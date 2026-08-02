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
