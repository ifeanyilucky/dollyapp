//! Export IPC — the minimal, fast path for shipping a rendered video file
//! from the frontend to disk.
//!
//! The frontend renders the exported movie itself (canvas → `MediaRecorder`,
//! so the frames are pixel-identical to what the preview compositor draws),
//! then hands the finished bytes over. The bytes can be many tens of MB, so
//! they travel as a *raw* invoke body (`tauri::ipc::InvokeBody::Raw`) rather
//! than a base64/JSON payload — two commands are used because a raw body is
//! the *entire* payload (there's no room for a second path argument):
//!
//! 1. `export_set_destination(path, open_dir)` — records where the file goes.
//! 2. `export_write(bytes)` (raw body) — writes the bytes there.
//!
//! The file-writing commands are async and push their filesystem work onto
//! the blocking pool: a tens-of-MB write (or the legacy-directory fallback
//! read) must not occupy the event-loop/UI thread. `export_set_destination`
//! stays sync — it only records a path in state.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

/// Managed state for an export in progress: the destination path the frontend
/// picked in its save dialog, plus the allowed write roots snapshot taken
/// when it was set. `None` until `export_set_destination` runs, so a stray
/// `export_write` fails loudly instead of writing somewhere random.
#[derive(Default)]
pub struct ExportDest(Mutex<Option<(PathBuf, Vec<PathBuf>)>>);

/// The places the frontend may read from or write to: the recordings folder,
/// the app cache (where the staging dir for a recording in flight lives), and
/// the directory of the currently-open bundle (a `.dol` the user opened from
/// elsewhere — exports default to its folder too). Everything outside these is
/// out of scope for a renderer-facing command, so a compromised webview can't
/// use `read_file_bytes`/`export_write` to touch arbitrary files.
fn allowed_roots(app: &AppHandle, open_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = crate::projects::recordings_dir(app) {
        roots.push(dir);
    }
    if let Ok(dir) = app.path().app_cache_dir() {
        roots.push(dir);
    }
    if let Some(dir) = open_dir {
        roots.push(dir.to_path_buf());
    }
    roots
        .into_iter()
        .filter_map(|p| p.canonicalize().ok())
        .collect()
}

/// Canonicalizes `path` and checks it lives under one of `roots`, so `..`
/// segments and symlinks can't escape the boundary. `path` itself must exist
/// (that's what `canonicalize` requires) — callers pass an existing ancestor
/// when the target file doesn't exist yet, like an export destination.
fn resolve_within(path: &Path, roots: &[PathBuf]) -> Result<PathBuf> {
    let canonical = path
        .canonicalize()
        .with_context(|| format!("resolving {}", path.display()))?;
    if roots.iter().any(|root| canonical.starts_with(root)) {
        Ok(canonical)
    } else {
        anyhow::bail!("path {} is outside the app's folders", canonical.display())
    }
}

#[tauri::command]
pub fn export_set_destination(
    app: AppHandle,
    dest: State<'_, ExportDest>,
    path: String,
    open_dir: Option<String>,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("export destination path is empty".into());
    }
    let roots = allowed_roots(&app, open_dir.as_deref().map(Path::new));
    if roots.is_empty() {
        return Err("no export locations available (recordings and app-cache dirs unresolvable)".into());
    }
    // The dialog can point at a file that doesn't exist yet, which
    // `canonicalize` rejects — so scope on the canonicalized *parent*
    // directory, then keep the original (non-canonical) path for writing.
    let parent = Path::new(&path)
        .parent()
        .ok_or("export destination has no parent directory")?;
    resolve_within(parent, &roots).map_err(|e| e.to_string())?;
    *dest.0.lock().map_err(|e| e.to_string())? = Some((PathBuf::from(path), roots));
    Ok(())
}

#[tauri::command]
pub async fn export_write(dest: State<'_, ExportDest>, request: Request<'_>) -> Result<(), String> {
    let (path, roots) = dest
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("no export destination set — call export_set_destination first")?;
    let parent = path.parent().ok_or("export destination has no parent directory")?;
    resolve_within(parent, &roots).map_err(|e| e.to_string())?;

    // Copy the raw bytes out of the request up front so the borrowed
    // `Request` (not `Send`) can be dropped before the await below.
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.to_vec(),
        _ => return Err("expected a raw binary invoke body (invoke with a Uint8Array)".into()),
    };

    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create dir {}: {e}", parent.display()))?;
        }
        std::fs::write(&path, bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("export write task panicked: {e}"))?
}

/// Reads a file back into the webview as a raw byte response — the JS side
/// gets an `ArrayBuffer`. The export flow uses this (via `fetch` on the
/// `asset:` protocol, or this command as a fallback) to turn `screen.mov`
/// into a same-origin `blob:` URL so drawing its frames onto the export
/// canvas doesn't taint it (`captureStream` throws `SecurityError` on a
/// non-origin-clean canvas). Reads are scoped to the recordings and app-cache
/// directories — the only places `screen.mov` legitimately lives.
#[tauri::command]
pub async fn read_file_bytes(app: AppHandle, path: String) -> Result<Response, String> {
    let roots = allowed_roots(&app, None);
    let resolved = resolve_within(Path::new(&path), &roots).map_err(|e| e.to_string())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&resolved).map_err(|e| format!("read {}: {e}", resolved.display()))
    })
    .await
    .map_err(|e| format!("read task panicked: {e}"))??;
    Ok(Response::new(bytes))
}
