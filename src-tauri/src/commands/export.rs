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
//! 1. `export_set_destination(path)` — records where the file goes.
//! 2. `export_write(bytes)` (raw body) — writes the bytes there.
//!
//! Plain `std::fs::write` is fine here: writing happens once, after the whole
//! movie has been recorded, so there's no streaming or partial-progress need.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request};
use tauri::State;

/// Managed state for an export in progress: the destination path the frontend
/// picked in its save dialog. `None` until `export_set_destination` runs, so
/// a stray `export_write` fails loudly instead of writing somewhere random.
#[derive(Default)]
pub struct ExportDest(Mutex<Option<PathBuf>>);

#[tauri::command]
pub fn export_set_destination(dest: State<'_, ExportDest>, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("export destination path is empty".into());
    }
    *dest.0.lock().map_err(|e| e.to_string())? = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub fn export_write(dest: State<'_, ExportDest>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw binary invoke body (invoke with a Uint8Array)".into());
    };
    let path = dest
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("no export destination set — call export_set_destination first")?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir {}: {e}", parent.display()))?;
    }
    std::fs::write(&path, bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(())
}
