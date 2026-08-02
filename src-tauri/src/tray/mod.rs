//! Menu bar tray icon — the primary entry point for recording, per PRD §9
//! ("Menu bar item is the primary entry point; the main window is for
//! editing"). Shares `toggle_recording` with the global shortcut
//! (`src-tauri/src/shortcut.rs`) so both trigger the exact same start/stop
//! path as the editor UI would.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::recorder;

const TOGGLE_ID: &str = "toggle_recording";
const SHOW_TOOLBAR_ID: &str = "show_toolbar";

/// Wraps the toggle item so its label can be flipped between "Start" and
/// "Stop" after each call to `toggle_recording`. Tauri's menu handles are
/// themselves `Send + Sync` (mutating one dispatches to the main thread
/// internally), unlike the cursor monitor token in `cursor::macos` — no
/// thread-confinement dance needed here.
struct ToggleMenuItem(MenuItem<Wry>);

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let toggle_item = MenuItem::with_id(
        app,
        TOGGLE_ID,
        "Start Recording (\u{2325}\u{2318}2)",
        true,
        None::<&str>,
    )?;
    let quit_item = PredefinedMenuItem::quit(app, Some("Quit Dolly"))?;
    let show_item = MenuItem::with_id(app, SHOW_TOOLBAR_ID, "Show Toolbar", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle_item, &show_item, &quit_item])?;

    app.manage(ToggleMenuItem(toggle_item));

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Dolly")
        .on_menu_event(|app, event| {
            if event.id() == SHOW_TOOLBAR_ID {
                // Brings the floating toolbar back after it was closed
                // (Escape / its close button) — it can't be reopened any
                // other way.
                let _ = crate::toolbar::show(app);
            } else if event.id() == TOGGLE_ID {
                toggle_recording(app.clone());
            }
        })
        .build(app)?;

    Ok(())
}

/// Starts or stops recording depending on current state. Called from the
/// tray menu and the global shortcut — never call `recorder::start`/`stop`
/// directly from a new entry point without going through this, or the
/// label will fall out of sync with reality.
pub fn toggle_recording(app: AppHandle) {
    let state = app.state::<recorder::RecorderState>();

    if recorder::is_recording(&state) {
        tauri::async_runtime::spawn(async move {
            let state = app.state::<recorder::RecorderState>();
            match recorder::stop(&app, &state).await {
                Ok(path) => tracing::info!("recording saved to {}", path.display()),
                Err(e) => tracing::error!("failed to stop recording: {e}"),
            }
            set_label(&app, "Start Recording (\u{2325}\u{2318}2)");
        });
        return;
    }

    match recorder::start(&app, &state) {
        Ok(()) => set_label(&app, "Stop Recording (\u{2325}\u{2318}2)"),
        Err(e) => tracing::error!("failed to start recording: {e}"),
    }
}

fn set_label(app: &AppHandle, text: &str) {
    if let Some(item) = app.try_state::<ToggleMenuItem>() {
        if let Err(e) = item.0.set_text(text) {
            tracing::warn!("failed to update tray menu label: {e}");
        }
    }
}
