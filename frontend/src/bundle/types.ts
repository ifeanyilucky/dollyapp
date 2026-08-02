/**
 * `.motionrec` bundle types — the TypeScript side of the schema defined in
 * `src-tauri/src/bundle/`. A `meta.json` or `cursor.json` written by the
 * Rust core must parse into these without translation; keep both sides in
 * sync by hand when either changes (see ARCHITECTURE.md).
 */

export interface DisplayInfo {
  widthPx: number;
  heightPx: number;
  /** Retina scale factor. Cursor coordinates are in point space, not pixel
   * space — multiply by this to map onto screen.mov pixels. */
  scaleFactor: number;
}

export interface RecordingMeta {
  version: number;
  /** mach_absolute_time-derived epoch, in microseconds. Every cursor.json
   * timestamp is relative to this — see ARCHITECTURE.md "Recording format". */
  clockEpoch: number;
  /** `t` (relative to clockEpoch) of the first frame written to
   * screen.mov. An HTML `<video>` element's `currentTime` is relative to
   * *that* frame, not clockEpoch, so map it onto cursor.json timestamps
   * with `t = currentTime * 1_000_000 + videoStartUs`. */
  videoStartUs: number;
  display: DisplayInfo;
  durationUs: number;
  hasWebcam: boolean;
  hasSystemAudio: boolean;
  hasMicAudio: boolean;
  fps: number;
}

export type CursorType =
  | "arrow"
  | "iBeam"
  | "pointingHand"
  | "resizeLeftRight"
  | "resizeUpDown"
  | "closedHand"
  | "other";

export interface CursorSample {
  /** Microseconds since clockEpoch. */
  t: number;
  x: number;
  y: number;
  type: CursorType;
}

export type CursorEvent =
  | { kind: "leftDown"; t: number; x: number; y: number }
  | { kind: "leftUp"; t: number; x: number; y: number }
  | { kind: "rightDown"; t: number; x: number; y: number }
  | { kind: "rightUp"; t: number; x: number; y: number }
  /** Key code only — never resolved text. See ARCHITECTURE.md. */
  | { kind: "key"; t: number; code: number; modifiers: string[] }
  | { kind: "scroll"; t: number; dy: number }
  | { kind: "gap"; t: number; resumedAt: number | null };

export interface CursorTrack {
  version: number;
  clockEpoch: number;
  sampleRate: number;
  samples: CursorSample[];
  events: CursorEvent[];
}

export const CURSOR_TRACK_SAMPLE_RATE_HZ = 120;
