/**
 * Public surface of the motion engine. This module is imported by both the
 * live WebGL preview and (via a values handoff, not a JS-in-Rust call) the
 * Rust export pipeline — they must never diverge. See ARCHITECTURE.md.
 */

export * from "./oneEuroFilter";
export * from "./spring";
export * from "./autoZoom";

import type { CursorSample, CursorTrack } from "../bundle/types";
import { DEFAULT_ONE_EURO_PARAMS, OneEuroFilter2D, type OneEuroFilterParams } from "./oneEuroFilter";
import { PAN_SPRING, stepSpring, ZOOM_LEVEL_SPRING, type SpringState } from "./spring";
import {
  generateZoomKeyframes,
  viewportForKeyframe,
  type AutoZoomSensitivity,
  type FrameSize,
  type Viewport,
  type ZoomKeyframe,
} from "./autoZoom";

/** Cursor position smoothed for rendering (ARCHITECTURE.md, "Cursor
 * rendering") — a separate concern from the zoom viewport, which is driven
 * by keyframe centers, not raw cursor position. */
export function smoothCursorTrack(
  samples: CursorSample[],
  params: OneEuroFilterParams = DEFAULT_ONE_EURO_PARAMS,
): CursorSample[] {
  const filter = new OneEuroFilter2D(params);
  return samples.map((sample) => {
    const { x, y } = filter.filter(sample.x, sample.y, sample.t / 1e6);
    return { ...sample, x, y };
  });
}

export interface FrameTransform {
  viewport: Viewport;
}

/**
 * Resolves a per-frame viewport transform from zoom keyframes, springing
 * toward whichever keyframe is active at each queried time. Stateful and
 * expects monotonically increasing `t` — both the preview scrubber and the
 * export renderer call it that way (a seek resets it, see `reset()`).
 */
export class MotionEngine {
  private frame: FrameSize;
  private keyframes: ZoomKeyframe[];
  private levelSpring: SpringState;
  private centerXSpring: SpringState;
  private centerYSpring: SpringState;
  private lastT = 0;

  constructor(frame: FrameSize, keyframes: ZoomKeyframe[]) {
    this.frame = frame;
    this.keyframes = keyframes;
    this.levelSpring = { value: 1, velocity: 0 };
    this.centerXSpring = { value: frame.width / 2, velocity: 0 };
    this.centerYSpring = { value: frame.height / 2, velocity: 0 };
  }

  /** Call after a scrub/seek so the next `transformAt` doesn't treat the
   * jump as elapsed playback time. */
  reset(atT = 0): void {
    this.lastT = atT;
  }

  private targetAt(
    tUs: number,
    livePosition?: { x: number; y: number },
  ): { level: number; center: { x: number; y: number } } {
    const active = this.keyframes.find((kf) => tUs >= kf.startT && tUs <= kf.endT);
    if (active) {
      // The keyframe decides *when* to zoom and *how far*; while it's
      // active, pan continuously trails the live cursor instead of
      // holding at the cluster's fixed centroid — a static hold reads as
      // "zoomed near the action," a live follow reads as "focused on the
      // action," which is the actual ask. Falls back to the keyframe's
      // own center if no live position is available (e.g. export frames
      // that don't carry it — see viewportForKeyframe's clamping, which
      // still keeps this on-frame either way).
      return { level: active.level, center: livePosition ?? active.center };
    }
    return { level: 1, center: { x: this.frame.width / 2, y: this.frame.height / 2 } };
  }

  /** `tUs`: microseconds since the recording's clock epoch, matching
   * `CursorTrack` timestamps. `livePosition` (point space, same as
   * `CursorTrack` samples): the smoothed cursor position at `tUs`, used as
   * the pan target while a zoom is active — see `targetAt`. */
  transformAt(tUs: number, livePosition?: { x: number; y: number }): FrameTransform {
    const dt = Math.max((tUs - this.lastT) / 1e6, 0);
    this.lastT = tUs;

    const target = this.targetAt(tUs, livePosition);
    // Pan and zoom now use deliberately different spring stiffness — see
    // PAN_SPRING's doc comment for why sharing one clock stopped being
    // the right call once pan started continuously chasing the live
    // cursor instead of jumping once between two fixed points.
    this.levelSpring = stepSpring(this.levelSpring, target.level, dt, ZOOM_LEVEL_SPRING);
    this.centerXSpring = stepSpring(this.centerXSpring, target.center.x, dt, PAN_SPRING);
    this.centerYSpring = stepSpring(this.centerYSpring, target.center.y, dt, PAN_SPRING);

    const resolved: ZoomKeyframe = {
      startT: 0,
      endT: 0,
      level: this.levelSpring.value,
      center: { x: this.centerXSpring.value, y: this.centerYSpring.value },
    };
    return { viewport: viewportForKeyframe(resolved, this.frame) };
  }
}

/** Builds a ready-to-play `MotionEngine` from a raw cursor track — the one
 * call site the editor and export both go through. */
export function createMotionEngine(
  track: CursorTrack,
  frame: FrameSize,
  sensitivity?: AutoZoomSensitivity,
): MotionEngine {
  const keyframes = generateZoomKeyframes(track, sensitivity);
  return new MotionEngine(frame, keyframes);
}
