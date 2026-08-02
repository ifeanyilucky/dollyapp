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

describe("MotionEngine.setKeyframes", () => {
  it("a keyframe added after construction takes effect on the next transformAt", () => {
    const engine = new MotionEngine(FRAME, []);
    // Idle — no keyframe covers t=1s yet, so level stays at 1x.
    expect(stepFor(engine, 1).viewport.width).toBeCloseTo(FRAME.width, 0);

    engine.setKeyframes([{ startT: 0, endT: 5_000_000, level: 2, center: { x: 960, y: 540 } }]);
    const level = FRAME.width / stepFor(engine, 3).viewport.width;
    expect(level).toBeGreaterThan(1.5);
  });

  it("shortening a keyframe's window (a timeline trim) takes effect on the same, already-running engine", () => {
    const engine = new MotionEngine(FRAME, [
      { startT: 0, endT: 5_000_000, level: 2, center: { x: 960, y: 540 } },
    ]);
    // Settle into the zoom.
    stepFor(engine, 2);
    const zoomedLevel = FRAME.width / engine.transformAt(2_000_000).viewport.width;
    expect(zoomedLevel).toBeGreaterThan(1.5);

    // Trim the keyframe so it now ends *before* the current time (2s) —
    // simulating a timeline edit shortening it while playback is already
    // past the new end. No `reset()` — this must apply live.
    engine.setKeyframes([{ startT: 0, endT: 1_000_000, level: 2, center: { x: 960, y: 540 } }]);

    let t = 2_000_000;
    let level = zoomedLevel;
    for (let i = 0; i < 200; i++) {
      t += 16_000;
      level = FRAME.width / engine.transformAt(t).viewport.width;
    }
    expect(level).toBeLessThan(zoomedLevel);
    expect(level).toBeCloseTo(1, 0);
  });
});

describe("MotionEngine stability under large/janky dt", () => {
  it("a single huge dt (simulating a dropped-frame hitch) doesn't overshoot past the target", () => {
    const keyframes: ZoomKeyframe[] = [
      { startT: 0, endT: 5_000_000, level: 3, center: { x: 960, y: 540 } },
    ];
    const engine = new MotionEngine(FRAME, keyframes);
    // First tick establishes lastT; second tick simulates a huge stall
    // (e.g. an expensive render or tab switch) before the next frame.
    engine.transformAt(0);
    const { viewport } = engine.transformAt(2_000_000); // 2s gap in one step

    // Un-clamped explicit-Euler at this stiffness would overshoot the
    // target level wildly (springing past 3x and oscillating). With
    // sub-stepping it should land at or very near the settled target.
    const level = FRAME.width / viewport.width;
    expect(level).toBeGreaterThan(0.9);
    expect(level).toBeLessThanOrEqual(3.05);
  });

  it("repeated jittery dt (alternating tiny and large steps) never explodes the viewport", () => {
    const keyframes: ZoomKeyframe[] = [
      { startT: 0, endT: 5_000_000, level: 2.5, center: { x: 960, y: 540 } },
    ];
    const engine = new MotionEngine(FRAME, keyframes);
    let t = 0;
    for (let i = 0; i < 50; i++) {
      // Alternate a normal 16ms frame with an occasional 500ms hitch.
      t += i % 5 === 0 ? 500_000 : 16_000;
      const { viewport } = engine.transformAt(t, { x: 960, y: 540 });
      expect(Number.isFinite(viewport.x)).toBe(true);
      expect(Number.isFinite(viewport.width)).toBe(true);
      expect(viewport.width).toBeGreaterThan(0);
      expect(viewport.height).toBeGreaterThan(0);
      // A finite, positive, on-frame viewport at every single tick is the
      // actual regression check — explicit-Euler blowup shows up as
      // negative/absurd sizes or NaN long before it shows up as "looks
      // glitchy" to a human.
      expect(viewport.x).toBeGreaterThanOrEqual(-1e-6);
      expect(viewport.y).toBeGreaterThanOrEqual(-1e-6);
      expect(viewport.x + viewport.width).toBeLessThanOrEqual(FRAME.width + 1e-6);
      expect(viewport.y + viewport.height).toBeLessThanOrEqual(FRAME.height + 1e-6);
    }
  });
});
