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
const HEIGHT: f64 = 420.0;
/// Vertical distance from the window's top edge to the visible pill's
/// center. The pill is pinned to the top of this (taller) window via
/// `pt-2` and is 64px tall (8px top padding + 48px controls + 8px bottom
/// padding), so its center sits 40px below the window's top edge. Used to
/// position the window so the *pill* — not the taller, mostly-invisible
/// window itself — lands on the display's vertical center.
const PILL_CENTER_OFFSET: f64 = 40.0;

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
