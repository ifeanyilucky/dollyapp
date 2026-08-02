use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::capture::{self, TargetKind, WindowHitInfo};
use crate::recorder::{self, RecorderState};
use crate::toolbar;

const WINDOW_PICKER_LABEL: &str = "window-picker";
/// Emitted to the main/toolbar window once a window is picked (and
/// recording starts), so its picker UI can reflect the choice — mirrors
/// the pattern `area_selector::AREA_SELECTED_EVENT` already uses.
const WINDOW_SELECTED_EVENT: &str = "window-selected";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WindowSelectedPayload {
    window_id: u32,
    title: String,
}

/// Opens the full-screen hover-to-pick overlay for the "Window" picker
/// (PRD §9's window picker, Screen Studio-style): rather than listing
/// windows in a menu, the user moves their cursor over a window and it
/// gets highlighted in place. Resolves once the window is open — the
/// actual pick arrives later, asynchronously, either as
/// `pick_window_and_record` or `cancel_window_picker`.
///
/// The overlay is a transparent, borderless, always-on-top window covering
/// the main display — the same setup `open_area_selector` uses. It hit-
/// tests on every cursor move via `window_info_at_point` (which excludes
/// this app's own windows, so the overlay never highlights itself).
#[tauri::command]
pub fn open_window_picker(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window(WINDOW_PICKER_LABEL).is_some() {
        return Ok(());
    }

    // The toolbar is always-on-top too — get it out of the way so it
    // doesn't sit over the overlay's centered label (or block hits on the
    // windows behind it) while the user is picking.
    toolbar::hide(&app);

    let display_id = match capture::main_display().ok_or("no capturable display found")? {
        scap::Target::Display(d) => d.id,
        scap::Target::Window(_) => unreachable!("main_display always returns a Display target"),
    };
    let (x, y, width, height) = capture::display_bounds(display_id);

    WebviewWindowBuilder::new(
        &app,
        WINDOW_PICKER_LABEL,
        WebviewUrl::App(format!("index.html?mode=window-pick&ox={x}&oy={y}").into()),
    )
    .title("Select a window")
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

/// Hit-tests the on-screen windows at `(x, y)` — global display point
/// space (the overlay webview reports its own `clientX/clientY` offset by
/// its window position to reconstruct these). Returns `None` when the
/// cursor isn't over a capturable window.
#[tauri::command]
pub fn window_info_at_point(x: f64, y: f64) -> Option<WindowHitInfo> {
    capture::window_at_point(x, y)
}

/// `window_info_at_point` at the cursor's current location — seeds the
/// overlay with the window under the cursor as soon as it opens.
#[tauri::command]
pub fn window_info_at_cursor() -> Option<WindowHitInfo> {
    capture::window_at_cursor()
}

/// Called by the overlay when the user picks a window (clicking it or the
/// overlay's "Start recording" button): selects it as the capture target,
/// closes the overlay, and starts recording it immediately.
#[tauri::command]
pub fn pick_window_and_record(
    app: AppHandle,
    state: State<'_, RecorderState>,
    window_id: u32,
) -> Result<(), String> {
    let target = capture::resolve_target(window_id, TargetKind::Window)
        .ok_or_else(|| format!("window {window_id} is no longer available"))?;
    let title = match &target {
        scap::Target::Window(w) => w.title.clone(),
        _ => String::new(),
    };
    recorder::set_selected_target(&state, Some(target));

    let _ = app.emit(
        WINDOW_SELECTED_EVENT,
        WindowSelectedPayload {
            window_id,
            title: title.clone(),
        },
    );

    // Start first, close only on success — if `recorder::start` fails
    // (e.g. a recording is already in progress) the overlay stays open so
    // the frontend can surface the error and the user can cancel. The
    // overlay is a *window* target's capture-irrelevant sibling anyway, and
    // the first frame never lands before this returns, so closing after is
    // safe.
    recorder::start(&app, &state).map_err(|e| e.to_string())?;
    close_window_picker(&app);
    // The toolbar (which the user just picked from) comes back to show the
    // stop control.
    let _ = toolbar::show(&app);
    Ok(())
}

/// Called by the overlay on cancel (Escape) — closes it without changing
/// the selection, and brings the toolbar back.
#[tauri::command]
pub fn cancel_window_picker(app: AppHandle) {
    close_window_picker(&app);
    let _ = toolbar::show(&app);
}

fn close_window_picker(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_PICKER_LABEL) {
        // Hide before close so the always-on-top overlay is off the screen
        // the moment a recording starts, even if teardown is still running.
        let _ = window.hide();
        let _ = window.close();
    }
}
