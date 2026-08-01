/**
 * 1€ filter (Casiez, Roussel, Vogel — CHI 2012). Smooths a noisy scalar
 * signal with a cutoff frequency that adapts to speed: aggressive smoothing
 * while the signal is nearly still (hand tremor, sensor noise), low lag
 * while it's moving fast. That's exactly the shape cursor motion needs —
 * see ARCHITECTURE.md, "The motion engine".
 *
 * One instance filters one scalar; use two (x, y) for a 2D cursor path.
 */

export interface OneEuroFilterParams {
  /** Lower = smoother when the signal is nearly still. */
  minCutoff: number;
  /** Higher = less lag when the signal is moving fast. */
  beta: number;
  /** Cutoff for the derivative estimate; rarely needs tuning. */
  dCutoff: number;
}

/** Starting point from ARCHITECTURE.md, tune by eye from here. */
export const DEFAULT_ONE_EURO_PARAMS: OneEuroFilterParams = {
  minCutoff: 1.0,
  beta: 0.007,
  dCutoff: 1.0,
};

function lowPassAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

class LowPassFilter {
  private hasValue = false;
  private value = 0;

  filter(x: number, alpha: number): number {
    this.value = this.hasValue ? alpha * x + (1 - alpha) * this.value : x;
    this.hasValue = true;
    return this.value;
  }

  get last(): number {
    return this.value;
  }
}

export class OneEuroFilter {
  private params: OneEuroFilterParams;
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastX: number | null = null;
  private lastT: number | null = null;

  constructor(params: OneEuroFilterParams = DEFAULT_ONE_EURO_PARAMS) {
    this.params = params;
  }

  setParams(params: OneEuroFilterParams): void {
    this.params = params;
  }

  /** `t` is seconds (fractional). Call with strictly increasing `t`. */
  filter(x: number, t: number): number {
    const dt = this.lastT === null ? 1 / 120 : Math.max(t - this.lastT, 1e-6);
    this.lastT = t;

    const dx = this.lastX === null ? 0 : (x - this.lastX) / dt;
    this.lastX = x;
    const dxHat = this.dxFilter.filter(dx, lowPassAlpha(this.params.dCutoff, dt));

    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(dxHat);
    return this.xFilter.filter(x, lowPassAlpha(cutoff, dt));
  }
}

/** Convenience wrapper filtering an (x, y) pair with matched parameters. */
export class OneEuroFilter2D {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(params: OneEuroFilterParams = DEFAULT_ONE_EURO_PARAMS) {
    this.fx = new OneEuroFilter(params);
    this.fy = new OneEuroFilter(params);
  }

  setParams(params: OneEuroFilterParams): void {
    this.fx.setParams(params);
    this.fy.setParams(params);
  }

  filter(x: number, y: number, t: number): { x: number; y: number } {
    return { x: this.fx.filter(x, t), y: this.fy.filter(y, t) };
  }
}
