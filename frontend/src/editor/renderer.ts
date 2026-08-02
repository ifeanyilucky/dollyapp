import type { CursorEvent, CursorSample, CursorTrack } from "../bundle/types";
import { createMotionEngine, smoothCursorTrack, type FrameSize, type MotionEngine } from "../motion-engine";
import { DEFAULT_STYLE, type StyleSettings } from "./style";

const CLICK_PULSE_DURATION_US = 220_000;
const CLICK_RIPPLE_DURATION_US = 500_000;
/** Fixed apparent size, independent of zoom level — the whole point of
 * redrawing the cursor rather than relying on captured pixels
 * (ARCHITECTURE.md, "Cursor rendering"). Big and readable, per the intent
 * of a screen-recording tool whose entire pitch is legibility. */
const CURSOR_SIZE_PX = 34;

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
  private events: CursorEvent[];
  private scaleFactor: number;
  private videoAspect: number;
  // `shadowBlur` is one of the more expensive things Canvas2D can do —
  // recomputing a full-size blurred rect every frame was enough to make
  // rendering janky, which fed directly into spring instability (a slow
  // frame means a large `dt` on the next `transformAt` call). The content
  // rect + shadow style only change on a style edit or resize, not every
  // frame, so the blurred shadow is rendered once into an offscreen
  // canvas and just blitted (cheap) after that.
  private shadowLayer: HTMLCanvasElement | null = null;
  private shadowLayerKey = "";

  constructor(opts: SceneRendererOptions) {
    this.scaleFactor = opts.scaleFactor;
    this.videoAspect = opts.frame.width / opts.frame.height;
    this.motionEngine = createMotionEngine(opts.cursorTrack, opts.frame);
    this.smoothedSamples = smoothCursorTrack(opts.cursorTrack.samples);
    this.events = opts.cursorTrack.events;
  }

  /** Call after a scrub/seek so the next `draw` doesn't treat the jump as
   * elapsed playback time (see `MotionEngine.reset`). */
  resetAt(tUs: number): void {
    this.motionEngine.reset(tUs);
  }

  /** `tUs`: microseconds since the recording's clock epoch — see
   * `RecordingMeta.videoStartUs` for how to derive this from a `<video>`
   * element's `currentTime`. */
  draw(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    tUs: number,
    style: StyleSettings = DEFAULT_STYLE,
  ): void {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const content = this.contentRect(canvas.width, canvas.height, style.padding);

    const cursor = this.cursorPositionAt(tUs);
    // Live cursor position drives pan while a zoom is active (see
    // ARCHITECTURE.md, "Pan follows the live cursor") — computed before
    // `transformAt` so it can be passed straight in.
    const { viewport } = this.motionEngine.transformAt(tUs, cursor ?? undefined);

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

    if (!cursor) return;

    const cx = content.x + ((cursor.x - viewport.x) / viewport.width) * content.width;
    const cy = content.y + ((cursor.y - viewport.y) / viewport.height) * content.height;

    this.drawClickRipples(ctx, tUs, viewport, content);
    drawCursorGlyph(ctx, cx, cy, this.clickPulseScaleAt(tUs));
  }

  /** Video content rect, centered in the canvas and inset by `padding` on
   * all sides while preserving the recording's own aspect ratio (padding
   * shrinks the video, it doesn't stretch it). */
  private contentRect(canvasWidth: number, canvasHeight: number, padding: number): Rect {
    const availWidth = Math.max(canvasWidth - padding * 2, 1);
    const availHeight = Math.max(canvasHeight - padding * 2, 1);

    let width = availWidth;
    let height = width / this.videoAspect;
    if (height > availHeight) {
      height = availHeight;
      width = height * this.videoAspect;
    }

    return { x: (canvasWidth - width) / 2, y: (canvasHeight - height) / 2, width, height };
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

  private cursorPositionAt(tUs: number): { x: number; y: number } | null {
    const samples = this.smoothedSamples;
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

/** A simplified macOS-arrow-like pointer path, filled white with a dark
 * outline so it reads on any background. Not a real `NSCursor` asset (see
 * ARCHITECTURE.md's note that those still need shipping per-type) — this
 * is the placeholder that's actually visible and animated in the
 * meantime. */
function drawCursorGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const s = (CURSOR_SIZE_PX / 30) * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 22);
  ctx.lineTo(5.5, 17.5);
  ctx.lineTo(9, 25.5);
  ctx.lineTo(12, 24);
  ctx.lineTo(8.7, 16.5);
  ctx.lineTo(15, 16.5);
  ctx.closePath();

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#00000090";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 3;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();

  ctx.restore();
}
