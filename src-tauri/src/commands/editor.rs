use serde::Serialize;

use crate::bundle::{CursorTrack, RecordingMeta};
use crate::fs::BundleReader;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedRecording {
    meta: RecordingMeta,
    cursor_track: CursorTrack,
    /// Absolute path to `screen.mov` — the frontend turns this into a
    /// playable `<video src>` via `convertFileSrc` (see ARCHITECTURE.md /
    /// the asset-protocol scope configured for `$VIDEO/Dolly/**`).
    screen_video_path: String,
    /// Absolute path `mic.wav` would live at — only meaningful when
    /// `meta.has_mic_audio` is true (see `BundleReader::mic_audio_path`).
    mic_audio_path: String,
}

#[tauri::command]
pub fn load_recording(bundle_path: String) -> Result<LoadedRecording, String> {
    let reader = BundleReader::open(&bundle_path).map_err(|e| e.to_string())?;
    let meta = reader.read_meta().map_err(|e| e.to_string())?;
    let cursor_track = reader.read_cursor_track().map_err(|e| e.to_string())?;
    let screen_video_path = reader.screen_video_path().to_string_lossy().into_owned();
    let mic_audio_path = reader.mic_audio_path().to_string_lossy().into_owned();

    Ok(LoadedRecording {
        meta,
        cursor_track,
        screen_video_path,
        mic_audio_path,
    })
}

/// Opens the bundle folder in Finder. Implemented as a plain `open`
/// invocation (same pattern as `permissions::open_screen_recording_settings`)
/// rather than through `tauri-plugin-shell`'s `open` command — that
/// command's default ACL scope only covers `http(s)`/`tel`/`mailto`
/// links, not arbitrary local paths, and Rust-side code doesn't need ACL
/// grants the way frontend-invoked plugin commands do.
#[tauri::command]
pub fn reveal_in_finder(bundle_path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&bundle_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Deletes a recording bundle. The frontend is expected to have already
/// confirmed with the user — this performs the delete unconditionally.
/// `BundleReader::open` first as a sanity check (must actually look like
/// a `.motionrec` bundle, i.e. contain `meta.json`) so a bad path can't
/// end up passed to `remove_dir_all` directly.
#[tauri::command]
pub fn delete_recording(bundle_path: String) -> Result<(), String> {
    let reader = BundleReader::open(&bundle_path).map_err(|e| e.to_string())?;
    std::fs::remove_dir_all(reader.path()).map_err(|e| e.to_string())
}
