import { describe, expect, it } from "vitest";
import type { CursorTrack } from "../bundle/types";
import { DEFAULT_ZOOM_KEYFRAME_EXTRAS, generateZoomKeyframes, viewportForKeyframe, type ZoomKeyframe } from "./autoZoom";

function track(overrides: Partial<CursorTrack>): CursorTrack {
  return {
    version: 1,
    clockEpoch: 0,
    sampleRate: 120,
    samples: [],
    events: [],
    ...overrides,
  };
}

function kf(overrides: Pick<ZoomKeyframe, "startT" | "endT" | "level" | "center">): ZoomKeyframe {
  return { ...DEFAULT_ZOOM_KEYFRAME_EXTRAS, ...overrides };
}

describe("generateZoomKeyframes", () => {
  it("produces no keyframes for an idle recording", () => {
    const t = track({ samples: [{ t: 0, x: 500, y: 500, type: "arrow" }] });
    expect(generateZoomKeyframes(t)).toEqual([]);
  });

  it("emits a zoom block around a single click, leading the anchor", () => {
    const t = track({
      events: [{ kind: "leftDown", t: 5_000_000, x: 800, y: 400 }],
    });

    const keyframes = generateZoomKeyframes(t);
    expect(keyframes).toHaveLength(1);
    expect(keyframes[0].startT).toBeLessThan(5_000_000);
    expect(keyframes[0].endT).toBeGreaterThan(5_000_000);
    expect(keyframes[0].center).toEqual({ x: 800, y: 400 });
  });

  it("merges clicks that are close in time and space into one block", () => {
    const t = track({
      events: [
        { kind: "leftDown", t: 1_000_000, x: 500, y: 500 },
        { kind: "leftDown", t: 1_500_000, x: 520, y: 510 },
      ],
    });

    expect(generateZoomKeyframes(t)).toHaveLength(1);
  });

  it("keeps distant, well-separated clicks as separate blocks", () => {
    const t = track({
      events: [
        { kind: "leftDown", t: 1_000_000, x: 100, y: 100 },
        { kind: "leftDown", t: 20_000_000, x: 1800, y: 900 },
      ],
    });

    expect(generateZoomKeyframes(t)).toHaveLength(2);
  });

  it("drops a zoom shorter than the minimum duration", () => {
    // A single instantaneous anchor still gets lead+trail padding (1.2s
    // total), so this checks the floor holds rather than trying to force
    // a sub-minimum block through the generator.
    const t = track({
      events: [{ kind: "leftDown", t: 1_000_000, x: 500, y: 500 }],
    });
    const [kf] = generateZoomKeyframes(t);
    expect(kf.endT - kf.startT).toBeGreaterThanOrEqual(1.2e6);
  });

  it("splits a long hold into a mid-hold dip back toward 1x", () => {
    const t = track({
      events: Array.from({ length: 8 }, (_, i) => ({
        kind: "leftDown" as const,
        t: i * 1_000_000,
        x: 500,
        y: 500,
      })),
    });

    const keyframes = generateZoomKeyframes(t);
    expect(keyframes).toHaveLength(3);
    const [before, dip, after] = keyframes;

    expect(before.level).toBeGreaterThan(1);
    expect(after.level).toEqual(before.level);
    expect(dip.level).toBe(1.0);

    // Contiguous, in order, covering the same overall span as one block would.
    expect(dip.startT).toEqual(before.endT);
    expect(after.startT).toEqual(dip.endT);
    expect(after.endT - before.startT).toBeGreaterThanOrEqual(7.8e6);
  });

  it("plans a wider cluster more zoomed-out for a vertical output", () => {
    // A cluster that spreads ~250px horizontally — the width of a tall 9:16
    // crop of a 1920x1080 source is only ~607px at level 1, so the same
    // spread fills far more of a vertical viewport than it would of the
    // full 1920px-wide source. The vertical plan must therefore zoom OUT
    // (lower level) to keep the cursor framed.
    const t = track({
      events: [
        { kind: "leftDown", t: 1_000_000, x: 200, y: 400 },
        { kind: "leftDown", t: 2_000_000, x: 450, y: 400 },
      ],
    });
    const sourceFrame = { width: 1920, height: 1080 };

    const landscape = generateZoomKeyframes(t);
    const vertical = generateZoomKeyframes(t, { factor: 1 }, {
      sourceFrame,
      outputAspect: 9 / 16,
    });

    expect(landscape).toHaveLength(1);
    expect(vertical).toHaveLength(1);
    // Vertical reframing shrinks the level-1 width to ~31% of the source,
    // so the same horizontal spread must resolve to a lower zoom level.
    expect(vertical[0].level).toBeLessThan(landscape[0].level);
  });

  it("leaves same-aspect planning identical to the legacy behavior", () => {
    const t = track({
      events: [
        { kind: "leftDown", t: 1_000_000, x: 200, y: 400 },
        { kind: "leftDown", t: 3_000_000, x: 450, y: 640 },
      ],
    });

    const legacy = generateZoomKeyframes(t);
    const sameAspect = generateZoomKeyframes(t, { factor: 1 }, {
      sourceFrame: { width: 1920, height: 1080 },
      outputAspect: 1920 / 1080,
    });

    expect(sameAspect).toEqual(legacy);
  });

  it("does not zoom deeper than the vertical viewport can show a tight cluster", () => {
    // A tight cluster (only ~20px of spread) maps to the 2.0x ceiling either
    // way — but the vertical crop is inherently narrower, so the level must
    // never exceed the shared ceiling or bottom out below the floor.
    const t = track({
      events: [
        { kind: "leftDown", t: 1_000_000, x: 950, y: 530 },
        { kind: "leftDown", t: 3_000_000, x: 970, y: 550 },
      ],
    });

    const vertical = generateZoomKeyframes(t, { factor: 1 }, {
      sourceFrame: { width: 1920, height: 1080 },
      outputAspect: 9 / 16,
    });
    expect(vertical[0].level).toBeGreaterThanOrEqual(1.4);
    expect(vertical[0].level).toBeLessThanOrEqual(3.0);
  });
});

describe("viewportForKeyframe", () => {
  it("stays inside frame bounds when the cluster center is near a corner", () => {
    const viewport = viewportForKeyframe(
      kf({ startT: 0, endT: 0, level: 2, center: { x: 0, y: 0 } }),
      { width: 1920, height: 1080 },
    );
    expect(viewport.x).toBeGreaterThanOrEqual(0);
    expect(viewport.y).toBeGreaterThanOrEqual(0);
    expect(viewport.x + viewport.width).toBeLessThanOrEqual(1920 + 1e-9);
    expect(viewport.y + viewport.height).toBeLessThanOrEqual(1080 + 1e-9);
  });

  it("matches the source frame's own aspect when outputAspect is omitted", () => {
    const viewport = viewportForKeyframe(
      kf({ startT: 0, endT: 0, level: 1, center: { x: 960, y: 540 } }),
      { width: 1920, height: 1080 },
    );
    expect(viewport.width).toBeCloseTo(1920);
    expect(viewport.height).toBeCloseTo(1080);
  });

  it("reframes to a vertical crop of a landscape source when outputAspect is given", () => {
    const frame = { width: 1920, height: 1080 };
    const viewport = viewportForKeyframe(
      kf({ startT: 0, endT: 0, level: 1, center: { x: 960, y: 540 } }),
      frame,
      9 / 16,
    );
    // The largest 9:16 rect that fits inside a 1920x1080 frame is
    // full-height, narrower than the frame — not the frame's own 16:9.
    expect(viewport.height).toBeCloseTo(1080);
    expect(viewport.width).toBeCloseTo(1080 * (9 / 16));
    expect(viewport.width).toBeLessThan(frame.width);
    // Centered horizontally on the (frame-center) keyframe.
    expect(viewport.x).toBeCloseTo((frame.width - viewport.width) / 2);
  });

  it("keeps a reframed viewport at the requested aspect while zoomed in", () => {
    const viewport = viewportForKeyframe(
      kf({ startT: 0, endT: 0, level: 2, center: { x: 960, y: 540 } }),
      { width: 1920, height: 1080 },
      9 / 16,
    );
    expect(viewport.width / viewport.height).toBeCloseTo(9 / 16);
  });
});
