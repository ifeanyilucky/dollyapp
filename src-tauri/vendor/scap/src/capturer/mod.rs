pub mod engine;

use std::{error::Error, sync::mpsc};

use engine::ChannelItem;

use crate::{
    frame::{Frame, FrameType},
    has_permission, is_supported,
    targets::Target,
};

pub use engine::get_output_frame_size;

#[derive(Debug, Clone, Copy, Default)]
pub enum Resolution {
    _480p,
    _720p,
    _1080p,
    _1440p,
    _2160p,
    _4320p,

    #[default]
    Captured,
}

impl Resolution {
    fn value(&self, aspect_ratio: f32) -> [u32; 2] {
        match *self {
            Resolution::_480p => [640, (640_f32 / aspect_ratio).floor() as u32],
            Resolution::_720p => [1280, (1280_f32 / aspect_ratio).floor() as u32],
            Resolution::_1080p => [1920, (1920_f32 / aspect_ratio).floor() as u32],
            Resolution::_1440p => [2560, (2560_f32 / aspect_ratio).floor() as u32],
            Resolution::_2160p => [3840, (3840_f32 / aspect_ratio).floor() as u32],
            Resolution::_4320p => [7680, (7680_f32 / aspect_ratio).floor() as u32],
            Resolution::Captured => {
                panic!(".value should not be called when Resolution type is Captured")
            }
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Default, Clone)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}
#[derive(Debug, Default, Clone)]
pub struct Area {
    pub origin: Point,
    pub size: Size,
}

/// Options passed to the screen capturer
#[derive(Debug, Default, Clone)]
pub struct Options {
    pub fps: u32,
    pub show_cursor: bool,
    pub show_highlight: bool,
    pub target: Option<Target>,
    pub crop_area: Option<Area>,
    pub output_type: FrameType,
    pub output_resolution: Resolution,
    // excluded targets will only work on macOS
    pub excluded_targets: Option<Vec<Target>>,
}

/// Screen capturer class
pub struct Capturer {
    engine: engine::Engine,
    rx: mpsc::Receiver<ChannelItem>,
}

#[derive(Debug)]
pub enum CapturerBuildError {
    NotSupported,
    PermissionNotGranted,
}

impl std::fmt::Display for CapturerBuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CapturerBuildError::NotSupported => write!(f, "Screen capturing is not supported"),
            CapturerBuildError::PermissionNotGranted => {
                write!(f, "Permission to capture the screen is not granted")
            }
        }
    }
}

impl Error for CapturerBuildError {}

impl Capturer {
    /// Create a new capturer instance with the provided options
    #[deprecated(
        since = "0.0.6",
        note = "Use `build` instead of `new` to create a new capturer instance."
    )]
    pub fn new(options: Options) -> Capturer {
        let (tx, rx) = mpsc::channel();
        let engine = engine::Engine::new(&options, tx);

        Capturer { engine, rx }
    }

    /// Build a new [Capturer] instance with the provided options
    pub fn build(options: Options) -> Result<Capturer, CapturerBuildError> {
        if !is_supported() {
            return Err(CapturerBuildError::NotSupported);
        }

        if !has_permission() {
            return Err(CapturerBuildError::PermissionNotGranted);
        }

        let (tx, rx) = mpsc::channel();
        let engine = engine::Engine::new(&options, tx);

        Ok(Capturer { engine, rx })
    }

    // TODO
    // Prevent starting capture if already started
    /// Start capturing the frames
    pub fn start_capture(&mut self) {
        self.engine.start();
    }

    /// Stop the capturer
    pub fn stop_capture(&mut self) {
        self.engine.stop();
    }

    /// Get the next captured frame
    pub fn get_next_frame(&self) -> Result<Frame, mpsc::RecvError> {
        loop {
            let res = self.rx.recv()?;

            if let Some(frame) = self.engine.process_channel_item(res) {
                return Ok(frame);
            }
        }
    }

    /// Get the next captured frame, waiting at most `timeout` for one to
    /// arrive. Unlike [`Capturer::get_next_frame`] this can never block
    /// forever, so callers can keep responding to their own stop signals
    /// even when a stream is alive but delivering nothing (ScreenCaptureKit
    /// can stall a stream without dropping it or reporting an error — see
    /// Dolly's `capture::FrameGrabber::run_while` watchdog).
    pub fn recv_timeout(&self, timeout: std::time::Duration) -> Result<Frame, RecvError> {
        loop {
            if self.engine.has_error() {
                return Err(RecvError::StreamError);
            }
            match self.rx.recv_timeout(timeout) {
                Ok(item) => {
                    if let Some(frame) = self.engine.process_channel_item(item) {
                        return Ok(frame);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => return Err(RecvError::Timeout),
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err(RecvError::Disconnected),
            }
        }
    }

    /// Get the dimensions the frames will be captured in
    pub fn get_output_frame_size(&mut self) -> [u32; 2] {
        self.engine.get_output_frame_size()
    }

    pub fn raw(&self) -> RawCapturer {
        RawCapturer { capturer: self }
    }
}

/// Failure modes for [`Capturer::recv_timeout`].
#[derive(Debug)]
pub enum RecvError {
    /// No frame arrived within the given timeout.
    Timeout,
    /// The capture stream's channel was dropped — capture has ended.
    Disconnected,
    /// ScreenCaptureKit reported a stream error.
    StreamError,
}

impl std::fmt::Display for RecvError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RecvError::Timeout => write!(f, "timed out waiting for a frame"),
            RecvError::Disconnected => write!(f, "capture stream ended"),
            RecvError::StreamError => write!(f, "capture stream failed"),
        }
    }
}

impl Error for RecvError {}

pub struct RawCapturer<'a> {
    capturer: &'a Capturer,
}
