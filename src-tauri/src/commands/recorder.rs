use tauri::{AppHandle, State};

use crate::recorder::{self, RecorderState};

/// Lets the UI pick up state changed elsewhere (tray menu, global
/// shortcut) — e.g. on mount, or after the window regains focus.
#[tauri::command]
pub fn recording_status(state: State<'_, RecorderState>) -> bool {
    recorder::is_recording(&state)
}

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

/// The frontend must have already confirmed microphone permission via
/// `request_microphone_permission` before calling this with `true` —
/// enabling here doesn't itself trigger the OS prompt.
#[tauri::command]
pub fn set_mic_enabled(state: State<'_, RecorderState>, enabled: bool) {
    recorder::set_mic_enabled(&state, enabled);
}
