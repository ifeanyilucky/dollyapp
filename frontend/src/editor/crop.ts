/**
 * A rectangular sub-region, in the *full composed frame*'s own pixel space
 * (the same canvas `SceneRenderer.draw()` already renders onto today —
 * background, content, cursor overlay, everything) — not source-video
 * pixels, and not touching the zoom/pan viewport at all. Cropping selects
 * what to keep of the *finished* frame, the same way an image editor's
 * crop tool works on a flattened image; see `EditorView`'s dual-canvas
 * render path (`renderer.draw()` is completely unchanged, still composing
 * the full frame — the crop is a second, separate step that blits a
 * sub-rect of that onto the actually-displayed/exported canvas).
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The "no crop" rect — the entire frame, origin at the top-left. Used as
 * the starting draft when entering crop mode with no crop confirmed yet. */
export function fullFrameCrop(frameWidth: number, frameHeight: number): CropRect {
  return { x: 0, y: 0, width: frameWidth, height: frameHeight };
}

/** Smallest a crop rect's width/height may shrink to — small enough to be
 * a real, deliberate crop, large enough that "1x1 pixel video" can't
 * happen from a stray drag. */
export const MIN_CROP_SIZE = 20;

/** Keeps `rect` fully inside `[0, frameWidth] x [0, frameHeight]` and no
 * smaller than `MIN_CROP_SIZE` in either dimension — the single place
 * drag handles, numeric inputs, and keyboard nudging all funnel through,
 * so none of them can independently produce an out-of-bounds or
 * degenerate crop. */
export function clampCropRect(rect: CropRect, frameWidth: number, frameHeight: number): CropRect {
  const width = Math.min(Math.max(rect.width, MIN_CROP_SIZE), frameWidth);
  const height = Math.min(Math.max(rect.height, MIN_CROP_SIZE), frameHeight);
  const x = Math.min(Math.max(rect.x, 0), frameWidth - width);
  const y = Math.min(Math.max(rect.y, 0), frameHeight - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Whether `crop` is effectively "no crop" for `frameWidth`/`frameHeight`
 * — lets callers skip the dual-canvas blit path entirely rather than
 * doing a full-frame-sized no-op crop every frame. */
export function isFullFrameCrop(crop: CropRect, frameWidth: number, frameHeight: number): boolean {
  return crop.x === 0 && crop.y === 0 && crop.width === frameWidth && crop.height === frameHeight;
}

/** Largest same-`aspect` rect centered within the full frame — backs
 * `CropEditor`'s "Select..." preset dropdown (reuses `ASPECT_RATIO_PRESETS`
 * rather than inventing a second, parallel preset list). `aspect === null`
 * ("Original") is the full frame itself. */
export function centeredCropForAspect(frameWidth: number, frameHeight: number, aspect: number | null): CropRect {
  if (aspect === null) return fullFrameCrop(frameWidth, frameHeight);
  let width = frameWidth;
  let height = width / aspect;
  if (height > frameHeight) {
    height = frameHeight;
    width = height * aspect;
  }
  return clampCropRect(
    { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height },
    frameWidth,
    frameHeight,
  );
}
