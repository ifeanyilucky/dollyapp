//! The floating recording toolbar — an always-on-top, undecorated,
//! translucent window that carries the source picker and start/stop
//! controls (PRD §9, Screen Studio-style "floating toolbar" — macOS UI
//! terms for this: floating panel / HUD / overlay controls / always-on-top
//! window). This is the app's primary idle-state UI; the regular "main"
//! window is reserved for the first-run permission flow (`lib.rs::setup`)
//! and the post-recording editor (`recorder::stop`, `commands::editor`).
//!
//! A real `NSPanel` (non-activating, so it never steals focus from
//! whatever app you're about to record) isn't available through Tauri's
//! window API — this is a plain `NSWindow` with `.always_on_top` and
//! `.visible_on_all_workspaces`, which covers "floats above everything,
//! everywhere" but not "never takes focus". Good enough for now; a true
//! `NSPanel` would need a custom raw-`objc2` window subclass.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::capture;

const LABEL: &str = "toolbar";
const WIDTH: f64 = 900.0;
/// Taller than the visible pill itself (~90px) — a real OS window clips
/// its own content at its bounds, so the Display dropdown (rendered inside
/// this same window via a Radix portal, not a separate window) needs slack
/// below the pill to actually be visible instead of being cut off. The
/// pill stays pinned near the top (see `ToolbarView`), so this only grows
/// the window downward, invisibly, until a menu opens.
///
/// Since the window is much bigger than the pill, `spawn_hit_test_loop`
/// below keeps the OS-level "ignore cursor events" flag in sync with
/// whether the cursor is actually over the visible pill (as reported by
/// `set_hit_rect`) — otherwise this whole invisible region would sit on
/// top of, and block clicks into, whatever's underneath it on screen.
const HEIGHT: f64 = 420.0;
/// Vertical distance from the window's top edge to the visible pill's
/// center. The pill is pinned to the top of this (taller) window via
/// `pt-2` and is 64px tall (8px top padding + 48px controls + 8px bottom
/// padding), so its center sits 40px below the window's top edge. Used to
/// position the window so the *pill* — not the taller, mostly-invisible
/// window itself — lands on the display's vertical center.
const PILL_CENTER_OFFSET: f64 = 40.0;

/// How often `spawn_hit_test_loop` re-checks the cursor against the pill's
/// reported bounds. Cheap (two syscalls, no IPC to the frontend) — short
/// enough that the click-through toggle feels instant, long enough to be
/// a non-issue on CPU.
const HIT_TEST_INTERVAL: Duration = Duration::from_millis(30);
/// Slack added around the reported pill rect before treating the cursor as
/// "outside" it — without this, the very first pixel at the pill's edge
/// would already read as a miss.
const HIT_TEST_MARGIN: f64 = 4.0;

/// The visible pill's bounds within the toolbar window, in window-local
/// logical points (`getBoundingClientRect()` units) — reported by the
/// frontend via `set_toolbar_hit_rect` since only it knows where flex
/// layout actually placed the pill (it moves: recording vs. picker mode
/// are different widths/heights, see `ToolbarView`/`RecordingControls`).
/// `None` until the first report lands, during which the whole window
/// stays click-through — better to briefly not receive a click on the
/// pill than to briefly block the screen behind it.
#[derive(Default)]
pub struct ToolbarHitRect(Mutex<Option<(f64, f64, f64, f64)>>);

pub fn set_hit_rect(state: &ToolbarHitRect, rect: (f64, f64, f64, f64)) {
    *state.0.lock().unwrap() = Some(rect);
}

/// Creates (if it doesn't already exist) and shows the floating toolbar.
pub fn show(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    let (display_x, display_y, display_width, display_height) = main_display_bounds();
    let x = display_x + (display_width - WIDTH) / 2.0;
    let y = display_y + display_height / 2.0 - PILL_CENTER_OFFSET;

    WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?mode=toolbar".into()),
    )
    .title("Dolly")
    .position(x, y)
    .inner_size(WIDTH, HEIGHT)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(true)
    .focused(true)
    .visible(true)
    .build()?;

    // Only spawned once, right after the window is first created (not on
    // every `show()` — the `if let Some(window) = ...` branch above
    // returns early for a re-show, so this line only runs the one time).
    spawn_hit_test_loop(app.clone());

    Ok(())
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

fn main_display_bounds() -> (f64, f64, f64, f64) {
    match capture::main_display() {
        Some(scap::Target::Display(d)) => capture::display_bounds(d.id),
        _ => (0.0, 0.0, 1440.0, 900.0),
    }
}

/// Keeps the toolbar window's OS-level "ignore cursor events" flag synced
/// to whether the cursor is over the visible pill, so the rest of the
/// (much bigger, invisible) window lets clicks fall through to whatever
/// app is actually underneath it on screen. Runs for the lifetime of the
/// app once the toolbar window exists — cheap enough (two syscalls per
/// tick, no frontend round-trip) not to bother tearing down.
fn spawn_hit_test_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(HIT_TEST_INTERVAL).await;

            let Some(window) = app.get_webview_window(LABEL) else {
                break;
            };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }

            let rect = app.state::<ToolbarHitRect>();
            let Some((rx, ry, rw, rh)) = *rect.0.lock().unwrap() else {
                let _ = window.set_ignore_cursor_events(true);
                continue;
            };

            let (Ok(outer), Ok(scale)) = (window.outer_position(), window.scale_factor()) else {
                continue;
            };
            let Some((cursor_x, cursor_y)) = capture::cursor_position() else {
                continue;
            };

            // `outer_position()` is physical pixels; the pill rect the
            // frontend reports is logical (`getBoundingClientRect()`) —
            // both need to land in the same unit before comparing against
            // the cursor position, which is already in point space (see
            // `capture::cursor_position`'s doc comment).
            let win_x = outer.x as f64 / scale;
            let win_y = outer.y as f64 / scale;

            let inside = cursor_x >= win_x + rx - HIT_TEST_MARGIN
                && cursor_x <= win_x + rx + rw + HIT_TEST_MARGIN
                && cursor_y >= win_y + ry - HIT_TEST_MARGIN
                && cursor_y <= win_y + ry + rh + HIT_TEST_MARGIN;

            let _ = window.set_ignore_cursor_events(!inside);
        }
    });
}
