//! Toolbar window IPC — the floating toolbar's close affordance (Escape or
//! its close button). A thin command over `toolbar::hide`, which the
//! picker overlays also use to get out of the way while they're open.

use tauri::{AppHandle, State};

use crate::toolbar::{self, ToolbarHitRect};

/// Hides the floating toolbar. The app keeps running in the background —
/// the tray menu's "Show Toolbar", the global shortcut, or any other
/// `toolbar::show` call brings it back.
#[tauri::command]
pub fn close_toolbar(app: AppHandle) {
    toolbar::hide(&app);
}

/// Reports the visible pill's bounds so the toolbar window's click-through
/// polling (`toolbar::spawn_hit_test_loop`) knows what part of the
/// (much bigger) window is actually meant to receive clicks. See
/// `setToolbarHitRect`'s doc comment on the frontend side.
#[tauri::command]
pub fn set_toolbar_hit_rect(
    state: State<'_, ToolbarHitRect>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) {
    toolbar::set_hit_rect(&state, (x, y, width, height));
}
