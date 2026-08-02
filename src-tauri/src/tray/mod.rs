//! Menu bar tray icon — the primary entry point for recording, per PRD §9
//! ("Menu bar item is the primary entry point; the main window is for
//! editing"). Shares `toggle_recording` with the global shortcut
//! (`src-tauri/src/shortcut.rs`) so both trigger the exact same start/stop
//! path as the editor UI would.
//!
//! The menu itself has two shapes, swapped via `refresh_menu` rather than
//! mutated in place: the full idle menu (new recording / record
//! display-window-area / settings / dock toggle / previous projects / open
//! project) while nothing is recording, and a minimal stop-recording menu
//! while one is in progress — matching the screenshot this was built from,
//! which only shows the full picker menu in the idle state. `refresh_menu`
//! is wired to `recorder::RECORDING_STATE_EVENT` (setup, below) so it stays
//! correct no matter which entry point actually started/stopped the
//! recording (this tray, the toolbar's own button, the global shortcut, or
//! the window/area picker overlays), rather than every one of those call
//! sites needing to remember to poke the tray.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Listener, Manager, Wry};

use crate::{commands, dock, projects, recorder, settings};

const NEW_RECORDING_ID: &str = "new_recording";
const RECORD_DISPLAY_ID: &str = "record_display";
const RECORD_WINDOW_ID: &str = "record_window";
const RECORD_AREA_ID: &str = "record_area";
const SHOW_SETTINGS_ID: &str = "show_settings";
const SHOW_IN_DOCK_ID: &str = "show_in_dock";
const PREVIOUS_PROJECTS_ID: &str = "show_previous_projects";
const RECENT_PROJECT_PREFIX: &str = "open_recent_";
const OPEN_PROJECT_ID: &str = "open_project";
const OPEN_LAST_PROJECT_ID: &str = "open_last_project";
const TOGGLE_ID: &str = "toggle_recording";
/// How many past recordings the "Show previous projects" submenu lists.
const RECENT_PROJECTS_LIMIT: usize = 10;

/// Index -> bundle path for whatever "Show previous projects" is currently
/// showing, so `on_menu_event`'s `open_recent_{i}` ids can resolve back to
/// an actual path without round-tripping through the filesystem again.
/// Repopulated every time `build_idle_menu` runs.
#[derive(Default)]
struct RecentProjects(Mutex<Vec<PathBuf>>);

struct TrayHandle(TrayIcon<Wry>);

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.manage(RecentProjects::default());

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    let menu = build_idle_menu(app)?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Dolly")
        .on_menu_event(handle_menu_event)
        .build(app)?;

    app.manage(TrayHandle(tray));

    // Keeps the menu's shape (idle vs. recording) correct regardless of
    // which entry point actually changed recording state — see the module
    // doc comment.
    let app_handle = app.clone();
    app.listen(recorder::RECORDING_STATE_EVENT, move |_event| {
        refresh_menu(&app_handle);
    });

    Ok(())
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id: &str = event.id().as_ref();

    if let Some(index) = id.strip_prefix(RECENT_PROJECT_PREFIX) {
        if let Ok(index) = index.parse::<usize>() {
            let path = app
                .state::<RecentProjects>()
                .0
                .lock()
                .unwrap()
                .get(index)
                .cloned();
            if let Some(path) = path {
                projects::open_in_editor(app, &path);
            }
        }
        return;
    }

    match id {
        NEW_RECORDING_ID => {
            // Brings the floating toolbar back after it was closed (Escape
            // / its close button), or straight to the front if it's
            // already open — it can't be reopened any other way.
            let _ = crate::toolbar::show(app);
        }
        RECORD_DISPLAY_ID => start_display_recording(app),
        RECORD_WINDOW_ID => {
            let _ = commands::open_window_picker(app.clone());
        }
        RECORD_AREA_ID => {
            let _ = commands::open_area_selector(app.clone());
        }
        SHOW_SETTINGS_ID => {
            let _ = commands::open_settings_window(app.clone());
        }
        SHOW_IN_DOCK_ID => {
            let enabled = !settings::load(app).show_in_dock;
            set_show_in_dock(app, enabled);
        }
        OPEN_PROJECT_ID => {
            projects::open_project_dialog(app.clone());
        }
        OPEN_LAST_PROJECT_ID => {
            projects::open_last(app);
        }
        TOGGLE_ID => {
            toggle_recording(app.clone());
        }
        _ => {}
    }
}

pub fn start_display_recording(app: &AppHandle) {
    let state = app.state::<recorder::RecorderState>();
    // Clears any previously selected window/area target too (and any
    // selected area) — see `recorder::set_selected_target`'s doc comment —
    // so this always records the main display regardless of whatever was
    // last picked in the toolbar.
    recorder::set_selected_target(&state, None);
    if let Err(e) = recorder::start(app, &state) {
        tracing::error!("failed to start display recording from tray: {e}");
    }
}

/// Starts or stops recording depending on current state. Called from the
/// tray menu and the global shortcut — never call `recorder::start`/`stop`
/// directly from a new entry point without going through this, or the
/// menu will fall out of sync with reality (`refresh_menu` is triggered by
/// `RECORDING_STATE_EVENT`, which both `start`/`stop` emit either way, so
/// in practice any entry point works — this just centralizes the
/// start-vs-stop decision the way the label used to need it centralized).
pub fn toggle_recording(app: AppHandle) {
    let state = app.state::<recorder::RecorderState>();

    if recorder::is_recording(&state) {
        tauri::async_runtime::spawn(async move {
            let state = app.state::<recorder::RecorderState>();
            match recorder::stop(&app, &state).await {
                Ok(path) => tracing::info!("recording saved to {}", path.display()),
                Err(e) => tracing::error!("failed to stop recording: {e}"),
            }
        });
        return;
    }

    if let Err(e) = recorder::start(&app, &state) {
        tracing::error!("failed to start recording: {e}");
    }
}

/// Single entry point for changing Dock visibility — called by both the
/// tray's own checkbox and `commands::set_show_in_dock` (the settings
/// window's toggle), so the persisted preference, the checkbox, and the
/// actual Dock policy can never drift apart.
pub fn set_show_in_dock(app: &AppHandle, enabled: bool) {
    let mut current = settings::load(app);
    current.show_in_dock = enabled;
    settings::save(app, &current);
    dock::set_visible(app, enabled);
    refresh_menu(app);
}

/// Rebuilds and swaps in the menu matching current recording state —
/// called after every recording start/stop (via the `RECORDING_STATE_EVENT`
/// listener registered in `setup`) and after anything else that changes
/// what the idle menu should show (the dock checkbox, a new recording
/// appearing in "previous projects").
fn refresh_menu(app: &AppHandle) {
    let state = app.state::<recorder::RecorderState>();
    let menu = if recorder::is_recording(&state) {
        build_recording_menu(app)
    } else {
        build_idle_menu(app)
    };

    let menu = match menu {
        Ok(menu) => menu,
        Err(e) => {
            tracing::warn!("failed to rebuild tray menu: {e}");
            return;
        }
    };

    if let Some(tray) = app.try_state::<TrayHandle>() {
        if let Err(e) = tray.0.set_menu(Some(menu)) {
            tracing::warn!("failed to update tray menu: {e}");
        }
    }
}

fn build_idle_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let new_recording = MenuItem::with_id(
        app,
        NEW_RECORDING_ID,
        "New recording... (\u{2303}\u{2318}\u{23CE})",
        true,
        None::<&str>,
    )?;
    let record_display = MenuItem::with_id(
        app,
        RECORD_DISPLAY_ID,
        "Record display (\u{2325}\u{2318}3)",
        true,
        None::<&str>,
    )?;
    let record_window = MenuItem::with_id(
        app,
        RECORD_WINDOW_ID,
        "Record window (\u{2325}\u{2318}4)",
        true,
        None::<&str>,
    )?;
    let record_area = MenuItem::with_id(
        app,
        RECORD_AREA_ID,
        "Record area (\u{2325}\u{2318}5)",
        true,
        None::<&str>,
    )?;

    let show_settings = MenuItem::with_id(
        app,
        SHOW_SETTINGS_ID,
        "Show settings (\u{2318},)",
        true,
        None::<&str>,
    )?;
    let show_in_dock = CheckMenuItem::with_id(
        app,
        SHOW_IN_DOCK_ID,
        "Show Dolly in Dock (\u{2318}D)",
        true,
        settings::load(app).show_in_dock,
        None::<&str>,
    )?;

    let recent = projects::list_recent(app, RECENT_PROJECTS_LIMIT);
    *app.state::<RecentProjects>().0.lock().unwrap() = recent.clone();
    let previous_projects = build_previous_projects_submenu(app, &recent)?;

    let open_project = MenuItem::with_id(
        app,
        OPEN_PROJECT_ID,
        "Open project... (\u{2318}O)",
        true,
        None::<&str>,
    )?;
    let open_last_project = MenuItem::with_id(
        app,
        OPEN_LAST_PROJECT_ID,
        "Open last project (\u{2325}\u{2318}Z)",
        !recent.is_empty(),
        None::<&str>,
    )?;

    let quit = PredefinedMenuItem::quit(app, Some("Quit Dolly"))?;

    Menu::with_items(
        app,
        &[
            &new_recording,
            &PredefinedMenuItem::separator(app)?,
            &record_display,
            &record_window,
            &record_area,
            &PredefinedMenuItem::separator(app)?,
            &show_settings,
            &show_in_dock,
            &PredefinedMenuItem::separator(app)?,
            &previous_projects,
            &PredefinedMenuItem::separator(app)?,
            &open_project,
            &open_last_project,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

fn build_previous_projects_submenu(app: &AppHandle, recent: &[PathBuf]) -> tauri::Result<Submenu<Wry>> {
    if recent.is_empty() {
        let empty = MenuItem::with_id(app, "no_recent_projects", "No recordings yet", false, None::<&str>)?;
        return Submenu::with_id_and_items(app, PREVIOUS_PROJECTS_ID, "Show previous projects", true, &[&empty]);
    }

    let items = recent
        .iter()
        .enumerate()
        .map(|(index, path)| {
            let label = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Recording")
                .to_string();
            MenuItem::with_id(app, format!("{RECENT_PROJECT_PREFIX}{index}"), label, true, None::<&str>)
        })
        .collect::<tauri::Result<Vec<_>>>()?;

    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|item| item as &dyn IsMenuItem<Wry>).collect();
    Submenu::with_id_and_items(app, PREVIOUS_PROJECTS_ID, "Show previous projects", true, &refs)
}

fn build_recording_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let stop = MenuItem::with_id(app, TOGGLE_ID, "Stop Recording (\u{2325}\u{2318}2)", true, None::<&str>)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit Dolly"))?;
    Menu::with_items(app, &[&stop, &PredefinedMenuItem::separator(app)?, &quit])
}
