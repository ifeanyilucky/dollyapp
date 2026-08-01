//! Screen Recording, Microphone, and Camera permission checks/requests.
//!
//! Rules from ARCHITECTURE.md, "Permissions":
//! 1. Never trigger an OS prompt cold — the frontend shows its own
//!    explanation screen first (see `permissions` Tauri commands below,
//!    called from that screen, not on app launch).
//! 2. Mic/camera are requested lazily, only when the user switches them on
//!    — never at startup alongside Screen Recording.
//! 3. A denied state deep-links into the exact System Settings pane.

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::{
    camera_status, microphone_status, open_camera_settings, open_microphone_settings,
    open_screen_recording_settings, request_camera, request_microphone,
    request_screen_recording, screen_recording_status,
};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionStatus {
    NotDetermined,
    Denied,
    Restricted,
    Authorized,
}
