use serde::Serialize;

use crate::bundle::{CursorTrack, RecordingMeta};
use crate::fs::BundleReader;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedRecording {
    meta: RecordingMeta,
    cursor_track: CursorTrack,
    /// Absolute path to the bundle the recording lives in — a single
    /// `Recording N.dol` file for new recordings, a `*.motionrec` directory
    /// for legacy ones. Used by the frontend for the editor title, the
    /// export-save default, and reveal-in-Finder.
    bundle_path: String,
    /// Playable URL for the screen capture: a `dol://` URL served by the
    /// custom protocol for `.dol` bundles, or the absolute `screen.mov` path
    /// for legacy directories (which the frontend turns into an `asset:`
    /// URL via `convertFileSrc`). Feed this straight to a `<video>`.
    screen_video_url: String,
    /// Counterpart to `screen_video_url` for the mic track — `None` when
    /// `meta.has_mic_audio` is false.
    mic_audio_url: Option<String>,
    /// The editor's saved `project.json` — the frontend's `EditorDocument`
    /// (crop, slices, masks, zoom keyframes, style, ...). `None` until the
    /// recording's first edit is saved, so a never-touched recording loads
    /// fresh defaults + auto-generated keyframes (ARCHITECTURE.md, "absent
    /// until first edit").
    project_json: Option<String>,
}

#[tauri::command]
pub fn load_recording(bundle_path: String) -> Result<LoadedRecording, String> {
    let reader = BundleReader::open(&bundle_path).map_err(|e| e.to_string())?;
    let meta = reader.read_meta().map_err(|e| e.to_string())?;
    let cursor_track = reader.read_cursor_track().map_err(|e| e.to_string())?;
    let screen_video_url = reader.screen_video_url();
    let mic_audio_url = meta.has_mic_audio.then(|| reader.mic_audio_url().unwrap_or_default());
    let project_json = reader.read_project();

    Ok(LoadedRecording {
        meta,
        cursor_track,
        bundle_path: reader.path().display().to_string(),
        screen_video_url,
        mic_audio_url,
        project_json,
    })
}

/// Persists the editor's `EditorDocument` into the recording's
/// `project.json` entry — the save half of project persistence (load comes
/// back through `load_recording`'s `projectJson`). See
/// `BundleReader::write_project` for how the `.dol` archive is safely
/// rewritten.
#[tauri::command]
pub fn save_project(bundle_path: String, project_json: String) -> Result<(), String> {
    let reader = BundleReader::open(&bundle_path).map_err(|e| e.to_string())?;
    reader.write_project(&project_json).map_err(|e| e.to_string())
}

/// Reveals the bundle in Finder — a single file for `.dol` bundles, a
/// folder for legacy `*.motionrec`. Implemented as a plain `open -R`
/// invocation (same pattern as `permissions::open_screen_recording_settings`)
/// rather than through `tauri-plugin-shell`'s `open` command — that
/// command's default ACL scope only covers `http(s)`/`tel`/`mailto`
/// links, not arbitrary local paths, and Rust-side code doesn't need ACL
/// grants the way frontend-invoked plugin commands do.
#[tauri::command]
pub fn reveal_in_finder(bundle_path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(&bundle_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Deletes a recording bundle. The frontend is expected to have already
/// confirmed with the user — this performs the delete unconditionally.
/// `BundleReader::open` first as a sanity check (must actually look like a
/// Dolly recording) so a bad path can't end up passed to the filesystem
/// delete directly.
#[tauri::command]
pub fn delete_recording(bundle_path: String) -> Result<(), String> {
    let reader = BundleReader::open(&bundle_path).map_err(|e| e.to_string())?;
    reader.remove().map_err(|e| e.to_string())
}
