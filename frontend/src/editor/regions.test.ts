import { describe, expect, it } from "vitest";
import { addRegion, regionAt, removeRegion } from "./regions";

interface TestRegion {
  id: string;
  startS: number;
  endS: number;
}

describe("addRegion", () => {
  it("adds a non-overlapping region alongside existing ones", () => {
    const existing: TestRegion[] = [{ id: "a", startS: 0, endS: 5 }];
    const result = addRegion(existing, { id: "b", startS: 10, endS: 15 });
    expect(result).toHaveLength(2);
  });

  it("drops any existing region the new one overlaps", () => {
    const existing: TestRegion[] = [
      { id: "a", startS: 0, endS: 5 },
      { id: "b", startS: 10, endS: 15 },
    ];
    const result = addRegion(existing, { id: "c", startS: 3, endS: 12 });
    expect(result).toEqual([{ id: "c", startS: 3, endS: 12 }]);
  });
});

describe("removeRegion", () => {
  it("removes only the matching id", () => {
    const existing: TestRegion[] = [
      { id: "a", startS: 0, endS: 5 },
      { id: "b", startS: 10, endS: 15 },
    ];
    expect(removeRegion(existing, "a")).toEqual([{ id: "b", startS: 10, endS: 15 }]);
  });
});

describe("regionAt", () => {
  const regions: TestRegion[] = [
    { id: "a", startS: 0, endS: 5 },
    { id: "b", startS: 10, endS: 15 },
  ];

  it("finds the region containing t", () => {
    expect(regionAt(regions, 12)?.id).toBe("b");
  });

  it("treats the end as exclusive", () => {
    expect(regionAt(regions, 5)).toBeUndefined();
  });

  it("returns undefined for a gap between regions", () => {
    expect(regionAt(regions, 7)).toBeUndefined();
  });
});
