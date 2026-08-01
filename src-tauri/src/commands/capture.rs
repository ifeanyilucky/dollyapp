use tauri::State;

use crate::capture::{self, TargetInfo, TargetKind};
use crate::recorder::{self, RecorderState};

#[tauri::command]
pub fn list_capture_targets() -> Vec<TargetInfo> {
    capture::list_targets()
}

/// `None` clears the selection (falls back to the main display on the
/// next `start_recording`).
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
