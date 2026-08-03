import { clampCropRect, type CropRect } from "./crop";

/**
 * Timeline masks — a rectangular sub-region of the frame (`rect`, same
 * point-space `crop.ts` uses — see `MaskClip.rect`'s doc comment), active
 * over a time range, drawn one of two ways:
 *
 *  - "sensitive data": the box itself is blurred — everything *outside* it
 *    plays back completely normally. Always fully blurred (no adjustable
 *    strength): the whole point is that nothing underneath is readable, so
 *    there's no "partially visible" setting to offer.
 *  - "highlight": the *inverse* — the box itself always stays perfectly
 *    normal/visible, and everything *outside* it dims to draw the eye
 *    toward it, like a spotlight. `opacity` controls how dark that
 *    *outside* area gets; it has no effect on the box's own content, which
 *    is the entire point of a highlight (see `MaskClip.opacity`'s doc
 *    comment).
 *
 * Unlike `ClipSlice`s, masks don't tile/partition the clip — they're
 * independent, possibly-overlapping, user-added ranges, structurally much
 * closer to `ZoomKeyframe`s than to slices (see `Timeline.tsx`'s mask
 * track, which reuses the same move/trim-handle drag pattern zoom
 * keyframes already established for the *time* axis; `rect`'s on-canvas
 * editing, in `MaskEditor.tsx`, similarly reuses `CropEditor.tsx`'s 8-handle
 * drag interaction for the *spatial* axis).
 */

export type MaskType = "sensitive" | "highlight";

export interface MaskClip {
  id: string;
  startS: number;
  endS: number;
  type: MaskType;
  /** The masked region — same coordinate space as `CropRect` (point space,
   * scale-factor-adjusted), but relative to the *effective* frame (the
   * confirmed crop's own size once one exists, the full recording
   * otherwise — see `renderer.ts`'s `SceneRendererOptions.crop`), since
   * that's what the mask is actually drawn against: the renderer projects
   * `rect` through whatever the *current* zoom/pan viewport is the exact
   * same way it already projects the cursor's on-screen position, so the
   * masked region correctly tracks a zoom/pan instead of staying pinned to
   * a fixed spot on the canvas while the content underneath moves. */
  rect: CropRect;
  /** Highlight-only — ignored by the renderer and hidden from
   * `MaskEditorPanel` for a "sensitive" mask (see the module doc comment).
   * How dark *everything outside `rect`* gets, 0 (no dimming) to 1 (fully
   * black) — never affects `rect`'s own content. */
  opacity: number;
  /** Kept on the timeline but skipped by the renderer/exporter when true —
   * see `masksActiveAt`. Lets a mask be temporarily turned off without
   * losing its placement/settings. */
  disabled: boolean;
}

/** A freshly-added mask's default duration, before any trim. */
export const DEFAULT_MASK_DURATION_S = 2;
export const DEFAULT_MASK_OPACITY = 0.6;
/** Smallest a mask's time range may shrink to while trimming — mirrors
 * `slices.ts`/`Timeline.tsx`'s own minimums for the same reason: small
 * enough to be a real, deliberate range, large enough that a stray drag
 * can't produce a degenerate zero-length mask. */
export const MIN_MASK_SECONDS = 0.2;
/** What fraction of the (effective) frame's smaller dimension a freshly-
 * added mask's box defaults to, centered — see `defaultMaskRect`. */
const DEFAULT_MASK_RECT_FRACTION = 0.35;

export function createMask(startS: number, endS: number, type: MaskType, rect: CropRect): MaskClip {
  return {
    id: crypto.randomUUID(),
    startS,
    endS,
    type,
    rect,
    opacity: DEFAULT_MASK_OPACITY,
    disabled: false,
  };
}

/** Where a brand-new mask's *time range* should land — starting at `atS`
 * (typically the current playhead), `DEFAULT_MASK_DURATION_S` long,
 * clamped inside `[clipStartS, clipEndS)` so it's never added off the
 * trimmed clip or longer than the clip itself. */
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

/** Where a brand-new mask's *box* should land — a centered square-ish
 * region sized off the frame's smaller dimension (so it's a sensible size
 * regardless of aspect ratio), clamped the same way `CropOverlay`'s own
 * drag handles are (`clampCropRect`, reused as-is rather than a parallel
 * copy of the same bounds-checking). */
export function defaultMaskRect(frameWidth: number, frameHeight: number): CropRect {
  const size = Math.min(frameWidth, frameHeight) * DEFAULT_MASK_RECT_FRACTION;
  return clampCropRect(
    { x: (frameWidth - size) / 2, y: (frameHeight - size) / 2, width: size, height: size },
    frameWidth,
    frameHeight,
  );
}

/** Every mask in effect at `t` (video-relative seconds) — filters out
 * `disabled` ones (present on the timeline, but not applied to playback/
 * export) and anything outside its own `[startS, endS)` range. Unlike
 * `sliceAt`, returns *every* match rather than a single active one: masks
 * are independent, possibly-overlapping ranges, not a gapless partition. */
export function masksActiveAt(masks: MaskClip[], t: number): MaskClip[] {
  return masks.filter((m) => !m.disabled && t >= m.startS && t < m.endS);
}
