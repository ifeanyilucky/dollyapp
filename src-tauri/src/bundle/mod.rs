//! The `.motionrec` recording bundle: on-disk layout, `meta.json` and
//! `cursor.json` schemas, and read/write helpers.
//!
//! Mirrored by `frontend/src/bundle/types.ts` — a `meta.json` or
//! `cursor.json` written here must deserialize there without translation.
//! Keep the two in sync by hand; there is no codegen step (see
//! ARCHITECTURE.md before adding one).

mod meta;
mod cursor_track;
mod writer;

pub use cursor_track::{CursorEvent, CursorSample, CursorTrack, CursorType};
pub use meta::{DisplayInfo, RecordingMeta};
pub use writer::BundleWriter;

/// File and directory names inside a `*.motionrec` bundle. Centralized so a
/// rename never has to be grepped for across the crate.
pub mod names {
    pub const META: &str = "meta.json";
    pub const CURSOR: &str = "cursor.json";
    pub const PROJECT: &str = "project.json";
    pub const SCREEN_VIDEO: &str = "screen.mov";
    pub const WEBCAM_VIDEO: &str = "webcam.mov";
    pub const SYSTEM_AUDIO: &str = "system.wav";
    pub const MIC_AUDIO: &str = "mic.wav";
    pub const EXTENSION: &str = "motionrec";
}
