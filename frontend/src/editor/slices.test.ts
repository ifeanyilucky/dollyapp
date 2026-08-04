import { describe, expect, it } from "vitest";
import { createSlice, initialSlices, resizeSlices, sliceAt, splitSliceAt } from "./slices";

function slice(startS: number, endS: number) {
  return createSlice(startS, endS);
}

describe("initialSlices", () => {
  it("spans exactly the clip range", () => {
    const slices = initialSlices(2, 10);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ startS: 2, endS: 10 });
  });
});

describe("resizeSlices", () => {
  it("re-anchors the first/last slice to a trim's new edges", () => {
    const slices = resizeSlices([slice(0, 4), slice(4, 8)], 1, 7);
    expect(slices).toHaveLength(2);
    expect(slices[0].startS).toBe(1);
    expect(slices[1].endS).toBe(7);
  });

  it("keeps coverage contiguous when a trim would make an edge slice sub-minimum", () => {
    // Trim the start so close to the second slice that the first slice
    // would shrink below MIN_SLICE_SECONDS — it must be dropped and the
    // surviving first slice re-anchored to the new clip start, not leave a
    // gap where sliceAt returns undefined.
    const slices = resizeSlices([slice(0, 4), slice(4, 8)], 3.95, 8);
    expect(slices).toHaveLength(1);
    expect(slices[0].startS).toBe(3.95);
    expect(slices[0].endS).toBe(8);
    expect(sliceAt(slices, 3.95)).toBeDefined();
  });

  it("keeps coverage contiguous when a trim would make the last slice sub-minimum", () => {
    const slices = resizeSlices([slice(0, 4), slice(4, 8)], 0, 4.05);
    expect(slices).toHaveLength(1);
    expect(slices[0].startS).toBe(0);
    expect(slices[0].endS).toBe(4.05);
    expect(sliceAt(slices, 4.0)).toBeDefined();
  });

  it("preserves interior boundaries", () => {
    const slices = resizeSlices([slice(0, 2), slice(2, 4), slice(4, 6)], 0, 6);
    expect(slices.map((s) => s.startS)).toEqual([0, 2, 4]);
  });

  it("returns a single slice covering the whole clip when everything collapses", () => {
    const slices = resizeSlices([slice(0, 2), slice(2, 4)], 0.5, 0.6);
    expect(slices).toHaveLength(1);
    expect(slices[0].startS).toBe(0.5);
    expect(slices[0].endS).toBe(0.6);
  });
});

describe("splitSliceAt", () => {
  it("splits the containing slice into two covering the same range", () => {
    const slices = splitSliceAt([slice(0, 10)], 4);
    expect(slices).toHaveLength(2);
    expect(slices[0].endS).toBe(4);
    expect(slices[1].startS).toBe(4);
  });

  it("is a no-op too close to an existing boundary", () => {
    expect(splitSliceAt([slice(0, 10)], 0.05)).toHaveLength(1);
    expect(splitSliceAt([slice(0, 10)], 9.95)).toHaveLength(1);
  });

  it("preserves speed/removed/cursorOverride on both halves", () => {
    const original = { ...slice(0, 10), speed: 1.6, removed: false };
    const [first, second] = splitSliceAt([original], 5);
    expect(first.speed).toBe(1.6);
    expect(second.speed).toBe(1.6);
    expect(first.id).not.toBe(second.id);
  });
});

describe("sliceAt", () => {
  it("is inclusive of startS and exclusive of endS", () => {
    const slices = [slice(0, 4), slice(4, 8)];
    expect(sliceAt(slices, 0)?.startS).toBe(0);
    expect(sliceAt(slices, 4)?.startS).toBe(4);
    expect(sliceAt(slices, 8)).toBeUndefined();
  });
});
