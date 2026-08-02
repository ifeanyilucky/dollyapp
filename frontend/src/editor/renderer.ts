import type { CursorEvent, CursorSample, CursorTrack } from "../bundle/types";
import { createMotionEngine, smoothCursorTrack, type FrameSize, type MotionEngine } from "../motion-engine";

const CLICK_PULSE_DURATION_US = 220_000;
const CLICK_RIPPLE_DURATION_US = 500_000;
/** Fixed apparent size, independent of zoom level — the whole point of
 * redrawing the cursor rather than relying on captured pixels
 * (ARCHITECTURE.md, "Cursor rendering"). Big and readable, per the intent
 * of a screen-recording tool whose entire pitch is legibility. */
const CURSOR_SIZE_PX = 34;

export interface SceneRendererOptions {
  /** Display size in *points*, not pixels — matches the space
   * `cursorTrack` coordinates are already in. */
  frame: FrameSize;
  scaleFactor: number;
  cursorTrack: CursorTrack;
}

/**
 * Renders one frame of the preview: crops/pans the video per the motion
 * engine's resolved viewport, then draws a smoothed, animated cursor on
 * top. This is the "live preview" half of ARCHITECTURE.md's "preview and
 * export must never diverge" rule — export (not built yet) will read
 * transforms from the same `motion-engine` module, just driven from Rust
 * instead of a canvas loop.
 */
export class SceneRenderer {
  private motionEngine: MotionEngine;
  private smoothedSamples: CursorSample[];
  private events: CursorEvent[];
  private scaleFactor: number;

  constructor(opts: SceneRendererOptions) {
    this.scaleFactor = opts.scaleFactor;
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
  draw(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, tUs: number): void {
    const canvas = ctx.canvas;
    const { viewport } = this.motionEngine.transformAt(tUs);

    // `viewport` is in point space; the video's actual pixels are at
    // `scaleFactor`x that (ARCHITECTURE.md, "Recording format").
    const sx = viewport.x * this.scaleFactor;
    const sy = viewport.y * this.scaleFactor;
    const sw = viewport.width * this.scaleFactor;
    const sh = viewport.height * this.scaleFactor;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const cursor = this.cursorPositionAt(tUs);
    if (!cursor) return;

    const cx = ((cursor.x - viewport.x) / viewport.width) * canvas.width;
    const cy = ((cursor.y - viewport.y) / viewport.height) * canvas.height;

    this.drawClickRipples(ctx, tUs, viewport, canvas);
    drawCursorGlyph(ctx, cx, cy, this.clickPulseScaleAt(tUs));
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
    canvas: HTMLCanvasElement,
  ): void {
    for (const event of this.events) {
      if (event.kind !== "leftDown" && event.kind !== "rightDown") continue;
      const age = tUs - event.t;
      if (age < 0 || age > CLICK_RIPPLE_DURATION_US) continue;

      const f = age / CLICK_RIPPLE_DURATION_US;
      const cx = ((event.x - viewport.x) / viewport.width) * canvas.width;
      const cy = ((event.y - viewport.y) / viewport.height) * canvas.height;
      const radius = CURSOR_SIZE_PX * 0.4 + f * CURSOR_SIZE_PX * 1.2;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${(1 - f) * 0.8})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
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
