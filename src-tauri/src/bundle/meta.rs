use serde::{Deserialize, Serialize};

/// `meta.json` — written once, at the end of a recording.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMeta {
    pub version: u32,
    /// `mach_absolute_time` at the moment `Clock::start()` was called, just
    /// before cursor tracking and capture both begin — every `t` in
    /// `cursor.json`, and `video_start_us` below, are relative to this. See
    /// ARCHITECTURE.md "Recording format" — this field is why the two
    /// streams stay in sync.
    pub clock_epoch: u64,
    /// `t` (relative to `clock_epoch`, same units as `cursor.json`) of the
    /// first frame actually written to `screen.mov`. Needed because
    /// `AVAssetWriter.startSessionAtSourceTime` anchors the *movie's own*
    /// zero to that frame's timestamp, not to `clock_epoch` — capture
    /// always has some startup latency before the first real frame lands,
    /// so this is never 0. To map an HTML `<video>` element's
    /// `currentTime` (movie-relative seconds) onto a `cursor.json`
    /// timestamp: `t = currentTime * 1_000_000 + video_start_us`.
    pub video_start_us: u64,
    pub display: DisplayInfo,
    /// Wall-clock duration of the recording, in microseconds.
    pub duration_us: u64,
    pub has_webcam: bool,
    pub has_system_audio: bool,
    pub has_mic_audio: bool,
    pub fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub width_px: u32,
    pub height_px: u32,
    /// Retina scale factor (2.0 on most current Macs). Cursor coordinates in
    /// `cursor.json` are in the same point space as this display, not
    /// pixels — multiply by this factor to map onto `screen.mov` pixels.
    pub scale_factor: f64,
    /// Top-left of the captured content (window, cropped area, or display),
    /// in the *global* point space `cursor.json` samples are already in
    /// (same coordinate system `CGEvent::location()` reports — see
    /// `cursor::macos`). Cursor samples are never re-anchored on write, so
    /// consumers must subtract this before mapping a sample onto video
    /// pixel coordinates: `videoX = (cursor.x - originX) * scaleFactor`.
    /// `(0, 0)` for a full main-display recording, since that display's
    /// own origin already *is* the global origin.
    pub origin_x: f64,
    pub origin_y: f64,
}

impl RecordingMeta {
    pub const CURRENT_VERSION: u32 = 1;
}
