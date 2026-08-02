import type { ZoomKeyframe } from "../motion-engine";
import type { AspectRatioId } from "./aspect";
import { DEFAULT_CURSOR_SETTINGS, type CursorSettings } from "./cursorSettings";
import type { ClipSlice } from "./slices";
import { DEFAULT_STYLE, type StyleSettings } from "./style";

/**
 * Every user-editable setting that (a) undoes/redoes as one linear timeline
 * (see `history.ts`) and (b) is what `exportVideo` bakes into the rendered
 * output. Playback-only state (current time, playback rate, which panel is
 * open, current selection, ...) is deliberately not part of this — none of
 * it survives into the export, and undoing it wouldn't mean anything.
 */
export interface EditorDocument {
  style: StyleSettings;
  showCursor: boolean;
  aspectRatioId: AspectRatioId;
  zoomKeyframes: ZoomKeyframe[];
  /** Effective in/out of the whole clip (video-relative seconds) — both 0
   * until the video's metadata loads (see `EditorView`'s `patch` call on
   * `onLoadedMetadata`). */
  clipStartS: number;
  clipEndS: number;
  slices: ClipSlice[];
  cursorSettings: CursorSettings;
}

export const DEFAULT_DOCUMENT: EditorDocument = {
  style: DEFAULT_STYLE,
  showCursor: true,
  aspectRatioId: "original",
  zoomKeyframes: [],
  clipStartS: 0,
  clipEndS: 0,
  slices: [],
  cursorSettings: DEFAULT_CURSOR_SETTINGS,
};
