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
