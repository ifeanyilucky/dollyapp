//! Opening past recordings from outside the normal record -> stop -> edit
//! flow — backs the tray's "Show previous projects" submenu, "Open
//! project...", and "Open last project", plus the settings window's
//! recordings-location display. Everything funnels through
//! `open_in_editor`, which does exactly what `recorder::stop` does once a
//! recording finishes (see that function's doc comment): emit
//! `RECORDING_FINISHED_EVENT`, hide the toolbar, show+focus the main
//! window — so a manually-opened recording lands in the same place a
//! freshly-finished one does.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tauri::{AppHandle, Emitter, Manager};

use crate::fs::{list_recordings, BundleReader};
use crate::{recorder, toolbar};

/// `~/Movies/Dolly` — where `recorder::macos::new_bundle_dir` writes every
/// recording. Kept in one place since both new-recording creation and this
/// module's "browse past recordings" need the same path.
pub fn recordings_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .video_dir()
        .context("could not resolve the user's Movies directory")?;
    Ok(base.join("Dolly"))
}

/// Most-recently-modified bundles first, capped at `limit`. Empty (not an
/// error) if the recordings directory doesn't exist yet — a fresh install
/// with no recordings made.
pub fn list_recent(app: &AppHandle, limit: usize) -> Vec<PathBuf> {
    let Ok(dir) = recordings_dir(app) else {
        return Vec::new();
    };
    list_recordings(&dir)
        .unwrap_or_default()
        .into_iter()
        .take(limit)
        .collect()
}

/// Opens `bundle_path` in the editor, exactly as if the recording had just
/// finished (see module doc comment). Silently no-ops on an invalid path —
/// callers are tray menu clicks and a file dialog result, neither of which
/// has anywhere better to surface an error than a log line.
pub fn open_in_editor(app: &AppHandle, bundle_path: &Path) {
    if let Err(e) = BundleReader::open(bundle_path) {
        tracing::warn!("not a Dolly recording bundle: {e}");
        return;
    }

    let _ = app.emit(
        recorder::RECORDING_FINISHED_EVENT,
        bundle_path.display().to_string(),
    );
    toolbar::hide(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Opens the single most recently modified recording, if any exist.
pub fn open_last(app: &AppHandle) {
    if let Some(path) = list_recent(app, 1).into_iter().next() {
        open_in_editor(app, &path);
    }
}

/// Native "choose a folder" dialog, defaulted to the recordings directory,
/// for opening a `.motionrec` bundle that isn't in the recent list (or was
/// moved elsewhere). Asynchronous — resolves via callback whenever the user
/// finishes with the dialog, same as every other `tauri-plugin-dialog` call
/// in this codebase.
pub fn open_project_dialog(app: AppHandle) {
    use tauri_plugin_dialog::DialogExt;

    let mut file_dialog = app.dialog().file().set_title("Open Recording");
    if let Ok(dir) = recordings_dir(&app) {
        file_dialog = file_dialog.set_directory(dir);
    }

    let app_for_callback = app.clone();
    file_dialog.pick_folder(move |folder| {
        let Some(folder) = folder else { return };
        let Ok(path) = folder.into_path() else { return };
        open_in_editor(&app_for_callback, &path);
    });
}
