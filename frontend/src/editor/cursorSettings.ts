import type { CursorType } from "../bundle/types";

/**
 * Cursor customization — PRD §9's cursor panel (size, style, and the
 * behavior toggles below it). `hideCursor` deliberately isn't duplicated
 * here: the editor already has a single `showCursor` boolean (driven by
 * both this panel's "Hide cursor" toggle and the top bar's eye icon), and
 * this settings object doesn't need its own copy of the same thing.
 */

/** The distinct glyph shapes a cursor style can draw. Each `CursorStyleId`
 * maps to one of these (plus a fill/stroke treatment); the line-art shapes
 * are also used when a recorded `CursorType` is a text/beam or resize
 * cursor and the chosen style is pointer-shaped. Drawn around a (0,0)
 * anchor — the hot spot at the recorded pointer position (the arrow and
 * triangle put their tip there; centered shapes like the dot read fine
 * centered, matching the old dot behavior). */
export type CursorGlyphId =
  | "arrow"
  | "dot"
  | "ring"
  | "target"
  | "crosshair"
  | "plus"
  | "triangle"
  | "diamond"
  | "square"
  | "star"
  | "heart"
  | "handPointing"
  | "handGrab"
  | "iBeam"
  | "resizeH"
  | "resizeV";

export interface CursorPaint {
  fill: string | null;
  stroke: string;
  strokeWidth: number;
}

export interface CursorStylePreset {
  id: CursorStyleId;
  label: string;
  glyph: CursorGlyphId;
  fill: string | null;
  stroke: string;
  strokeWidth: number;
}

/** Bounding box (untransformed local coords) of each glyph — used to
 * center the preview swatches in the panel. */
export const CURSOR_GLYPH_BOUNDS: Record<CursorGlyphId, { x: number; y: number; w: number; h: number }> = {
  arrow: { x: 0, y: 0, w: 15, h: 26 },
  dot: { x: -7, y: -7, w: 14, h: 14 },
  ring: { x: -13, y: -13, w: 26, h: 26 },
  target: { x: -12, y: -12, w: 24, h: 24 },
  crosshair: { x: -13, y: -13, w: 26, h: 26 },
  plus: { x: -12, y: -12, w: 24, h: 24 },
  triangle: { x: -2, y: 0, w: 14, h: 10 },
  diamond: { x: -9, y: -9, w: 18, h: 18 },
  square: { x: -9, y: -9, w: 18, h: 18 },
  star: { x: -13, y: -13, w: 26, h: 26 },
  heart: { x: -15, y: -13, w: 30, h: 26 },
  handPointing: { x: -14, y: -15, w: 22, h: 27 },
  handGrab: { x: -12, y: -11, w: 20, h: 21 },
  iBeam: { x: -5, y: 0, w: 10, h: 24 },
  resizeH: { x: -13, y: -5, w: 26, h: 10 },
  resizeV: { x: -5, y: -13, w: 10, h: 26 },
};

export type CursorStyleId =
  | "classic"
  | "thin"
  | "black"
  | "gray"
  | "red"
  | "blue"
  | "green"
  | "white"
  | "dot"
  | "ring"
  | "target"
  | "crosshair"
  | "plus"
  | "triangle"
  | "diamond"
  | "square"
  | "star"
  | "heart"
  | "hand"
  | "grab";

export const CURSOR_STYLE_PRESETS: CursorStylePreset[] = [
  { id: "classic", label: "Classic", glyph: "arrow", fill: "#ffffff", stroke: "rgba(0,0,0,0.55)", strokeWidth: 1.5 },
  { id: "thin", label: "Thin", glyph: "arrow", fill: "#ffffff", stroke: "rgba(0,0,0,0.35)", strokeWidth: 0.75 },
  { id: "black", label: "Solid black", glyph: "arrow", fill: "#111111", stroke: "rgba(255,255,255,0.25)", strokeWidth: 1 },
  { id: "gray", label: "Solid gray", glyph: "arrow", fill: "#6b7280", stroke: "rgba(0,0,0,0.3)", strokeWidth: 1 },
  { id: "red", label: "Red", glyph: "arrow", fill: "#ef4444", stroke: "rgba(0,0,0,0.3)", strokeWidth: 1 },
  { id: "blue", label: "Blue", glyph: "arrow", fill: "#3b82f6", stroke: "rgba(0,0,0,0.3)", strokeWidth: 1 },
  { id: "green", label: "Green", glyph: "arrow", fill: "#22c55e", stroke: "rgba(0,0,0,0.3)", strokeWidth: 1 },
  { id: "white", label: "White", glyph: "arrow", fill: "#ffffff", stroke: "transparent", strokeWidth: 0 },
  { id: "dot", label: "Dot", glyph: "dot", fill: "#9ca3af", stroke: "rgba(0,0,0,0.3)", strokeWidth: 1 },
  { id: "ring", label: "Ring", glyph: "ring", fill: "#ffffff", stroke: "rgba(0,0,0,0.55)", strokeWidth: 2 },
  { id: "target", label: "Target", glyph: "target", fill: "#ef4444", stroke: "#ffffff", strokeWidth: 2 },
  { id: "crosshair", label: "Crosshair", glyph: "crosshair", fill: null, stroke: "#ffffff", strokeWidth: 2 },
  { id: "plus", label: "Plus", glyph: "plus", fill: "#ffffff", stroke: "rgba(0,0,0,0.5)", strokeWidth: 1 },
  { id: "triangle", label: "Triangle", glyph: "triangle", fill: "#ffffff", stroke: "rgba(0,0,0,0.55)", strokeWidth: 1.5 },
  { id: "diamond", label: "Diamond", glyph: "diamond", fill: "#ffffff", stroke: "rgba(0,0,0,0.55)", strokeWidth: 1.5 },
  { id: "square", label: "Square", glyph: "square", fill: "#ffffff", stroke: "rgba(0,0,0,0.55)", strokeWidth: 1.5 },
  { id: "star", label: "Star", glyph: "star", fill: "#fbbf24", stroke: "rgba(0,0,0,0.45)", strokeWidth: 1 },
  { id: "heart", label: "Heart", glyph: "heart", fill: "#f472b6", stroke: "rgba(0,0,0,0.45)", strokeWidth: 1 },
  { id: "hand", label: "Pointing hand", glyph: "handPointing", fill: "#ffffff", stroke: "rgba(0,0,0,0.55)", strokeWidth: 1.5 },
  { id: "grab", label: "Grab hand", glyph: "handGrab", fill: "#ffffff", stroke: "rgba(0,0,0,0.55)", strokeWidth: 1.5 },
];

export function cursorStylePreset(style: CursorStyleId): CursorStylePreset {
  return CURSOR_STYLE_PRESETS.find((p) => p.id === style) ?? CURSOR_STYLE_PRESETS[0];
}

/** The glyph a given style draws for a recorded `CursorType`. The
 * pointer-shaped styles (arrow/dot) stay type-aware: a text-selection
 * I-beam or a resize cursor still renders as its own line-art shape (in
 * the style's color) unless `alwaysPointer` pins it to the arrow. Every
 * other style is a fixed "theme" — picking the pointing hand always shows
 * a hand, etc. */
export function cursorGlyphFor(
  style: CursorStyleId,
  recordedType: CursorType,
  alwaysPointer: boolean,
): CursorGlyphId {
  const glyph = cursorStylePreset(style).glyph;
  if (glyph === "arrow" || glyph === "dot") {
    const type = alwaysPointer ? "arrow" : recordedType;
    if (type === "iBeam") return "iBeam";
    if (type === "resizeLeftRight") return "resizeH";
    if (type === "resizeUpDown") return "resizeV";
  }
  return glyph;
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

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
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
}

function traceRingPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
}

function traceCrosshairPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.lineTo(-4, 0);
  ctx.moveTo(4, 0);
  ctx.lineTo(13, 0);
  ctx.moveTo(0, -13);
  ctx.lineTo(0, -4);
  ctx.moveTo(0, 4);
  ctx.lineTo(0, 13);
}

function tracePlusPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-3, -12);
  ctx.lineTo(3, -12);
  ctx.lineTo(3, -3);
  ctx.lineTo(12, -3);
  ctx.lineTo(12, 3);
  ctx.lineTo(3, 3);
  ctx.lineTo(3, 12);
  ctx.lineTo(-3, 12);
  ctx.lineTo(-3, 3);
  ctx.lineTo(-12, 3);
  ctx.lineTo(-12, -3);
  ctx.lineTo(-3, -3);
  ctx.closePath();
}

function traceTrianglePath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(12, 10);
  ctx.lineTo(-2, 10);
  ctx.closePath();
}

function traceDiamondPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(9, 0);
  ctx.lineTo(0, 9);
  ctx.lineTo(-9, 0);
  ctx.closePath();
}

function traceStarPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 13 : 5.5;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function traceHeartPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, 13);
  ctx.bezierCurveTo(-15, -3, -8, -13, 0, -4);
  ctx.bezierCurveTo(8, -13, 15, -3, 0, 13);
  ctx.closePath();
}

/** Draws a glyph at its natural size around (0,0), applying the preset's
 * fill/stroke treatment. Shared by the live cursor draw (`renderer.ts`) and
 * the panel's preview swatches, so a swatch always matches what actually
 * renders. Handles shadowBlur itself: any shadow the caller sets only lands
 * on fills, never on the stroke. */
export function drawCursorShape(ctx: CanvasRenderingContext2D, glyph: CursorGlyphId, paint: CursorPaint): void {
  const fillAndStroke = (trace: (c: CanvasRenderingContext2D) => void) => {
    trace(ctx);
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
  };

  switch (glyph) {
    case "iBeam":
      ctx.beginPath();
      ctx.moveTo(-5, 0);
      ctx.lineTo(5, 0);
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 24);
      ctx.moveTo(-5, 24);
      ctx.lineTo(5, 24);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = paint.fill ?? paint.stroke;
      ctx.shadowBlur = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      return;
    case "resizeH":
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.lineTo(13, 0);
      ctx.moveTo(-8, -5);
      ctx.lineTo(-13, 0);
      ctx.lineTo(-8, 5);
      ctx.moveTo(8, -5);
      ctx.lineTo(13, 0);
      ctx.lineTo(8, 5);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = paint.fill ?? paint.stroke;
      ctx.shadowBlur = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      return;
    case "resizeV":
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(0, 13);
      ctx.moveTo(-5, -8);
      ctx.lineTo(0, -13);
      ctx.lineTo(5, -8);
      ctx.moveTo(-5, 8);
      ctx.lineTo(0, 13);
      ctx.lineTo(5, 8);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = paint.fill ?? paint.stroke;
      ctx.shadowBlur = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      return;
    case "crosshair":
      traceCrosshairPath(ctx);
      ctx.lineCap = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = paint.stroke;
      ctx.shadowBlur = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      return;
    case "target":
      traceRingPath(ctx);
      ctx.lineWidth = 2;
      ctx.strokeStyle = paint.stroke;
      ctx.shadowBlur = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fillStyle = paint.fill ?? "#ffffff";
      ctx.fill();
      return;
    case "handPointing":
      fillAndStroke(() => roundedRectPath(ctx, -4, -15, 8, 20, 3));
      fillAndStroke(() => roundedRectPath(ctx, -10, 1, 18, 11, 3));
      fillAndStroke(() => roundedRectPath(ctx, -14, -3, 6, 10, 2.5));
      return;
    case "handGrab":
      fillAndStroke(() => roundedRectPath(ctx, -6, -10, 3, 9, 1.5));
      fillAndStroke(() => roundedRectPath(ctx, -2.5, -11, 3, 10, 1.5));
      fillAndStroke(() => roundedRectPath(ctx, 1, -11, 3, 10, 1.5));
      fillAndStroke(() => roundedRectPath(ctx, 4.5, -10, 3, 9, 1.5));
      fillAndStroke(() => roundedRectPath(ctx, -8, -2, 16, 12, 3));
      fillAndStroke(() => roundedRectPath(ctx, -12, 1, 6, 8, 2));
      return;
    case "arrow":
      fillAndStroke(traceArrowPath);
      return;
    case "dot":
      fillAndStroke(traceDotPath);
      return;
    case "ring":
      fillAndStroke(traceRingPath);
      return;
    case "plus":
      fillAndStroke(tracePlusPath);
      return;
    case "triangle":
      fillAndStroke(traceTrianglePath);
      return;
    case "diamond":
      fillAndStroke(traceDiamondPath);
      return;
    case "square":
      fillAndStroke(() => roundedRectPath(ctx, -9, -9, 18, 18, 4));
      return;
    case "star":
      fillAndStroke(traceStarPath);
      return;
    case "heart":
      fillAndStroke(traceHeartPath);
      return;
  }
}

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
  style: "classic",
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
