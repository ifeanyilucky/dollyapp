import { invoke } from "@tauri-apps/api/core";

/** Mirrors `src-tauri/src/capture::{TargetInfo, TargetKind}`. */
export type TargetKind = "display" | "window";

export interface TargetInfo {
  id: number;
  kind: TargetKind;
  title: string;
}

export function listCaptureTargets(): Promise<TargetInfo[]> {
  return invoke("list_capture_targets");
}

/** Pass `null` to clear the selection (falls back to the main display). */
export function selectCaptureTarget(target: TargetInfo | null): Promise<void> {
  return invoke("select_capture_target", {
    id: target?.id ?? null,
    kind: target?.kind ?? null,
  });
}

/** A user-picked sub-rectangle of a display — global point space, same as
 * `cursor.json` (see `RecordingMeta.display.originX/originY`). */
export interface CropArea {
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Payload of the `area-selected` event, emitted once the area-selector
 * overlay window (see `openAreaSelector`) confirms a selection — see
 * `src-tauri/src/commands/area_selector.rs`. */
export const AREA_SELECTED_EVENT = "area-selected";

/** Opens the full-screen drag-to-select overlay window for the "Area"
 * picker. Resolves once the window is open — the actual selection arrives
 * later, asynchronously, as an `AREA_SELECTED_EVENT`. */
export function openAreaSelector(): Promise<void> {
  return invoke("open_area_selector");
}

/** Called from *within* the area-selector overlay window only. */
export function confirmAreaSelection(area: CropArea): Promise<void> {
  return invoke("confirm_area_selection", {
    displayId: area.displayId,
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
  });
}

/** Called from *within* the area-selector overlay window only. */
export function cancelAreaSelection(): Promise<void> {
  return invoke("cancel_area_selection");
}
