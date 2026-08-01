//! Global cursor position, click, and key tracking.
//!
//! Deliberately built on `NSEvent.addGlobalMonitorForEventsMatchingMask`,
//! not `CGEventTap`: it's lighter weight and doesn't require the
//! Accessibility permission prompt, at the cost of being read-only (fine —
//! we only ever observe, never synthesize or block events). See
//! ARCHITECTURE.md "Permissions".

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::{
    mark_pause_on_main_thread, mark_resume_on_main_thread, start_on_main_thread,
    stop_on_main_thread, CursorRecorder,
};

use crate::bundle::CursorTrack;

/// Handle returned while a recording is in progress; `stop()` consumes it
/// and returns the finished track ready to hand to `BundleWriter`.
pub trait CursorRecording {
    fn stop(self) -> CursorTrack;
}
