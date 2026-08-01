use tauri::{AppHandle, State};

use crate::recorder::{self, RecorderState};

#[tauri::command]
pub fn start_recording(app: AppHandle, state: State<'_, RecorderState>) -> Result<(), String> {
    recorder::start(&app, &state).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, RecorderState>,
) -> Result<String, String> {
    recorder::stop(&app, &state)
        .await
        .map(|path| path.display().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pause_recording(app: AppHandle, state: State<'_, RecorderState>) -> Result<(), String> {
    recorder::pause(&app, &state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resume_recording(app: AppHandle, state: State<'_, RecorderState>) -> Result<(), String> {
    recorder::resume(&app, &state).map_err(|e| e.to_string())
}
