use tauri::State;

use crate::capture::{self, CropArea, TargetInfo, TargetKind};
use crate::recorder::{self, RecorderState};

#[tauri::command]
pub fn list_capture_targets() -> Vec<TargetInfo> {
    capture::list_targets()
}

/// `None` clears the selection (falls back to the main display on the
/// next `start_recording`). Also clears any selected area — see
/// `recorder::set_selected_target`'s doc comment.
#[tauri::command]
pub fn select_capture_target(
    state: State<'_, RecorderState>,
    id: Option<u32>,
    kind: Option<TargetKind>,
) -> Result<(), String> {
    let target = match (id, kind) {
        (Some(id), Some(kind)) => Some(
            capture::resolve_target(id, kind)
                .ok_or_else(|| format!("no capture target with id {id}"))?,
        ),
        _ => None,
    };
    recorder::set_selected_target(&state, target);
    Ok(())
}

/// Selects a sub-rectangle of `display_id` to record (the region/"Area"
/// picker) — `x`/`y`/`width`/`height` are in the same global point space
/// `list_capture_targets`'s displays and `cursor.json` both use. Sets the
/// display as the active target too, so callers don't need a separate
/// `select_capture_target` round-trip first.
#[tauri::command]
pub fn select_capture_area(
    state: State<'_, RecorderState>,
    display_id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let target = capture::resolve_target(display_id, TargetKind::Display)
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
    Ok(())
}
