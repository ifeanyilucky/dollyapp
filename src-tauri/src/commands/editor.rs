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
}

#[tauri::command]
pub fn load_recording(bundle_path: String) -> Result<LoadedRecording, String> {
    let reader = BundleReader::open(&bundle_path).map_err(|e| e.to_string())?;
    let meta = reader.read_meta().map_err(|e| e.to_string())?;
    let cursor_track = reader.read_cursor_track().map_err(|e| e.to_string())?;
    let screen_video_path = reader.screen_video_path().to_string_lossy().into_owned();

    Ok(LoadedRecording {
        meta,
        cursor_track,
        screen_video_path,
    })
}
