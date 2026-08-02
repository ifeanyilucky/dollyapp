//! Capturable displays/windows, and mapping the frontend's plain-data
//! selection back onto `scap::Target` (which wraps a raw `CGDisplay`/
//! `CGWindowID` and isn't worth serializing over IPC as-is).

use std::ffi::c_void;
use std::os::raw::c_char;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetKind {
    Display,
    Window,
}

#[derive(Debug, Clone, Serialize)]
pub struct TargetInfo {
    pub id: u32,
    pub kind: TargetKind,
    pub title: String,
}

impl From<&scap::Target> for TargetInfo {
    fn from(target: &scap::Target) -> Self {
        match target {
            scap::Target::Display(d) => TargetInfo {
                id: d.id,
                kind: TargetKind::Display,
                title: d.title.clone(),
            },
            scap::Target::Window(w) => TargetInfo {
                id: w.id,
                kind: TargetKind::Window,
                title: w.title.clone(),
            },
        }
    }
}

/// Displays first, then windows — matches the picker's expected grouping
/// (PRD §9: "Picker: full display / window / region").
pub fn list_targets() -> Vec<TargetInfo> {
    let targets = scap::get_all_targets();
    let mut displays: Vec<TargetInfo> = targets
        .iter()
        .filter(|t| matches!(t, scap::Target::Display(_)))
        .map(TargetInfo::from)
        .collect();
    let windows = targets
        .iter()
        .filter(|t| matches!(t, scap::Target::Window(_)))
        .map(TargetInfo::from);
    displays.extend(windows);
    displays
}

/// Re-resolves a `scap::Target` from an id + kind pair. Targets aren't
/// cached between listing and selecting — window/display sets can change
/// between the two (a window closes, a display disconnects), so a fresh
/// lookup is the only way to know the id is still valid.
pub fn resolve_target(id: u32, kind: TargetKind) -> Option<scap::Target> {
    scap::get_all_targets()
        .into_iter()
        .find(|t| match (t, kind) {
            (scap::Target::Display(d), TargetKind::Display) => d.id == id,
            (scap::Target::Window(w), TargetKind::Window) => w.id == id,
            _ => false,
        })
}

/// `scap` 0.0.8 doesn't publicly expose a "main display" getter (it exists
/// internally but isn't `pub`), so this re-derives it: find the
/// `Target::Display` whose id matches `CGDisplay::main()`, falling back to
/// the first display listed if that somehow doesn't match anything.
pub fn main_display() -> Option<scap::Target> {
    let main_id = core_graphics::display::CGDisplay::main().id;
    let targets = scap::get_all_targets();
    targets
        .iter()
        .find(|t| matches!(t, scap::Target::Display(d) if d.id == main_id))
        .or_else(|| {
            targets
                .iter()
                .find(|t| matches!(t, scap::Target::Display(_)))
        })
        .cloned()
}

/// Points-to-pixels scale factor for a target's display. `scap` doesn't
/// expose this either (same gap as `main_display`), so it's computed
/// directly via `CGDisplayMode`'s point vs. pixel width — no AppKit/main-
/// thread dependency, unlike the `NSScreen.backingScaleFactor` route.
/// Windows use their containing display's factor; since finding which
/// display a window is actually on needs more bookkeeping than this is
/// worth right now, this always uses the main display for windows, which
/// is correct on the common single/uniform-scale-factor setup.
pub fn scale_factor(target: &scap::Target) -> f64 {
    let display_id = match target {
        scap::Target::Display(d) => d.id,
        scap::Target::Window(_) => core_graphics::display::CGDisplay::main().id,
    };

    core_graphics::display::CGDisplay::new(display_id)
        .display_mode()
        .map(|mode| mode.pixel_width() as f64 / mode.width().max(1) as f64)
        .unwrap_or(1.0)
}

/// Global point-space bounds of a display — used to size and position the
/// area-selection overlay window so it exactly covers the display being
/// selected from.
pub fn display_bounds(display_id: u32) -> (f64, f64, f64, f64) {
    let bounds = core_graphics::display::CGDisplay::new(display_id).bounds();
    (
        bounds.origin.x,
        bounds.origin.y,
        bounds.size.width,
        bounds.size.height,
    )
}

/// A user-picked sub-rectangle of a display to record instead of the whole
/// thing (PRD §9's "region" picker) — in the same global point space as
/// `cursor.json` (see `DisplayInfo::origin_x`'s doc comment).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropArea {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Converts a `CropArea` (global point space, see its doc comment) into
/// `scap`'s own `Area` (which `SCContentFilter` interprets relative to
/// *`target`'s own* top-left, not the global desktop — the same offset
/// `target_origin` below computes) by subtracting `target`'s own origin.
pub fn crop_area_for_target(area: CropArea, target: &scap::Target) -> scap::capturer::Area {
    let (origin_x, origin_y) = target_origin(target, None);
    scap::capturer::Area {
        origin: scap::capturer::Point {
            x: area.x - origin_x,
            y: area.y - origin_y,
        },
        size: scap::capturer::Size {
            width: area.width,
            height: area.height,
        },
    }
}

/// Top-left of a target's actual captured content, in the same global
/// point space `cursor.json` samples are already in — see
/// `DisplayInfo::origin_x`'s doc comment for why this matters. `crop`, if
/// given, overrides the target's own origin (used when recording a
/// user-picked area rather than the whole target).
pub fn target_origin(target: &scap::Target, crop: Option<CropArea>) -> (f64, f64) {
    if let Some(area) = crop {
        return (area.x, area.y);
    }
    match target {
        scap::Target::Display(d) => {
            let bounds = core_graphics::display::CGDisplay::new(d.id).bounds();
            (bounds.origin.x, bounds.origin.y)
        }
        scap::Target::Window(w) => window_origin(w.id).unwrap_or((0.0, 0.0)),
    }
}

// --- Raw CGWindowListCopyWindowInfo lookup --------------------------------
//
// `scap`'s own window target doesn't expose an on-screen position (only
// width/height, via `SCShareableContent` — see `vendor/scap/PATCH.md`),
// and `CGWindowListCopyWindowInfo` is the standard cross-process way to
// get one: unlike `[NSApp windowWithWindowNumber:]` (broken for any
// window not owned by this process, which is the same bug the vendored
// scap patch works around), it's a window-server-level query that works
// for any window regardless of owning process. Declared raw here rather
// than pulling in the `core-foundation` crate for a single field read.
type CfTypeRef = *const c_void;
type CfArrayRef = *const c_void;
type CfDictionaryRef = *const c_void;
type CfStringRef = *const c_void;
type CfIndex = isize;

#[repr(C)]
#[derive(Clone, Copy)]
struct CgPoint {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct CgSize {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct CgRect {
    origin: CgPoint,
    size: CgSize,
}

const K_CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW: u32 = 1 << 3;
const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
const K_CG_WINDOW_LIST_OPTION_EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;
const K_CF_NUMBER_SINT32: i32 = 3;
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    static kCGWindowNumber: CfStringRef;
    static kCGWindowOwnerPID: CfStringRef;
    static kCGWindowOwnerName: CfStringRef;
    static kCGWindowName: CfStringRef;
    static kCGWindowLayer: CfStringRef;
    static kCGWindowBounds: CfStringRef;
    fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> CfArrayRef;
    fn CGRectMakeWithDictionaryRepresentation(dict: CfDictionaryRef, rect: *mut CgRect) -> u8;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: CfArrayRef) -> CfIndex;
    fn CFArrayGetValueAtIndex(array: CfArrayRef, idx: CfIndex) -> *const c_void;
    fn CFDictionaryGetValue(dict: CfDictionaryRef, key: *const c_void) -> *const c_void;
    fn CFNumberGetValue(number: CfTypeRef, the_type: i32, value_ptr: *mut c_void) -> u8;
    fn CFStringGetCStringPtr(string: CfStringRef, encoding: u32) -> *const c_char;
    fn CFStringGetLength(string: CfStringRef) -> CfIndex;
    fn CFStringGetCString(
        string: CfStringRef,
        buffer: *mut c_char,
        buffer_size: CfIndex,
        encoding: u32,
    ) -> u8;
    fn CFRelease(cf: CfTypeRef);
}

fn window_origin(window_id: u32) -> Option<(f64, f64)> {
    unsafe {
        let array = CGWindowListCopyWindowInfo(K_CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW, window_id);
        if array.is_null() {
            return None;
        }
        let result = (|| {
            if CFArrayGetCount(array) == 0 {
                return None;
            }
            let dict = CFArrayGetValueAtIndex(array, 0);
            let rect = dict_rect(dict)?;
            Some((rect.origin.x, rect.origin.y))
        })();
        CFRelease(array);
        result
    }
}

/// A capturable window under the cursor, with everything the window
/// picker's hover overlay needs to highlight it and label it — owner
/// (the app, e.g. "Google Chrome"), title, and its current on-screen
/// size. `x`/`y`/`width`/`height` are in the same global point space as
/// `cursor.json` and `display_bounds`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowHitInfo {
    pub window_id: u32,
    pub owner_name: String,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Topmost on-screen window whose bounds contain `(x, y)`, or `None`.
/// `CGWindowListCopyWindowInfo` lists on-screen windows front-to-back, so
/// the first match is the frontmost. Windows owned by this process (the
/// toolbar, the picker overlay itself, the main window) and non-user
/// windows (menubar/dock/desktop — anything with a `kCGWindowLayer` other
/// than the normal 0) are skipped. Window names are redacted to the app
/// name unless Screen Recording permission is granted, which the toolbar
/// (the picker's only entry point) guarantees.
pub fn window_at_point(x: f64, y: f64) -> Option<WindowHitInfo> {
    let own_pid = std::process::id() as i32;
    unsafe {
        let array = CGWindowListCopyWindowInfo(
            K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY
                | K_CG_WINDOW_LIST_OPTION_EXCLUDE_DESKTOP_ELEMENTS,
            0,
        );
        if array.is_null() {
            return None;
        }
        let result = (|| {
            for i in 0..CFArrayGetCount(array) {
                let dict = CFArrayGetValueAtIndex(array, i);

                if dict_number(dict, kCGWindowLayer).unwrap_or(0) != 0 {
                    continue;
                }
                if dict_number(dict, kCGWindowOwnerPID).unwrap_or(-1) == own_pid {
                    continue;
                }
                let rect = match dict_rect(dict) {
                    Some(rect) => rect,
                    None => continue,
                };
                if rect.size.width <= 0.0
                    || rect.size.height <= 0.0
                    || x < rect.origin.x
                    || x > rect.origin.x + rect.size.width
                    || y < rect.origin.y
                    || y > rect.origin.y + rect.size.height
                {
                    continue;
                }

                return Some(WindowHitInfo {
                    window_id: dict_number(dict, kCGWindowNumber).unwrap_or(0) as u32,
                    owner_name: dict_string(dict, kCGWindowOwnerName).unwrap_or_default(),
                    title: dict_string(dict, kCGWindowName).unwrap_or_default(),
                    x: rect.origin.x,
                    y: rect.origin.y,
                    width: rect.size.width,
                    height: rect.size.height,
                });
            }
            None
        })();
        CFRelease(array);
        result
    }
}

/// `window_at_point` at the cursor's current location — seeds the picker
/// overlay with the window under the cursor the moment it opens, without
/// waiting for the first `mousemove`.
pub fn window_at_cursor() -> Option<WindowHitInfo> {
    let (x, y) = cursor_position()?;
    window_at_point(x, y)
}

/// The cursor's current position in the same global point space as
/// `kCGWindowBounds` (what `window_at_point`'s hit-testing compares
/// against) — used directly by `window_at_cursor` above, and by the
/// toolbar's click-through polling (`toolbar::spawn_hit_test_loop`),
/// which needs the raw position rather than a window hit-test result.
pub fn cursor_position() -> Option<(f64, f64)> {
    let source = core_graphics::event_source::CGEventSource::new(
        core_graphics::event_source::CGEventSourceStateID::HIDSystemState,
    )
    .ok()?;
    let event = core_graphics::event::CGEvent::new(source).ok()?;
    let loc = event.location();
    Some((loc.x, loc.y))
}

unsafe fn dict_number(dict: CfDictionaryRef, key: CfStringRef) -> Option<i32> {
    let value = CFDictionaryGetValue(dict, key);
    if value.is_null() {
        return None;
    }
    let mut number: i32 = 0;
    let ok = CFNumberGetValue(
        value,
        K_CF_NUMBER_SINT32,
        &mut number as *mut i32 as *mut c_void,
    );
    if ok != 0 {
        Some(number)
    } else {
        None
    }
}

unsafe fn dict_string(dict: CfDictionaryRef, key: CfStringRef) -> Option<String> {
    let value = CFDictionaryGetValue(dict, key);
    if value.is_null() {
        return None;
    }
    // `CFStringGetCStringPtr` is the zero-copy fast path but can return
    // NULL (some strings' internal storage isn't directly exposable), so
    // fall back to a buffered copy via `CFStringGetCString`.
    let ptr = CFStringGetCStringPtr(value, K_CF_STRING_ENCODING_UTF8);
    if !ptr.is_null() {
        return Some(std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned());
    }
    let length = CFStringGetLength(value);
    // Up to 4 bytes per UTF-8 code point, plus room for the NUL.
    let mut buffer = vec![0u8; length.max(0) as usize * 4 + 1];
    let ok = CFStringGetCString(
        value,
        buffer.as_mut_ptr().cast(),
        buffer.len() as CfIndex,
        K_CF_STRING_ENCODING_UTF8,
    );
    if ok != 0 {
        let len = buffer.iter().position(|&b| b == 0).unwrap_or(buffer.len());
        return Some(String::from_utf8_lossy(&buffer[..len]).into_owned());
    }
    None
}

unsafe fn dict_rect(dict: CfDictionaryRef) -> Option<CgRect> {
    let bounds = CFDictionaryGetValue(dict, kCGWindowBounds);
    if bounds.is_null() {
        return None;
    }
    let mut rect = CgRect {
        origin: CgPoint { x: 0.0, y: 0.0 },
        size: CgSize {
            width: 0.0,
            height: 0.0,
        },
    };
    let ok = CGRectMakeWithDictionaryRepresentation(bounds, &mut rect as *mut CgRect);
    if ok != 0 {
        Some(rect)
    } else {
        None
    }
}
