//! The `.dol` recording bundle: the single-file on-disk format, the
//! `meta.json`/`cursor.json` schemas, and read/write helpers.
//!
//! Mirrored by `frontend/src/bundle/types.ts` — a `meta.json` or
//! `cursor.json` written here must deserialize there without translation.
//! Keep the two in sync by hand; there is no codegen step (see
//! ARCHITECTURE.md before adding one).
//!
//! A recording is staged into a plain directory in the app's cache during
//! capture (`screen.mov`/`mic.wav` can't be written into an archive live —
//! see `writer::BundleWriter` and `recorder::macos`'s doc comments for
//! why), then packed into one `.dol` file in `~/Movies/Dolly` at the very
//! end via `container::pack_recording`. Media entries are served to the
//! editor straight out of that file over the `dol://` custom scheme
//! (`dol_protocol`) — no unpacking on open. `fs::BundleReader` reads the
//! new single-file format and old `*.motionrec` directories left over from
//! before it existed — there is no migration, both forms just keep
//! working.

mod cursor_track;
pub mod container;
mod meta;
mod writer;

pub use cursor_track::{CursorEvent, CursorSample, CursorTrack, CursorType};
pub use meta::{DisplayInfo, RecordingMeta};
pub use writer::BundleWriter;

/// File names inside a bundle — either as zip entries (new `.dol` files) or
/// plain files in a directory (legacy `*.motionrec`, and the staging
/// directory every recording still starts as). Centralized so a rename
/// never has to be grepped for across the crate.
pub mod names {
    pub const META: &str = "meta.json";
    pub const CURSOR: &str = "cursor.json";
    pub const PROJECT: &str = "project.json";
    pub const SCREEN_VIDEO: &str = "screen.mov";
    pub const WEBCAM_VIDEO: &str = "webcam.mov";
    pub const SYSTEM_AUDIO: &str = "system.wav";
    pub const MIC_AUDIO: &str = "mic.wav";
    /// New recordings: a single `.dol` file (see the module doc comment).
    pub const EXTENSION: &str = "dol";
    /// Old recordings: a `*.motionrec` directory — `fs::BundleReader`/
    /// `fs::list_recordings` still recognize these so nothing already on
    /// disk stops working.
    pub const LEGACY_EXTENSION: &str = "motionrec";
}
