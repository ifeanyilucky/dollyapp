use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{anyhow, Result};
use block2::RcBlock;
use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType, NSCursor};

use super::CursorRecording;
use crate::bundle::{CursorEvent, CursorSample, CursorTrack, CursorType};
use crate::clock::Clock;

/// Global monitor + polling cursor position sampler for one recording.
///
/// Two independent mechanisms feed the same track:
/// - a background thread polls `CGEventCreate`'s reported pointer location
///   at `CursorTrack::SAMPLE_RATE_HZ` for the position stream (works off the
///   main thread, no AppKit main-thread constraint);
/// - an `NSEvent` global monitor block, which needs the main run loop
///   pumping (true of Tauri's app for the app's lifetime) to actually
///   deliver callbacks, delivers clicks/keys/scroll as discrete events.
///
/// The live cursor *shape* is resolved from the monitor block — it runs on
/// the main thread, where `NSCursor.currentSystemCursor` is callable — and
/// shared with the position sampler via a mutex, so each 120Hz sample is
/// stamped with the type that was active at the time. Shape changes only
/// ever follow pointer motion (hit-testing), so resolving on mouse-move (and
/// every other monitored event, throttled) covers every transition.
pub struct CursorRecorder {
    clock: Clock,
    samples: Arc<Mutex<Vec<CursorSample>>>,
    events: Arc<Mutex<Vec<CursorEvent>>>,
    stop_flag: Arc<AtomicBool>,
    sampler_thread: Option<JoinHandle<()>>,
    // Keeping the monitor token alive keeps the block registered; dropping
    // it (via `removeMonitor:`) is what actually unregisters it.
    monitor_token: Option<Retained<AnyObject>>,
}

impl CursorRecorder {
    pub fn start(clock: Clock) -> Self {
        let samples = Arc::new(Mutex::new(Vec::new()));
        let events = Arc::new(Mutex::new(Vec::new()));
        let cursor_type = Arc::new(Mutex::new(CursorType::Arrow));
        let stop_flag = Arc::new(AtomicBool::new(false));

        let sampler_thread = {
            let samples = Arc::clone(&samples);
            let stop_flag = Arc::clone(&stop_flag);
            let cursor_type = Arc::clone(&cursor_type);
            std::thread::Builder::new()
                .name("dolly-cursor-sampler".into())
                .spawn(move || run_sampler(clock, samples, stop_flag, cursor_type))
                .expect("failed to spawn cursor sampler thread")
        };

        let monitor_token = install_global_monitor(clock, Arc::clone(&events), cursor_type.clone());

        Self {
            clock,
            samples,
            events,
            stop_flag,
            sampler_thread: Some(sampler_thread),
            monitor_token,
        }
    }
}

impl CursorRecorder {
    /// Pause/resume don't touch capture at all (PRD §9: "do not try to
    /// splice video during capture") — they only bracket a `Gap` in the
    /// cursor track, which the editor uses later to know what range to
    /// trim. `t` should come from the same `Clock` the recording started
    /// with, computed by the caller.
    fn mark_gap_start(&self, t: u64) {
        if let Ok(mut events) = self.events.lock() {
            events.push(CursorEvent::Gap {
                t,
                resumed_at: None,
            });
        }
    }

    /// No-ops if there's no open gap (e.g. resume called without a prior
    /// pause) — callers are expected to enforce that invariant themselves.
    fn mark_gap_end(&self, t: u64) {
        if let Ok(mut events) = self.events.lock() {
            let open_gap = events.iter_mut().rev().find(|e| {
                matches!(
                    e,
                    CursorEvent::Gap {
                        resumed_at: None,
                        ..
                    }
                )
            });
            if let Some(CursorEvent::Gap { resumed_at, .. }) = open_gap {
                *resumed_at = Some(t);
            }
        }
    }
}

impl CursorRecording for CursorRecorder {
    fn stop(mut self) -> CursorTrack {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(handle) = self.sampler_thread.take() {
            let _ = handle.join();
        }
        if let Some(token) = self.monitor_token.take() {
            unsafe { NSEvent::removeMonitor(&token) };
        }

        let mut track = CursorTrack::new(self.clock.epoch_us());
        track.samples = std::mem::take(&mut self.samples.lock().unwrap());
        track.events = std::mem::take(&mut self.events.lock().unwrap());
        track
    }
}

thread_local! {
    // `CursorRecorder` holds a `Retained<AnyObject>` (the NSEvent monitor
    // token), which is `!Send` — it can never leave the thread it was
    // created on. A `thread_local`, only ever touched from inside
    // `run_on_main_thread` closures below, keeps the whole recording
    // pinned to the main thread without smuggling the token across a
    // channel or into `Send`-bound Tauri state.
    static ACTIVE_RECORDER: RefCell<Option<CursorRecorder>> = const { RefCell::new(None) };
}

/// Starts cursor tracking, dispatched onto the main thread. Fire-and-forget
/// — the recorder never needs to leave that thread, so there's nothing
/// `Send`-safe to hand back to the caller. Pair with `stop_on_main_thread`.
pub fn start_on_main_thread(app: &tauri::AppHandle, clock: Clock) -> Result<()> {
    app.run_on_main_thread(move || {
        ACTIVE_RECORDER.with(|cell| {
            *cell.borrow_mut() = Some(CursorRecorder::start(clock));
        });
    })
    .map_err(|e| anyhow!("failed to dispatch cursor start to main thread: {e}"))
}

/// Stops cursor tracking and returns the finished (plain-data, `Send`)
/// `CursorTrack`. Errors if `start_on_main_thread` was never called or was
/// already stopped.
pub async fn stop_on_main_thread(app: &tauri::AppHandle) -> Result<CursorTrack> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    app.run_on_main_thread(move || {
        let track =
            ACTIVE_RECORDER.with(|cell| cell.borrow_mut().take().map(CursorRecording::stop));
        let _ = tx.send(track);
    })
    .map_err(|e| anyhow!("failed to dispatch cursor stop to main thread: {e}"))?;

    rx.await
        .map_err(|_| anyhow!("main thread dropped without responding to cursor stop"))?
        .ok_or_else(|| anyhow!("no active cursor recording to stop"))
}

/// Brackets a pause with a `Gap` cursor event; `t` should be
/// `active_recording.clock.now_us()` at the moment of the pause. Fire-and-
/// forget, same as `start_on_main_thread`.
pub fn mark_pause_on_main_thread(app: &tauri::AppHandle, t: u64) -> Result<()> {
    app.run_on_main_thread(move || {
        ACTIVE_RECORDER.with(|cell| {
            if let Some(recorder) = cell.borrow().as_ref() {
                recorder.mark_gap_start(t);
            }
        });
    })
    .map_err(|e| anyhow!("failed to dispatch pause marker to main thread: {e}"))
}

/// Closes the most recent open `Gap`. No-op if there wasn't one.
pub fn mark_resume_on_main_thread(app: &tauri::AppHandle, t: u64) -> Result<()> {
    app.run_on_main_thread(move || {
        ACTIVE_RECORDER.with(|cell| {
            if let Some(recorder) = cell.borrow().as_ref() {
                recorder.mark_gap_end(t);
            }
        });
    })
    .map_err(|e| anyhow!("failed to dispatch resume marker to main thread: {e}"))
}

const SAMPLE_INTERVAL: Duration =
    Duration::from_micros(1_000_000 / CursorTrack::SAMPLE_RATE_HZ as u64);

/// Height of the main display in CG global point-space (the same space the
/// sampler's `CGEvent::location` uses). The global-monitor block needs this
/// to mirror AppKit screen-coordinate y (bottom-left origin, y-up) into the
/// top-left-origin, y-down space the position stream and video pixels use.
fn main_display_height_points() -> f64 {
    core_graphics::display::CGDisplay::main().bounds().size.height
}

fn run_sampler(
    clock: Clock,
    samples: Arc<Mutex<Vec<CursorSample>>>,
    stop_flag: Arc<AtomicBool>,
    cursor_type: Arc<Mutex<CursorType>>,
) {
    // A source is required by the API but doesn't gate what `.location()`
    // reports — CGEventCreate always reflects the live HID pointer state.
    let Ok(source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
        tracing::error!("failed to create CGEventSource for cursor sampling");
        return;
    };

    while !stop_flag.load(Ordering::Relaxed) {
        let tick_start = std::time::Instant::now();

        if let Ok(event) = CGEvent::new(source.clone()) {
            let loc = event.location();
            // The type is the monitor block's latest resolution (see the
            // struct doc) — the sampler can't call `NSCursor` itself, since
            // that's main-thread-bound and this thread is off-main.
            let cursor_type = cursor_type.lock().map(|t| *t).unwrap_or(CursorType::Arrow);
            let sample = CursorSample {
                t: clock.now_us(),
                x: loc.x,
                y: loc.y,
                cursor_type,
            };
            if let Ok(mut guard) = samples.lock() {
                guard.push(sample);
            }
        }

        let elapsed = tick_start.elapsed();
        if elapsed < SAMPLE_INTERVAL {
            std::thread::sleep(SAMPLE_INTERVAL - elapsed);
        }
    }
}

/// Minimum time between `NSCursor.currentSystemCursor` resolutions inside
/// the monitor block. Mouse-move events can fire far faster than any cursor
/// shape actually changes, so resolving every event would just burn main-
/// thread time; 10Hz is plenty to catch every hit-test transition.
const CURSOR_TYPE_RESOLVE_INTERVAL_US: u64 = 100_000;

fn install_global_monitor(
    clock: Clock,
    events: Arc<Mutex<Vec<CursorEvent>>>,
    cursor_type: Arc<Mutex<CursorType>>,
) -> Option<Retained<AnyObject>> {
    let mask = NSEventMask::LeftMouseDown
        | NSEventMask::LeftMouseUp
        | NSEventMask::RightMouseDown
        | NSEventMask::RightMouseUp
        | NSEventMask::KeyDown
        | NSEventMask::ScrollWheel
        // Without this the block never fires while the pointer is merely
        // moving — which is precisely when the cursor shape can change.
        | NSEventMask::MouseMoved;

    let last_resolve: RefCell<u64> = RefCell::new(0);

    let handler = RcBlock::new(move |event: std::ptr::NonNull<NSEvent>| {
        let event = unsafe { event.as_ref() };
        let t = clock.now_us();

        // Cursor-shape changes always follow pointer motion (hit-testing),
        // so resolving on the throttled mouse-move path covers them all.
        if t.saturating_sub(*last_resolve.borrow()) >= CURSOR_TYPE_RESOLVE_INTERVAL_US {
            *last_resolve.borrow_mut() = t;
            if let Some(cursor) = unsafe { NSCursor::currentSystemCursor() } {
                if let Ok(mut guard) = cursor_type.lock() {
                    *guard = system_cursor_type(&cursor);
                }
            }
        }

        // For a globally monitored event there's no associated window, and
        // AppKit documents `locationInWindow` as screen coordinates in that
        // case — with the AppKit screen-space origin at the bottom-left of
        // the main display and y increasing *up*, which is vertically
        // mirrored from the position stream's space (the sampler's
        // `CGEvent::location`, and the video pixels, both use the global
        // display coordinate space: top-left origin, y increasing down).
        // Mirror the y so click/scroll anchors land in the same space as
        // the samples the motion engine clusters them with; x is aligned
        // between the two spaces already.
        let point = unsafe { event.locationInWindow() };
        let x = point.x;
        let y = main_display_height_points() - point.y;
        let kind = unsafe { event.r#type() };

        let recorded = match kind {
            NSEventType::LeftMouseDown => Some(CursorEvent::LeftDown { t, x, y }),
            NSEventType::LeftMouseUp => Some(CursorEvent::LeftUp { t, x, y }),
            NSEventType::RightMouseDown => Some(CursorEvent::RightDown { t, x, y }),
            NSEventType::RightMouseUp => Some(CursorEvent::RightUp { t, x, y }),
            NSEventType::KeyDown => {
                let code = unsafe { event.keyCode() };
                let flags = unsafe { event.modifierFlags() };
                Some(CursorEvent::Key {
                    t,
                    code,
                    modifiers: modifier_names(flags),
                })
            }
            NSEventType::ScrollWheel => {
                let dy = unsafe { event.scrollingDeltaY() };
                Some(CursorEvent::Scroll { t, dy })
            }
            _ => None,
        };

        if let Some(recorded) = recorded {
            if let Ok(mut guard) = events.lock() {
                guard.push(recorded);
            }
        }
    });

    unsafe { NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &handler) }
}

fn modifier_names(flags: NSEventModifierFlags) -> Vec<String> {
    let mut names = Vec::new();
    if flags.contains(NSEventModifierFlags::NSEventModifierFlagCommand) {
        names.push("cmd".to_string());
    }
    if flags.contains(NSEventModifierFlags::NSEventModifierFlagShift) {
        names.push("shift".to_string());
    }
    if flags.contains(NSEventModifierFlags::NSEventModifierFlagOption) {
        names.push("option".to_string());
    }
    if flags.contains(NSEventModifierFlags::NSEventModifierFlagControl) {
        names.push("control".to_string());
    }
    names
}

// The system cursors worth distinguishing, keyed by the `CursorType` they
// map to. Built once per main thread (the only thread that ever calls it) —
// `NSCursor` class methods return the same cached instances every call, and
// `Retained` is `!Send`, so a `thread_local` is the natural home.
thread_local! {
    static SYSTEM_CURSORS: Vec<(CursorType, Retained<NSCursor>)> = {
        vec![
            (CursorType::Arrow, NSCursor::arrowCursor()),
            (CursorType::IBeam, NSCursor::IBeamCursor()),
            (CursorType::IBeam, NSCursor::IBeamCursorForVerticalLayout()),
            (CursorType::PointingHand, NSCursor::pointingHandCursor()),
            (CursorType::ResizeLeftRight, NSCursor::resizeLeftCursor()),
            (CursorType::ResizeLeftRight, NSCursor::resizeRightCursor()),
            (CursorType::ResizeLeftRight, NSCursor::resizeLeftRightCursor()),
            (CursorType::ResizeUpDown, NSCursor::resizeUpCursor()),
            (CursorType::ResizeUpDown, NSCursor::resizeDownCursor()),
            (CursorType::ResizeUpDown, NSCursor::resizeUpDownCursor()),
            (CursorType::ClosedHand, NSCursor::closedHandCursor()),
            (CursorType::ClosedHand, NSCursor::openHandCursor()),
        ]
    };
}

/// Maps a live system cursor to the recording's coarse `CursorType`. The
/// diagonal resize handles collapse into their axis (left/right or up/down,
/// whichever the enum offers); anything else — crosshair, disappearing-item,
/// not-allowed, drag/drop cursors, ... — becomes `Other` (which the editor
/// renders as the user's chosen arrow-ish glyph, see `cursorSettings.ts`).
fn system_cursor_type(cursor: &NSCursor) -> CursorType {
    SYSTEM_CURSORS.with(|cache| {
        for (kind, candidate) in cache {
            // `NSCursor` implements `isEqual:` (compares hotspot + image).
            let equal: bool = unsafe { msg_send![cursor, isEqual: &**candidate] };
            if equal {
                return *kind;
            }
        }
        CursorType::Other
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Both tests need a real NSApplication run loop / WindowServer
    // connection: `+[NSCursor ...]` class methods return nil (and the
    // bindings panic) in a bare test process. Run with `cargo test -- --ignored`
    // from within the app, or rely on the in-app path these exercise.
    #[test]
    #[ignore = "requires a running NSApplication (WindowServer connection)"]
    fn maps_known_system_cursors_to_their_coarse_types() {
        assert_eq!(system_cursor_type(&NSCursor::arrowCursor()), CursorType::Arrow);
        assert_eq!(system_cursor_type(&NSCursor::IBeamCursor()), CursorType::IBeam);
        assert_eq!(
            system_cursor_type(&NSCursor::pointingHandCursor()),
            CursorType::PointingHand
        );
        assert_eq!(
            system_cursor_type(&NSCursor::resizeLeftRightCursor()),
            CursorType::ResizeLeftRight
        );
        assert_eq!(
            system_cursor_type(&NSCursor::resizeUpDownCursor()),
            CursorType::ResizeUpDown
        );
        assert_eq!(
            system_cursor_type(&NSCursor::closedHandCursor()),
            CursorType::ClosedHand
        );
    }

    #[test]
    #[ignore = "requires a running NSApplication (WindowServer connection)"]
    fn treats_unknown_system_cursors_as_other() {
        // Crosshair isn't in the cache — must fall through to `Other`
        // rather than misreporting as a known type.
        assert_eq!(
            system_cursor_type(&NSCursor::crosshairCursor()),
            CursorType::Other
        );
    }
}
