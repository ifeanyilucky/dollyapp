//! Screen capture.
//!
//! Current state (M0): `macos::FrameGrabber` pulls raw frames from `scap`
//! and hands each one, with a shared-clock timestamp, to a caller-supplied
//! sink. The M0 sync spike (`src/bin/sync_spike.rs`) uses this to dump a
//! timestamped PNG sequence — enough to visually verify a click event lands
//! on the right frame, which is the entire goal of that milestone.
//!
//! What's deliberately *not* here yet: HEVC/VideoToolbox encoding straight
//! to `screen.mov`, and the `SCStreamConfiguration.showsCursor = false` +
//! `SCContentFilter` exclusion of Dolly's own windows. Both belong to M1
//! (recorder core) and M3 (export), per ARCHITECTURE.md's milestone split —
//! building them before sync is proven would be solving the wrong problem
//! first.

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
