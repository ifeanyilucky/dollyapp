use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::capture::{self, CropArea};
use crate::recorder::{self, RecorderState};
use crate::toolbar;

const AREA_SELECTOR_LABEL: &str = "area-selector";
/// Emitted to the main window once an area is confirmed, so its picker UI
/// can reflect the selection without polling — mirrors the pattern
/// `recorder::RECORDING_STATE_EVENT` already uses.
const AREA_SELECTED_EVENT: &str = "area-selected";

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct AreaSelectedPayload {
    display_id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Opens a transparent, borderless, always-on-top window covering the main
/// display for the "Area" picker's drag-to-select flow (PRD §9's "region"
/// picker). The frontend detects this via `?mode=area-select` in its own
/// URL (see `main.tsx`) and renders a crosshair/drag-rect overlay instead
/// of the normal app UI. Scoped to the main display only, for now — the
/// same simplification `capture::scale_factor` already makes for windows.
#[tauri::command]
pub fn open_area_selector(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window(AREA_SELECTOR_LABEL).is_some() {
        return Ok(());
    }

    // Get the always-on-top toolbar out of the way so it can't overlap the
    // selection surface (it sits at the screen center now).
    toolbar::hide(&app);

    let display_id = match capture::main_display().ok_or("no capturable display found")? {
        scap::Target::Display(d) => d.id,
        scap::Target::Window(_) => unreachable!("main_display always returns a Display target"),
    };
    let (x, y, width, height) = capture::display_bounds(display_id);

    WebviewWindowBuilder::new(
        &app,
        AREA_SELECTOR_LABEL,
        WebviewUrl::App(format!("index.html?mode=area-select&displayId={display_id}").into()),
    )
    .title("Select an area")
    .position(x, y)
    .inner_size(width, height)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .focused(true)
    .visible(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Called by the area-selector overlay once the user finishes dragging a
/// rectangle. Sets the selection (same effect as `select_capture_area`),
/// notifies the main window, and closes the overlay.
#[tauri::command]
pub fn confirm_area_selection(
    app: AppHandle,
    state: State<'_, RecorderState>,
    display_id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let target = capture::resolve_target(display_id, capture::TargetKind::Display)
        .ok_or_else(|| format!("no display with id {display_id}"))?;
    recorder::set_selected_target(&state, Some(target));
    recorder::set_selected_area(
        &state,
        Some(CropArea {
            x,
            y,
            width,
            height,
        }),
    );

    let _ = app.emit(
        AREA_SELECTED_EVENT,
        AreaSelectedPayload {
            display_id,
            x,
            y,
            width,
            height,
        },
    );
    close_area_selector(&app);
    // The toolbar comes back so the user can hit Start on the area they
    // just drew.
    let _ = toolbar::show(&app);
    Ok(())
}

/// Called by the area-selector overlay on cancel (Escape, or clicking
/// outside without dragging) — closes it without changing the selection,
/// and brings the toolbar back.
#[tauri::command]
pub fn cancel_area_selection(app: AppHandle) {
    close_area_selector(&app);
    let _ = toolbar::show(&app);
}

fn close_area_selector(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(AREA_SELECTOR_LABEL) {
        let _ = window.close();
    }
}
