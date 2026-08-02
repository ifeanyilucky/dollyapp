//! Persisted app-level preferences — currently just Dock visibility.
//! Stored as JSON in the app's config dir, applied at startup (`lib.rs::run`)
//! and re-applied any time it's toggled, from either the tray checkbox
//! (`tray::set_show_in_dock`) or the settings window.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub show_in_dock: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self { show_in_dock: true }
    }
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("settings.json"))
}

/// Falls back to `AppSettings::default()` on first launch or if the file is
/// missing/unreadable/corrupt — settings are a convenience, not something
/// worth failing startup over.
pub fn load(app: &AppHandle) -> AppSettings {
    settings_path(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &AppSettings) {
    let Some(path) = settings_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            tracing::warn!("failed to create settings directory: {e}");
            return;
        }
    }
    match serde_json::to_vec_pretty(settings) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                tracing::warn!("failed to write settings to {}: {e}", path.display());
            }
        }
        Err(e) => tracing::warn!("failed to serialize settings: {e}"),
    }
}
