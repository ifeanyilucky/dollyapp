use anyhow::{anyhow, Result};
use scap::capturer::{Capturer, Options, Resolution};
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

/// Pulls frames from `scap` at a fixed fps, stamping each with the shared
/// `Clock`. Blocking: `capture_for` runs on the calling thread until the
/// duration elapses, invoking `on_frame` synchronously for each frame so
/// callers don't have to deal with buffering/backpressure themselves.
pub struct FrameGrabber {
    capturer: Capturer,
    clock: Clock,
}

impl FrameGrabber {
    pub fn new(clock: Clock, fps: u32) -> Result<Self> {
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
            target: None, // full display; window/region targeting lands with the picker in M1
            show_cursor: false,
            show_highlight: false,
            excluded_targets: None,
            output_type: FrameType::BGRAFrame,
            output_resolution: Resolution::Captured,
            crop_area: None,
        };

        let capturer = Capturer::build(options)
            .map_err(|e| anyhow!("failed to build screen capturer: {e}"))?;
        Ok(Self { capturer, clock })
    }

    pub fn capture_for(
        &mut self,
        duration: std::time::Duration,
        mut on_frame: impl FnMut(CapturedFrame),
    ) -> Result<()> {
        self.capturer.start_capture();
        let deadline = std::time::Instant::now() + duration;

        let result = (|| -> Result<()> {
            while std::time::Instant::now() < deadline {
                let frame = self
                    .capturer
                    .get_next_frame()
                    .map_err(|e| anyhow!("scap capture error: {e}"))?;

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
            Ok(())
        })();

        self.capturer.stop_capture();
        result
    }
}
