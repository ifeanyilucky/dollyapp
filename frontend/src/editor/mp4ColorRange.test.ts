import { describe, expect, it } from "vitest";
import { fixMp4ColorRange } from "./mp4ColorRange";

// A minimal MP4 colour box: [size(4)]['colr'(4)]['nclx'(4)][primaries(2)]
// [transfer(2)][matrix(2)][full_range_flag(1)]. `nclx` sits at offset 8, so
// the flag byte is at offset 18.
function nclxBuffer(fullRangeBit: number): Uint8Array {
  return new Uint8Array([
    0, 0, 0, 0, 99, 111, 108, 114, 110, 99, 108, 120, 0, 1, 0, 13, 0, 1, fullRangeBit,
  ]);
}

describe("fixMp4ColorRange", () => {
  it("clears the full-range flag when set", () => {
    const bytes = nclxBuffer(0x80);
    fixMp4ColorRange(bytes);
    expect(bytes[18]).toBe(0);
  });

  it("leaves the flag alone when it is already cleared", () => {
    const bytes = nclxBuffer(0x00);
    const copy = Uint8Array.from(bytes);
    fixMp4ColorRange(bytes);
    expect(bytes).toEqual(copy);
  });

  it("leaves all other bytes untouched", () => {
    const bytes = nclxBuffer(0x80);
    const copy = Uint8Array.from(bytes);
    fixMp4ColorRange(bytes);
    expect(bytes).toEqual(Uint8Array.from(copy, (v, i) => (i === 18 ? 0 : v)));
  });

  it("clears every nclx box in the file, not just the first", () => {
    const bytes = Uint8Array.from([...nclxBuffer(0x80), ...Array(4).fill(0), ...nclxBuffer(0x80)]);
    fixMp4ColorRange(bytes);
    expect(bytes[18]).toBe(0);
    expect(bytes[18 + nclxBuffer(0x80).length + 4]).toBe(0);
  });

  it("is a no-op when the file has no nclx box (e.g. WebM)", () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
    const copy = Uint8Array.from(bytes);
    fixMp4ColorRange(bytes);
    expect(bytes).toEqual(copy);
  });
});
