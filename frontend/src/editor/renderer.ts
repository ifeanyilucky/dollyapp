import type { CursorEvent, CursorSample, CursorTrack, CursorType } from "../bundle/types";
import {
  CURSOR_ANIMATION_PRESETS,
  MotionEngine,
  smoothCursorTrack,
  type CursorAnimationStyle,
  type FrameSize,
  type ScreenAnimationStyle,
  type ZoomKeyframe,
} from "../motion-engine";
import { DEFAULT_ANIMATION_SETTINGS, type AnimationSettings } from "./animationSettings";
import {
  CURSOR_GLYPH_BOUNDS,
  cursorGlyphFor,
  cursorSizeMultiplier,
  cursorStylePreset,
  drawCursorShape,
  DEFAULT_CURSOR_SETTINGS,
  type CursorGlyphId,
  type CursorPaint,
  type CursorSettings,
} from "./cursorSettings";
import type { CropRect } from "./crop";
import type { MaskClip } from "./masks";
import type { SliceCursorOverride } from "./slices";
import { DEFAULT_STYLE, type StyleSettings } from "./style";
import { GRADIENT_PRESETS, paintCanvasGradient, WALLPAPER_IMAGES } from "./wallpapers";

const CLICK_PULSE_DURATION_US = 220_000;
const CLICK_RIPPLE_DURATION_US = 500_000;
/** Fixed apparent size, independent of zoom level — the whole point of
 * redrawing the cursor rather than relying on captured pixels
 * (ARCHITECTURE.md, "Cursor rendering"). Big and readable, per the intent
 * of a screen-recording tool whose entire pitch is legibility. This is
 * the *base* size before `CursorSettings.size`'s multiplier is applied. */
const CURSOR_SIZE_PX = 92;

// Motion blur — the content (during a zoom/pan transition) gets a
// *directional* trailing-echo blur proportional to how fast the viewport is
// actually moving on screen right now, fading to nothing once it settles.
// This is deliberately not `ctx.filter = blur(...)` for the content: a
// uniform Gaussian filter blurs equally in every direction, which isn't
// what motion blur actually looks like (a smeared *streak* behind the
// direction of travel) — and Canvas2D `filter` combined with a clipped
// draw (the content draw is clipped to the rounded content rect) is
// exactly the kind of thing that quietly no-ops on some WebKit builds.
// Instead, each `draw()` compares this frame's viewport to the *previous*
// call's (`lastViewport`), and — when it's moved enough — draws several
// semi-transparent "echoes" interpolated between the two positions before
// the real, fully-opaque current-frame draw on top. That's the same
// technique a photographed zoom-burst/light-trail effect actually is:
// multiple exposures of the same subject at different positions, blended —
// and it reads correctly for a full video frame, since the overlapping
// copies share almost all their pixels.
//
// The cursor glyph is a different case: it's a small, single, recognizable
// icon shape (arrow/dot with a hard-edged fill+stroke), not a continuous
// image, so the same "draw it several times at partial opacity" technique
// just reads as several distinct ghost cursors rather than a blur. So the
// cursor gets a real *Gaussian* blur in software instead (`drawBlurredCursorGlyph`):
// the glyph is rendered into a small scratch canvas and passed through
// `boxBlurGaussian` (three box passes ≈ a Gaussian). Not `ctx.filter =
// blur(...)` — verified on this WKWebView that a canvas filter is a silent
// no-op on *every* draw path, including the glyph's primitive fill/stroke
// (a blurred composite is pixel-identical to an unblurred one), which is
// why the cursor only ever visibly *faded* before rather than smearing. The
// cursor also stays fully opaque: a fast move (whether from real mouse
// movement or from the viewport sweeping it across the frame during a
// zoom/pan transition) smears it into a blur, it doesn't fade it out.
// Velocity is normalized by real elapsed wall-clock time (not video time),
// so intensity naturally scales with playback rate too — 2x playback
// looks proportionally blurrier, which is the physically-correct
// direction. Tuned by eye, not derived from anything physical — adjust the
// constants below if the effect ever reads as too subtle or too smeary.
const MAX_TRAIL_STEPS = 10;
const CONTENT_TRAIL_SENSITIVITY = 900;
/** How opaque the *closest-to-current* echo gets at full intensity —
 * scaled down for earlier echoes so the trail actually fades out toward
 * its tail instead of every echo being equally solid. Kept low, with the
 * higher `MAX_TRAIL_STEPS`, so the echoes blend into a continuous smear
 * (a motion-blur streak) rather than a few distinct ghost copies. */
const MAX_TRAIL_ALPHA = 0.35;
/** Largest Gaussian blur radius (canvas px) applied to a fast-moving
 * cursor glyph. Applied in software (`boxBlurGaussian`) — a real
 * `ctx.filter = blur(...)` is a silent no-op in this WKWebView even on
 * the glyph's primitive fill/stroke draws (verified pixel-identical), so
 * relying on it is exactly why the blur never showed up before. */
const MAX_CURSOR_BLUR_PX = 18;
const CURSOR_BLUR_SENSITIVITY = 5.5;
/** `CursorSettings.loopCursorPosition`'s blend window, capped to 30% of
 * the clip for anything shorter than this. */
const LOOP_BLEND_DURATION_US = 1_200_000;
/** `CursorSettings.hideCursorIfNotMoving`'s lookback window and movement
 * threshold — small enough to catch a real pause quickly, large enough
 * not to flicker during a slow, deliberate drag. */
const IDLE_WINDOW_US = 500_000;
const IDLE_THRESHOLD_PX = 3;
/** A "sensitive" mask's blur strength — how much smaller than its own
 * on-screen size the intermediate scratch canvas `drawBlurredRegion`
 * downscales to before stretching back up. Deliberately *not*
 * `ctx.filter = blur(...)`: WebKit ignores a canvas filter on `drawImage`
 * calls entirely — whether the source is a live `<video>`, an `<img>`, or
 * another canvas (verified on this app's WKWebView: a blurred `drawImage`
 * composite is pixel-identical to an unblurred one; filters only land on
 * primitive draws like `fill`/`stroke`, which is why the cursor glyph's
 * blur still works). That silent no-op is exactly what made this render as
 * an unblurred, fully-legible box instead of a redacted one — and it's the
 * same reason the background blur broke (see `getBackgroundLayer`).
 * Downscale-then-upscale only relies on ordinary `drawImage` scaling
 * (universally supported, video source or not) — smaller than this
 * fraction of the box's own size = blurrier (and less legible) the result;
 * tuned low enough that text becomes illegible, not just softened. */
const MASK_BLUR_DOWNSCALE_FRACTION = 0.06;
/** A mask's own corner radius (fraction of its smaller on-screen
 * dimension) while it's just sitting there being played back normally —
 * *not* while it's the one currently being actively edited, where it
 * renders perfectly square instead, matching `MaskOverlay`'s square
 * corner-handle box exactly (rounding it there would visibly disagree with
 * where the handles actually are). See `draw`'s `editingMaskId`. */
const MASK_CORNER_RADIUS_FRACTION = 0.12;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Video content rect, centered in the canvas and inset by `padding` on all
 * sides while preserving the drawn region's own aspect ratio (padding
 * shrinks the video, it doesn't stretch it) — `aspect` is `outputAspect`
 * when set (the viewport is reframed to match it, see `viewportForKeyframe`)
 * or the source recording's own otherwise. Exported (not just a private
 * `SceneRenderer` method) so `CropEditor`'s on-canvas overlay can map its
 * handles onto exactly where the video is actually drawn — including
 * padding — using the *same* formula, rather than a second copy of it that
 * could drift out of sync.
 */
export function computeContentRect(canvasWidth: number, canvasHeight: number, padding: number, aspect: number): Rect {
  const availWidth = Math.max(canvasWidth - padding * 2, 1);
  const availHeight = Math.max(canvasHeight - padding * 2, 1);

  let width = availWidth;
  let height = width / aspect;
  if (height > availHeight) {
    height = availHeight;
    width = height * aspect;
  }

  return { x: (canvasWidth - width) / 2, y: (canvasHeight - height) / 2, width, height };
}

export interface SceneRendererOptions {
  /** Display size in *points*, not pixels — matches the space
   * `cursorTrack` coordinates are already in. */
  frame: FrameSize;
  scaleFactor: number;
  cursorTrack: CursorTrack;
  /** `RecordingMeta.display.originX/originY` — top-left of the captured
   * content in the same global point space `cursorTrack` samples are
   * already in. Non-zero whenever the recording was a window or a custom
   * area rather than a full main-display capture; subtracted from every
   * sample/event position up front so the rest of this class can treat
   * `cursorTrack` as already being in video-local space. */
  origin?: { x: number; y: number };
  /** A confirmed crop (see `crop.ts`) — a sub-window of *this* recording
   * (point space, same units as `frame`/`cursorTrack`) that the rest of
   * the renderer then treats as if it were the *entire* recording: zoom/
   * pan bounds, the source aspect `contentRect` falls back to, and every
   * cursor position are all re-anchored to it, the same way `origin`
   * already re-anchors a window/area recording. The one thing crop does
   * that `origin` doesn't: the underlying `screen.mov` file itself was
   * *not* re-encoded to match (unlike a window/area recording, whose
   * capture-time crop really did produce a smaller file) — so sampling
   * from the video still needs the extra offset `cropOffsetPx` (below)
   * applies at draw time. `undefined`/`null` means no crop. */
  crop?: CropRect | null;
  /** Width/height of the desired output framing — see
   * `viewportForKeyframe`'s doc comment. `undefined` keeps the source
   * recording's own aspect. */
  outputAspect?: number;
  /** Zoom keyframes driving playback — the *same* array the timeline
   * shows and lets the user move/trim (`SceneRenderer` doesn't generate
   * its own copy internally; see `setZoomKeyframes` for how edits reach
   * the already-constructed motion engine live). */
  zoomKeyframes: ZoomKeyframe[];
  /** Animations panel's "Screen animation style" — passed straight to
   * `MotionEngine`'s constructor; see `setScreenAnimationStyle` for the
   * live-switch path. Defaults match `MotionEngine`'s own default. */
  screenAnimationStyle?: ScreenAnimationStyle;
  /** Animations panel's "Cursor animation style" — picks the One Euro
   * filter preset `smoothedSamples` is built from, or bypasses filtering
   * entirely for "none" (see `setCursorAnimationStyle`). */
  cursorAnimationStyle?: CursorAnimationStyle;
}

/** Re-anchors every position-bearing sample/event in `track` from global
 * point space onto `origin` — see `SceneRendererOptions.origin`'s doc
 * comment. A no-op copy when `origin` is `(0, 0)` (the common case).
 * Exported so `EditorView` can apply the *same* shift before generating
 * zoom keyframes from the cursor track — those keyframes' `center` values
 * need to land in the same video-local space this renderer works in, or
 * panning would target the wrong spot for any window/area recording
 * (non-zero origin). */
export function shiftCursorTrack(track: CursorTrack, origin: { x: number; y: number }): CursorTrack {
  if (origin.x === 0 && origin.y === 0) return track;
  return {
    ...track,
    samples: track.samples.map((s) => ({ ...s, x: s.x - origin.x, y: s.y - origin.y })),
    events: track.events.map((e) =>
      "x" in e ? { ...e, x: e.x - origin.x, y: e.y - origin.y } : e,
    ),
  };
}

/**
 * Renders one frame of the preview: fills a background, crops/pans the
 * video per the motion engine's resolved viewport into a padded/rounded/
 * shadowed content rect, then draws a smoothed, animated cursor on top.
 * This is the "live preview" half of ARCHITECTURE.md's "preview and
 * export must never diverge" rule — export (not built yet) will read
 * transforms from the same `motion-engine` module, just driven from Rust
 * instead of a canvas loop.
 */
export class SceneRenderer {
  private motionEngine: MotionEngine;
  private smoothedSamples: CursorSample[];
  /** Same samples, before the One Euro filter — used instead of
   * `smoothedSamples` for whatever time range a slice's
   * `disableSmoothMovement` override is active, e.g. to keep a drop-down
   * menu's precise click alignment instead of a smoothed approximation.
   * Also what `smoothedSamples` gets rebuilt from whenever
   * `setCursorAnimationStyle` picks a new filter preset live. */
  private rawSamples: CursorSample[];
  /** Mirrors `SceneRendererOptions.cursorAnimationStyle` — kept only so
   * `setCursorAnimationStyle` doesn't need it re-passed in. */
  private cursorAnimationStyle: CursorAnimationStyle;
  private events: CursorEvent[];
  private scaleFactor: number;
  /** The source aspect `contentRect` falls back to when `outputAspect`
   * isn't set — the *crop's* aspect once one is confirmed (see
   * `SceneRendererOptions.crop`), the raw recording's otherwise. */
  private videoAspect: number;
  /** Mirrors `SceneRendererOptions.outputAspect` — kept in sync with the
   * motion engine's own copy (see `setOutputAspect`) since `contentRect`
   * needs it too: the drawn region now has *this* aspect (the viewport's),
   * not the source video's, whenever it's set. */
  private outputAspect: number | undefined;
  /** The point-space frame size zoom/pan treats as "the whole recording"
   * — the crop's own size once one is confirmed, the raw recording's
   * otherwise (see `SceneRendererOptions.crop`). Used for the static
   * full-frame viewport `draw`'s `forceFullFrame` substitutes for the
   * motion engine's own (crop mode wants to show the *entire* selectable
   * area, not whatever a zoom keyframe happens to be reframed to at the
   * current time). */
  private effectiveFrame: FrameSize;
  /** Device-pixel offset added to every source-sample coordinate in
   * `draw` — see `SceneRendererOptions.crop`'s doc comment on why this
   * exists (the underlying video file itself was never re-encoded to
   * match the crop, unlike `origin`). Zero when there's no crop. */
  private cropOffsetPx: { x: number; y: number };
  // `shadowBlur` is one of the more expensive things Canvas2D can do —
  // recomputing a full-size blurred rect every frame was enough to make
  // rendering janky, which fed directly into spring instability (a slow
  // frame means a large `dt` on the next `transformAt` call). The content
  // rect + shadow style only change on a style edit or resize, not every
  // frame, so the blurred shadow is rendered once into an offscreen
  // canvas and just blitted (cheap) after that.
  private shadowLayer: HTMLCanvasElement | null = null;
  private shadowLayerKey = "";
  // Same caching story as the shadow layer — a gradient fill plus a CSS
  // blur filter pass is not something to redo 60 times a second.
  private backgroundLayer: HTMLCanvasElement | null = null;
  private backgroundLayerKey = "";
  private backgroundBlurSource: HTMLCanvasElement | null = null;
  // Wallpaper photos and user-uploaded images decode asynchronously; cache
  // the `Image` objects across frames instead of re-creating (and
  // re-downloading) one every draw call.
  private imageCache = new Map<string, HTMLImageElement>();
  // Previous frame's state, for the motion-blur velocity estimate — see
  // the constants above. `null` means "no previous frame to compare
  // against" (first frame after construction, or right after a seek —
  // `resetAt` clears these so a jump-cut in position/time never reads as
  // "fast motion" and blurs).
  private lastViewport: Rect | null = null;
  private lastCursorRenderPos: { x: number; y: number } | null = null;
  private lastDrawWallClockMs: number | null = null;
  // Scratch canvas reused across masks/frames for `drawBlurredRegion` — the
  // video frame changes every draw anyway, so (unlike `shadowLayer`/
  // `backgroundLayer`) there's nothing to cache *across* frames; this just
  // avoids allocating a fresh canvas element per masked region per frame.
  private maskBlurBuffer: HTMLCanvasElement | null = null;

  constructor(opts: SceneRendererOptions) {
    this.scaleFactor = opts.scaleFactor;
    this.outputAspect = opts.outputAspect;

    const crop = opts.crop ?? null;
    const origin = opts.origin ?? { x: 0, y: 0 };
    // See `SceneRendererOptions.crop`'s doc comment: a confirmed crop
    // redefines "the whole recording" for everything downstream, the same
    // way `origin` already does for a window/area capture — composed with
    // it (added, not replaced), since both can be true of the same
    // recording at once (a cropped window recording, say).
    this.effectiveFrame = crop ? { width: crop.width, height: crop.height } : opts.frame;
    const effectiveOrigin = crop ? { x: origin.x + crop.x, y: origin.y + crop.y } : origin;
    this.cropOffsetPx = crop
      ? { x: crop.x * this.scaleFactor, y: crop.y * this.scaleFactor }
      : { x: 0, y: 0 };
    this.videoAspect = this.effectiveFrame.width / this.effectiveFrame.height;

    const cursorTrack = shiftCursorTrack(opts.cursorTrack, effectiveOrigin);
    // Built directly from the caller's keyframes rather than
    // `createMotionEngine` (which would generate its own, independent
    // copy from the cursor track) — see `SceneRendererOptions.zoomKeyframes`'s
    // doc comment for why there must only ever be one array of these.
    this.motionEngine = new MotionEngine(
      this.effectiveFrame,
      opts.zoomKeyframes,
      opts.outputAspect,
      opts.screenAnimationStyle,
    );
    this.cursorAnimationStyle = opts.cursorAnimationStyle ?? DEFAULT_ANIMATION_SETTINGS.cursorAnimationStyle;
    this.rawSamples = cursorTrack.samples;
    this.smoothedSamples = this.buildSmoothedSamples(this.cursorAnimationStyle);
    this.events = cursorTrack.events;
  }

  /** "none" skips the One Euro filter entirely and draws the raw recorded
   * path — every other style just picks which filter preset to smooth
   * with (see `CURSOR_ANIMATION_PRESETS`). */
  private buildSmoothedSamples(style: CursorAnimationStyle): CursorSample[] {
    if (style === "none") return this.rawSamples;
    return smoothCursorTrack(this.rawSamples, CURSOR_ANIMATION_PRESETS[style]);
  }

  /** Called live when the user switches "Screen animation style" in the
   * Animations panel — see `MotionEngine.setScreenAnimationStyle`. */
  setScreenAnimationStyle(style: ScreenAnimationStyle): void {
    this.motionEngine.setScreenAnimationStyle(style);
  }

  /** Called live when the user switches "Cursor animation style" — rebuilds
   * `smoothedSamples` from the untouched `rawSamples` rather than
   * re-filtering the already-smoothed output (which would compound the
   * previous style's smoothing into the new one). */
  setCursorAnimationStyle(style: CursorAnimationStyle): void {
    this.cursorAnimationStyle = style;
    this.smoothedSamples = this.buildSmoothedSamples(style);
  }

  /** Call after a scrub/seek so the next `draw` doesn't treat the jump as
   * elapsed playback time (see `MotionEngine.reset`) — also clears the
   * motion-blur trackers for the same reason (a seek's position jump
   * isn't "fast motion", it's a teleport, and blurring it would look like
   * a glitch rather than a transition). */
  resetAt(tUs: number): void {
    this.motionEngine.reset(tUs);
    this.lastViewport = null;
    this.lastCursorRenderPos = null;
    this.lastDrawWallClockMs = null;
  }

  /** Called live when the user edits a zoom keyframe (move/trim) in the
   * timeline — see `MotionEngine.setKeyframes`. */
  setZoomKeyframes(keyframes: ZoomKeyframe[]): void {
    this.motionEngine.setKeyframes(keyframes);
  }

  /** Switches the output aspect ratio live — see
   * `SceneRendererOptions.outputAspect`'s doc comment. */
  setOutputAspect(aspect: number | undefined): void {
    this.outputAspect = aspect;
    this.motionEngine.setOutputAspect(aspect);
  }

  /** `tUs`: microseconds since the recording's clock epoch — see
   * `RecordingMeta.videoStartUs` for how to derive this from a `<video>`
   * element's `currentTime`. `clipEndTUs`: same epoch, the clip's current
   * out-point (respects a timeline trim, not just the source recording's
   * raw length) — used only for `cursorSettings.loopCursorPosition`.
   * `sliceCursorOverride`: the slice active at `tUs`'s own cursor override
   * (see `slices.ts`), if any — layers on top of `cursorSettings` for just
   * that slice's time range, rather than replacing it. `forceFullFrame`:
   * crop mode's overlay needs to see the *entire* selectable area to draw
   * handles/dimming against, not whatever a zoom keyframe happens to be
   * reframed to right now — bypasses the motion engine's own viewport
   * entirely for a static, unzoomed, centered one instead (see
   * `EditorView`'s `cropMode`). The motion engine's spring state is simply
   * not advanced while this is true — resumes, with a brief catch-up
   * animation bounded by its own `transformAt` clamp, once it's false
   * again. `activeMasks`: whichever `MaskClip`s (see `masks.ts`) are in
   * effect at `tUs`, resolved by the caller via `masksActiveAt` the same
   * way `sliceCursorOverride` is resolved via `sliceAt` — drawn as a
   * full-content-rect cover/tint *underneath* the cursor (a mask hides
   * recorded screen content; the cursor is an editor-added annotation
   * layer, not itself part of what a mask needs to hide). `editingMaskId`:
   * whichever mask (if any) currently has its `MaskOverlay` box open for
   * editing — that one renders perfectly square (see
   * `MASK_CORNER_RADIUS_FRACTION`) so its corners line up exactly with the
   * overlay's own square corner handles; every other active mask still
   * gets its normal rounded corners. `animationSettings`: only the
   * `motionBlur`/`motionBlurAppliesTo*` fields are read here — the two
   * style enums on the same object reshape stateful spring/filter machinery
   * instead, via `setScreenAnimationStyle`/`setCursorAnimationStyle`, so
   * they're not re-applied every frame the way these plain multipliers
   * are. */
  draw(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    tUs: number,
    style: StyleSettings = DEFAULT_STYLE,
    showCursor = true,
    cursorSettings: CursorSettings = DEFAULT_CURSOR_SETTINGS,
    clipEndTUs = 0,
    sliceCursorOverride: SliceCursorOverride | null = null,
    forceFullFrame = false,
    activeMasks: MaskClip[] = [],
    editingMaskId: string | null = null,
    animationSettings: AnimationSettings = DEFAULT_ANIMATION_SETTINGS,
  ): void {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.getBackgroundLayer(canvas.width, canvas.height, style), 0, 0);

    const content = this.contentRect(canvas.width, canvas.height, style.padding);

    const useRaw = sliceCursorOverride?.disableSmoothMovement ?? false;
    const cursor = this.effectiveCursorPositionAt(tUs, clipEndTUs, cursorSettings.loopCursorPosition, useRaw);
    // Live cursor position drives pan while a zoom is active (see
    // ARCHITECTURE.md, "Pan follows the live cursor") — computed before
    // `transformAt` so it can be passed straight in.
    const viewport = forceFullFrame
      ? { x: 0, y: 0, width: this.effectiveFrame.width, height: this.effectiveFrame.height }
      : this.motionEngine.transformAt(tUs, cursor ?? undefined).viewport;

    // Real (wall-clock, not video) elapsed time since the last `draw` —
    // the basis for both trail estimates below, so their intensity tracks
    // actual on-screen motion speed regardless of frame rate or playback
    // rate. `null` on the first frame (or right after a seek — see
    // `resetAt`), where there's nothing to compare against yet.
    const nowMs = performance.now();
    const dtMs = this.lastDrawWallClockMs !== null ? Math.max(1, nowMs - this.lastDrawWallClockMs) : null;
    // Animations panel's "Motion blur" slider + "applies to" toggles — a
    // plain 0-1 multiplier on top of the same speed-derived intensity
    // `contentTrailSteps`/`cursorMotion` already compute, not a replacement
    // for it (0 fully disables, independent of how fast the content/cursor
    // is actually moving).
    const screenBlurFactor = animationSettings.motionBlurAppliesToScreen ? animationSettings.motionBlur / 100 : 0;
    const cursorBlurFactor = animationSettings.motionBlurAppliesToCursor ? animationSettings.motionBlur / 100 : 0;
    const contentTrailSteps = this.contentTrailSteps(viewport, dtMs);
    const lastViewportForTrail = this.lastViewport;
    this.lastViewport = viewport;
    this.lastDrawWallClockMs = nowMs;

    // `viewport` is in point space; the video's actual pixels are at
    // `scaleFactor`x that (ARCHITECTURE.md, "Recording format").
    // `+ this.cropOffsetPx`: `viewport` is relative to the *effective*
    // frame's own origin (0,0 = the crop's top-left, once one exists) —
    // the underlying video file's pixels are not, so sampling from it
    // needs the crop's offset added back in (see `cropOffsetPx`'s doc
    // comment). Zero, a no-op, whenever there's no crop.
    const sx = viewport.x * this.scaleFactor + this.cropOffsetPx.x;
    const sy = viewport.y * this.scaleFactor + this.cropOffsetPx.y;
    const sw = viewport.width * this.scaleFactor;
    const sh = viewport.height * this.scaleFactor;

    // Shadow pass: a filled rounded rect casts the shadow, cached (see
    // the `shadowLayer` field doc comment) since it doesn't change frame
    // to frame during normal playback.
    const shadowLayer = this.getShadowLayer(canvas.width, canvas.height, content, style);
    ctx.drawImage(shadowLayer, 0, 0);

    ctx.save();
    roundedRectPath(ctx, content, style.cornerRadius);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    // Directional motion-blur trail during a zoom/pan transition (see the
    // constants/comment at the top of this file) — interpolated echoes
    // between last frame's viewport and this one's, faintest first,
    // *underneath* the real, fully-opaque draw below. `globalAlpha` is
    // part of the state `ctx.save()`/`ctx.restore()` already bracket here,
    // so it doesn't need manually resetting to 1 afterward.
    if (contentTrailSteps > 0 && lastViewportForTrail && screenBlurFactor > 0) {
      for (let i = 1; i <= contentTrailSteps; i++) {
        const t = i / (contentTrailSteps + 1);
        const echo = lerpRect(lastViewportForTrail, viewport, t);
        const esx = echo.x * this.scaleFactor + this.cropOffsetPx.x;
        const esy = echo.y * this.scaleFactor + this.cropOffsetPx.y;
        const esw = echo.width * this.scaleFactor;
        const esh = echo.height * this.scaleFactor;
        ctx.globalAlpha = t * MAX_TRAIL_ALPHA * screenBlurFactor;
        ctx.drawImage(video, esx, esy, esw, esh, content.x, content.y, content.width, content.height);
      }
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(video, sx, sy, sw, sh, content.x, content.y, content.width, content.height);
    ctx.restore();

    if (style.inset > 0) {
      const insetRect = {
        x: content.x + style.inset / 2,
        y: content.y + style.inset / 2,
        width: content.width - style.inset,
        height: content.height - style.inset,
      };
      ctx.save();
      roundedRectPath(ctx, insetRect, Math.max(0, style.cornerRadius - style.inset / 2));
      // Glass-bezel light: a vertical gradient across the stroke so the top
      // edge catches the light and the bottom recedes, with `insetBalance`
      // (0 = light from below, 1 = from above, 0.5 = even) and
      // `insetOpacity` shaping the two ends. `insetColor` is a plain hex
      // (the panel's color picker only yields hex), so the alpha is applied
      // here when building the rgba() gradient.
      const [r, g, b] = hexToRgb(style.insetColor);
      const gradient = ctx.createLinearGradient(0, insetRect.y, 0, insetRect.y + insetRect.height);
      gradient.addColorStop(0, `rgba(${r},${g},${b},${style.insetOpacity * (0.5 + 0.5 * style.insetBalance)})`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},${style.insetOpacity * (1 - 0.5 * style.insetBalance)})`);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = style.inset;
      ctx.stroke();
      ctx.restore();
    }

    this.drawMasks(ctx, video, viewport, content, style, activeMasks, editingMaskId);

    // `cursor` still drives pan above even when the glyph itself is
    // hidden — this flag is purely visual, not a "stop tracking" switch.
    if (!cursor || !showCursor || sliceCursorOverride?.hideCursor) return;
    // Idle-hide checks the *raw* (non-loop-blended) position — a loop
    // blend nudging the cursor a fraction of a pixel per frame shouldn't
    // itself count as "moving".
    if (cursorSettings.hideCursorIfNotMoving && this.isCursorIdleAt(tUs, useRaw)) return;

    const cx = content.x + ((cursor.x - viewport.x) / viewport.width) * content.width;
    const cy = content.y + ((cursor.y - viewport.y) / viewport.height) * content.height;

    // Blur/fade for a fast cursor move (see the constants and comment at
    // the top of this file) — in the same *content*/on-screen pixel space
    // the glyph itself is drawn in, so the effect scales with zoom the
    // same way the cursor's apparent speed does (a fast move reads as
    // faster, and blurrier, while zoomed in).
    const { blurPx: cursorBlurPx, alpha: cursorAlpha } = this.cursorMotion(cx, cy, dtMs, cursorBlurFactor);
    this.lastCursorRenderPos = { x: cx, y: cy };

    if (cursorSettings.clickEffectEnabled) this.drawClickRipples(ctx, tUs, viewport, content);

    const type = this.cursorTypeAt(tUs);
    const pulseScale = this.clickPulseScaleAt(tUs);
    drawCursorGlyph(ctx, cx, cy, pulseScale, type, cursorSettings, cursorAlpha, cursorBlurPx);
  }

  /** How many trailing echoes to draw for the video content this frame,
   * from how much `viewport` (the motion engine's resolved pan/zoom rect)
   * moved/resized since the last `draw` call — see the constants/comment
   * at the top of this file. Zoom (size change) and pan (position change)
   * are both folded in, `Math.log` on the size ratio so zooming in and out
   * contribute symmetrically (a 2x-in and a 2x-out change should trail the
   * same amount, not one being "bigger" than the other by whatever
   * direction the raw ratio happens to point). */
  private contentTrailSteps(viewport: Rect, dtMs: number | null): number {
    if (!this.lastViewport || dtMs === null) return 0;
    const scaleChange = Math.abs(Math.log(viewport.width / this.lastViewport.width));
    const panChange = Math.hypot(viewport.x - this.lastViewport.x, viewport.y - this.lastViewport.y) / viewport.width;
    const motionPerMs = (scaleChange + panChange) / dtMs;
    const intensity = Math.min(1, motionPerMs * CONTENT_TRAIL_SENSITIVITY);
    return Math.round(intensity * MAX_TRAIL_STEPS);
  }

  /** Gaussian blur radius for the cursor glyph this frame, from how far it
   * moved (in on-screen content pixels) since the last `draw` call — see
   * the constants at the top of this file. `blurFactor` (0-1, the
   * Animations panel's "Motion blur" slider, gated on "applies to cursor
   * movement") scales the radius — 0 means a fast move stays perfectly
   * sharp. Alpha is always 1: the cursor never fades out, a fast move
   * (real mouse movement, or the viewport sweeping the cursor across the
   * frame during a zoom/pan transition) just smears it into a blur. */
  private cursorMotion(
    cx: number,
    cy: number,
    dtMs: number | null,
    blurFactor: number,
  ): { blurPx: number; alpha: number } {
    if (!this.lastCursorRenderPos || dtMs === null || blurFactor <= 0) return { blurPx: 0, alpha: 1 };
    const distPx = Math.hypot(cx - this.lastCursorRenderPos.x, cy - this.lastCursorRenderPos.y);
    const speedPerMs = distPx / dtMs;
    const intensity = Math.min(1, speedPerMs * CURSOR_BLUR_SENSITIVITY);
    return { blurPx: intensity * MAX_CURSOR_BLUR_PX * blurFactor, alpha: 1 };
  }

  /** Draws every active mask's *own rectangular region* — not the whole
   * frame (see `masks.ts`'s doc comment for what changed and why) —
   * projected from `mask.rect`'s point-space coordinates through the
   * *current* `viewport` into `content`-rect pixel space, the same way
   * the cursor's on-screen position is projected in `draw` above. That
   * projection is what makes a mask correctly track a zoom/pan instead of
   * staying pinned to a fixed spot on the canvas while the content
   * underneath moves — the same reason `origin`/`crop` re-anchor
   * everything else this renderer draws. Clipped to the content's own
   * rounded rect, same as the main video draw, so a mask near the edge
   * doesn't poke square corners out past it. Multiple simultaneously-
   * active masks (an edge case, not the common one — see `masksActiveAt`)
   * simply layer, each drawn in array order. */
  private drawMasks(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    viewport: Rect,
    content: Rect,
    style: StyleSettings,
    masks: MaskClip[],
    editingMaskId: string | null,
  ): void {
    if (masks.length === 0) return;
    ctx.save();
    roundedRectPath(ctx, content, style.cornerRadius);
    ctx.clip();
    for (const mask of masks) {
      const rx = content.x + ((mask.rect.x - viewport.x) / viewport.width) * content.width;
      const ry = content.y + ((mask.rect.y - viewport.y) / viewport.height) * content.height;
      const rw = (mask.rect.width / viewport.width) * content.width;
      const rh = (mask.rect.height / viewport.height) * content.height;
      if (rw <= 0 || rh <= 0) continue;

      // Square while it's the one currently open for editing (so it lines
      // up with `MaskOverlay`'s square corner handles), rounded otherwise
      // — see `MASK_CORNER_RADIUS_FRACTION`.
      const radius = mask.id === editingMaskId ? 0 : Math.min(rw, rh) * MASK_CORNER_RADIUS_FRACTION;

      if (mask.type === "sensitive") {
        this.drawBlurredRegion(ctx, video, mask.rect, rx, ry, rw, rh, radius);
      } else {
        // Highlight: dim everything *outside* this (possibly rounded) rect
        // — fill the whole content area, then punch the rect back out via
        // an evenodd-rule compound path (outer content bounds + inner
        // rounded rect as two subpaths — a point inside both is crossed an
        // even number of times and so left unfilled). The rect's own area
        // is deliberately untouched either way — a highlight's entire
        // purpose is that the highlighted thing stays completely normal.
        ctx.save();
        ctx.beginPath();
        ctx.rect(content.x, content.y, content.width, content.height);
        roundedRectSubpath(ctx, { x: rx, y: ry, width: rw, height: rh }, radius);
        ctx.fillStyle = `rgba(0,0,0,${mask.opacity})`;
        ctx.fill("evenodd");
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /** Blurs just the `sourceRect` (point-space) region of `video` and draws
   * it, clipped to a rect of corner `radius`, at `(destX, destY, destW,
   * destH)` in canvas-pixel space — the "sensitive" mask's actual
   * redaction. See `MASK_BLUR_DOWNSCALE_FRACTION`'s doc comment for why
   * this is a downscale-then-upscale rather than `ctx.filter`: sampling
   * `video` straight into a *much smaller* scratch canvas (a plain scaled
   * `drawImage`, not a spreading blur kernel) means every output pixel is
   * real, fully-opaque picture data — unlike a filter's blur radius, there
   * is no "sample past the edge into nothing" case to guard against here,
   * so the box is solidly obscured edge-to-edge with no extra bookkeeping. */
  private drawBlurredRegion(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    sourceRect: CropRect,
    destX: number,
    destY: number,
    destW: number,
    destH: number,
    radius: number,
  ): void {
    const bw = Math.max(1, Math.round(destW));
    const bh = Math.max(1, Math.round(destH));
    const tinyW = Math.max(1, Math.round(bw * MASK_BLUR_DOWNSCALE_FRACTION));
    const tinyH = Math.max(1, Math.round(bh * MASK_BLUR_DOWNSCALE_FRACTION));

    const sx = sourceRect.x * this.scaleFactor + this.cropOffsetPx.x;
    const sy = sourceRect.y * this.scaleFactor + this.cropOffsetPx.y;
    const sw = sourceRect.width * this.scaleFactor;
    const sh = sourceRect.height * this.scaleFactor;

    const tiny = this.maskBlurBuffer ?? document.createElement("canvas");
    tiny.width = tinyW;
    tiny.height = tinyH;
    const tctx = tiny.getContext("2d");
    if (!tctx) return;
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    tctx.clearRect(0, 0, tinyW, tinyH);
    tctx.drawImage(video, sx, sy, sw, sh, 0, 0, tinyW, tinyH);
    this.maskBlurBuffer = tiny;

    ctx.save();
    roundedRectPath(ctx, { x: destX, y: destY, width: destW, height: destH }, radius);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tiny, destX, destY, destW, destH);
    ctx.restore();
  }

  /** `outputAspect` when set (the viewport is reframed to match it, see
   * `viewportForKeyframe`), the source recording's own — or the crop's,
   * once one is confirmed; see `videoAspect`'s doc comment — otherwise.
   * See `computeContentRect` (the module-level export this delegates to)
   * for the actual geometry. */
  private contentRect(canvasWidth: number, canvasHeight: number, padding: number): Rect {
    return computeContentRect(canvasWidth, canvasHeight, padding, this.outputAspect ?? this.videoAspect);
  }

  /** Resolves the photo URL backing "wallpaper" (bundled presets) or
   * "image" (user upload) background types; null for color/gradient. */
  private backgroundImageUrl(style: StyleSettings): string | null {
    if (style.backgroundType === "wallpaper") {
      return WALLPAPER_IMAGES.find((w) => w.id === style.wallpaperId)?.url ?? WALLPAPER_IMAGES[0].url;
    }
    if (style.backgroundType === "image") {
      return style.customImageUrl;
    }
    return null;
  }

  private getImage(url: string): HTMLImageElement {
    let img = this.imageCache.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      this.imageCache.set(url, img);
    }
    return img;
  }

  private paintBackgroundFill(
    ctx: CanvasRenderingContext2D,
    style: StyleSettings,
    width: number,
    height: number,
  ): void {
    if (style.backgroundType === "color") {
      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (style.backgroundType === "gradient") {
      const preset = GRADIENT_PRESETS.find((p) => p.id === style.gradientId) ?? GRADIENT_PRESETS[0];
      ctx.fillStyle = paintCanvasGradient(ctx, preset, width, height);
      ctx.fillRect(0, 0, width, height);
      return;
    }

    // "wallpaper" or "image": cover-fit a photo. Fall back to a flat fill
    // until the bitmap has decoded (or, for "image", until the user has
    // picked one) so the canvas never goes transparent.
    ctx.fillStyle = "#111114";
    ctx.fillRect(0, 0, width, height);
    const url = this.backgroundImageUrl(style);
    if (!url) return;
    const img = this.getImage(url);
    if (!img.complete || img.naturalWidth === 0) return;

    const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }

  private getBackgroundLayer(canvasWidth: number, canvasHeight: number, style: StyleSettings): HTMLCanvasElement {
    const imageUrl = this.backgroundImageUrl(style);
    // Photos decode asynchronously; fold "has this URL finished loading
    // yet" into the cache key so the layer is repainted with the real
    // bitmap the first frame after it becomes available, instead of the
    // placeholder fill sticking around for the rest of playback.
    const imageReady = imageUrl ? this.getImage(imageUrl).complete : false;

    const key = [
      canvasWidth,
      canvasHeight,
      style.backgroundType,
      style.backgroundType === "color"
        ? style.backgroundColor
        : style.backgroundType === "gradient"
          ? style.gradientId
          : `${imageUrl ?? ""}:${imageReady}`,
      style.backgroundBlur,
    ].join(":");

    if (this.backgroundLayer && this.backgroundLayerKey === key) return this.backgroundLayer;

    const layer = this.backgroundLayer ?? document.createElement("canvas");
    layer.width = canvasWidth;
    layer.height = canvasHeight;
    const lctx = layer.getContext("2d");
    if (lctx) {
      lctx.clearRect(0, 0, canvasWidth, canvasHeight);
      if (style.backgroundBlur > 0) {
        // Not `ctx.filter = blur(...)` + a full-size `drawImage` of the
        // unblurred fill — this WKWebView (like the clip-region `drawImage`
        // cases the motion-blur comment at the top of this file already
        // warns about) silently ignores a canvas filter on `drawImage`
        // calls: filters only land on primitive draws (fill/stroke). That
        // exact `filter`+`drawImage` composite is what this originally did
        // and it rendered no blur at all. So the blur runs in software
        // (`boxBlurGaussian`, three passes ≈ a Gaussian) on a *downscaled*
        // scratch canvas, then is drawn back up to full size — plain,
        // universally-supported `drawImage` scaling. Downscaling keeps the
        // blur interactive on slider drags; the blurred fill has no detail
        // finer than the box radius to lose, and the blur at reduced scale
        // means the bilinear upscale spreads smooth content rather than
        // enlarging pixels into blocks. Two tiers keep the radius in
        // reduced-res pixels at ~radius/2 (i.e. matching the CSS
        // `blur(radius)` the slider means): subtle blurs run at 1/4 scale
        // (fine enough to stay light), stronger ones at 1/8 (their detail
        // is already gone, and 8x upscaling is where blockiness would show
        // — the box blur prevents it). A blurred region's pixel-blocks
        // stay ≤ ~2 output px; the old pure-downscale approach made
        // ~blur-px-sized flat blocks, which is the "blocky" look this
        // replaces.
        const scale = style.backgroundBlur < 12 ? 0.25 : 0.125;
        const smallW = Math.max(1, Math.round(canvasWidth * scale));
        const smallH = Math.max(1, Math.round(canvasHeight * scale));
        const source = this.backgroundBlurSource ?? document.createElement("canvas");
        source.width = smallW;
        source.height = smallH;
        const sctx = source.getContext("2d");
        if (sctx) {
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = "high";
          this.paintBackgroundFill(sctx, style, smallW, smallH);
          const imageData = sctx.getImageData(0, 0, smallW, smallH);
          boxBlurGaussian(imageData.data, smallW, smallH, Math.max(1, Math.round((style.backgroundBlur * scale) / 2)));
          sctx.putImageData(imageData, 0, 0);
        }
        this.backgroundBlurSource = source;

        lctx.imageSmoothingEnabled = true;
        lctx.imageSmoothingQuality = "high";
        lctx.drawImage(source, 0, 0, smallW, smallH, 0, 0, canvasWidth, canvasHeight);
      } else {
        this.paintBackgroundFill(lctx, style, canvasWidth, canvasHeight);
      }
    }

    this.backgroundLayer = layer;
    this.backgroundLayerKey = key;
    return layer;
  }

  private getShadowLayer(
    canvasWidth: number,
    canvasHeight: number,
    content: Rect,
    style: StyleSettings,
  ): HTMLCanvasElement {
    const key = [
      canvasWidth,
      canvasHeight,
      content.x,
      content.y,
      content.width,
      content.height,
      style.cornerRadius,
      style.shadowBlur,
      style.shadowOffsetY,
      style.shadowColor,
    ].join(":");

    if (this.shadowLayer && this.shadowLayerKey === key) return this.shadowLayer;

    const layer = this.shadowLayer ?? document.createElement("canvas");
    layer.width = canvasWidth;
    layer.height = canvasHeight;
    const lctx = layer.getContext("2d");
    if (lctx) {
      lctx.clearRect(0, 0, canvasWidth, canvasHeight);
      lctx.shadowColor = style.shadowColor;
      lctx.shadowBlur = style.shadowBlur;
      lctx.shadowOffsetY = style.shadowOffsetY;
      lctx.fillStyle = "#000";
      roundedRectPath(lctx, content, style.cornerRadius);
      lctx.fill();
    }

    this.shadowLayer = layer;
    this.shadowLayerKey = key;
    return layer;
  }

  private cursorPositionAt(tUs: number, useRaw = false): { x: number; y: number } | null {
    const samples = useRaw ? this.rawSamples : this.smoothedSamples;
    if (samples.length === 0) return null;
    if (tUs <= samples[0].t) return samples[0];
    const last = samples[samples.length - 1];
    if (tUs >= last.t) return last;

    // Binary search for the first sample at or after tUs, then lerp
    // between it and its predecessor — smooths the 120Hz sample grid out
    // to whatever framerate the canvas is actually redrawing at.
    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].t <= tUs) lo = mid + 1;
      else hi = mid;
    }
    const b = samples[lo];
    const a = samples[lo - 1];
    const span = b.t - a.t;
    const f = span > 0 ? (tUs - a.t) / span : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  /** `cursorPositionAt`, blended toward the clip's first sample over the
   * last `LOOP_BLEND_DURATION_US` before `clipEndTUs` — see
   * `CursorSettings.loopCursorPosition`'s doc comment. A no-op (returns
   * the raw position) unless `loopEnabled`, or for a clip too short to
   * have a meaningful blend window. */
  private effectiveCursorPositionAt(
    tUs: number,
    clipEndTUs: number,
    loopEnabled: boolean,
    useRaw = false,
  ): { x: number; y: number } | null {
    const raw = this.cursorPositionAt(tUs, useRaw);
    const first = (useRaw ? this.rawSamples : this.smoothedSamples)[0];
    if (!raw || !first || !loopEnabled || clipEndTUs <= 0) return raw;

    const remaining = clipEndTUs - tUs;
    if (remaining < 0) return raw;
    const blendWindowUs = Math.min(LOOP_BLEND_DURATION_US, (clipEndTUs - first.t) * 0.3);
    if (blendWindowUs <= 0 || remaining >= blendWindowUs) return raw;

    const f = 1 - remaining / blendWindowUs;
    return { x: raw.x + (first.x - raw.x) * f, y: raw.y + (first.y - raw.y) * f };
  }

  /** Nearest recorded sample's `type` at `tUs` — categorical, so this
   * picks the closer neighbor rather than interpolating like
   * `cursorPositionAt` does for position. */
  private cursorTypeAt(tUs: number): CursorType {
    const samples = this.smoothedSamples;
    if (samples.length === 0) return "arrow";
    if (tUs <= samples[0].t) return samples[0].type;
    const last = samples[samples.length - 1];
    if (tUs >= last.t) return last.type;

    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].t <= tUs) lo = mid + 1;
      else hi = mid;
    }
    const b = samples[lo];
    const a = samples[lo - 1];
    return tUs - a.t <= b.t - tUs ? a.type : b.type;
  }

  /** Whether the cursor has moved less than a few pixels over the last
   * `IDLE_WINDOW_US` — drives `CursorSettings.hideCursorIfNotMoving`. Uses
   * the non-loop-blended position (still respects `useRaw`, so idle
   * detection isn't skewed by smoothing while a slice disables it); see
   * `draw`'s call site. */
  private isCursorIdleAt(tUs: number, useRaw = false): boolean {
    const now = this.cursorPositionAt(tUs, useRaw);
    const before = this.cursorPositionAt(Math.max(0, tUs - IDLE_WINDOW_US), useRaw);
    if (!now || !before) return false;
    return Math.hypot(now.x - before.x, now.y - before.y) < IDLE_THRESHOLD_PX;
  }

  private clickPulseScaleAt(tUs: number): number {
    let scale = 1;
    for (const event of this.events) {
      if (event.kind !== "leftDown" && event.kind !== "rightDown") continue;
      const age = tUs - event.t;
      if (age < 0 || age > CLICK_PULSE_DURATION_US) continue;
      const f = age / CLICK_PULSE_DURATION_US;
      scale = Math.max(scale, 1 + Math.sin(f * Math.PI) * 0.35);
    }
    return scale;
  }

  private drawClickRipples(
    ctx: CanvasRenderingContext2D,
    tUs: number,
    viewport: { x: number; y: number; width: number; height: number },
    content: Rect,
  ): void {
    for (const event of this.events) {
      if (event.kind !== "leftDown" && event.kind !== "rightDown") continue;
      const age = tUs - event.t;
      if (age < 0 || age > CLICK_RIPPLE_DURATION_US) continue;

      const f = age / CLICK_RIPPLE_DURATION_US;
      const cx = content.x + ((event.x - viewport.x) / viewport.width) * content.width;
      const cy = content.y + ((event.y - viewport.y) / viewport.height) * content.height;
      const radius = CURSOR_SIZE_PX * 0.4 + f * CURSOR_SIZE_PX * 1.2;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${(1 - f) * 0.8})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
}

/** Linear interpolation between two rects, `t` in `[0, 1]` — backs the
 * motion-blur trail's interpolated echo positions (see the comment at the
 * top of this file). */
function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}

/** Traces a rounded rect as a subpath *without* starting a new path — lets
 * a caller combine it with another already-open subpath (see `drawMasks`'s
 * highlight-mask "punch a rounded hole" fill, which needs both the content
 * rect and this in the same path for an evenodd fill to work). */
function roundedRectSubpath(ctx: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  const { x, y, width: w, height: h } = rect;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundedRectPath(ctx: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  ctx.beginPath();
  roundedRectSubpath(ctx, rect, radius);
}

/** `#rrggbb` (the only form a native color input produces) → `[r, g, b]`;
 * falls back to white for anything else so the callers (currently the
 * inset bezel gradient) never interpolate a NaN into a canvas color. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return Number.isNaN(n) ? [255, 255, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** In-place blur of an RGBA pixel buffer (from `getImageData`), separable
 * box-blur passes to approximate a Gaussian — the stand-in for the canvas
 * `filter` blur this WKWebView ignores (see `getBackgroundLayer`'s
 * comment). Defaults to three passes (≈ a Gaussian, for the background);
 * the cursor's fast-move smear passes 2, where a triangle filter is
 * visually indistinguishable and cheaper. Radius is in buffer pixels; each
 * pass is a sliding-window mean so cost is ~independent of radius. The
 * scratch buffer is reused across passes, and the horizontal/vertical
 * sweeps alternate between `buf` and `tmp` so a pass never samples its own
 * output. */
function boxBlurGaussian(buf: Uint8ClampedArray, width: number, height: number, radius: number, passes = 3): void {
  const tmp = new Uint8ClampedArray(buf.length);
  const invDiv = 1 / (radius * 2 + 1);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let i = -radius; i <= radius; i++) {
        const p = row + (i < 0 ? 0 : i >= width ? width - 1 : i) * 4;
        sr += buf[p];
        sg += buf[p + 1];
        sb += buf[p + 2];
        sa += buf[p + 3];
      }
      for (let x = 0; x < width; x++) {
        const o = row + x * 4;
        tmp[o] = sr * invDiv;
        tmp[o + 1] = sg * invDiv;
        tmp[o + 2] = sb * invDiv;
        tmp[o + 3] = sa * invDiv;
        const addX = x + radius + 1 < width ? x + radius + 1 : width - 1;
        const subX = x - radius > 0 ? x - radius : 0;
        const pa = row + addX * 4;
        const pr = row + subX * 4;
        sr += buf[pa] - buf[pr];
        sg += buf[pa + 1] - buf[pr + 1];
        sb += buf[pa + 2] - buf[pr + 2];
        sa += buf[pa + 3] - buf[pr + 3];
      }
    }
    for (let x = 0; x < width; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let i = -radius; i <= radius; i++) {
        const p = (i < 0 ? 0 : i >= height ? height - 1 : i) * width * 4 + x * 4;
        sr += tmp[p];
        sg += tmp[p + 1];
        sb += tmp[p + 2];
        sa += tmp[p + 3];
      }
      for (let y = 0; y < height; y++) {
        const o = y * width * 4 + x * 4;
        buf[o] = sr * invDiv;
        buf[o + 1] = sg * invDiv;
        buf[o + 2] = sb * invDiv;
        buf[o + 3] = sa * invDiv;
        const addY = y + radius + 1 < height ? y + radius + 1 : height - 1;
        const subY = y - radius > 0 ? y - radius : 0;
        const pa = addY * width * 4 + x * 4;
        const pr = subY * width * 4 + x * 4;
        sr += tmp[pa] - tmp[pr];
        sg += tmp[pa + 1] - tmp[pr + 1];
        sb += tmp[pa + 2] - tmp[pr + 2];
        sa += tmp[pa + 3] - tmp[pr + 3];
      }
    }
  }
}

/**
 * Redraws a cursor glyph rather than compositing captured pixels
 * (ARCHITECTURE.md, "Cursor rendering") — fixed apparent size regardless
 * of zoom, so it's always legible. `settings.style` selects a whole glyph +
 * paint treatment (see `cursorSettings.ts`); the pointer-shaped styles
 * stay type-aware so a recorded I-beam/resize `CursorType` still renders
 * as its own line-art shape, while theme styles (hand, crosshair, ...)
 * always draw their own glyph — see `cursorGlyphFor`.
 */
/** Draws the cursor glyph — `blurPx > 0` (a fast move, from real movement
 * or a zoom/pan transition sweeping it across the frame) renders it via
 * `drawBlurredCursorGlyph` as a software Gaussian-blurred smear at full
 * opacity, rather than fading it out. `alpha` is effectively always 1 now
 * (see `cursorMotion`) but stays in the signature for the ripple code's
 * sake. */
function drawCursorGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pulseScale: number,
  type: CursorType,
  settings: CursorSettings,
  alpha = 1,
  blurPx = 0,
): void {
  const preset = cursorStylePreset(settings.style);
  const glyph = cursorGlyphFor(settings.style, type, settings.alwaysPointerCursor);
  const s = (CURSOR_SIZE_PX / 30) * pulseScale * cursorSizeMultiplier(settings.size);

  if (blurPx > 0) {
    drawBlurredCursorGlyph(ctx, x, y, s, glyph, preset, settings.rotationDeg, alpha, blurPx);
    return;
  }

  ctx.save();
  ctx.translate(x, y);
  if (settings.rotationDeg) ctx.rotate((settings.rotationDeg * Math.PI) / 180);
  ctx.scale(s, s);
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.globalAlpha = alpha;
  // `drawCursorShape` re-zeroes shadowBlur before its own strokes, so this
  // default only shades the fills.
  ctx.shadowBlur = 3;
  drawCursorShape(ctx, glyph, preset);
  ctx.shadowBlur = 0;
  ctx.restore();
}

/** Reused scratch canvas for the blurred-cursor path — only one cursor is
 * drawn at a time, so a module-level buffer is safe. */
let cursorBlurCanvas: HTMLCanvasElement | null = null;

/** Draws the cursor glyph blurred by a real Gaussian at full opacity. The
 * glyph is rendered into a scratch canvas (translated to its center,
 * rotated, and scaled exactly like the sharp draw), passed through
 * `boxBlurGaussian`, then composited back at `(x, y)`. `ctx.filter` can't
 * do this — it's a no-op here (see the comment at the top of this file).
 * The scratch canvas is rendered at half resolution (`BLUR_RENDER_SCALE`)
 * and blurred there before being stretched back up, exactly like the
 * background blur: the smear has no fine detail to lose, and it keeps the
 * per-frame cost at a few ms even though the glyph itself draws ~92px
 * large (a full-res scratch would be a ~270px box and ~40ms). */
const BLUR_RENDER_SCALE = 0.5;
function drawBlurredCursorGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  glyph: CursorGlyphId,
  paint: CursorPaint,
  rotationDeg: number,
  alpha: number,
  blurPx: number,
): void {
  const bounds = CURSOR_GLYPH_BOUNDS[glyph];
  // Glyph's max extent from its anchor (the full diagonal covers corner-
  // anchored shapes like the arrow), plus the blur reach and shadow room,
  // in full-res screen px; then the half-res scratch is just that halved.
  const fullExtent = Math.hypot(bounds.w, bounds.h) * s + blurPx + 5;
  const fullSize = Math.ceil(fullExtent * 2);
  const size = Math.ceil(fullSize * BLUR_RENDER_SCALE);
  if (!cursorBlurCanvas) cursorBlurCanvas = document.createElement("canvas");
  const scratch = cursorBlurCanvas;
  if (scratch.width !== size) {
    scratch.width = size;
    scratch.height = size;
  }
  const sctx = scratch.getContext("2d");
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, size, size);
  sctx.translate(size / 2, size / 2);
  if (rotationDeg) sctx.rotate((rotationDeg * Math.PI) / 180);
  sctx.scale(s * BLUR_RENDER_SCALE, s * BLUR_RENDER_SCALE);
  sctx.shadowColor = "rgba(0,0,0,0.4)";
  sctx.shadowBlur = 3 * BLUR_RENDER_SCALE;
  drawCursorShape(sctx, glyph, paint);
  const imageData = sctx.getImageData(0, 0, size, size);
  boxBlurGaussian(imageData.data, size, size, Math.max(1, Math.round(blurPx * BLUR_RENDER_SCALE)), 2);
  sctx.putImageData(imageData, 0, 0);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(scratch, 0, 0, size, size, x - fullExtent, y - fullExtent, fullSize, fullSize);
  ctx.restore();
}
