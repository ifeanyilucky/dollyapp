/**
 * Clip slices — "Cut & Speed up" (PRD §9), rebuilt around a non-destructive
 * split model instead of drag-selected regions: slices always tile
 * `[clipStartS, clipEndS)` contiguously with no gaps, and the scissors
 * tool only ever inserts a boundary (splits one slice into two, both
 * inheriting the original's speed/cursor override) — it never removes
 * anything. Removing content is a separate, deliberate action from the
 * slice editor panel (`removed: true`, skipped during playback the same
 * way the old cut regions were — preview-only, there's no export pipeline
 * to ripple-delete from yet).
 */

export interface SliceCursorOverride {
  hideCursor: boolean;
  disableSmoothMovement: boolean;
}

export interface ClipSlice {
  id: string;
  startS: number;
  endS: number;
  speed: number;
  removed: boolean;
  /** `null` inherits the editor's global cursor settings for this range. */
  cursorOverride: SliceCursorOverride | null;
}

export const SLICE_SPEED_PRESETS = [1, 1.2, 1.4, 1.6, 1.8, 2];
const MIN_SLICE_SECONDS = 0.1;

export function createSlice(startS: number, endS: number): ClipSlice {
  return {
    id: crypto.randomUUID(),
    startS,
    endS,
    speed: 1,
    removed: false,
    cursorOverride: null,
  };
}

/** One slice spanning the whole clip — the starting state before any
 * splits, and what a clip collapses back to if all-but-one split is
 * ever undone (not currently exposed, but keeps the invariant "slices
 * always cover the full clip with no gaps" trivially true either way). */
export function initialSlices(clipStartS: number, clipEndS: number): ClipSlice[] {
  return [createSlice(clipStartS, clipEndS)];
}

/** Re-tiles `slices` to exactly cover `[clipStartS, clipEndS)` — called
 * whenever the outer clip trim changes, so a trim never leaves a gap or
 * an out-of-range sliver. Interior boundaries are preserved; only the
 * first/last slice's outer edge moves. */
export function resizeSlices(slices: ClipSlice[], clipStartS: number, clipEndS: number): ClipSlice[] {
  if (slices.length === 0) return initialSlices(clipStartS, clipEndS);
  const sorted = [...slices].sort((a, b) => a.startS - b.startS);
  sorted[0] = { ...sorted[0], startS: clipStartS };
  sorted[sorted.length - 1] = { ...sorted[sorted.length - 1], endS: clipEndS };
  const resized = sorted.filter((s) => s.endS - s.startS >= MIN_SLICE_SECONDS);
  if (resized.length === 0) return initialSlices(clipStartS, clipEndS);
  // The filter above can drop an edge sliver (e.g. a trim moved the clip's
  // start past the second slice's start), which would leave a gap and
  // break the "slices always tile the clip" invariant — re-anchor the
  // surviving first/last slice to the clip's exact edges so coverage stays
  // contiguous. Re-anchoring only ever lengthens a slice, so it can't
  // re-introduce a sub-minimum sliver.
  if (resized[0].startS !== clipStartS) resized[0] = { ...resized[0], startS: clipStartS };
  if (resized[resized.length - 1].endS !== clipEndS) {
    resized[resized.length - 1] = { ...resized[resized.length - 1], endS: clipEndS };
  }
  return resized;
}

/** Splits whichever slice contains `atS` into two, both keeping the
 * original's speed/removed/cursorOverride. A no-op if `atS` doesn't fall
 * strictly inside a slice (outside the clip, or too close to an existing
 * boundary to produce two meaningfully-sized pieces). */
export function splitSliceAt(slices: ClipSlice[], atS: number): ClipSlice[] {
  const index = slices.findIndex((s) => atS > s.startS + MIN_SLICE_SECONDS && atS < s.endS - MIN_SLICE_SECONDS);
  if (index === -1) return slices;
  const original = slices[index];
  const first: ClipSlice = { ...original, id: crypto.randomUUID(), endS: atS };
  const second: ClipSlice = { ...original, id: crypto.randomUUID(), startS: atS };
  return [...slices.slice(0, index), first, second, ...slices.slice(index + 1)];
}

export function sliceAt(slices: ClipSlice[], t: number): ClipSlice | undefined {
  return slices.find((s) => t >= s.startS && t < s.endS);
}
