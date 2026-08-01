use crate::permissions::{self, PermissionStatus};

#[tauri::command]
pub fn screen_recording_permission_status() -> PermissionStatus {
    permissions::screen_recording_status()
}

#[tauri::command]
pub fn microphone_permission_status() -> PermissionStatus {
    permissions::microphone_status()
}

#[tauri::command]
pub fn camera_permission_status() -> PermissionStatus {
    permissions::camera_status()
}

/// Only call after the pre-prompt explanation screen has been shown
/// (ARCHITECTURE.md, "Permissions").
#[tauri::command]
pub fn request_screen_recording_permission() -> bool {
    permissions::request_screen_recording()
}

#[tauri::command]
pub async fn request_microphone_permission() -> bool {
    permissions::request_microphone().await
}

#[tauri::command]
pub async fn request_camera_permission() -> bool {
    permissions::request_camera().await
}

#[tauri::command]
pub fn open_screen_recording_settings() {
    permissions::open_screen_recording_settings();
}

#[tauri::command]
pub fn open_microphone_settings() {
    permissions::open_microphone_settings();
}

#[tauri::command]
pub fn open_camera_settings() {
    permissions::open_camera_settings();
}
