//! Global hotkeys for the tray menu's recording-entry items — the ones that
//! also make sense to trigger without going through the menu at all.
//! Default `⌥⌘2` to start/stop per PRD §9 ("Hotkey to start and stop"); the
//! rest (⌃⌘⏎ new recording, ⌥⌘3/4/5 record display/window/area) follow the
//! same precedent for the same reason. `⌘,`/`⌘O`/`⌥⌘Z` (settings/open
//! project/open last project) are deliberately *not* registered globally
//! here even though the tray menu displays them — those combos are
//! standard local shortcuts in most other Mac apps (Preferences/Open/Redo),
//! and a system-wide hotkey pre-empts whatever app is actually frontmost,
//! so hijacking them would break other apps' own shortcuts the whole time
//! Dolly is running. They still work as menu items, just not as hotkeys
//! outside the menu. A user-configurable binding is an editor-settings-
//! panel feature, not built yet.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::tray;

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                // Fires on both press and release; only act once per press.
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if *shortcut == start_stop_shortcut() {
                    tray::toggle_recording(app.clone());
                } else if *shortcut == new_recording_shortcut() {
                    let _ = crate::toolbar::show(app);
                } else if *shortcut == record_display_shortcut() {
                    tray::start_display_recording(app);
                } else if *shortcut == record_window_shortcut() {
                    let _ = crate::commands::open_window_picker(app.clone());
                } else if *shortcut == record_area_shortcut() {
                    let _ = crate::commands::open_area_selector(app.clone());
                }
            })
            .build(),
    )?;

    let shortcuts = app.global_shortcut();
    shortcuts
        .register(start_stop_shortcut())
        .map_err(|e| anyhow::anyhow!(e))?;
    shortcuts
        .register(new_recording_shortcut())
        .map_err(|e| anyhow::anyhow!(e))?;
    shortcuts
        .register(record_display_shortcut())
        .map_err(|e| anyhow::anyhow!(e))?;
    shortcuts
        .register(record_window_shortcut())
        .map_err(|e| anyhow::anyhow!(e))?;
    shortcuts
        .register(record_area_shortcut())
        .map_err(|e| anyhow::anyhow!(e))?;

    Ok(())
}

fn start_stop_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::Digit2)
}

fn new_recording_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SUPER), Code::Enter)
}

fn record_display_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::Digit3)
}

fn record_window_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::Digit4)
}

fn record_area_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::Digit5)
}
