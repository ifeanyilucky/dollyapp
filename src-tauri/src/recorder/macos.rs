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
    /// From `capture::target_origin`, same "read once at start" reasoning
    /// as `scale_factor` above — see `DisplayInfo::origin_x`'s doc comment.
    origin: (f64, f64),
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
    /// `t` of the first frame written to `screen.mov` — see the doc
    /// comment on `RecordingMeta::video_start_us` for why this needs to
    /// be captured and persisted, not assumed to be 0.
    video_start_us: u64,
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
    /// A user-picked sub-rectangle of `selected_target` (PRD §9's "region"
    /// picker) — `None` records the whole target. Cleared whenever
    /// `selected_target` changes, since a stale area from a previously
    /// selected display/window wouldn't make sense against a new one.
    selected_area: Mutex<Option<capture::CropArea>>,
    /// Opt-in, read at the next `start()` — never enabled implicitly, per
    /// the lazy-permission-request rule (ARCHITECTURE.md, "Permissions").
    mic_enabled: Mutex<bool>,
}

pub fn is_recording(state: &RecorderState) -> bool {
    state.active.lock().unwrap().is_some()
}

/// `None` clears the selection, falling back to the main display. Also
/// clears any selected area — see `RecorderState::selected_area`'s doc
/// comment.
pub fn set_selected_target(state: &RecorderState, target: Option<scap::Target>) {
    *state.selected_target.lock().unwrap() = target;
    *state.selected_area.lock().unwrap() = None;
}

/// Sets (or, with `None`, clears) a sub-rectangle of the *currently
/// selected* target to record instead of the whole thing. Doesn't touch
/// `selected_target` itself — callers pick the target first.
pub fn set_selected_area(state: &RecorderState, area: Option<capture::CropArea>) {
    *state.selected_area.lock().unwrap() = area;
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
    let area = *state.selected_area.lock().unwrap();
    let origin = capture::target_origin(&target, area);
    let crop_area = area.map(|a| capture::crop_area_for_target(a, &target));

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
            .spawn(move || run_capture(clock, capture_stop, bundle_dir, target, crop_area))
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
        origin,
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
        video_start_us: outcome.video_start_us,
        display: DisplayInfo {
            width_px: outcome.width,
            height_px: outcome.height,
            scale_factor: active.scale_factor,
            origin_x: active.origin.0,
            origin_y: active.origin.1,
        },
        duration_us: active.clock.now_us(),
        has_webcam: false,
        has_system_audio: false,
        has_mic_audio,
        fps: FPS,
    })?;
    tracing::info!(
        "wrote {} frames to {}",
        outcome.frame_count,
        active.bundle_dir.display()
    );

    // The floating toolbar (where recording starts/stops) and the editor
    // (which shows the result) are different windows — swap which one's
    // visible regardless of whether this `stop` came from the toolbar's
    // own Stop button, the tray menu, or the global shortcut, so all
    // three end up in the same place afterward.
    let _ = app.emit(
        super::RECORDING_FINISHED_EVENT,
        active.bundle_dir.display().to_string(),
    );
    crate::toolbar::hide(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(active.bundle_dir)
}

/// Stops capture and cursor tracking like `stop`, but throws the result
/// away instead of writing a bundle — the toolbar's "restart"/"discard"
/// controls (a user who messed up wants the partial `screen.mov` gone,
/// not sitting in `~/Movies/Dolly` as a phantom recording). Unlike `stop`,
/// doesn't touch the toolbar/main-window swap: the caller stays right
/// where it was, ready to record again immediately.
pub async fn discard(app: &AppHandle, state: &RecorderState) -> Result<()> {
    let active = state
        .active
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| anyhow!("no recording in progress"))?;
    let _ = app.emit(RECORDING_STATE_EVENT, false);

    active.capture_stop.store(true, Ordering::SeqCst);
    // Errors here don't matter — the whole point is discarding, so a
    // capture-thread panic or mid-write failure isn't worth surfacing.
    if let Some(handle) = active.capture_thread {
        let _ = handle.join();
    }
    if let Some(mic) = active.mic {
        let _ = mic.stop();
    }
    let _ = cursor::stop_on_main_thread(app).await;

    if let Err(e) = std::fs::remove_dir_all(&active.bundle_dir) {
        tracing::error!(
            "failed to remove discarded recording at {}: {e}",
            active.bundle_dir.display()
        );
    }

    Ok(())
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
    crop_area: Option<scap::capturer::Area>,
) -> Result<CaptureOutcome> {
    let mov_path = bundle_dir.join(names::SCREEN_VIDEO);
    let mut grabber = FrameGrabber::new(clock, FPS, Some(target), crop_area)?;
    // `MovWriter` needs frame dimensions up front (for the AVAssetWriter
    // output-settings dict), which aren't known until the first frame
    // arrives — so it's created lazily rather than passed in.
    let mut writer: Option<MovWriter> = None;
    let mut size = (0u32, 0u32);
    let mut frame_count = 0u32;
    let mut video_start_us = 0u64;
    let mut first_error: Option<anyhow::Error> = None;

    grabber.run_until_stopped(&stop_flag, |frame| {
        if first_error.is_some() {
            return;
        }
        // `scap`/ScreenCaptureKit can emit degenerate 0x0 status frames
        // while the stream is still starting up, before real content
        // arrives. A 0x0 buffer isn't valid input to CVPixelBufferCreateWithBytes
        // (returns kCVReturnInvalidArgument) and isn't worth an
        // AVAssetWriter of that size either, so skip it rather than
        // failing the whole recording over a frame that has no content.
        if frame.width == 0 || frame.height == 0 {
            tracing::warn!("skipping degenerate {}x{} frame", frame.width, frame.height);
            return;
        }
        size = (frame.width, frame.height);

        if writer.is_none() {
            match MovWriter::create(&mov_path, frame.width, frame.height) {
                Ok(w) => {
                    writer = Some(w);
                    // The frame that triggers writer creation is always
                    // the first one actually written — see
                    // `RecordingMeta::video_start_us`'s doc comment.
                    video_start_us = frame.t;
                }
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

    let writer =
        writer.ok_or_else(|| anyhow!("recording stopped before any frame was captured"))?;
    writer.finish()?;

    Ok(CaptureOutcome {
        frame_count,
        width: size.0,
        height: size.1,
        video_start_us,
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
