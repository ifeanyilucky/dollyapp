import { describe, expect, it } from "vitest";
import { clampCropRect, fullFrameCrop, isFullFrameCrop, MIN_CROP_SIZE } from "./crop";

describe("clampCropRect", () => {
  it("passes an already-valid rect through unchanged", () => {
    expect(clampCropRect({ x: 10, y: 20, width: 100, height: 80 }, 1920, 1080)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 80,
    });
  });

  it("clamps a rect that overhangs the right/bottom edge", () => {
    expect(clampCropRect({ x: 1900, y: 1070, width: 100, height: 80 }, 1920, 1080)).toEqual({
      x: 1820,
      y: 1000,
      width: 100,
      height: 80,
    });
  });

  it("clamps negative x/y back to 0", () => {
    expect(clampCropRect({ x: -50, y: -30, width: 100, height: 80 }, 1920, 1080)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
  });

  it("never shrinks below MIN_CROP_SIZE", () => {
    const result = clampCropRect({ x: 0, y: 0, width: 2, height: 2 }, 1920, 1080);
    expect(result.width).toBe(MIN_CROP_SIZE);
    expect(result.height).toBe(MIN_CROP_SIZE);
  });

  it("never exceeds the frame even if requested larger", () => {
    const result = clampCropRect({ x: 0, y: 0, width: 5000, height: 5000 }, 1920, 1080);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });
});

describe("isFullFrameCrop", () => {
  it("is true for the full-frame rect", () => {
    expect(isFullFrameCrop(fullFrameCrop(1920, 1080), 1920, 1080)).toBe(true);
  });

  it("is false for anything smaller or offset", () => {
    expect(isFullFrameCrop({ x: 0, y: 0, width: 1000, height: 1080 }, 1920, 1080)).toBe(false);
    expect(isFullFrameCrop({ x: 10, y: 0, width: 1920, height: 1080 }, 1920, 1080)).toBe(false);
  });
});
