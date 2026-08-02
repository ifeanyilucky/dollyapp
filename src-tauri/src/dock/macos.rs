use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
use objc2_foundation::MainThreadMarker;
use tauri::AppHandle;

/// Shows or hides the Dock icon by flipping `NSApplication`'s activation
/// policy between `.regular` (Dock icon, normal Cmd-Tab switching) and
/// `.accessory` (menu-bar-only, no Dock icon) — takes effect immediately,
/// no relaunch needed. Dispatched onto the main thread like every other
/// direct AppKit call in this codebase (see `cursor::macos`'s doc comment
/// on why: AppKit objects/calls are thread-confined).
pub fn set_visible(app: &AppHandle, visible: bool) {
    let _ = app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        let policy = if visible {
            NSApplicationActivationPolicy::Regular
        } else {
            NSApplicationActivationPolicy::Accessory
        };
        ns_app.setActivationPolicy(policy);
    });
}
