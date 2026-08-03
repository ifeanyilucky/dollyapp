/**
 * Timeline masks — independent, full-frame time ranges that cover the
 * *entire* content rect for as long as they're active: a "sensitive data"
 * mask (always fully opaque — nothing partially shows through, since the
 * whole point is that nothing sensitive leaks into the recording) or a
 * "highlight" mask (a tinted, adjustable-opacity wash, e.g. to draw
 * attention to that part of the recording). There's deliberately no
 * spatial sub-region here (no x/y/width/height the way `crop.ts` has) —
 * a mask covers the whole frame for its time range; "make sure the mask
 * covers the entire part of the *timeline*" (the sensitive-type warning
 * shown in `MaskEditorPanel`) is about sizing its time range generously
 * enough, not positioning a box.
 *
 * Unlike `ClipSlice`s, masks don't tile/partition the clip — they're
 * independent, possibly-overlapping, user-added ranges, structurally much
 * closer to `ZoomKeyframe`s than to slices (see `Timeline.tsx`'s mask
 * track, which reuses the same move/trim-handle drag pattern zoom
 * keyframes already established).
 */

export type MaskType = "sensitive" | "highlight";

export interface MaskClip {
  id: string;
  startS: number;
  endS: number;
  type: MaskType;
  /** Highlight-only — a sensitive mask is always fully opaque (see the
   * module doc comment), so this is ignored by the renderer and hidden
   * from the editor panel for that type. 0..1. */
  opacity: number;
  /** Kept on the timeline but skipped by the renderer/exporter when true —
   * see `masksActiveAt`. Lets a mask be temporarily turned off without
   * losing its placement/settings. */
  disabled: boolean;
}

/** A freshly-added mask's default duration, before any trim. */
export const DEFAULT_MASK_DURATION_S = 2;
export const DEFAULT_MASK_OPACITY = 0.5;
/** Smallest a mask may shrink to while trimming — mirrors
 * `slices.ts`/`Timeline.tsx`'s own minimums for the same reason: small
 * enough to be a real, deliberate range, large enough that a stray drag
 * can't produce a degenerate zero-length mask. */
export const MIN_MASK_SECONDS = 0.2;

export function createMask(startS: number, endS: number, type: MaskType): MaskClip {
  return {
    id: crypto.randomUUID(),
    startS,
    endS,
    type,
    opacity: DEFAULT_MASK_OPACITY,
    disabled: false,
  };
}

/** Where a brand-new mask should land — starting at `atS` (typically the
 * current playhead), `DEFAULT_MASK_DURATION_S` long, clamped inside
 * `[clipStartS, clipEndS)` so it's never added off the trimmed clip or
 * longer than the clip itself. */
export function defaultMaskRange(
  atS: number,
  clipStartS: number,
  clipEndS: number,
): { startS: number; endS: number } {
  const available = Math.max(clipEndS - clipStartS, MIN_MASK_SECONDS);
  const duration = Math.min(DEFAULT_MASK_DURATION_S, available);
  const startS = Math.min(Math.max(atS, clipStartS), clipEndS - duration);
  return { startS, endS: startS + duration };
}

/** Every mask in effect at `t` (video-relative seconds) — filters out
 * `disabled` ones (present on the timeline, but not applied to playback/
 * export) and anything outside its own `[startS, endS)` range. Unlike
 * `sliceAt`, returns *every* match rather than a single active one: masks
 * are independent, possibly-overlapping ranges, not a gapless partition. */
export function masksActiveAt(masks: MaskClip[], t: number): MaskClip[] {
  return masks.filter((m) => !m.disabled && t >= m.startS && t < m.endS);
}
