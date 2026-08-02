import { describe, expect, it } from "vitest";
import { historyReducer, type HistoryState } from "./history";

function initial<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [], pendingSnapshot: null };
}

describe("historyReducer", () => {
  it("set pushes the previous value and clears future", () => {
    let s = initial(1);
    s = historyReducer(s, { type: "set", updater: 2 });
    expect(s).toEqual({ past: [1], present: 2, future: [], pendingSnapshot: null });
  });

  it("set is a no-op when the updater returns the same value", () => {
    const s = initial(1);
    const next = historyReducer(s, { type: "set", updater: (p) => p });
    expect(next).toBe(s);
  });

  it("undo moves present into future and restores the last past value", () => {
    let s = initial(1);
    s = historyReducer(s, { type: "set", updater: 2 });
    s = historyReducer(s, { type: "set", updater: 3 });
    s = historyReducer(s, { type: "undo" });
    expect(s).toEqual({ past: [1], present: 2, future: [3], pendingSnapshot: null });
  });

  it("undo with empty past is a no-op", () => {
    const s = initial(1);
    expect(historyReducer(s, { type: "undo" })).toBe(s);
  });

  it("redo moves the next future value back into present", () => {
    let s = initial(1);
    s = historyReducer(s, { type: "set", updater: 2 });
    s = historyReducer(s, { type: "undo" });
    s = historyReducer(s, { type: "redo" });
    expect(s).toEqual({ past: [1], present: 2, future: [], pendingSnapshot: null });
  });

  it("redo with empty future is a no-op", () => {
    const s = initial(1);
    expect(historyReducer(s, { type: "redo" })).toBe(s);
  });

  it("a new set after undo discards the redo future", () => {
    let s = initial(1);
    s = historyReducer(s, { type: "set", updater: 2 });
    s = historyReducer(s, { type: "undo" });
    s = historyReducer(s, { type: "set", updater: 5 });
    expect(s).toEqual({ past: [1], present: 5, future: [], pendingSnapshot: null });
  });

  it("a drag (many setTransient calls) collapses into a single undo step on commit", () => {
    let s = initial(0);
    s = historyReducer(s, { type: "setTransient", updater: 1 });
    s = historyReducer(s, { type: "setTransient", updater: 2 });
    s = historyReducer(s, { type: "setTransient", updater: 3 });
    expect(s.present).toBe(3);
    expect(s.past).toEqual([]); // nothing committed yet
    s = historyReducer(s, { type: "commit" });
    expect(s).toEqual({ past: [0], present: 3, future: [], pendingSnapshot: null });
    // A single undo now returns all the way to the pre-drag value, not to
    // an intermediate one.
    s = historyReducer(s, { type: "undo" });
    expect(s.present).toBe(0);
  });

  it("commit with nothing pending is a no-op", () => {
    const s = initial(1);
    expect(historyReducer(s, { type: "commit" })).toBe(s);
  });

  it("commit after a no-op setTransient (same value) is still a no-op", () => {
    let s = initial(1);
    s = historyReducer(s, { type: "setTransient", updater: (p) => p });
    expect(historyReducer(s, { type: "commit" })).toBe(s);
  });

  it("patch merges fields without creating an undo step", () => {
    let s = initial({ a: 1, b: 2 });
    s = historyReducer(s, { type: "patch", patch: { b: 99 } });
    expect(s).toEqual({ past: [], present: { a: 1, b: 99 }, future: [], pendingSnapshot: null });
  });

  it("undo discards any in-progress (uncommitted) transient snapshot", () => {
    let s = initial(1);
    s = historyReducer(s, { type: "set", updater: 2 });
    s = historyReducer(s, { type: "setTransient", updater: 3 }); // uncommitted drag in progress
    s = historyReducer(s, { type: "undo" });
    expect(s.pendingSnapshot).toBeNull();
    expect(s.present).toBe(1);
  });
});
