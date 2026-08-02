/**
 * Cursor customization — PRD §9's cursor panel (size, style, and the
 * behavior toggles below it). `hideCursor` deliberately isn't duplicated
 * here: the editor already has a single `showCursor` boolean (driven by
 * both this panel's "Hide cursor" toggle and the top bar's eye icon), and
 * this settings object doesn't need its own copy of the same thing.
 */

export type CursorStyleId = "outline" | "thin" | "dot" | "solidBlack" | "solidGray";

export interface CursorStylePreset {
  id: CursorStyleId;
  label: string;
}

export const CURSOR_STYLE_PRESETS: CursorStylePreset[] = [
  { id: "outline", label: "Outline" },
  { id: "thin", label: "Thin outline" },
  { id: "dot", label: "Dot" },
  { id: "solidBlack", label: "Solid black" },
  { id: "solidGray", label: "Solid gray" },
];

export interface CursorSettings {
  /** 0-100, mapped to a 0.5x-2x draw-size multiplier — see
   * `renderer.ts`'s `cursorSizeMultiplier`. */
  size: number;
  style: CursorStyleId;
  /** When true, always draw the arrow/pointer glyph regardless of the
   * recorded `CursorType` (text-select I-beam, resize handles, ...). */
  alwaysPointerCursor: boolean;
  hideCursorIfNotMoving: boolean;
  /** Near the end of the clip, blend the cursor back toward its position
   * at the very start — a loop-friendly export doesn't end with the
   * pointer stranded wherever the recording happened to stop. */
  loopCursorPosition: boolean;
  clickEffectEnabled: boolean;
  clickSoundEnabled: boolean;
  /** Degrees, clockwise. */
  rotationDeg: number;
}

export const DEFAULT_CURSOR_SETTINGS: CursorSettings = {
  size: 50,
  style: "outline",
  alwaysPointerCursor: false,
  hideCursorIfNotMoving: false,
  loopCursorPosition: false,
  clickEffectEnabled: true,
  clickSoundEnabled: false,
  rotationDeg: 0,
};

/** Maps the 0-100 UI slider to an actual draw-size multiplier. */
export function cursorSizeMultiplier(size: number): number {
  return 0.5 + (size / 100) * 1.5;
}
