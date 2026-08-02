//! Toolbar window IPC — the floating toolbar's close affordance (Escape or
//! its close button). A thin command over `toolbar::hide`, which the
//! picker overlays also use to get out of the way while they're open.

use tauri::AppHandle;

use crate::toolbar;

/// Hides the floating toolbar. The app keeps running in the background —
/// the tray menu's "Show Toolbar", the global shortcut, or any other
/// `toolbar::show` call brings it back.
#[tauri::command]
pub fn close_toolbar(app: AppHandle) {
    toolbar::hide(&app);
}
