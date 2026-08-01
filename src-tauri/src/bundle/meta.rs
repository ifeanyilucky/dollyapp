use serde::{Deserialize, Serialize};

/// `meta.json` — written once, at the end of a recording.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingMeta {
    pub version: u32,
    /// `mach_absolute_time` at the moment the first video frame landed.
    /// Every timestamp in `cursor.json` is relative to this. See
    /// ARCHITECTURE.md "Recording format" — this field is why the two
    /// streams stay in sync.
    pub clock_epoch: u64,
    pub display: DisplayInfo,
    /// Wall-clock duration of the recording, in microseconds.
    pub duration_us: u64,
    pub has_webcam: bool,
    pub has_system_audio: bool,
    pub has_mic_audio: bool,
    pub fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub width_px: u32,
    pub height_px: u32,
    /// Retina scale factor (2.0 on most current Macs). Cursor coordinates in
    /// `cursor.json` are in the same point space as this display, not
    /// pixels — multiply by this factor to map onto `screen.mov` pixels.
    pub scale_factor: f64,
}

impl RecordingMeta {
    pub const CURRENT_VERSION: u32 = 1;
}
