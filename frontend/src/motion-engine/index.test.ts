import { describe, expect, it } from "vitest";
import { MotionEngine } from "./index";
import type { ZoomKeyframe } from "./autoZoom";

const FRAME = { width: 1920, height: 1080 };

function stepFor(engine: MotionEngine, seconds: number, dtMs = 16, livePosition?: { x: number; y: number }) {
  let t = 0;
  let last;
  while (t <= seconds * 1e6) {
    last = engine.transformAt(t, livePosition);
    t += dtMs * 1000;
  }
  return last!;
}

describe("MotionEngine pan-follows-cursor", () => {
  it("while idle (no active keyframe), centers on the frame regardless of live position", () => {
    const engine = new MotionEngine(FRAME, []);
    const { viewport } = stepFor(engine, 1, 16, { x: 100, y: 100 });
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;
    expect(centerX).toBeCloseTo(FRAME.width / 2, 0);
    expect(centerY).toBeCloseTo(FRAME.height / 2, 0);
  });

  it("while a zoom is active, pan converges on the live cursor position, not the keyframe's fixed center", () => {
    const keyframes: ZoomKeyframe[] = [
      { startT: 0, endT: 5_000_000, level: 2, center: { x: 500, y: 500 } },
    ];
    const engine = new MotionEngine(FRAME, keyframes);
    // Live cursor is far from the keyframe's own `center` — after enough
    // time to settle, the viewport should be centered on the cursor.
    const livePosition = { x: 1400, y: 800 };
    const { viewport } = stepFor(engine, 2, 16, livePosition);

    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;
    expect(centerX).toBeCloseTo(livePosition.x, -1);
    expect(centerY).toBeCloseTo(livePosition.y, -1);
  });

  it("falls back to the keyframe's own center when no live position is supplied", () => {
    const keyframes: ZoomKeyframe[] = [
      { startT: 0, endT: 5_000_000, level: 2, center: { x: 600, y: 300 } },
    ];
    const engine = new MotionEngine(FRAME, keyframes);
    const { viewport } = stepFor(engine, 2, 16, undefined);

    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;
    expect(centerX).toBeCloseTo(600, -1);
    expect(centerY).toBeCloseTo(300, -1);
  });

  it("a moving live cursor keeps the pan trailing it smoothly, staying within the frame", () => {
    const keyframes: ZoomKeyframe[] = [
      { startT: 0, endT: 5_000_000, level: 2.5, center: { x: 960, y: 540 } },
    ];
    const engine = new MotionEngine(FRAME, keyframes);
    let t = 0;
    let lastViewport;
    // Sweep the cursor across the frame; the viewport should track along
    // without ever producing an out-of-bounds crop rect.
    while (t <= 3_000_000) {
      const cursor = { x: 200 + (t / 3_000_000) * 1500, y: 540 };
      const { viewport } = engine.transformAt(t, cursor);
      expect(viewport.x).toBeGreaterThanOrEqual(0);
      expect(viewport.y).toBeGreaterThanOrEqual(0);
      expect(viewport.x + viewport.width).toBeLessThanOrEqual(FRAME.width + 1e-6);
      expect(viewport.y + viewport.height).toBeLessThanOrEqual(FRAME.height + 1e-6);
      lastViewport = viewport;
      t += 16_000;
    }
    expect(lastViewport).toBeDefined();
  });
});
