use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use scap::capturer::{Capturer, Options, RecvError, Resolution};
use scap::frame::{Frame, FrameType};

use crate::clock::Clock;

/// One captured frame, timestamped against the recording's shared clock —
/// never against `scap`'s own `display_time`, which is not guaranteed to
/// share an epoch with the cursor track. See ARCHITECTURE.md, "Recording
/// format".
pub struct CapturedFrame {
    pub t: u64,
    pub width: u32,
    pub height: u32,
    /// BGRA8, row-major, no padding. Cheap to hand to `image::RgbaImage`
    /// for the M0 PNG dump; the production encoder (M3) will want YUV
    /// BiPlanar instead (`FrameType::YUVFrame`) to stay GPU-resident into
    /// VideoToolbox, so this type is expected to change shape once that
    /// lands.
    pub bgra: Vec<u8>,
}

impl CapturedFrame {
    /// Swaps channel order for `image::RgbaImage`/PNG output. Only used by
    /// the interim PNG-sequence capture path (see the module doc comment);
    /// goes away once frames feed VideoToolbox directly instead.
    pub fn to_rgba_bytes(&self) -> Vec<u8> {
        let mut rgba = vec![0u8; self.bgra.len()];
        for (src, dst) in self.bgra.chunks_exact(4).zip(rgba.chunks_exact_mut(4)) {
            dst[0] = src[2]; // R <- B
            dst[1] = src[1]; // G
            dst[2] = src[0]; // B <- R
            dst[3] = src[3]; // A
        }
        rgba
    }
}

/// Pulls frames from `scap` at a fixed fps, stamping each with the shared
/// `Clock`. Blocking: both capture methods run on the calling thread for
/// their whole duration, invoking `on_frame` synchronously for each frame
/// so callers don't have to deal with buffering/backpressure themselves —
/// callers that need this off the main thread (the real recorder does)
/// are expected to run it on a dedicated thread of their own.
pub struct FrameGrabber {
    capturer: Capturer,
    clock: Clock,
}

impl FrameGrabber {
    /// `target`: `None` captures the main display (the sync-spike binary's
    /// use case); the real recorder always passes an explicit target,
    /// resolved from the picker via `capture::resolve_target`. `crop_area`
    /// restricts capture to a sub-rectangle of `target` (PRD §9's "region"
    /// picker) — in `target`'s own point space, i.e. `(0,0)` is always
    /// `target`'s own top-left, not the global desktop origin.
    pub fn new(
        clock: Clock,
        fps: u32,
        target: Option<scap::Target>,
        crop_area: Option<scap::capturer::Area>,
    ) -> Result<Self> {
        if !scap::has_permission() {
            // The caller is expected to have already walked the user
            // through the pre-prompt explanation screen (ARCHITECTURE.md,
            // "Permissions") before this is ever reached in the real app;
            // the sync-spike binary just requests it directly.
            if !scap::request_permission() {
                return Err(anyhow!("screen recording permission was denied"));
            }
        }

        let options = Options {
            fps,
            target,
            show_cursor: false,
            show_highlight: false,
            excluded_targets: None,
            output_type: FrameType::BGRAFrame,
            output_resolution: Resolution::Captured,
            crop_area,
        };

        let capturer = Capturer::build(options)
            .map_err(|e| anyhow!("failed to build screen capturer: {e}"))?;
        Ok(Self { capturer, clock })
    }

    /// Used by the M0 sync-spike binary, which wants a fixed-length clip
    /// rather than start/stop control.
    pub fn capture_for(
        &mut self,
        duration: std::time::Duration,
        on_frame: impl FnMut(CapturedFrame),
    ) -> Result<()> {
        let deadline = std::time::Instant::now() + duration;
        self.run_while(|| std::time::Instant::now() < deadline, on_frame)
    }

    /// Used by the real recorder (`recorder` module): runs until
    /// `stop_flag` is set from another thread. Checked between frames, so
    /// stopping is bounded by roughly one frame interval, not instant —
    /// fine for a "stop recording" click.
    pub fn run_until_stopped(
        &mut self,
        stop_flag: &AtomicBool,
        on_frame: impl FnMut(CapturedFrame),
    ) -> Result<()> {
        self.run_while(|| !stop_flag.load(Ordering::Relaxed), on_frame)
    }

    fn run_while(
        &mut self,
        mut keep_going: impl FnMut() -> bool,
        mut on_frame: impl FnMut(CapturedFrame),
    ) -> Result<()> {
        self.capturer.start_capture();

        // Poll with a bounded wait instead of blocking forever inside
        // scap's channel (its `get_next_frame` is unbounded). A stalled or
        // failed ScreenCaptureKit stream would otherwise leave this thread
        // parked forever: the recording never finalizes and
        // `recorder::stop`'s thread join hangs with it.
        let mut last_frame_at = Instant::now();
        while keep_going() {
            match self.capturer.recv_timeout(POLL_INTERVAL) {
                Ok(frame) => {
                    last_frame_at = Instant::now();

                    let Frame::BGRA(bgra_frame) = frame else {
                        continue;
                    };

                    on_frame(CapturedFrame {
                        // Stamped on receipt, not from `display_time`, per the
                        // shared-clock rule above.
                        t: self.clock.now_us(),
                        width: bgra_frame.width as u32,
                        height: bgra_frame.height as u32,
                        bgra: bgra_frame.data,
                    });
                }
                // A live stream keeps emitting idle frames even on a
                // static screen, so only silence past the watchdog
                // means the stream is actually gone — end capture so
                // the caller can finalize what was recorded.
                Err(RecvError::Timeout) if last_frame_at.elapsed() > STREAM_STALLED_AFTER => {
                    tracing::warn!("screen capture stream stalled; ending capture");
                    break;
                }
                Err(RecvError::Timeout) => {}
                Err(RecvError::Disconnected) => {
                    tracing::warn!("screen capture stream ended; ending capture");
                    break;
                }
                Err(RecvError::StreamError) => {
                    tracing::warn!("screen capture stream failed; ending capture");
                    break;
                }
            }
        }
        self.capturer.stop_capture();
        Ok(())
    }
}

/// How long each poll waits for a frame before re-checking the stop flag —
/// bounds stop latency at roughly this value.
const POLL_INTERVAL: Duration = Duration::from_millis(100);
/// If no frame (including SCK's idle frames) arrives for this long, treat
/// the stream as dead and end capture so `stop` can finalize the recording.
const STREAM_STALLED_AFTER: Duration = Duration::from_secs(5);
