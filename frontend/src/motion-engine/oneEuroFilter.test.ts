import { describe, expect, it } from "vitest";
import { OneEuroFilter } from "./oneEuroFilter";

describe("OneEuroFilter", () => {
  it("smooths jitter around a held-still position", () => {
    const filter = new OneEuroFilter();
    const noise = [0, 1, -1, 0.5, -0.5, 0, 1, -1, 0.5, -0.5];
    let maxDeviation = 0;

    noise.forEach((n, i) => {
      const y = filter.filter(100 + n, i / 120);
      maxDeviation = Math.max(maxDeviation, Math.abs(y - 100));
    });

    // Raw noise swings +/-1; the filter should compress that meaningfully.
    expect(maxDeviation).toBeLessThan(1);
  });

  it("tracks a fast, steady sweep with bounded lag", () => {
    const filter = new OneEuroFilter();
    const dt = 1 / 120;
    let lastY = 0;

    for (let i = 0; i < 240; i++) {
      const t = i * dt;
      const x = t * 1000; // 1000 px/s sweep
      lastY = filter.filter(x, t);
    }

    const finalX = 240 * dt * 1000;
    // Should be catching up to the sweep, not stuck far behind it.
    expect(finalX - lastY).toBeLessThan(50);
  });
});
