use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use block2::RcBlock;
use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType};

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
        let stop_flag = Arc::new(AtomicBool::new(false));

        let sampler_thread = {
            let samples = Arc::clone(&samples);
            let stop_flag = Arc::clone(&stop_flag);
            let clock = clock;
            std::thread::Builder::new()
                .name("dolly-cursor-sampler".into())
                .spawn(move || run_sampler(clock, samples, stop_flag))
                .expect("failed to spawn cursor sampler thread")
        };

        let monitor_token = install_global_monitor(clock, Arc::clone(&events));

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

const SAMPLE_INTERVAL: Duration =
    Duration::from_micros(1_000_000 / CursorTrack::SAMPLE_RATE_HZ as u64);

fn run_sampler(clock: Clock, samples: Arc<Mutex<Vec<CursorSample>>>, stop_flag: Arc<AtomicBool>) {
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
            let sample = CursorSample {
                t: clock.now_us(),
                x: loc.x,
                y: loc.y,
                // Resolving the live `NSCursor` type requires reading app
                // state from the main thread; left as a fixed value here
                // and refined once the editor needs per-widget cursor
                // shapes (ARCHITECTURE.md, cursor rendering).
                cursor_type: CursorType::Arrow,
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

fn install_global_monitor(
    clock: Clock,
    events: Arc<Mutex<Vec<CursorEvent>>>,
) -> Option<Retained<AnyObject>> {
    let mask = NSEventMask::LeftMouseDown
        | NSEventMask::LeftMouseUp
        | NSEventMask::RightMouseDown
        | NSEventMask::RightMouseUp
        | NSEventMask::KeyDown
        | NSEventMask::ScrollWheel;

    let handler = RcBlock::new(move |event: std::ptr::NonNull<NSEvent>| {
        let event = unsafe { event.as_ref() };
        let t = clock.now_us();
        // For a globally monitored event there's no associated window, and
        // AppKit documents `locationInWindow` as screen coordinates in that
        // case — this is not a bug, just an overloaded accessor name.
        let point = unsafe { event.locationInWindow() };
        let kind = unsafe { event.r#type() };

        let recorded = match kind {
            NSEventType::LeftMouseDown => {
                Some(CursorEvent::LeftDown { t, x: point.x, y: point.y })
            }
            NSEventType::LeftMouseUp => Some(CursorEvent::LeftUp { t, x: point.x, y: point.y }),
            NSEventType::RightMouseDown => {
                Some(CursorEvent::RightDown { t, x: point.x, y: point.y })
            }
            NSEventType::RightMouseUp => Some(CursorEvent::RightUp { t, x: point.x, y: point.y }),
            NSEventType::KeyDown => {
                let code = unsafe { event.keyCode() };
                let flags = unsafe { event.modifierFlags() };
                Some(CursorEvent::Key { t, code, modifiers: modifier_names(flags) })
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
    if flags.contains(NSEventModifierFlags::Command) {
        names.push("cmd".to_string());
    }
    if flags.contains(NSEventModifierFlags::Shift) {
        names.push("shift".to_string());
    }
    if flags.contains(NSEventModifierFlags::Option) {
        names.push("option".to_string());
    }
    if flags.contains(NSEventModifierFlags::Control) {
        names.push("control".to_string());
    }
    names
}
