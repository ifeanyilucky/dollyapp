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

/** Largest `dt` handed to a single `stepSpring` call — see the comment in
 * `transformAt` for why larger real gaps get sub-stepped instead of
 * passed straight through. */
const MAX_SPRING_STEP_SECONDS = 1 / 30;

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
  /** Width/height of the desired *output* framing — see
   * `viewportForKeyframe`'s doc comment. `undefined` keeps the source
   * frame's own aspect (the pre-aspect-ratio-switcher default). */
  private outputAspect: number | undefined;

  constructor(frame: FrameSize, keyframes: ZoomKeyframe[], outputAspect?: number) {
    this.frame = frame;
    this.keyframes = keyframes;
    this.outputAspect = outputAspect;
    this.levelSpring = { value: 1, velocity: 0 };
    this.centerXSpring = { value: frame.width / 2, velocity: 0 };
    this.centerYSpring = { value: frame.height / 2, velocity: 0 };
  }

  /** Called live when the user switches the output aspect ratio — no
   * spring/keyframe state is reset, so the crop reshapes in place rather
   * than restarting playback's motion. */
  setOutputAspect(aspect: number | undefined): void {
    this.outputAspect = aspect;
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
    // `stepSpring` integrates with explicit Euler, which goes numerically
    // unstable (visible as sudden overshoot/jitter, not a graceful
    // catch-up) if a single step's `dt` gets too large relative to
    // stiffness. A slow/janky render frame — expensive canvas work, a tab
    // switch, a GC pause — otherwise feeds a huge `dt` straight into the
    // spring on the very next tick. Sub-stepping in a bounded chunk size
    // keeps every individual step stable regardless of how choppy the
    // wall-clock gap between calls was.
    const totalDt = Math.min(Math.max((tUs - this.lastT) / 1e6, 0), 2);
    this.lastT = tUs;

    const target = this.targetAt(tUs, livePosition);
    // Pan and zoom now use deliberately different spring stiffness — see
    // PAN_SPRING's doc comment for why sharing one clock stopped being
    // the right call once pan started continuously chasing the live
    // cursor instead of jumping once between two fixed points.
    let remaining = totalDt;
    while (remaining > 0) {
      const step = Math.min(remaining, MAX_SPRING_STEP_SECONDS);
      this.levelSpring = stepSpring(this.levelSpring, target.level, step, ZOOM_LEVEL_SPRING);
      this.centerXSpring = stepSpring(this.centerXSpring, target.center.x, step, PAN_SPRING);
      this.centerYSpring = stepSpring(this.centerYSpring, target.center.y, step, PAN_SPRING);
      remaining -= step;
    }

    const resolved: ZoomKeyframe = {
      startT: 0,
      endT: 0,
      level: this.levelSpring.value,
      center: { x: this.centerXSpring.value, y: this.centerYSpring.value },
    };
    return { viewport: viewportForKeyframe(resolved, this.frame, this.outputAspect) };
  }
}

/** Builds a ready-to-play `MotionEngine` from a raw cursor track — the one
 * call site the editor and export both go through. */
export function createMotionEngine(
  track: CursorTrack,
  frame: FrameSize,
  sensitivity?: AutoZoomSensitivity,
  outputAspect?: number,
): MotionEngine {
  const keyframes = generateZoomKeyframes(track, sensitivity);
  return new MotionEngine(frame, keyframes, outputAspect);
}
