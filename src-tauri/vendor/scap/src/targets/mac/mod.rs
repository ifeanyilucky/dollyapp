use cocoa::appkit::NSScreen;
use cocoa::base::{id, nil};
use cocoa::foundation::NSString;
use core_graphics_helmer_fork::display::{CGDirectDisplayID, CGDisplay, CGMainDisplayID};
use core_graphics_helmer_fork::window::CGWindowID;
use objc::{msg_send, sel, sel_impl};
use screencapturekit::sc_shareable_content::SCShareableContent;

use super::{Display, Target};

fn get_display_name(display_id: CGDirectDisplayID) -> String {
    unsafe {
        // Get all screens
        let screens: id = NSScreen::screens(nil);
        let count: u64 = msg_send![screens, count];

        for i in 0..count {
            let screen: id = msg_send![screens, objectAtIndex: i];
            let device_description: id = msg_send![screen, deviceDescription];
            let display_id_number: id = msg_send![device_description, objectForKey: NSString::alloc(nil).init_str("NSScreenNumber")];
            let display_id_number: u32 = msg_send![display_id_number, unsignedIntValue];

            if display_id_number == display_id {
                let localized_name: id = msg_send![screen, localizedName];
                let name: *const i8 = msg_send![localized_name, UTF8String];
                return std::ffi::CStr::from_ptr(name)
                    .to_string_lossy()
                    .into_owned();
            }
        }

        format!("Unknown Display {}", display_id)
    }
}

pub fn get_all_targets() -> Vec<Target> {
    let mut targets: Vec<Target> = Vec::new();

    let content = SCShareableContent::current();

    // Add displays to targets
    for display in content.displays {
        let id: CGDirectDisplayID = display.display_id;
        let raw_handle = CGDisplay::new(id);
        let title = get_display_name(id);

        let target = Target::Display(super::Display {
            id,
            title,
            raw_handle,
        });

        targets.push(target);
    }

    // Add windows to targets
    for window in content.windows {
        if window.title.is_some() {
            let id = window.window_id;
            let title = window.title.expect("Window title not found");
            let raw_handle: CGWindowID = id;

            let target = Target::Window(super::Window {
                id,
                title,
                raw_handle,
            });
            targets.push(target);
        }
    }

    targets
}

pub fn get_main_display() -> Display {
    let id = unsafe { CGMainDisplayID() };
    let title = get_display_name(id);

    Display {
        id,
        title,
        raw_handle: CGDisplay::new(id),
    }
}

// --- Dolly patch (see PATCH.md) -----------------------------------------
//
// The two functions below used to resolve a `Target::Window` by calling
// `[NSApp windowWithWindowNumber:]`, which only finds windows owned by
// *this* process. For any real capture target (always a different app)
// that call returns `nil`: `-frame` on a nil window silently produced a
// 0×0 rect, and `-backingScaleFactor` silently produced `0.0`. Downstream,
// `capturer::engine::mac::get_output_frame_size` multiplies the crop
// area's size by that scale factor, so a selected window's *output*
// frame size collapsed to 0×0 — which ScreenCaptureKit doesn't error on,
// it just falls back to capturing the entire display instead of the
// selected window. That's the root cause of window capture silently
// recording everything instead of just the chosen window.
//
// Fixed by sourcing both values from data that isn't scoped to this
// process: `SCShareableContent` (already used above in `get_all_targets`,
// a window-server-level query) for real width/height, and the main
// display's scale factor as a stand-in for "the window's own display" —
// the same simplification the host app's own `capture::scale_factor`
// already makes for windows, since figuring out which physical display a
// window is actually on needs more bookkeeping than a single-display or
// uniform-scale-factor setup (by far the common case) warrants.
pub fn get_scale_factor(target: &Target) -> f64 {
    match target {
        Target::Window(_) => {
            let mode = CGDisplay::main().display_mode().unwrap();
            (mode.pixel_width() / mode.width()) as f64
        }
        Target::Display(display) => {
            let mode = display.raw_handle.display_mode().unwrap();
            (mode.pixel_width() / mode.width()) as f64
        }
    }
}

pub fn get_target_dimensions(target: &Target) -> (u64, u64) {
    match target {
        Target::Window(window) => SCShareableContent::current()
            .windows
            .into_iter()
            .find(|w| w.window_id == window.id)
            .map(|w| (w.width as u64, w.height as u64))
            .unwrap_or((0, 0)),
        Target::Display(display) => {
            let mode = display.raw_handle.display_mode().unwrap();
            (mode.width(), mode.height())
        }
    }
}
// --- end Dolly patch -----------------------------------------------------
