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

/** Zoom *level* transitions (in/out) — deliberately slower than pan for a
 * cinematic, unhurried feel. Settle time scales with distance either way
 * (that's the whole point of a spring over a fixed-duration easing curve),
 * this just sets the pace. */
export const ZOOM_LEVEL_SPRING = criticallyDamped(40);

/** Pan (viewport center) while a zoom is active now continuously chases
 * the live cursor position rather than jumping once between two fixed
 * points (see `MotionEngine.targetAt`) — stiffer than the zoom-level
 * spring so it stays responsive enough to keep the cursor comfortably
 * inside the cropped viewport instead of trailing it off-frame. */
export const PAN_SPRING = criticallyDamped(90);

/** The Animations panel's "Screen animation style" — picks which pan/zoom
 * spring stiffness `MotionEngine` steps with (see its `setScreenAnimationStyle`).
 * `focused` is exactly today's tuned defaults above (quick to stabilize, easy
 * to follow); `smooth` is deliberately looser on both, for a slower, more
 * cinematic drift instead of snapping to a stop. */
export type ScreenAnimationStyle = "focused" | "smooth";

export const SCREEN_ANIMATION_SPRINGS: Record<ScreenAnimationStyle, { pan: SpringParams; zoomLevel: SpringParams }> = {
  focused: { pan: PAN_SPRING, zoomLevel: ZOOM_LEVEL_SPRING },
  smooth: { pan: criticallyDamped(42), zoomLevel: criticallyDamped(18) },
};

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
