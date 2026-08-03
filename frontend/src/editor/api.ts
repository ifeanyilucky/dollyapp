import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { CursorTrack, RecordingMeta } from "../bundle/types";

export interface LoadedRecording {
  meta: RecordingMeta;
  cursorTrack: CursorTrack;
  /** Absolute path to the bundle the recording lives in — a single
   * `Recording N.dol` file for new recordings, a `*.motionrec` directory for
   * legacy ones. Used for the editor title, the export-save default, and
   * reveal-in-Finder. */
  bundlePath: string;
  /** Playable source for the screen capture: a `dol://` URL served by the
   * custom protocol for `.dol` bundles, or the absolute `screen.mov` path for
   * legacy directories. Pass through `mediaSrc` before using. */
  screenVideoUrl: string;
  /** Counterpart to `screenVideoUrl` for the mic track — `null` when
   * `meta.hasMicAudio` is false. */
  micAudioUrl: string | null;
}

/** Turns a `LoadedRecording` media field into something a `<video>`/`<audio>`
 * or `fetch()` accepts: `dol://` URLs (packed `.dol` bundles) are used as-is;
 * absolute paths (legacy `.motionrec` directories) go through `convertFileSrc`
 * to become `asset:` URLs. */
export function mediaSrc(url: string | null): string {
  if (!url) return "";
  return url.startsWith("dol://") ? url : convertFileSrc(url);
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

export interface RecentProject {
  path: string;
  name: string;
}

/** Recent recordings for the "Show previous projects" submenu in `TopBar`'s
 * folder-icon dropdown — same `~/Movies/Dolly`, most-recent-first list the
 * tray menu's own "Show previous projects" submenu uses. */
export function listRecentProjects(limit: number): Promise<RecentProject[]> {
  return invoke("list_recent_projects", { limit });
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
