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
//! Not here: system audio (`SCStreamConfiguration.showsAudio`) would need a
//! hand-rolled `SCStream` rather than scap, so recordings carry video only —
//! the mic narration and ambient music are captured separately and mixed in
//! at render/export time. Dolly's own windows *are* excluded from
//! display/area captures via scap's `excluded_targets` knob →
//! `SCContentFilter`'s `DisplayExcludingWindows` (see `own_window_targets`),
//! so the always-on-top toolbar never appears in a recording.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod targets;

#[cfg(target_os = "macos")]
pub use macos::{CapturedFrame, FrameGrabber};
#[cfg(target_os = "macos")]
pub use targets::{
    crop_area_for_target, cursor_position, display_bounds, list_targets, main_display,
    resolve_target, scale_factor, target_origin, window_at_cursor, window_at_point, CropArea,
    TargetInfo, TargetKind, WindowHitInfo,
};
#[cfg(target_os = "macos")]
pub use macos::own_window_targets;
