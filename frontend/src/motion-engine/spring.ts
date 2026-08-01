/**
 * Critically damped spring, used for zoom/pan transitions instead of a
 * cubic bezier. Springs settle without overshoot and their duration scales
 * naturally with distance — a small adjustment finishes fast, a large one
 * takes longer, matching what the eye expects. See ARCHITECTURE.md,
 * "Easing".
 */

export interface SpringParams {
  stiffness: number;
  /** `2 * sqrt(stiffness)` is critical damping — no overshoot, fastest
   * settle time without bounce. Pass a different value deliberately only
   * if underdamped bounce is ever wanted for a specific interaction. */
  damping: number;
}

export function criticallyDamped(stiffness: number): SpringParams {
  return { stiffness, damping: 2 * Math.sqrt(stiffness) };
}

/** Default used by zoom/pan transitions (ARCHITECTURE.md). */
export const DEFAULT_SPRING = criticallyDamped(120);

export interface SpringState {
  value: number;
  velocity: number;
}

/**
 * Advances a spring toward `target` by `dt` seconds. Pan and zoom each get
 * their own `SpringState` but should be stepped with the same `dt` on the
 * same clock tick so they arrive together (ARCHITECTURE.md).
 */
export function stepSpring(
  state: SpringState,
  target: number,
  dt: number,
  params: SpringParams = DEFAULT_SPRING,
): SpringState {
  const { stiffness, damping } = params;
  const displacement = state.value - target;
  const springForce = -stiffness * displacement;
  const dampingForce = -damping * state.velocity;
  const acceleration = springForce + dampingForce;

  const velocity = state.velocity + acceleration * dt;
  const value = state.value + velocity * dt;

  return { value, velocity };
}

/** True once the spring is close enough to target and slow enough to snap. */
export function springSettled(
  state: SpringState,
  target: number,
  valueEpsilon = 0.001,
  velocityEpsilon = 0.001,
): boolean {
  return Math.abs(state.value - target) < valueEpsilon && Math.abs(state.velocity) < velocityEpsilon;
}
