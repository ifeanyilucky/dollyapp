use serde::{Deserialize, Serialize};

/// `cursor.json` — the cursor position/event track for one recording.
///
/// Sampled at 120Hz against 60fps video deliberately: the One Euro filter
/// in the motion engine needs oversampled input to smooth well. See
/// ARCHITECTURE.md "The motion engine".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorTrack {
    pub version: u32,
    /// Must equal `RecordingMeta::clock_epoch` for the same recording.
    pub clock_epoch: u64,
    pub sample_rate: u32,
    pub samples: Vec<CursorSample>,
    pub events: Vec<CursorEvent>,
}

impl CursorTrack {
    pub const CURRENT_VERSION: u32 = 1;
    pub const SAMPLE_RATE_HZ: u32 = 120;

    pub fn new(clock_epoch: u64) -> Self {
        Self {
            version: Self::CURRENT_VERSION,
            clock_epoch,
            sample_rate: Self::SAMPLE_RATE_HZ,
            samples: Vec::new(),
            events: Vec::new(),
        }
    }
}

/// A single position sample. `t` is microseconds since `clock_epoch` — never
/// `Date.now()` / `Instant::now()` on their own, always derived from the
/// shared epoch (ARCHITECTURE.md "Recording format").
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CursorSample {
    pub t: u64,
    pub x: f64,
    pub y: f64,
    #[serde(rename = "type")]
    pub cursor_type: CursorType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CursorType {
    Arrow,
    IBeam,
    PointingHand,
    ResizeLeftRight,
    ResizeUpDown,
    ClosedHand,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CursorEvent {
    LeftDown { t: u64, x: f64, y: f64 },
    LeftUp { t: u64, x: f64, y: f64 },
    RightDown { t: u64, x: f64, y: f64 },
    RightUp { t: u64, x: f64, y: f64 },
    /// Key *code* only — never the resolved character or text content.
    /// Keystroke display is a rendering feature, not a transcript.
    Key { t: u64, code: u16, modifiers: Vec<String> },
    Scroll { t: u64, dy: f64 },
    /// Written on pause/resume instead of splicing the video stream
    /// (ARCHITECTURE.md, Recorder section).
    Gap { t: u64, resumed_at: Option<u64> },
}
