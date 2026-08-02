import { invoke } from "@tauri-apps/api/core";
import type { CursorTrack, RecordingMeta } from "../bundle/types";

export interface LoadedRecording {
  meta: RecordingMeta;
  cursorTrack: CursorTrack;
  /** Absolute filesystem path — turn into a playable URL with
   * `convertFileSrc` (see `videoSrc` below), not used directly as `<video
   * src>`. */
  screenVideoPath: string;
}

export function loadRecording(bundlePath: string): Promise<LoadedRecording> {
  return invoke("load_recording", { bundlePath });
}

export function revealInFinder(bundlePath: string): Promise<void> {
  return invoke("reveal_in_finder", { bundlePath });
}

export function deleteRecording(bundlePath: string): Promise<void> {
  return invoke("delete_recording", { bundlePath });
}

/** Records where the rendered export file should be written — paired with
 * `writeExportFile`, since the bytes themselves travel as a raw invoke body
 * (no room for a second path argument there). */
export function setExportDestination(path: string): Promise<void> {
  return invoke("export_set_destination", { path });
}

/** Writes the raw export bytes to the path previously set with
 * `setExportDestination`. Pass a `Uint8Array` so Tauri sends them as a raw
 * (non-JSON) body — JSON-serializing tens of MB of video bytes would both
 * slow this down and balloon memory. */
export function writeExportFile(bytes: Uint8Array): Promise<void> {
  return invoke("export_write", bytes);
}
