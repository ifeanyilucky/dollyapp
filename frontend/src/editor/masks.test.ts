import { describe, expect, it } from "vitest";
import { createMask, defaultMaskRange, DEFAULT_MASK_DURATION_S, masksActiveAt, MIN_MASK_SECONDS } from "./masks";

describe("defaultMaskRange", () => {
  it("places a mask of the default duration starting at atS", () => {
    expect(defaultMaskRange(10, 0, 100)).toEqual({ startS: 10, endS: 10 + DEFAULT_MASK_DURATION_S });
  });

  it("clamps so the mask never starts before clipStartS", () => {
    expect(defaultMaskRange(-5, 0, 100)).toEqual({ startS: 0, endS: DEFAULT_MASK_DURATION_S });
  });

  it("clamps so the mask never ends after clipEndS", () => {
    const result = defaultMaskRange(99, 0, 100);
    expect(result.endS).toBe(100);
    expect(result.startS).toBe(100 - DEFAULT_MASK_DURATION_S);
  });

  it("shrinks the default duration (never below MIN_MASK_SECONDS) for a clip shorter than it", () => {
    const result = defaultMaskRange(0.5, 0, 1);
    expect(result.startS).toBe(0);
    expect(result.endS).toBe(1);
  });
});

describe("masksActiveAt", () => {
  const sensitive = createMask(0, 5, "sensitive");
  const highlight = createMask(3, 8, "highlight");
  const disabled = { ...createMask(0, 10, "sensitive"), disabled: true };

  it("returns every mask whose range contains t, not just one", () => {
    expect(masksActiveAt([sensitive, highlight], 4).map((m) => m.id).sort()).toEqual(
      [sensitive.id, highlight.id].sort(),
    );
  });

  it("excludes a mask whose range doesn't contain t", () => {
    expect(masksActiveAt([sensitive], 6)).toEqual([]);
  });

  it("is exclusive of endS (mirrors sliceAt's [start, end) convention)", () => {
    expect(masksActiveAt([sensitive], 5)).toEqual([]);
    expect(masksActiveAt([sensitive], 4.999)).toEqual([sensitive]);
  });

  it("excludes disabled masks even while t is inside their range", () => {
    expect(masksActiveAt([disabled], 5)).toEqual([]);
  });
});

describe("createMask", () => {
  it("defaults to not disabled and DEFAULT_MASK_OPACITY", () => {
    const mask = createMask(0, MIN_MASK_SECONDS, "highlight");
    expect(mask.disabled).toBe(false);
    expect(mask.type).toBe("highlight");
  });

  it("gives each mask a unique id", () => {
    const a = createMask(0, 1, "sensitive");
    const b = createMask(0, 1, "sensitive");
    expect(a.id).not.toBe(b.id);
  });
});
