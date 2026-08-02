/**
 * Turns cursor behavior into zoom keyframes. See ARCHITECTURE.md,
 * "Automatic zoom generation", for the full rationale — this is a direct
 * implementation of that five-step algorithm:
 *
 * 1. Find attention anchors (clicks, scroll bursts, typing runs).
 * 2. Cluster anchors that are close in time and space.
 * 3. Turn each cluster into a zoom block, leading the first anchor.
 * 4. Merge/cull blocks that are too short, too close together, or too
 *    frequent — over-zooming is the most common way this kind of tool
 *    feels amateurish.
 * 5. Pick a zoom level from cluster spread and keep the viewport on-screen.
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
}

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
    startT: Math.min(a.startT, b.startT),
    endT: Math.max(a.endT, b.endT),
    level: Math.min(a.level, b.level),
    center: {
      x: (a.center.x * aWeight + b.center.x * bWeight) / totalWeight,
      y: (a.center.y * aWeight + b.center.y * bWeight) / totalWeight,
    },
  };
}

/** Generates zoom keyframes from a recording's cursor track. */
export function generateZoomKeyframes(
  track: CursorTrack,
  sensitivity: AutoZoomSensitivity = { factor: 1 },
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
      level: levelForSpread(clusterSpread(cluster)),
      center: centroid(cluster),
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

  return keyframes.filter((kf) => kf.endT - kf.startT >= BASE.minDurationUs * factor);
}

/**
 * Viewport rect for a zoom keyframe, kept inside frame bounds — the pan
 * never crosses the screen edge, even for a cluster centered near a
 * corner. `outputAspect` (width/height), if given, reframes the viewport
 * to that aspect instead of the source frame's own — the largest
 * same-aspect rect centered in `frame` at level 1, shrinking (still at
 * that aspect) as `level` increases. This is what lets a 16:9 recording
 * export as a 9:16 vertical crop that actually follows the cursor, rather
 * than a 16:9 crop letterboxed inside a taller canvas. Omitted, it falls
 * back to the source frame's own aspect (unchanged pre-existing
 * behavior).
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

  const x = clamp(kf.center.x - width / 2, 0, Math.max(0, frame.width - width));
  const y = clamp(kf.center.y - height / 2, 0, Math.max(0, frame.height - height));

  return { x, y, width, height };
}
