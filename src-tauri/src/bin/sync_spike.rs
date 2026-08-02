//! M0 sync spike. Rust only, no UI, no Tauri — the whole point is to prove
//! the video and cursor streams share a clock before anything else in
//! ARCHITECTURE.md gets built on top of that assumption.
//!
//! Run with `cargo run --bin sync_spike`. It captures 30 seconds of the
//! main display as a timestamped PNG sequence, records cursor position and
//! click events over the same window, writes a `.motionrec` bundle, and
//! prints which frame each click landed on so you can open that frame and
//! confirm the click is visually where the cursor track says it is.
//!
//! This intentionally does not encode a real `screen.mov` — see
//! `src-tauri/src/capture/mod.rs` for why that's out of scope here.

use std::path::PathBuf;
use std::time::Duration;

use dolly_lib::bundle::{BundleWriter, CursorEvent, DisplayInfo, RecordingMeta};
use dolly_lib::capture::FrameGrabber;
use dolly_lib::clock::Clock;
use dolly_lib::cursor::{CursorRecorder, CursorRecording};

const CAPTURE_SECONDS: u64 = 30;
const FPS: u32 = 60;

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let out_dir: PathBuf = std::env::temp_dir().join(format!(
        "dolly-sync-spike-{}.motionrec",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    ));
    let frames_dir = out_dir.join("screen_frames");
    std::fs::create_dir_all(&frames_dir)?;

    println!("Dolly M0 sync spike");
    println!(
        "Recording {CAPTURE_SECONDS}s at {FPS}fps to {}",
        out_dir.display()
    );
    println!("Click somewhere on screen a few times during the recording.");

    // The one clock both streams are timestamped against — see
    // ARCHITECTURE.md, "Recording format".
    let clock = Clock::start();

    let cursor_recorder = CursorRecorder::start(clock);

    let mut grabber = FrameGrabber::new(clock, FPS, None)?;
    let mut frame_index: Vec<(u64, u32)> = Vec::new(); // (timestamp_us, frame_number)
    let mut frame_number = 0u32;

    grabber.capture_for(Duration::from_secs(CAPTURE_SECONDS), |frame| {
        if let Some(image) =
            image::RgbaImage::from_raw(frame.width, frame.height, frame.to_rgba_bytes())
        {
            let path = frames_dir.join(format!("{frame_number:06}.png"));
            if let Err(e) = image.save(&path) {
                tracing::warn!("failed to write frame {frame_number}: {e}");
            }
        }
        frame_index.push((frame.t, frame_number));
        frame_number += 1;
    })?;

    let cursor_track = cursor_recorder.stop();

    let writer = BundleWriter::create(&out_dir)?;
    writer.write_cursor_track(&cursor_track)?;
    writer.write_meta(&RecordingMeta {
        version: RecordingMeta::CURRENT_VERSION,
        clock_epoch: clock.epoch_us(),
        video_start_us: frame_index.first().map(|(t, _)| *t).unwrap_or(0),
        // Point-space size is unknown without a display query the spike
        // doesn't need; filled with the first captured frame's pixel size
        // as a placeholder, scale factor left at 1.0 pending that query.
        display: DisplayInfo {
            width_px: frame_index.len() as u32, // placeholder, see above
            height_px: 0,
            scale_factor: 1.0,
        },
        duration_us: clock.now_us(),
        has_webcam: false,
        has_system_audio: false,
        has_mic_audio: false,
        fps: FPS,
    })?;

    std::fs::write(
        out_dir.join("frame_index.json"),
        serde_json::to_vec_pretty(&frame_index)?,
    )?;

    println!("\nCaptured {} frames.", frame_index.len());
    print_sync_report(&cursor_track.events, &frame_index);
    println!("\nBundle written to {}", out_dir.display());
    println!(
        "Open screen_frames/ next to the reported frame numbers below and confirm each click \
         is visible in that frame."
    );

    Ok(())
}

/// For each click event, finds the nearest captured frame and reports the
/// gap — this is the actual acceptance check for M0 (ARCHITECTURE.md /
/// PRD §11): a large or inconsistent gap here means the clock-sharing
/// assumption is broken and nothing downstream should be built yet.
fn print_sync_report(events: &[CursorEvent], frame_index: &[(u64, u32)]) {
    println!("\nSync report (click timestamp -> nearest frame):");
    for event in events {
        let (kind, t) = match event {
            CursorEvent::LeftDown { t, .. } => ("leftDown", *t),
            CursorEvent::RightDown { t, .. } => ("rightDown", *t),
            _ => continue,
        };

        let nearest = frame_index
            .iter()
            .min_by_key(|(frame_t, _)| frame_t.abs_diff(t));

        match nearest {
            Some((frame_t, frame_number)) => {
                let delta_ms = (*frame_t as i64 - t as i64) as f64 / 1000.0;
                println!(
                    "  {kind} at t={t}us -> frame {frame_number:06} (t={frame_t}us, delta={delta_ms:+.1}ms)"
                );
            }
            None => println!("  {kind} at t={t}us -> no frames captured"),
        }
    }
}
