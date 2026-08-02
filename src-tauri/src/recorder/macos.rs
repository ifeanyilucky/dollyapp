use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use anyhow::{anyhow, Context, Result};
use tauri::{AppHandle, Emitter, Manager};

use super::RECORDING_STATE_EVENT;
use crate::audio::MicRecorder;
use crate::bundle::{names, BundleWriter, DisplayInfo, RecordingMeta};
use crate::capture::{self, FrameGrabber};
use crate::clock::Clock;
use crate::cursor;
use crate::encode::MovWriter;

const FPS: u32 = 60;

struct ActiveRecording {
    bundle_dir: PathBuf,
    clock: Clock,
    /// From `capture::scale_factor`, for the target this recording
    /// actually started against — read once at start rather than at stop,
    /// since a display could in principle be reconfigured mid-recording.
    scale_factor: f64,
    /// `Some` while recording, `None` while paused — pause/resume only
    /// bracket a cursor-track `Gap`, they don't touch this (PRD §9: "do
    /// not try to splice video during capture").
    is_paused: bool,
    capture_stop: Arc<AtomicBool>,
    capture_thread: Option<JoinHandle<Result<CaptureOutcome>>>,
    /// `None` if mic recording wasn't enabled for this recording.
    /// `MicRecorder` is plain `Send` data (its `AVAudioEngine` lives
    /// entirely inside its own dedicated thread, never touching this
    /// struct) — see `audio::macos`'s doc comment.
    mic: Option<MicRecorder>,
}

struct CaptureOutcome {
    frame_count: u32,
    width: u32,
    height: u32,
}

/// Tauri-managed state (`app.manage(RecorderState::default())` in `lib.rs`).
/// Both fields are `Send + Sync` — `scap::Target` wraps a raw
/// `CGDisplay`/`CGWindowID` (plain Core Graphics ids, not an ObjC object),
/// unlike the cursor monitor, which is why it's fine to store directly
/// here instead of behind the main-thread `thread_local` dance in
/// `cursor::macos`.
#[derive(Default)]
pub struct RecorderState {
    active: Mutex<Option<ActiveRecording>>,
    selected_target: Mutex<Option<scap::Target>>,
    /// Opt-in, read at the next `start()` — never enabled implicitly, per
    /// the lazy-permission-request rule (ARCHITECTURE.md, "Permissions").
    mic_enabled: Mutex<bool>,
}

pub fn is_recording(state: &RecorderState) -> bool {
    state.active.lock().unwrap().is_some()
}

/// `None` clears the selection, falling back to the main display.
pub fn set_selected_target(state: &RecorderState, target: Option<scap::Target>) {
    *state.selected_target.lock().unwrap() = target;
}

/// The frontend is expected to have already requested (and confirmed)
/// microphone permission via `request_microphone_permission` before
/// calling this with `true` — this just records the user's toggle, it
/// doesn't check or request permission itself.
pub fn set_mic_enabled(state: &RecorderState, enabled: bool) {
    *state.mic_enabled.lock().unwrap() = enabled;
}

pub fn start(app: &AppHandle, state: &RecorderState) -> Result<()> {
    let mut guard = state.active.lock().unwrap();
    if guard.is_some() {
        return Err(anyhow!("a recording is already in progress"));
    }

    let target = state
        .selected_target
        .lock()
        .unwrap()
        .clone()
        .or_else(capture::main_display)
        .ok_or_else(|| anyhow!("no capturable display found"))?;
    let scale_factor = capture::scale_factor(&target);

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
            .spawn(move || run_capture(clock, capture_stop, bundle_dir, target))
            .context("failed to spawn capture thread")?
    };

    let mic = if *state.mic_enabled.lock().unwrap() {
        match MicRecorder::start(bundle_dir.join(names::MIC_AUDIO)) {
            Ok(mic) => Some(mic),
            Err(e) => {
                // Mic failing to start shouldn't take down the whole
                // recording — screen + cursor are the parts that matter.
                tracing::error!("failed to start mic capture: {e}");
                None
            }
        }
    } else {
        None
    };

    *guard = Some(ActiveRecording {
        bundle_dir,
        clock,
        scale_factor,
        is_paused: false,
        capture_stop,
        capture_thread: Some(capture_thread),
        mic,
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
        .active
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

    // Mic errors don't fail the whole `stop()` — screen + cursor are
    // already safely on disk by this point, and losing just the audio
    // track is a much smaller problem than losing the recording.
    let has_mic_audio = match active.mic {
        Some(mic) => match mic.stop() {
            Ok(()) => true,
            Err(e) => {
                tracing::error!("failed to finalize mic recording: {e}");
                false
            }
        },
        None => false,
    };

    let cursor_track = cursor::stop_on_main_thread(app).await?;

    let writer = BundleWriter::create(&active.bundle_dir)?;
    writer.write_cursor_track(&cursor_track)?;
    writer.write_meta(&RecordingMeta {
        version: RecordingMeta::CURRENT_VERSION,
        clock_epoch: active.clock.epoch_us(),
        display: DisplayInfo {
            width_px: outcome.width,
            height_px: outcome.height,
            scale_factor: active.scale_factor,
        },
        duration_us: active.clock.now_us(),
        has_webcam: false,
        has_system_audio: false,
        has_mic_audio,
        fps: FPS,
    })?;
    tracing::info!("wrote {} frames to {}", outcome.frame_count, active.bundle_dir.display());

    Ok(active.bundle_dir)
}

pub fn pause(app: &AppHandle, state: &RecorderState) -> Result<()> {
    let mut guard = state.active.lock().unwrap();
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
    let mut guard = state.active.lock().unwrap();
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
    target: scap::Target,
) -> Result<CaptureOutcome> {
    let mov_path = bundle_dir.join(names::SCREEN_VIDEO);
    let mut grabber = FrameGrabber::new(clock, FPS, Some(target))?;
    // `MovWriter` needs frame dimensions up front (for the AVAssetWriter
    // output-settings dict), which aren't known until the first frame
    // arrives — so it's created lazily rather than passed in.
    let mut writer: Option<MovWriter> = None;
    let mut size = (0u32, 0u32);
    let mut frame_count = 0u32;
    let mut first_error: Option<anyhow::Error> = None;

    grabber.run_until_stopped(&stop_flag, |frame| {
        if first_error.is_some() {
            return;
        }
        size = (frame.width, frame.height);

        if writer.is_none() {
            match MovWriter::create(&mov_path, frame.width, frame.height) {
                Ok(w) => writer = Some(w),
                Err(e) => {
                    first_error = Some(e);
                    return;
                }
            }
        }

        if let Err(e) = writer.as_mut().expect("just created above").append(&frame) {
            first_error = Some(e);
            return;
        }
        frame_count += 1;
    })?;

    if let Some(e) = first_error {
        return Err(e);
    }

    let writer = writer.ok_or_else(|| anyhow!("recording stopped before any frame was captured"))?;
    writer.finish()?;

    Ok(CaptureOutcome { frame_count, width: size.0, height: size.1 })
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
