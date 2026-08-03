/**
 * A rectangular sub-region of the *recorded* frame — point space, the same
 * units as `RecordingMeta.display` scale-factor-adjusted (i.e. the `frame`
 * `SceneRenderer`'s constructor takes), *not* the composited canvas's own
 * pixel space and *not* touching background/padding/style at all. "Show
 * only the recorded area" is the whole point: cropping redefines what the
 * rest of the app (zoom/pan bounds, cursor positions, the aspect
 * `contentRect` falls back to) treats as "the entire recording", the same
 * way a window/area capture's own `origin` already does — see
 * `SceneRendererOptions.crop`'s doc comment for exactly how the two
 * compose. Background/padding/shadow styling still applies *around* the
 * cropped content afterward, same as it always did — crop only narrows
 * what's actually recorded-content, not the output frame's own shape
 * (that's still `aspectRatioId`/`resolution`, unaffected by this).
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The "no crop" rect — the entire recording, origin at the top-left. Used
 * as the starting draft when entering crop mode with no crop confirmed
 * yet. */
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
 * — `EditorView`'s `confirmCrop` uses this to store `null` (rather than a
 * redundant full-frame rect) in `doc.crop` whenever the confirmed draft
 * doesn't actually narrow anything down, keeping "is this recording
 * cropped at all" a simple null check everywhere else. */
export function isFullFrameCrop(crop: CropRect, frameWidth: number, frameHeight: number): boolean {
  return crop.x === 0 && crop.y === 0 && crop.width === frameWidth && crop.height === frameHeight;
}

/** Largest same-`aspect` rect centered within the recording — backs
 * `CropEditor`'s "Select..." preset dropdown (reuses `ASPECT_RATIO_PRESETS`
 * rather than inventing a second, parallel preset list). `aspect === null`
 * ("Original") is the whole recording, uncropped. */
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
