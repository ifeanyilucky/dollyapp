import type { CursorEvent, CursorSample, CursorTrack, CursorType } from "../bundle/types";
import {
  MotionEngine,
  smoothCursorTrack,
  type FrameSize,
  type ZoomKeyframe,
} from "../motion-engine";
import { cursorSizeMultiplier, DEFAULT_CURSOR_SETTINGS, type CursorSettings, type CursorStyleId } from "./cursorSettings";
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
const CURSOR_SIZE_PX = 46;

// Motion blur — both the content (during a zoom/pan transition) and the
// cursor glyph (during a fast move) get a `ctx.filter = blur(...)` pass
// proportional to how fast they're actually moving on screen right now,
// fading to zero once whatever's moving settles. Canvas2D has no native
// directional/per-object motion blur, so this is a frame-to-frame
// approximation: each `draw()` call compares this frame's viewport/cursor
// position to the *previous* call's (`lastViewport`/`lastCursorRenderPos`),
// normalizes the delta by real elapsed wall-clock time (not video time, so
// blur intensity naturally scales with playback rate too — 2x playback
// looks proportionally blurrier, which is the physically-correct
// direction), and maps that velocity to a blur radius. Tuned by eye, not
// derived from anything physical — adjust the `*_SENSITIVITY` constants if
// the effect ever reads as too subtle or too smeary.
const MAX_CONTENT_BLUR_PX = 8;
const CONTENT_BLUR_SENSITIVITY = 3000;
const MAX_CURSOR_BLUR_PX = 8;
const CURSOR_BLUR_SENSITIVITY = 3;
/** Cursor opacity fades alongside the blur during a fast move ("faded
 * movement" — a plain blur alone still reads as sharp-but-smeared; a
 * slight fade sells the "moving too fast to fully see it" feel) — floors
 * here rather than fading to fully invisible. */
const MIN_CURSOR_ALPHA = 0.4;
const CURSOR_FADE_SENSITIVITY = 0.22;
/** `CursorSettings.loopCursorPosition`'s blend window, capped to 30% of
 * the clip for anything shorter than this. */
const LOOP_BLEND_DURATION_US = 1_200_000;
/** `CursorSettings.hideCursorIfNotMoving`'s lookback window and movement
 * threshold — small enough to catch a real pause quickly, large enough
 * not to flicker during a slow, deliberate drag. */
const IDLE_WINDOW_US = 500_000;
const IDLE_THRESHOLD_PX = 3;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
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
  /** Width/height of the desired output framing — see
   * `viewportForKeyframe`'s doc comment. `undefined` keeps the source
   * recording's own aspect. */
  outputAspect?: number;
  /** Zoom keyframes driving playback — the *same* array the timeline
   * shows and lets the user move/trim (`SceneRenderer` doesn't generate
   * its own copy internally; see `setZoomKeyframes` for how edits reach
   * the already-constructed motion engine live). */
  zoomKeyframes: ZoomKeyframe[];
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
   * menu's precise click alignment instead of a smoothed approximation. */
  private rawSamples: CursorSample[];
  private events: CursorEvent[];
  private scaleFactor: number;
  private videoAspect: number;
  /** Mirrors `SceneRendererOptions.outputAspect` — kept in sync with the
   * motion engine's own copy (see `setOutputAspect`) since `contentRect`
   * needs it too: the drawn region now has *this* aspect (the viewport's),
   * not the source video's, whenever it's set. */
  private outputAspect: number | undefined;
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

  constructor(opts: SceneRendererOptions) {
    this.scaleFactor = opts.scaleFactor;
    this.videoAspect = opts.frame.width / opts.frame.height;
    this.outputAspect = opts.outputAspect;
    const cursorTrack = shiftCursorTrack(opts.cursorTrack, opts.origin ?? { x: 0, y: 0 });
    // Built directly from the caller's keyframes rather than
    // `createMotionEngine` (which would generate its own, independent
    // copy from the cursor track) — see `SceneRendererOptions.zoomKeyframes`'s
    // doc comment for why there must only ever be one array of these.
    this.motionEngine = new MotionEngine(opts.frame, opts.zoomKeyframes, opts.outputAspect);
    this.smoothedSamples = smoothCursorTrack(cursorTrack.samples);
    this.rawSamples = cursorTrack.samples;
    this.events = cursorTrack.events;
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
   * that slice's time range, rather than replacing it. */
  draw(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    tUs: number,
    style: StyleSettings = DEFAULT_STYLE,
    showCursor = true,
    cursorSettings: CursorSettings = DEFAULT_CURSOR_SETTINGS,
    clipEndTUs = 0,
    sliceCursorOverride: SliceCursorOverride | null = null,
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
    const { viewport } = this.motionEngine.transformAt(tUs, cursor ?? undefined);

    // Real (wall-clock, not video) elapsed time since the last `draw` —
    // the basis for both blur estimates below, so their intensity tracks
    // actual on-screen motion speed regardless of frame rate or playback
    // rate. `null` on the first frame (or right after a seek — see
    // `resetAt`), where there's nothing to compare against yet.
    const nowMs = performance.now();
    const dtMs = this.lastDrawWallClockMs !== null ? Math.max(1, nowMs - this.lastDrawWallClockMs) : null;
    const contentBlurPx = this.contentMotionBlurPx(viewport, dtMs);
    this.lastViewport = viewport;
    this.lastDrawWallClockMs = nowMs;

    // `viewport` is in point space; the video's actual pixels are at
    // `scaleFactor`x that (ARCHITECTURE.md, "Recording format").
    const sx = viewport.x * this.scaleFactor;
    const sy = viewport.y * this.scaleFactor;
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
    // Motion blur during a zoom/pan transition (see the constants at the
    // top of this file) — `ctx.filter` is part of the state `ctx.save()`/
    // `ctx.restore()` already bracket here, so it doesn't need its own
    // manual reset.
    if (contentBlurPx > 0.15) ctx.filter = `blur(${contentBlurPx}px)`;
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
      ctx.strokeStyle = style.insetColor;
      ctx.lineWidth = style.inset;
      ctx.stroke();
      ctx.restore();
    }

    // `cursor` still drives pan above even when the glyph itself is
    // hidden — this flag is purely visual, not a "stop tracking" switch.
    if (!cursor || !showCursor || sliceCursorOverride?.hideCursor) return;
    // Idle-hide checks the *raw* (non-loop-blended) position — a loop
    // blend nudging the cursor a fraction of a pixel per frame shouldn't
    // itself count as "moving".
    if (cursorSettings.hideCursorIfNotMoving && this.isCursorIdleAt(tUs, useRaw)) return;

    const cx = content.x + ((cursor.x - viewport.x) / viewport.width) * content.width;
    const cy = content.y + ((cursor.y - viewport.y) / viewport.height) * content.height;

    // Motion blur/fade for a fast cursor move (see the constants at the
    // top of this file) — in the same *content*/on-screen pixel space the
    // glyph itself is drawn in, so the effect scales with zoom the same
    // way the cursor's apparent speed does (a fast move reads as faster,
    // and blurs more, while zoomed in).
    const { blurPx: cursorBlurPx, alpha: cursorAlpha } = this.cursorMotion(cx, cy, dtMs);
    this.lastCursorRenderPos = { x: cx, y: cy };

    if (cursorSettings.clickEffectEnabled) this.drawClickRipples(ctx, tUs, viewport, content);
    drawCursorGlyph(ctx, cx, cy, this.clickPulseScaleAt(tUs), this.cursorTypeAt(tUs), cursorSettings, cursorBlurPx, cursorAlpha);
  }

  /** Blur radius (px) for the video content this frame, from how much
   * `viewport` (the motion engine's resolved pan/zoom rect) moved/resized
   * since the last `draw` call — see the constants at the top of this
   * file. Zoom (size change) and pan (position change) are both folded
   * in, `Math.log` on the size ratio so zooming in and out contribute
   * symmetrically (a 2x-in and a 2x-out change should blur the same
   * amount, not one being "bigger" than the other by whatever direction
   * the raw ratio happens to point). */
  private contentMotionBlurPx(viewport: Rect, dtMs: number | null): number {
    if (!this.lastViewport || dtMs === null) return 0;
    const scaleChange = Math.abs(Math.log(viewport.width / this.lastViewport.width));
    const panChange = Math.hypot(viewport.x - this.lastViewport.x, viewport.y - this.lastViewport.y) / viewport.width;
    const motionPerMs = (scaleChange + panChange) / dtMs;
    return Math.min(MAX_CONTENT_BLUR_PX, motionPerMs * CONTENT_BLUR_SENSITIVITY);
  }

  /** Blur radius + opacity for the cursor glyph this frame, from how far
   * it moved (in on-screen content pixels) since the last `draw` call —
   * see the constants at the top of this file. */
  private cursorMotion(cx: number, cy: number, dtMs: number | null): { blurPx: number; alpha: number } {
    if (!this.lastCursorRenderPos || dtMs === null) return { blurPx: 0, alpha: 1 };
    const distPx = Math.hypot(cx - this.lastCursorRenderPos.x, cy - this.lastCursorRenderPos.y);
    const speedPerMs = distPx / dtMs;
    const blurPx = Math.min(MAX_CURSOR_BLUR_PX, speedPerMs * CURSOR_BLUR_SENSITIVITY);
    const alpha = Math.max(MIN_CURSOR_ALPHA, 1 - speedPerMs * CURSOR_FADE_SENSITIVITY);
    return { blurPx, alpha };
  }

  /** Video content rect, centered in the canvas and inset by `padding` on
   * all sides while preserving the drawn region's own aspect ratio
   * (padding shrinks the video, it doesn't stretch it) — that's
   * `outputAspect` when set, since the viewport is reframed to match it
   * (see `viewportForKeyframe`), not the source recording's own aspect. */
  private contentRect(canvasWidth: number, canvasHeight: number, padding: number): Rect {
    const aspect = this.outputAspect ?? this.videoAspect;
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
        // `ctx.filter` only applies to subsequent draws, not retroactively
        // — paint the unblurred fill into a scratch canvas first, then
        // composite it back through a filtered drawImage.
        const source = this.backgroundBlurSource ?? document.createElement("canvas");
        source.width = canvasWidth;
        source.height = canvasHeight;
        const sctx = source.getContext("2d");
        if (sctx) this.paintBackgroundFill(sctx, style, canvasWidth, canvasHeight);
        this.backgroundBlurSource = source;

        lctx.filter = `blur(${style.backgroundBlur}px)`;
        lctx.drawImage(source, 0, 0);
        lctx.filter = "none";
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

function roundedRectPath(ctx: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  const { x, y, width: w, height: h } = rect;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Fill/stroke treatment per `CursorSettings.style` — applied to the
 * arrow/dot glyph; the type-specific shapes below (I-beam, resize) just
 * borrow `fill` as a single stroke color, since they're line-art rather
 * than filled shapes. */
const STYLE_PAINT: Record<CursorStyleId, { fill: string | null; stroke: string; strokeWidth: number }> = {
  outline: { fill: "#ffffff", stroke: "rgba(0,0,0,0.55)", strokeWidth: 1.5 },
  thin: { fill: "#ffffff", stroke: "rgba(0,0,0,0.35)", strokeWidth: 0.75 },
  dot: { fill: "#9ca3af", stroke: "rgba(0,0,0,0.3)", strokeWidth: 1 },
  solidBlack: { fill: "#111111", stroke: "rgba(255,255,255,0.25)", strokeWidth: 1 },
  solidGray: { fill: "#6b7280", stroke: "rgba(0,0,0,0.3)", strokeWidth: 1 },
};

function traceArrowPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 22);
  ctx.lineTo(5.5, 17.5);
  ctx.lineTo(9, 25.5);
  ctx.lineTo(12, 24);
  ctx.lineTo(8.7, 16.5);
  ctx.lineTo(15, 16.5);
  ctx.closePath();
}

function traceDotPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(6, 8, 7, 0, Math.PI * 2);
}

/** Classic text-cursor I-beam: a vertical bar with top/bottom serifs. */
function traceIBeamPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(5, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 24);
  ctx.moveTo(-5, 24);
  ctx.lineTo(5, 24);
}

/** A double-headed arrow, horizontal or vertical — window/pane resize. */
function traceResizePath(ctx: CanvasRenderingContext2D, horizontal: boolean): void {
  const len = 13;
  const head = 5;
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(-len, 0);
    ctx.lineTo(len, 0);
    ctx.moveTo(-len + head, -head);
    ctx.lineTo(-len, 0);
    ctx.lineTo(-len + head, head);
    ctx.moveTo(len - head, -head);
    ctx.lineTo(len, 0);
    ctx.lineTo(len - head, head);
  } else {
    ctx.moveTo(0, -len);
    ctx.lineTo(0, len);
    ctx.moveTo(-head, -len + head);
    ctx.lineTo(0, -len);
    ctx.lineTo(head, -len + head);
    ctx.moveTo(-head, len - head);
    ctx.lineTo(0, len);
    ctx.lineTo(head, len - head);
  }
}

/**
 * Redraws a cursor glyph rather than compositing captured pixels
 * (ARCHITECTURE.md, "Cursor rendering") — fixed apparent size regardless
 * of zoom, so it's always legible. `type` (the recorded `CursorType`)
 * picks the base shape unless `settings.alwaysPointerCursor` pins it to
 * the arrow; `settings.style` picks the arrow/dot's paint treatment (the
 * line-art shapes — I-beam, resize — always use the style's `fill` color
 * as a single stroke, since there's nothing to fill).
 */
function drawCursorGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pulseScale: number,
  type: CursorType,
  settings: CursorSettings,
  motionBlurPx = 0,
  alpha = 1,
): void {
  const effectiveType = settings.alwaysPointerCursor ? "arrow" : type;
  const paint = STYLE_PAINT[settings.style];
  const s = (CURSOR_SIZE_PX / 30) * pulseScale * cursorSizeMultiplier(settings.size);

  ctx.save();
  ctx.translate(x, y);
  if (settings.rotationDeg) ctx.rotate((settings.rotationDeg * Math.PI) / 180);
  ctx.scale(s, s);
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.globalAlpha = alpha;
  // `ctx.filter`'s blur radius is in the *current* (already-scaled) user
  // space, same as `ctx.lineWidth` — pre-dividing by `s` here keeps the
  // blur's actual on-screen size matching `motionBlurPx` (computed in
  // unscaled content pixels, see `SceneRenderer.cursorMotion`) regardless
  // of how big the cursor itself is currently drawn.
  if (motionBlurPx > 0.15) ctx.filter = `blur(${motionBlurPx / s}px)`;

  if (effectiveType === "iBeam" || effectiveType === "resizeLeftRight" || effectiveType === "resizeUpDown") {
    if (effectiveType === "iBeam") traceIBeamPath(ctx);
    else traceResizePath(ctx, effectiveType === "resizeLeftRight");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = paint.fill ?? paint.stroke;
    ctx.shadowBlur = 2;
    ctx.stroke();
  } else {
    // arrow, pointingHand, closedHand, other — pointing/closed hand fall
    // back to the arrow shape rather than shipping bespoke (and likely
    // low-quality, hand-drawn) hand iconography for a secondary case.
    if (settings.style === "dot") traceDotPath(ctx);
    else traceArrowPath(ctx);
    ctx.shadowBlur = 3;
    if (paint.fill) {
      ctx.fillStyle = paint.fill;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (paint.strokeWidth > 0) {
      ctx.strokeStyle = paint.stroke;
      ctx.lineWidth = paint.strokeWidth;
      ctx.stroke();
    }
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}
