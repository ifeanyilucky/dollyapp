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
pub use macos::{is_recording, pause, resume, start, stop, RecorderState};
