//! Orchestrates one recording: starts/stops capture and cursor tracking
//! together, writes the finished `.motionrec` bundle.
//!
//! Still using the M0 PNG-sequence capture path rather than a real
//! `screen.mov` — see `capture/mod.rs` and `encode/mod.rs` for why that's
//! deliberately deferred. Everything else here (permissions already
//! granted, target picker, pause/resume, bundle writing) is real.

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::{
    discard, is_recording, pause, resume, set_mic_enabled, set_selected_area, set_selected_target,
    set_system_audio_enabled, start, stop, RecorderState,
};

/// Tauri event name, payload `bool` (true = now recording). Emitted by
/// `start`/`stop` so the frontend stays in sync when recording is toggled
/// from the tray menu or the global shortcut instead of the UI.
pub const RECORDING_STATE_EVENT: &str = "recording-state-changed";

/// Tauri event name, payload the finished bundle's path (string). Emitted
/// by `stop` — the floating toolbar (where recording is started/stopped)
/// and the editor (which opens the result) are separate windows/webviews,
/// so this is how the "main" window learns which bundle to open, however
/// the stop was triggered (toolbar button, tray menu, or global shortcut).
pub const RECORDING_FINISHED_EVENT: &str = "recording-finished";
