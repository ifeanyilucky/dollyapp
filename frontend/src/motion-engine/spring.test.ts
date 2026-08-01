import { describe, expect, it } from "vitest";
import { criticallyDamped, springSettled, stepSpring, type SpringState } from "./spring";

describe("stepSpring", () => {
  it("is critically damped: no overshoot past the target", () => {
    let state: SpringState = { value: 0, velocity: 0 };
    const params = criticallyDamped(120);
    let maxValue = 0;

    for (let i = 0; i < 600; i++) {
      state = stepSpring(state, 1, 1 / 60, params);
      maxValue = Math.max(maxValue, state.value);
    }

    expect(maxValue).toBeLessThanOrEqual(1.001);
  });

  it("converges to the target and settles", () => {
    let state: SpringState = { value: 0, velocity: 0 };
    const params = criticallyDamped(120);

    for (let i = 0; i < 600; i++) {
      state = stepSpring(state, 5, 1 / 60, params);
    }

    expect(state.value).toBeCloseTo(5, 2);
    expect(springSettled(state, 5)).toBe(true);
  });

  it("a larger jump takes longer to settle than a smaller one", () => {
    const params = criticallyDamped(120);
    const dt = 1 / 60;

    const stepsToSettle = (target: number): number => {
      let state: SpringState = { value: 0, velocity: 0 };
      for (let i = 0; i < 10_000; i++) {
        state = stepSpring(state, target, dt, params);
        if (springSettled(state, target)) return i;
      }
      throw new Error("did not settle");
    };

    expect(stepsToSettle(10)).toBeGreaterThan(stepsToSettle(1));
  });
});
