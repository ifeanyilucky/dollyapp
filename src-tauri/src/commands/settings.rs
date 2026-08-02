use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{projects, settings};

const SETTINGS_LABEL: &str = "settings";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInfo {
    show_in_dock: bool,
    recordings_dir: String,
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> SettingsInfo {
    let current = settings::load(&app);
    SettingsInfo {
        show_in_dock: current.show_in_dock,
        recordings_dir: projects::recordings_dir(&app)
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    }
}

/// Single entry point for changing Dock visibility — delegates to
/// `tray::set_show_in_dock`, which is also what the tray's own "Show Dolly
/// in Dock" checkbox calls, so the persisted preference, the tray
/// checkmark, and the actual Dock policy can never drift apart.
#[tauri::command]
pub fn set_show_in_dock(app: AppHandle, enabled: bool) {
    crate::tray::set_show_in_dock(&app, enabled);
}

/// Opens (or focuses) the settings window — called from both the tray
/// menu's "Show settings" item and the toolbar's Settings button.
#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        SETTINGS_LABEL,
        WebviewUrl::App("index.html?mode=settings".into()),
    )
    .title("Dolly Settings")
    .inner_size(460.0, 420.0)
    .min_inner_size(420.0, 380.0)
    .visible(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}
