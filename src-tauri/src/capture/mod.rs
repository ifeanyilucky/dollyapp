//! Screen capture.
//!
//! `macos::FrameGrabber` pulls raw BGRA frames from `scap` and hands each
//! one, with a shared-clock timestamp, to a caller-supplied sink. Two
//! consumers:
//! - The M0 sync spike (`src/bin/sync_spike.rs`) dumps a timestamped PNG
//!   sequence — enough to visually verify a click event lands on the right
//!   frame, which is that milestone's entire goal.
//! - The real recorder (`recorder` module) feeds frames straight into
//!   `encode::MovWriter` for a real `screen.mov`.
//!
//! Still deliberately *not* here: `SCStreamConfiguration.showsCursor =
//! false` + `SCContentFilter` exclusion of Dolly's own windows (`scap`
//! doesn't expose these knobs; would need a hand-rolled `SCStream` to add
//! them — see `encode/mod.rs`'s doc comment for why that's a separate,
//! larger undertaking), and system audio for the same reason.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod targets;

#[cfg(target_os = "macos")]
pub use macos::{CapturedFrame, FrameGrabber};
#[cfg(target_os = "macos")]
pub use targets::{
    list_targets, main_display, resolve_target, scale_factor, TargetInfo, TargetKind,
};
