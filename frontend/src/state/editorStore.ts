import { create } from "zustand";
import type { CursorTrack, RecordingMeta } from "../bundle/types";
import { generateZoomKeyframes, type ZoomKeyframe } from "../motion-engine";

/**
 * Editor state. Zustand, not Redux or Context — Context re-renders the
 * whole timeline on every playhead tick, and Redux's ceremony buys nothing
 * here. See ARCHITECTURE.md.
 */
export interface EditorState {
  bundlePath: string | null;
  meta: RecordingMeta | null;
  cursorTrack: CursorTrack | null;
  zoomKeyframes: ZoomKeyframe[];
  /** Microseconds since the recording's clock epoch. */
  playheadUs: number;
  isPlaying: boolean;
  /** Drives the "less zoomy" slider (PRD §9); regenerating replaces
   * `zoomKeyframes` wholesale rather than trying to preserve manual edits
   * across a regeneration — those are two different user intents. */
  zoomSensitivity: number;

  loadRecording: (path: string, meta: RecordingMeta, cursorTrack: CursorTrack) => void;
  regenerateMotion: (sensitivity?: number) => void;
  setZoomKeyframes: (keyframes: ZoomKeyframe[]) => void;
  seek: (playheadUs: number) => void;
  setPlaying: (isPlaying: boolean) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  bundlePath: null,
  meta: null,
  cursorTrack: null,
  zoomKeyframes: [],
  playheadUs: 0,
  isPlaying: false,
  zoomSensitivity: 1,

  loadRecording: (path, meta, cursorTrack) => {
    set({
      bundlePath: path,
      meta,
      cursorTrack,
      zoomKeyframes: generateZoomKeyframes(cursorTrack, { factor: 1 }),
      playheadUs: 0,
      isPlaying: false,
      zoomSensitivity: 1,
    });
  },

  regenerateMotion: (sensitivity) => {
    const { cursorTrack } = get();
    if (!cursorTrack) return;
    const factor = sensitivity ?? get().zoomSensitivity;
    set({
      zoomKeyframes: generateZoomKeyframes(cursorTrack, { factor }),
      zoomSensitivity: factor,
    });
  },

  setZoomKeyframes: (keyframes) => set({ zoomKeyframes: keyframes }),
  seek: (playheadUs) => set({ playheadUs }),
  setPlaying: (isPlaying) => set({ isPlaying }),
}));
