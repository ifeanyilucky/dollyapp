use tauri::{AppHandle, Manager, State};

use crate::recorder::{self, RecorderState};
use crate::toolbar;

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

/// Throws away the in-progress recording instead of saving it — see
/// `recorder::discard`'s doc comment. Leaves the toolbar showing (the
/// caller can immediately start a new recording), unlike `stop_recording`
/// which swaps to the editor.
#[tauri::command]
pub async fn discard_recording(
    app: AppHandle,
    state: State<'_, RecorderState>,
) -> Result<(), String> {
    recorder::discard(&app, &state)
        .await
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

/// System audio rides on the Screen Recording permission the video capture
/// already required, so there's no extra permission flow to gate this on.
#[tauri::command]
pub fn set_system_audio_enabled(state: State<'_, RecorderState>, enabled: bool) {
    recorder::set_system_audio_enabled(&state, enabled);
}

/// Called once, by `PermissionsGate`'s `onGranted`, right after Screen
/// Recording permission is granted for the first time — hides the regular
/// window (which was showing the permission flow) and shows the floating
/// toolbar, entering the app's normal steady state.
#[tauri::command]
pub fn enter_toolbar_mode(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    toolbar::show(&app).map_err(|e| e.to_string())
}

/// Called when the editor closes (including after deleting a recording) —
/// the reverse of the swap `recorder::stop` performs when a recording
/// finishes.
#[tauri::command]
pub fn return_to_toolbar(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    toolbar::show(&app).map_err(|e| e.to_string())
}
