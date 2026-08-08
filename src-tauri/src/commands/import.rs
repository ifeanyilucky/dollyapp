use tauri::AppHandle;

/// Imports a foreign video file into a Dolly recording bundle (see
/// `crate::import`), returning the new `.dol` path. The frontend calls this
/// from the "Import video…" affordance and from file-drop handling.
#[tauri::command]
pub fn import_video(app: AppHandle, video_path: String) -> Result<String, String> {
    crate::import::import_video(&app, &video_path)
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}
