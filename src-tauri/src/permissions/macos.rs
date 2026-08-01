use std::sync::Mutex;

use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio, AVMediaTypeVideo};

use super::PermissionStatus;

/// `scap`/`CGPreflightScreenCaptureAccess` only report a boolean, so this
/// collapses "denied" and "not yet asked" into the same `NotDetermined`
/// value — there is no first-class macOS API to tell them apart for Screen
/// Recording specifically (unlike mic/camera, which use `AVAuthorizationStatus`
/// below and *can* distinguish all four states). The frontend should treat
/// `NotDetermined` as "show the pre-prompt screen" either way.
pub fn screen_recording_status() -> PermissionStatus {
    if scap::has_permission() {
        PermissionStatus::Authorized
    } else {
        PermissionStatus::NotDetermined
    }
}

/// Triggers the OS prompt if not yet determined; otherwise a no-op that
/// returns the current grant state. Caller must have shown the pre-prompt
/// explanation screen first (ARCHITECTURE.md, "Permissions", rule 1).
pub fn request_screen_recording() -> bool {
    scap::request_permission()
}

impl From<AVAuthorizationStatus> for PermissionStatus {
    fn from(status: AVAuthorizationStatus) -> Self {
        match status {
            AVAuthorizationStatus::Restricted => PermissionStatus::Restricted,
            AVAuthorizationStatus::Denied => PermissionStatus::Denied,
            AVAuthorizationStatus::Authorized => PermissionStatus::Authorized,
            _ => PermissionStatus::NotDetermined,
        }
    }
}

pub fn microphone_status() -> PermissionStatus {
    let media_type = unsafe { AVMediaTypeAudio }.expect("AVMediaTypeAudio unavailable");
    unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) }.into()
}

pub fn camera_status() -> PermissionStatus {
    let media_type = unsafe { AVMediaTypeVideo }.expect("AVMediaTypeVideo unavailable");
    unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) }.into()
}

/// Requests microphone access, showing the OS dialog if not yet determined.
/// Only ever call this at the moment the user switches mic recording on
/// (ARCHITECTURE.md, "Permissions", rule 2) — never at launch.
pub async fn request_microphone() -> bool {
    let media_type = unsafe { AVMediaTypeAudio }.expect("AVMediaTypeAudio unavailable");
    request_access(media_type).await
}

/// Same as `request_microphone`, for the webcam overlay.
pub async fn request_camera() -> bool {
    let media_type = unsafe { AVMediaTypeVideo }.expect("AVMediaTypeVideo unavailable");
    request_access(media_type).await
}

async fn request_access(media_type: &objc2_av_foundation::AVMediaType) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));

    // AVFoundation copies/retains completion-handler blocks it's handed for
    // as long as the async operation is in flight, so `handler` dropping at
    // the end of this function (once the call below returns) is safe — same
    // pattern as the NSEvent global monitor in cursor/macos.rs.
    let handler = block2_avf::RcBlock::new(move |granted: objc2_avf::runtime::Bool| {
        if let Some(tx) = tx.lock().unwrap().take() {
            let _ = tx.send(granted.into());
        }
    });

    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &handler);
    }

    rx.await.unwrap_or(false)
}

fn open_settings_pane(pane_query: &str) {
    let url = format!("x-apple.systempreferences:com.apple.preference.security?{pane_query}");
    if let Err(e) = std::process::Command::new("open").arg(&url).spawn() {
        tracing::warn!("failed to open System Settings pane {url}: {e}");
    }
}

pub fn open_screen_recording_settings() {
    open_settings_pane("Privacy_ScreenCapture");
}

pub fn open_microphone_settings() {
    open_settings_pane("Privacy_Microphone");
}

pub fn open_camera_settings() {
    open_settings_pane("Privacy_Camera");
}
