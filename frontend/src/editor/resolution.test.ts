import { describe, expect, it } from "vitest";
import { computeOutputSize, resolutionAvailable, RESOLUTION_PRESETS } from "./resolution";

describe("computeOutputSize", () => {
  it("caps a landscape 16:9 output at the tier's conventional WxH", () => {
    // A source well above 1080p, so nothing here is source-clamped.
    const { width, height } = computeOutputSize(1920, 3840, 2160, 16 / 9);
    expect(width).toBe(1920);
    expect(height).toBe(1080);
  });

  it("caps a portrait 9:16 output at the tier's conventional (rotated) WxH", () => {
    const { width, height } = computeOutputSize(1920, 3840, 2160, 9 / 16);
    expect(height).toBe(1920);
    expect(width).toBe(1080);
  });

  it("caps a square output evenly on both edges", () => {
    const { width, height } = computeOutputSize(1920, 3840, 2160, 1);
    expect(width).toBe(1920);
    expect(height).toBe(1920);
  });

  it("never upscales past the source, even below the requested tier", () => {
    // Source smaller than the 1080p tier in both dimensions.
    const { width, height } = computeOutputSize(1920, 1280, 720, 16 / 9);
    expect(width).toBe(1280);
    expect(height).toBe(720);
  });

  it("clamps to source height for a portrait source shorter than the tier", () => {
    const { width, height } = computeOutputSize(1920, 1080, 1500, 9 / 16);
    expect(height).toBe(1500);
    expect(width).toBe(Math.round(1500 * (9 / 16)));
  });
});

describe("resolutionAvailable", () => {
  const preset1080p = RESOLUTION_PRESETS.find((p) => p.id === "1080p")!;
  const preset2160p = RESOLUTION_PRESETS.find((p) => p.id === "2160p")!;

  it("is available when the source's longest edge covers the tier", () => {
    expect(resolutionAvailable(preset1080p, 1920, 1080)).toBe(true);
  });

  it("is unavailable when the source can't reach the tier in either dimension", () => {
    expect(resolutionAvailable(preset2160p, 1920, 1080)).toBe(false);
  });

  it("is available for a portrait source whose height alone covers the tier", () => {
    expect(resolutionAvailable(preset1080p, 1080, 1920)).toBe(true);
  });
});
