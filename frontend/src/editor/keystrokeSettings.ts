/** Anchor for the keystrokes chip stack, relative to the content rect. */
export type KeystrokePosition =
  | "bottom-center"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "top-left"
  | "top-right";

/**
 * The Shortcuts panel (keystrokes overlay) — renders recent recorded key
 * presses (see `keycodeMap.ts` and `bundle/types.ts`'s `CursorEvent`) as
 * modifier+key chips anchored to the video, in both the live preview and
 * export (the renderer's `draw` is the single code path for both).
 *
 * `enabled: false` by default: a recording that never captured keystrokes
 * has nothing to show, and the overlay shouldn't appear uninvited.
 */
export interface KeystrokeSettings {
  enabled: boolean;
  position: KeystrokePosition;
  /** 0-100, mapped to a 0.5x-2x chip scale (same scheme as cursor size). */
  size: number;
  /** How many distinct recent combos to show at once (1-5). */
  maxKeys: number;
  /** How long a key press stays visible after it happens, in seconds. */
  durationS: number;
}

export const DEFAULT_KEYSTROKE_SETTINGS: KeystrokeSettings = {
  enabled: false,
  position: "bottom-center",
  size: 50,
  maxKeys: 3,
  durationS: 2,
};

export const KEYSTROKE_POSITION_LABELS: Record<KeystrokePosition, string> = {
  "bottom-center": "Bottom center",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  "top-center": "Top center",
  "top-left": "Top left",
  "top-right": "Top right",
};

export function keystrokeSizeMultiplier(size: number): number {
  return 0.5 + (size / 100) * 1.5;
}
