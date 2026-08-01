use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use anyhow::{anyhow, Context, Result};
use tauri::{AppHandle, Emitter, Manager};

use super::RECORDING_STATE_EVENT;
use crate::bundle::{BundleWriter, DisplayInfo, RecordingMeta};
use crate::capture::FrameGrabber;
use crate::clock::Clock;
use crate::cursor;

const FPS: u32 = 60;

struct ActiveRecording {
    bundle_dir: PathBuf,
    clock: Clock,
    /// `Some` while recording, `None` while paused — pause/resume only
    /// bracket a cursor-track `Gap`, they don't touch this (PRD §9: "do
    /// not try to splice video during capture").
    is_paused: bool,
    capture_stop: Arc<AtomicBool>,
    capture_thread: Option<JoinHandle<Result<CaptureOutcome>>>,
}

struct CaptureOutcome {
    frame_index: Vec<(u64, u32)>,
    width: u32,
    height: u32,
}

/// Tauri-managed state (`app.manage(RecorderState::default())` in `lib.rs`).
/// `Mutex<Option<ActiveRecording>>` is `Send + Sync` because nothing in
/// `ActiveRecording` touches an ObjC type directly — the one thing that
/// would (the cursor monitor) is pinned to the main thread inside
/// `cursor::macos`'s own `thread_local` instead. See that module's doc
/// comment for the full reasoning.
#[derive(Default)]
pub struct RecorderState(Mutex<Option<ActiveRecording>>);

pub fn is_recording(state: &RecorderState) -> bool {
    state.0.lock().unwrap().is_some()
}

pub fn start(app: &AppHandle, state: &RecorderState) -> Result<()> {
    let mut guard = state.0.lock().unwrap();
    if guard.is_some() {
        return Err(anyhow!("a recording is already in progress"));
    }

    let clock = Clock::start();
    let bundle_dir = new_bundle_dir(app)?;
    std::fs::create_dir_all(&bundle_dir)
        .with_context(|| format!("creating {}", bundle_dir.display()))?;

    cursor::start_on_main_thread(app, clock)?;

    let capture_stop = Arc::new(AtomicBool::new(false));
    let capture_thread = {
        let capture_stop = Arc::clone(&capture_stop);
        let bundle_dir = bundle_dir.clone();
        std::thread::Builder::new()
            .name("dolly-capture".into())
            .spawn(move || run_capture(clock, capture_stop, bundle_dir))
            .context("failed to spawn capture thread")?
    };

    *guard = Some(ActiveRecording {
        bundle_dir,
        clock,
        is_paused: false,
        capture_stop,
        capture_thread: Some(capture_thread),
    });
    drop(guard);

    let _ = app.emit(RECORDING_STATE_EVENT, true);
    Ok(())
}

/// Stops capture and cursor tracking, writes the bundle, and returns its
/// path. Consumes the active recording — `start` must be called again for
/// the next one.
pub async fn stop(app: &AppHandle, state: &RecorderState) -> Result<PathBuf> {
    let active = state
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| anyhow!("no recording in progress"))?;
    // Emitted as soon as state actually flips, not after bundle writing
    // below finishes — `is_recording()` is already false at this point
    // even if writing the bundle subsequently fails.
    let _ = app.emit(RECORDING_STATE_EVENT, false);

    active.capture_stop.store(true, Ordering::SeqCst);
    let outcome = active
        .capture_thread
        .expect("capture_thread is always Some between start() and stop()")
        .join()
        .map_err(|_| anyhow!("capture thread panicked"))??;

    let cursor_track = cursor::stop_on_main_thread(app).await?;

    let writer = BundleWriter::create(&active.bundle_dir)?;
    writer.write_cursor_track(&cursor_track)?;
    writer.write_meta(&RecordingMeta {
        version: RecordingMeta::CURRENT_VERSION,
        clock_epoch: active.clock.epoch_us(),
        display: DisplayInfo {
            width_px: outcome.width,
            height_px: outcome.height,
            // TODO(M1 picker work): read the real backing-scale-factor for
            // the captured display instead of assuming 1.0 — `outcome`'s
            // width/height are already physical pixels from `scap`, so
            // this only matters once cursor coordinates (point space) need
            // to be mapped onto them precisely.
            scale_factor: 1.0,
        },
        duration_us: active.clock.now_us(),
        has_webcam: false,
        has_system_audio: false,
        has_mic_audio: false,
        fps: FPS,
    })?;
    std::fs::write(
        active.bundle_dir.join("frame_index.json"),
        serde_json::to_vec_pretty(&outcome.frame_index)?,
    )?;

    Ok(active.bundle_dir)
}

pub fn pause(app: &AppHandle, state: &RecorderState) -> Result<()> {
    let mut guard = state.0.lock().unwrap();
    let active = guard
        .as_mut()
        .ok_or_else(|| anyhow!("no recording in progress"))?;
    if active.is_paused {
        return Err(anyhow!("recording is already paused"));
    }
    active.is_paused = true;
    cursor::mark_pause_on_main_thread(app, active.clock.now_us())
}

pub fn resume(app: &AppHandle, state: &RecorderState) -> Result<()> {
    let mut guard = state.0.lock().unwrap();
    let active = guard
        .as_mut()
        .ok_or_else(|| anyhow!("no recording in progress"))?;
    if !active.is_paused {
        return Err(anyhow!("recording is not paused"));
    }
    active.is_paused = false;
    cursor::mark_resume_on_main_thread(app, active.clock.now_us())
}

fn run_capture(
    clock: Clock,
    stop_flag: Arc<AtomicBool>,
    bundle_dir: PathBuf,
) -> Result<CaptureOutcome> {
    let frames_dir = bundle_dir.join("screen_frames");
    std::fs::create_dir_all(&frames_dir)?;

    let mut grabber = FrameGrabber::new(clock, FPS)?;
    let mut frame_index = Vec::new();
    let mut frame_number = 0u32;
    let mut size = (0u32, 0u32);

    grabber.run_until_stopped(&stop_flag, |frame| {
        size = (frame.width, frame.height);
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

    Ok(CaptureOutcome {
        frame_index,
        width: size.0,
        height: size.1,
    })
}

fn new_bundle_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .video_dir()
        .context("could not resolve the user's Movies directory")?
        .join("Dolly");

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    Ok(base.join(format!("Recording {timestamp}.motionrec")))
}
