/**
 * Turns cursor behavior into zoom keyframes. See ARCHITECTURE.md,
 * "Automatic zoom generation", for the full rationale — this is a direct
 * implementation of that six-step algorithm:
 *
 * 1. Find attention anchors (clicks, scroll bursts, typing runs).
 * 2. Cluster anchors that are close in time and space.
 * 3. Turn each cluster into a zoom block, leading the first anchor.
 * 4. Merge/cull blocks that are too short, too close together, or too
 *    frequent — over-zooming is the most common way this kind of tool
 *    feels amateurish.
 * 5. Pick a zoom level from cluster spread and keep the viewport on-screen.
 * 6. Give any long-held block a brief dip back to 1x around its midpoint so
 *    it breathes instead of sitting at one zoom level for the whole hold.
 */

import type { CursorEvent, CursorSample, CursorTrack } from "../bundle/types";

export interface FrameSize {
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZoomKeyframe {
  /** Microseconds, same epoch as CursorTrack. */
  startT: number;
  endT: number;
  level: number;
  center: { x: number; y: number };
  /** "auto" (default): pan continuously trails the live cursor while this
   * keyframe is active (see `MotionEngine.targetAt`). "manual": pan stays
   * fixed at `center`, ignoring the live cursor entirely. */
  panMode: "auto" | "manual";
  /** Skips the spring easing for this keyframe's zoom/pan — snaps
   * straight to the target instead of transitioning into it. */
  instantAnimation: boolean;
  /** Treated as if this keyframe didn't exist — playback stays at 1x
   * frame-center through its time window instead of zooming. */
  disabled: boolean;
  /** 0-100. How hard the viewport is kept fully inside the source frame.
   * 100 (default): never crosses the edge, matching the original
   * behavior. Lower values let the crop drift past the frame edge when
   * `center` is near it, revealing the canvas background in the gap
   * instead of forcing the whole crop back on-frame — see
   * `viewportForKeyframe`. */
  snapToEdges: number;
}

/** Fields every generated/split/merged keyframe gets when nothing more
 * specific overrides them — kept in one place so `generateZoomKeyframes`,
 * `mergeKeyframes`, and `splitKeyframeAt` can't drift out of sync on what
 * "default" means. */
export const DEFAULT_ZOOM_KEYFRAME_EXTRAS = {
  panMode: "auto" as const,
  instantAnimation: false,
  disabled: false,
  snapToEdges: 100,
};

export interface AutoZoomSensitivity {
  /** Multiplies the default anchor-clustering distance/time windows.
   * >1 = fewer, larger zooms ("less zoomy"); <1 = more, tighter zooms.
   * This is the single knob the editor's "Regenerate motion" slider
   * drives (PRD §9) rather than exposing every constant below. */
  factor: number;
}

const BASE = {
  clusterMaxGapUs: 1.2e6,
  clusterMaxDistPx: 300,
  leadUs: 0.4e6,
  trailUs: 0.8e6,
  minDurationUs: 1.2e6,
  mergeGapUs: 0.8e6,
  minCadenceUs: 2.5e6,
  typingGroupGapUs: 0.6e6,
  minZoomLevel: 1.2,
  maxZoomLevel: 3.0,
  // Cluster spread (px) at which zoom bottoms out at 1.4x; below a tight
  // threshold it tops out at 2.0x. Interpolated linearly between.
  tightSpreadPx: 40,
  wideSpreadPx: 400,
  // A keyframe held this long or longer reads as a static "stuck" zoom
  // rather than a deliberate hold, so it gets a brief breathing dip back
  // toward 1x around its midpoint instead of holding one level throughout.
  dipEligibleDurationUs: 6e6,
  dipDurationUs: 1.6e6,
  dipLevel: 1.0,
};

interface Anchor {
  t: number;
  x: number;
  y: number;
}

function nearestSample(samples: CursorSample[], t: number): CursorSample | undefined {
  if (samples.length === 0) return undefined;
  // Samples are chronological; a linear scan is fine at cursor.json sizes
  // (a few hundred KB/minute per ARCHITECTURE.md) and keeps this free of a
  // binary-search off-by-one bug for a one-shot generation pass.
  let closest = samples[0];
  let closestDelta = Math.abs(samples[0].t - t);
  for (const sample of samples) {
    const delta = Math.abs(sample.t - t);
    if (delta < closestDelta) {
      closest = sample;
      closestDelta = delta;
    }
    if (sample.t > t && delta > closestDelta) break;
  }
  return closest;
}

function extractAnchors(track: CursorTrack, sensitivity: number): Anchor[] {
  const anchors: Anchor[] = [];
  const typingGroupGapUs = BASE.typingGroupGapUs * sensitivity;

  let pendingTypingRun: CursorEvent[] = [];
  const flushTypingRun = () => {
    if (pendingTypingRun.length === 0) return;
    const first = pendingTypingRun[0];
    const sample = nearestSample(track.samples, first.t);
    if (sample) anchors.push({ t: first.t, x: sample.x, y: sample.y });
    pendingTypingRun = [];
  };

  for (const event of track.events) {
    if (event.kind === "leftDown" || event.kind === "rightDown") {
      flushTypingRun();
      anchors.push({ t: event.t, x: event.x, y: event.y });
    } else if (event.kind === "scroll") {
      flushTypingRun();
      const sample = nearestSample(track.samples, event.t);
      if (sample) anchors.push({ t: event.t, x: sample.x, y: sample.y });
    } else if (event.kind === "key") {
      const last = pendingTypingRun[pendingTypingRun.length - 1];
      if (last && event.t - last.t > typingGroupGapUs) flushTypingRun();
      pendingTypingRun.push(event);
    }
  }
  flushTypingRun();

  return anchors.sort((a, b) => a.t - b.t);
}

function clusterAnchors(anchors: Anchor[], sensitivity: number): Anchor[][] {
  const maxGapUs = BASE.clusterMaxGapUs * sensitivity;
  const maxDistPx = BASE.clusterMaxDistPx * sensitivity;

  const clusters: Anchor[][] = [];
  for (const anchor of anchors) {
    const current = clusters[clusters.length - 1];
    const last = current?.[current.length - 1];
    const withinGap = last !== undefined && anchor.t - last.t <= maxGapUs;
    const withinDist =
      last !== undefined && Math.hypot(anchor.x - last.x, anchor.y - last.y) <= maxDistPx;

    if (current && withinGap && withinDist) {
      current.push(anchor);
    } else {
      clusters.push([anchor]);
    }
  }
  return clusters;
}

function clusterSpread(cluster: Anchor[]): number {
  let maxDist = 0;
  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      maxDist = Math.max(maxDist, Math.hypot(cluster[i].x - cluster[j].x, cluster[i].y - cluster[j].y));
    }
  }
  return maxDist;
}

function clusterSpreadOnAxis(cluster: Anchor[], axis: "x" | "y"): number {
  let min = Infinity;
  let max = -Infinity;
  for (const a of cluster) {
    const v = axis === "x" ? a.x : a.y;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === Infinity ? 0 : max - min;
}

/** Options that let auto-zoom plan *for the output aspect*, not just the
 * source's. `sourceFrame` is the source frame in point space (the same
 * space the cursor track lives in); `outputAspect` is the target
 * width/height (a vertical 9:16 output of a 16:9 recording, e.g.). */
export interface GenerateZoomOptions {
  sourceFrame?: FrameSize;
  outputAspect?: number;
}

/** Zoom level for one cluster, aspect-aware: for a vertical (narrower)
 * output, the viewport's level-1 width is a fraction of the source width,
 * so the same physical cursor spread fills a bigger fraction of it. The
 * tight/wide thresholds scale down by that fraction and the spread is
 * measured along the *limiting* axis (the one the output viewport shrinks
 * the most) — keeping a cluster of clicks framed in a tall crop instead of
 * blowing up to where the cursor falls off the left/right edge. Same-aspect
 * (or no-aspect) planning is byte-for-byte the old behavior. */
function levelForCluster(
  cluster: Anchor[],
  options?: GenerateZoomOptions,
): number {
  const frame = options?.sourceFrame;
  const aspect = options?.outputAspect;
  if (!frame || !aspect) return levelForSpread(clusterSpread(cluster));

  let targetW = frame.width;
  let targetH = frame.height;
  {
    // Same framing math as `viewportForKeyframe` (base rect at level 1).
    let baseWidth = frame.width;
    let baseHeight = baseWidth / aspect;
    if (baseHeight > frame.height) {
      baseHeight = frame.height;
      baseWidth = baseHeight * aspect;
    }
    targetW = baseWidth;
    targetH = baseHeight;
  }

  const xFraction = targetW / frame.width;
  const yFraction = targetH / frame.height;
  // A same-aspect (or near-same-aspect) output keeps the legacy Euclidean
  // spread → level mapping untouched; only a genuinely narrower output gets
  // the axis-aware re-planning below.
  if (xFraction >= 0.95 && yFraction >= 0.95) {
    return levelForSpread(clusterSpread(cluster));
  }

  const limitFraction = Math.min(xFraction, yFraction);
  const useX = xFraction <= yFraction;
  const spread = useX ? clusterSpreadOnAxis(cluster, "x") : clusterSpreadOnAxis(cluster, "y");
  const tight = BASE.tightSpreadPx * limitFraction;
  const wide = BASE.wideSpreadPx * limitFraction;
  const t = clamp((spread - tight) / (wide - tight), 0, 1);
  const level = 2.0 - t * (2.0 - 1.4);
  return clamp(level, BASE.minZoomLevel, BASE.maxZoomLevel);
}

function levelForSpread(spread: number): number {
  const t = clamp(
    (spread - BASE.tightSpreadPx) / (BASE.wideSpreadPx - BASE.tightSpreadPx),
    0,
    1,
  );
  // Wider cluster -> lower zoom (1.4x), tighter cluster -> higher (2.0x).
  const level = 2.0 - t * (2.0 - 1.4);
  return clamp(level, BASE.minZoomLevel, BASE.maxZoomLevel);
}

function centroid(cluster: Anchor[]): { x: number; y: number } {
  const sum = cluster.reduce((acc, a) => ({ x: acc.x + a.x, y: acc.y + a.y }), { x: 0, y: 0 });
  return { x: sum.x / cluster.length, y: sum.y / cluster.length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mergeKeyframes(a: ZoomKeyframe, b: ZoomKeyframe): ZoomKeyframe {
  const aWeight = a.endT - a.startT;
  const bWeight = b.endT - b.startT;
  const totalWeight = aWeight + bWeight || 1;
  return {
    // Both inputs are always freshly generated (still at their defaults)
    // at the point this runs — merging happens before any editing UI ever
    // sees these keyframes — so keeping `a`'s copy of every per-keyframe
    // override is as good as any other choice here.
    ...a,
    startT: Math.min(a.startT, b.startT),
    endT: Math.max(a.endT, b.endT),
    level: Math.min(a.level, b.level),
    center: {
      x: (a.center.x * aWeight + b.center.x * bWeight) / totalWeight,
      y: (a.center.y * aWeight + b.center.y * bWeight) / totalWeight,
    },
  };
}

/** Splits any keyframe held longer than `dipEligibleDurationUs` into three:
 * the original level, a brief dip to `dipLevel` around the midpoint, then
 * back to the original level — so a long hold breathes instead of sitting
 * at one zoom level for the whole clip. Disabled keyframes are left alone
 * since they're not actually zoomed in. */
function insertMidHoldDips(keyframes: ZoomKeyframe[], sensitivity: number): ZoomKeyframe[] {
  const dipEligibleDurationUs = BASE.dipEligibleDurationUs * sensitivity;
  const dipDurationUs = BASE.dipDurationUs * sensitivity;

  const result: ZoomKeyframe[] = [];
  for (const kf of keyframes) {
    const duration = kf.endT - kf.startT;
    if (kf.disabled || duration < dipEligibleDurationUs) {
      result.push(kf);
      continue;
    }
    const mid = (kf.startT + kf.endT) / 2;
    const dipStart = mid - dipDurationUs / 2;
    const dipEnd = mid + dipDurationUs / 2;
    result.push({ ...kf, endT: dipStart });
    result.push({ ...kf, startT: dipStart, endT: dipEnd, level: BASE.dipLevel });
    result.push({ ...kf, startT: dipEnd });
  }
  return result;
}

/** Generates zoom keyframes from a recording's cursor track. */
export function generateZoomKeyframes(
  track: CursorTrack,
  sensitivity: AutoZoomSensitivity = { factor: 1 },
  options?: GenerateZoomOptions,
): ZoomKeyframe[] {
  const factor = sensitivity.factor;
  const anchors = extractAnchors(track, factor);
  const clusters = clusterAnchors(anchors, factor);

  let keyframes: ZoomKeyframe[] = clusters.map((cluster) => {
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    return {
      startT: Math.max(0, first.t - BASE.leadUs),
      endT: last.t + BASE.trailUs,
      level: levelForCluster(cluster, options),
      center: centroid(cluster),
      ...DEFAULT_ZOOM_KEYFRAME_EXTRAS,
    };
  });

  // Merge and cull (step 4). Iterate to a fixed point: merging two blocks
  // can bring a third within range, and enforcing minimum cadence can
  // itself require another merge pass.
  let changed = true;
  while (changed) {
    changed = false;
    const mergeGapUs = BASE.mergeGapUs * factor;
    const minCadenceUs = BASE.minCadenceUs * factor;

    const merged: ZoomKeyframe[] = [];
    for (const kf of keyframes) {
      const prev = merged[merged.length - 1];
      const gap = prev ? kf.startT - prev.endT : Infinity;
      const cadence = prev ? kf.startT - prev.startT : Infinity;
      if (prev && (gap <= mergeGapUs || cadence < minCadenceUs)) {
        merged[merged.length - 1] = mergeKeyframes(prev, kf);
        changed = true;
      } else {
        merged.push(kf);
      }
    }
    keyframes = merged;
  }

  return insertMidHoldDips(
    keyframes.filter((kf) => kf.endT - kf.startT >= BASE.minDurationUs * factor),
    factor,
  );
}

/**
 * Viewport rect for a zoom keyframe. `outputAspect` (width/height), if
 * given, reframes the viewport to that aspect instead of the source
 * frame's own — the largest same-aspect rect centered in `frame` at level
 * 1, shrinking (still at that aspect) as `level` increases. This is what
 * lets a 16:9 recording export as a 9:16 vertical crop that actually
 * follows the cursor, rather than a 16:9 crop letterboxed inside a taller
 * canvas. Omitted, it falls back to the source frame's own aspect
 * (unchanged pre-existing behavior).
 *
 * `snapToEdges` (`kf.snapToEdges`, 0-100) blends between the raw,
 * un-clamped position (0 — the crop can drift past the frame edge when
 * `center` is near it, letting the renderer's background show through the
 * gap) and fully kept on-frame (100, the original always-on behavior).
 */
export function viewportForKeyframe(
  kf: ZoomKeyframe,
  frame: FrameSize,
  outputAspect?: number,
): Viewport {
  const aspect = outputAspect ?? frame.width / frame.height;
  let baseWidth = frame.width;
  let baseHeight = baseWidth / aspect;
  if (baseHeight > frame.height) {
    baseHeight = frame.height;
    baseWidth = baseHeight * aspect;
  }

  const width = baseWidth / kf.level;
  const height = baseHeight / kf.level;

  const rawX = kf.center.x - width / 2;
  const rawY = kf.center.y - height / 2;
  const clampedX = clamp(rawX, 0, Math.max(0, frame.width - width));
  const clampedY = clamp(rawY, 0, Math.max(0, frame.height - height));

  const snap = clamp((kf.snapToEdges ?? 100) / 100, 0, 1);
  const x = rawX + (clampedX - rawX) * snap;
  const y = rawY + (clampedY - rawY) * snap;

  return { x, y, width, height };
}

/** Splits `keyframes[index]` into two at `atT` (absolute µs, same epoch as
 * `startT`/`endT` — the caller converts from video-relative seconds via
 * `videoStartUs`), both copies keeping the original's level/center/mode/
 * etc. A no-op if `atT` doesn't fall strictly inside that keyframe. */
export function splitKeyframeAt(
  keyframes: ZoomKeyframe[],
  index: number,
  atT: number,
): ZoomKeyframe[] {
  const original = keyframes[index];
  if (!original || atT <= original.startT || atT >= original.endT) return keyframes;
  const first: ZoomKeyframe = { ...original, endT: atT };
  const second: ZoomKeyframe = { ...original, startT: atT };
  return [...keyframes.slice(0, index), first, second, ...keyframes.slice(index + 1)];
}
