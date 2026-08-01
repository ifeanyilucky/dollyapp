//! Global hotkey to start/stop recording without touching the tray menu.
//! Default `⌥⌘2` per PRD §9 ("Hotkey to start and stop"); a configurable
//! binding is an editor-settings-panel feature, not built yet.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::tray;

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                // Fires on both press and release; only act once per press.
                if event.state() == ShortcutState::Pressed {
                    tray::toggle_recording(app.clone());
                }
            })
            .build(),
    )?;

    let start_stop = Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::Digit2);
    app.global_shortcut()
        .register(start_stop)
        .map_err(|e| anyhow::anyhow!(e))?;

    Ok(())
}
