import { Minus, Pause, Play, Plus, Scissors, SkipBack, SkipForward } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ZoomKeyframe } from "../motion-engine";
import type { MaskClip } from "./masks";
import { ResolutionPicker } from "./ResolutionPicker";
import type { ResolutionId } from "./resolution";
import type { ClipSlice } from "./slices";
import { formatTime } from "./time";

/** Picks a tick spacing that keeps ~8 labeled ticks *within whatever's
 * currently visible*, not across the whole clip — at higher `zoomLevel`
 * the visible window is a smaller fraction of the total duration, so ticks
 * get proportionally finer (down to tenths of a second) rather than just
 * spreading the same handful of ticks further apart. */
function pickTickInterval(duration: number, zoomLevel: number): number {
  const target = duration / zoomLevel / 8;
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s >= target) ?? steps[steps.length - 1];
}

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function clampS(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** `formatTime` (shared, second-precision) isn't fine enough once ticks or
 * a live drag are showing tenths of a second — used only here, not for the
 * transport clock/tooltips elsewhere, so nothing else picks up decimals
 * that weren't asked for. */
function formatTimeFine(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

const MIN_DRAG_SECONDS = 0.15;
/** A pointer that moved less than this (px) between down and up counts as
 * a click/select rather than a drag — lets the zoom track's move-handle
 * double as its select-handle without a separate gesture. */
const CLICK_MOVE_THRESHOLD_PX = 4;
/** How close (px, in *current on-screen* track pixels — so effectively
 * finer in time the more zoomed in the timeline is) a dragged edge needs
 * to land next to a candidate before it snaps to it. */
const SNAP_THRESHOLD_PX = 8;

const MIN_ZOOM_LEVEL = 1;
const MAX_ZOOM_LEVEL = 8;

/** The zoom and mask tracks are "accordion" rows: compact by default (a
 * slim overview strip) and only grow to their full, comfortably-editable
 * height while actually being worked on (hovered, or holding the current
 * selection) — see `zoomFocused`/`maskFocused` below. Whichever one isn't
 * currently focused compacts to make room, so at most one of the two is
 * ever expanded at a time. The slice/clip track is deliberately not part
 * of this — it's the primary track and always stays at its own fixed
 * height. */
const TRACK_HEIGHT_COMPACT_PX = 14;
const TRACK_HEIGHT_NORMAL_PX = 36;

/** Which handle is being dragged right now — drives the grabbing/col-resize
 * cursor and keeps the white trim lines visible while a trim drag is in
 * flight even if the pointer strays off the element. */
type ActiveDrag =
  | { kind: "zoom-move" | "zoom-trim-left" | "zoom-trim-right"; index: number }
  | { kind: "video-trim-left" | "video-trim-right" }
  | { kind: "mask-move" | "mask-trim-left" | "mask-trim-right"; id: string };

export function Timeline({
  duration,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
  onPreviewSeek,
  zoomKeyframes,
  videoStartUs,
  clipStartS,
  clipEndS,
  onTrimVideoClip,
  onChangeZoomKeyframes,
  onCommitChange,
  slices,
  onSplitClip,
  onSelectSlice,
  selectedSliceId,
  onSplitZoomKeyframe,
  onSelectZoomKeyframe,
  selectedZoomIndex,
  masks,
  onChangeMasks,
  onSelectMask,
  selectedMaskId,
  resolution,
  onChangeResolution,
  sourceWidthPx,
  sourceHeightPx,
}: {
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  /** Live scrub-hover preview — called continuously while the mouse moves
   * over the track (not a commit; pairs with `onSeek`, which fires only on
   * an actual click) and with `null` when the mouse leaves the track,
   * meaning "revert to showing the actual committed position." */
  onPreviewSeek: (seconds: number | null) => void;
  /** Absolute `t` (microseconds since clockEpoch), same as `cursor.json` —
   * converted to video-relative seconds internally via `videoStartUs`. */
  zoomKeyframes: ZoomKeyframe[];
  videoStartUs: number;
  /** Effective in/out of the whole clip (video-relative seconds) — the
   * amber bar's trimmed range. */
  clipStartS: number;
  clipEndS: number;
  /** Live update, called continuously while dragging a trim handle — pairs
   * with `onCommitChange` below. */
  onTrimVideoClip: (startS: number, endS: number) => void;
  /** Live update, called continuously while dragging a zoom keyframe (move
   * or trim) — pairs with `onCommitChange` below. */
  onChangeZoomKeyframes: (keyframes: ZoomKeyframe[]) => void;
  /** Turns whatever's accumulated since the last commit into a single undo
   * step (see `history.ts`) — called once per drag, on release, from
   * `beginDrag`'s `handleEnd`, regardless of which drag kind it was. A
   * no-op if the drag never actually changed anything (a plain click),
   * since the history hook itself no-ops a commit with nothing pending. */
  onCommitChange: () => void;
  slices: ClipSlice[];
  onSplitClip: (atS: number) => void;
  onSelectSlice: (id: string) => void;
  /** Which slice is currently selected (`SliceEditorPanel` showing, if
   * any) — highlights that block on the timeline so the selection is
   * visible without having to look at the sidebar. */
  selectedSliceId: string | null;
  onSplitZoomKeyframe: (index: number, atT: number) => void;
  onSelectZoomKeyframe: (index: number) => void;
  /** Which zoom keyframe is currently selected — see `selectedSliceId`.
   * Also keeps the zoom track expanded to its normal height even after the
   * mouse moves away, for as long as its editor panel stays open. */
  selectedZoomIndex: number | null;
  masks: MaskClip[];
  /** Live update, called continuously while dragging a mask clip (move or
   * trim) — pairs with `onCommitChange` below, same as
   * `onChangeZoomKeyframes`. */
  onChangeMasks: (masks: MaskClip[]) => void;
  onSelectMask: (id: string) => void;
  /** Which mask is currently selected — see `selectedZoomIndex`. */
  selectedMaskId: string | null;
  /** Output resolution — see `ResolutionPicker`'s doc comment for why this
   * lives next to the split/scissors button and also drives `exportVideo`,
   * not just the preview. */
  resolution: ResolutionId;
  onChangeResolution: (id: ResolutionId) => void;
  /** The source recording's native pixels — disables any tier
   * `ResolutionPicker` couldn't actually reach without upscaling. */
  sourceWidthPx: number;
  sourceHeightPx: number;
}) {
  const [splitArmed, setSplitArmed] = useState(false);
  const [hoverS, setHoverS] = useState<number | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  // Which of the two "accordion" tracks the mouse is currently over — see
  // the `TRACK_HEIGHT_*` doc comment. Mid-drag, the track actually being
  // dragged always wins regardless of hover (a drag that briefly strays a
  // pixel outside the row's own bounds shouldn't cause it to collapse out
  // from under the pointer).
  const [hoveredTrack, setHoveredTrack] = useState<"zoom" | "mask" | null>(null);
  // A snapped-to position, while dragging — drawn as a highlighted guide
  // line distinct from the playhead/hover-scrub lines, and cleared as soon
  // as the drag ends (see `beginDrag`'s `handleEnd`). `null` means either
  // nothing's being dragged, or it is but it hasn't snapped to anything.
  const [snapAtS, setSnapAtS] = useState<number | null>(null);
  // A floating time readout that follows whatever's being dragged (trim
  // handle or whole-block move) — `pct` positions it horizontally, `text`
  // is the already-formatted value(s). Professional NLEs all show this;
  // without it, a drag only has the block's own (often too-narrow-to-read)
  // width to go on for exactly where an edge landed.
  const [dragLabel, setDragLabel] = useState<{ pct: number; text: string } | null>(null);
  // Horizontal timeline zoom — 1 means "fit the available width" (the only
  // level that existed before this), up to `MAX_ZOOM_LEVEL`x wider for
  // frame-level precision on a long recording. `trackRef` (the actual
  // ruler+tracks content) grows to `zoomLevel * 100%` width inside
  // `scrollRef` (a plain `overflow-x-auto` viewport) — every existing
  // percentage-based position (ticks, clips, playhead, ...) keeps working
  // unchanged, since percentages resolve against `trackRef`'s own box
  // regardless of how wide that box actually renders.
  const [zoomLevel, setZoomLevel] = useState(1);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Set by `handleWheelZoom` right before a zoom-level change, read back by
  // the `useLayoutEffect` below right after — lets Ctrl/Cmd+wheel zoom
  // "toward the cursor" (the same time position stays under the pointer)
  // instead of always zooming from the left edge.
  const zoomAnchorRef = useRef<{ atS: number; clientX: number } | null>(null);

  const zoomDragging = activeDrag?.kind.startsWith("zoom") ?? false;
  const maskDragging = activeDrag?.kind.startsWith("mask") ?? false;
  // Hover takes priority (it's the more immediate "what am I about to touch
  // right now" signal); once the mouse isn't over either track, falls back
  // to reflecting the current selection, so a selected zoom/mask keyframe's
  // track stays expanded — and the other one stays out of its way — for as
  // long as its editor panel is open, not just while the mouse happens to
  // be resting on it.
  const zoomSelected = selectedZoomIndex !== null;
  const maskSelected = selectedMaskId !== null;
  const zoomFocused =
    zoomDragging || (!maskDragging && (hoveredTrack === "zoom" || (hoveredTrack !== "mask" && zoomSelected)));
  const maskFocused =
    maskDragging || (!zoomDragging && (hoveredTrack === "mask" || (hoveredTrack !== "zoom" && maskSelected)));

  const safeDuration = duration > 0 ? duration : 1;
  const tickInterval = pickTickInterval(safeDuration, zoomLevel);
  const ticks: number[] = [];
  for (let t = 0; t <= safeDuration; t += tickInterval) ticks.push(t);
  const playheadPct = clampPct((currentTime / safeDuration) * 100);

  function secondsAtClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return frac * safeDuration;
  }

  /** Snaps a single dragged-edge `target` (seconds) to the nearest of
   * `candidates` within `SNAP_THRESHOLD_PX` of the current (zoom-aware)
   * track width — otherwise returns `target` unchanged. Sets/clears
   * `snapAtS` as a side effect so the guide line tracks whatever the
   * caller ends up using. */
  function snapEdge(target: number, candidates: number[]): number {
    const trackWidth = trackRef.current?.getBoundingClientRect().width;
    if (!trackWidth) return target;
    const thresholdS = (SNAP_THRESHOLD_PX / trackWidth) * safeDuration;
    let best = target;
    let bestDist = thresholdS;
    for (const c of candidates) {
      const d = Math.abs(target - c);
      if (d <= bestDist) {
        bestDist = d;
        best = c;
      }
    }
    setSnapAtS(best !== target ? best : null);
    return best;
  }

  /** Same idea as `snapEdge`, but for a whole-block *move*: snaps whichever
   * of the block's two edges (start or end) lands closest to a candidate,
   * returning the adjusted *start* so the block's own duration is
   * preserved. */
  function snapMoveStart(rawStart: number, durS: number, candidates: number[]): number {
    const trackWidth = trackRef.current?.getBoundingClientRect().width;
    if (!trackWidth) return rawStart;
    const thresholdS = (SNAP_THRESHOLD_PX / trackWidth) * safeDuration;
    let best = rawStart;
    let bestDist = thresholdS;
    let bestGuide = rawStart;
    for (const c of candidates) {
      const dStart = Math.abs(rawStart - c);
      if (dStart <= bestDist) {
        bestDist = dStart;
        best = c;
        bestGuide = c;
      }
      const dEnd = Math.abs(rawStart + durS - c);
      if (dEnd <= bestDist) {
        bestDist = dEnd;
        best = c - durS;
        bestGuide = c;
      }
    }
    setSnapAtS(best !== rawStart ? bestGuide : null);
    return best;
  }

  /** Every zoom keyframe's start/end (video-relative seconds), skipping
   * `excludeIndex` — a snap candidate list for dragging a *different* zoom
   * keyframe, a mask, or the clip trim handles. */
  function zoomEdgeCandidates(excludeIndex?: number): number[] {
    const edges: number[] = [];
    zoomKeyframes.forEach((kf, i) => {
      if (i === excludeIndex) return;
      edges.push((kf.startT - videoStartUs) / 1e6, (kf.endT - videoStartUs) / 1e6);
    });
    return edges;
  }

  /** Every mask's start/end, skipping `excludeId` — see
   * `zoomEdgeCandidates`. */
  function maskEdgeCandidates(excludeId?: string): number[] {
    const edges: number[] = [];
    masks.forEach((m) => {
      if (m.id === excludeId) return;
      edges.push(m.startS, m.endS);
    });
    return edges;
  }

  function handleTrackMouseMove(e: React.MouseEvent) {
    // Don't fight an in-progress trim/move/playhead drag with a
    // scrub-preview seek.
    if (activeDrag || isDraggingPlayhead) return;
    const s = secondsAtClientX(e.clientX);
    setHoverS(s);
    // Live scrub preview — the canvas shows exactly the frame under the
    // cursor, whether that's to line up a split or just to look around —
    // without moving the actual, committed playhead (that only happens on
    // click, via `onSeek` in `handleTrackClick`/`handleSliceClick`).
    onPreviewSeek(s);
  }

  function handleTrackMouseLeave() {
    setHoverS(null);
    // Revert the preview back to showing the actual committed position.
    onPreviewSeek(null);
  }

  /** Fires for clicks on the ruler or any empty gap between zoom
   * keyframes — slices and zoom keyframes handle (and stop propagation
   * for) their own clicks below, this is the scrub-to-here fallback for
   * everywhere else on the track. */
  function handleTrackClick(e: React.MouseEvent) {
    if (splitArmed) return;
    onSeek(secondsAtClientX(e.clientX));
  }

  /**
   * Starts a drag on `e.currentTarget` using native Pointer Capture
   * instead of `window`-level mouse listeners — every subsequent
   * `pointermove`/`pointerup` for this gesture is routed *directly* to
   * that element regardless of what's under the cursor as it moves, so
   * two drags started from two different handles can never cross-talk.
   * `onMove` receives the total horizontal delta since the press, in
   * seconds; `onClick` (if given) fires instead, once, on release, when
   * the pointer barely moved — lets a "move" handle double as a "select"
   * click without a separate gesture.
   */
  function beginDrag(
    e: React.PointerEvent<HTMLDivElement>,
    kind: ActiveDrag,
    onMove: (deltaS: number) => void,
    onClick?: () => void,
  ) {
    if (splitArmed) return;
    const trackWidth = trackRef.current?.getBoundingClientRect().width;
    if (!trackWidth) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    target.setPointerCapture(pointerId);
    setActiveDrag(kind);
    let maxMoved = 0;

    const handleMove = (ev: PointerEvent) => {
      maxMoved = Math.max(maxMoved, Math.abs(ev.clientX - startX));
      onMove(((ev.clientX - startX) / trackWidth) * safeDuration);
    };
    const handleEnd = () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleEnd);
      target.removeEventListener("pointercancel", handleEnd);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      setActiveDrag(null);
      setSnapAtS(null);
      setDragLabel(null);
      if (onClick && maxMoved < CLICK_MOVE_THRESHOLD_PX) onClick();
      // Collapses every `onMove` call from this drag into one undo step —
      // harmless to call even for a plain click that never moved (no
      // `onMove` ever fired, so there's nothing pending to commit).
      onCommitChange();
    };
    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleEnd);
    target.addEventListener("pointercancel", handleEnd);
  }

  function handlePlayheadPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    target.setPointerCapture(pointerId);
    setIsDraggingPlayhead(true);

    const handleMove = (ev: PointerEvent) => onSeek(secondsAtClientX(ev.clientX));
    const handleEnd = () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleEnd);
      target.removeEventListener("pointercancel", handleEnd);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      setIsDraggingPlayhead(false);
    };
    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleEnd);
    target.addEventListener("pointercancel", handleEnd);
  }

  function commitZoom(index: number, startS: number, endS: number) {
    onChangeZoomKeyframes(
      zoomKeyframes.map((k, i) =>
        i === index ? { ...k, startT: Math.round(startS * 1e6 + videoStartUs), endT: Math.round(endS * 1e6 + videoStartUs) } : k,
      ),
    );
  }

  function handleZoomMove(e: React.PointerEvent<HTMLDivElement>, kf: ZoomKeyframe, index: number) {
    const origStartS = (kf.startT - videoStartUs) / 1e6;
    const durS = (kf.endT - kf.startT) / 1e6;
    // Captured now (not read from `e` inside the click callback below,
    // which fires later, after the event object may have been reused/
    // cleared by React) — a "click" barely moved from this position by
    // definition (see `CLICK_MOVE_THRESHOLD_PX`), so it's a fine stand-in
    // for the actual pointerup position.
    const clickX = e.clientX;
    beginDrag(
      e,
      { kind: "zoom-move", index },
      (deltaS) => {
        const raw = clampS(origStartS + deltaS, 0, safeDuration - durS);
        const candidates = [0, safeDuration, clipStartS, clipEndS, currentTime, ...zoomEdgeCandidates(index), ...maskEdgeCandidates()];
        const snapped = clampS(snapMoveStart(raw, durS, candidates), 0, safeDuration - durS);
        commitZoom(index, snapped, snapped + durS);
        setDragLabel({
          pct: ((snapped + durS / 2) / safeDuration) * 100,
          text: `${formatTimeFine(snapped)} – ${formatTimeFine(snapped + durS)}`,
        });
      },
      () => {
        onSeek(secondsAtClientX(clickX));
        onSelectZoomKeyframe(index);
      },
    );
  }

  function handleZoomTrim(e: React.PointerEvent<HTMLDivElement>, kf: ZoomKeyframe, index: number, edge: "left" | "right") {
    const origStartS = (kf.startT - videoStartUs) / 1e6;
    const origEndS = (kf.endT - videoStartUs) / 1e6;
    beginDrag(e, { kind: edge === "left" ? "zoom-trim-left" : "zoom-trim-right", index }, (deltaS) => {
      if (edge === "left") {
        const raw = clampS(origStartS + deltaS, 0, origEndS - MIN_DRAG_SECONDS);
        const candidates = [0, clipStartS, currentTime, ...zoomEdgeCandidates(index), ...maskEdgeCandidates()];
        const snapped = clampS(snapEdge(raw, candidates), 0, origEndS - MIN_DRAG_SECONDS);
        commitZoom(index, snapped, origEndS);
        setDragLabel({ pct: (snapped / safeDuration) * 100, text: formatTimeFine(snapped) });
      } else {
        const raw = clampS(origEndS + deltaS, origStartS + MIN_DRAG_SECONDS, safeDuration);
        const candidates = [safeDuration, clipEndS, currentTime, ...zoomEdgeCandidates(index), ...maskEdgeCandidates()];
        const snapped = clampS(snapEdge(raw, candidates), origStartS + MIN_DRAG_SECONDS, safeDuration);
        commitZoom(index, origStartS, snapped);
        setDragLabel({ pct: (snapped / safeDuration) * 100, text: formatTimeFine(snapped) });
      }
    });
  }

  function commitMask(id: string, startS: number, endS: number) {
    onChangeMasks(masks.map((m) => (m.id === id ? { ...m, startS, endS } : m)));
  }

  function handleMaskMove(e: React.PointerEvent<HTMLDivElement>, mask: MaskClip) {
    const origStartS = mask.startS;
    const durS = mask.endS - mask.startS;
    // Captured now, not read from `e` inside the click callback below — see
    // `handleZoomMove`'s identical comment on why.
    const clickX = e.clientX;
    beginDrag(
      e,
      { kind: "mask-move", id: mask.id },
      (deltaS) => {
        const raw = clampS(origStartS + deltaS, 0, safeDuration - durS);
        const candidates = [0, safeDuration, clipStartS, clipEndS, currentTime, ...maskEdgeCandidates(mask.id), ...zoomEdgeCandidates()];
        const snapped = clampS(snapMoveStart(raw, durS, candidates), 0, safeDuration - durS);
        commitMask(mask.id, snapped, snapped + durS);
        setDragLabel({
          pct: ((snapped + durS / 2) / safeDuration) * 100,
          text: `${formatTimeFine(snapped)} – ${formatTimeFine(snapped + durS)}`,
        });
      },
      () => {
        onSeek(secondsAtClientX(clickX));
        onSelectMask(mask.id);
      },
    );
  }

  function handleMaskTrim(e: React.PointerEvent<HTMLDivElement>, mask: MaskClip, edge: "left" | "right") {
    const origStartS = mask.startS;
    const origEndS = mask.endS;
    beginDrag(e, { kind: edge === "left" ? "mask-trim-left" : "mask-trim-right", id: mask.id }, (deltaS) => {
      if (edge === "left") {
        const raw = clampS(origStartS + deltaS, 0, origEndS - MIN_DRAG_SECONDS);
        const candidates = [0, clipStartS, currentTime, ...maskEdgeCandidates(mask.id), ...zoomEdgeCandidates()];
        const snapped = clampS(snapEdge(raw, candidates), 0, origEndS - MIN_DRAG_SECONDS);
        commitMask(mask.id, snapped, origEndS);
        setDragLabel({ pct: (snapped / safeDuration) * 100, text: formatTimeFine(snapped) });
      } else {
        const raw = clampS(origEndS + deltaS, origStartS + MIN_DRAG_SECONDS, safeDuration);
        const candidates = [safeDuration, clipEndS, currentTime, ...maskEdgeCandidates(mask.id), ...zoomEdgeCandidates()];
        const snapped = clampS(snapEdge(raw, candidates), origStartS + MIN_DRAG_SECONDS, safeDuration);
        commitMask(mask.id, origStartS, snapped);
        setDragLabel({ pct: (snapped / safeDuration) * 100, text: formatTimeFine(snapped) });
      }
    });
  }

  function handleVideoTrim(e: React.PointerEvent<HTMLDivElement>, edge: "left" | "right") {
    const origStart = clipStartS;
    const origEnd = clipEndS;
    beginDrag(e, { kind: edge === "left" ? "video-trim-left" : "video-trim-right" }, (deltaS) => {
      if (edge === "left") {
        const raw = clampS(origStart + deltaS, 0, origEnd - MIN_DRAG_SECONDS);
        const candidates = [0, currentTime, ...zoomEdgeCandidates(), ...maskEdgeCandidates()];
        const snapped = clampS(snapEdge(raw, candidates), 0, origEnd - MIN_DRAG_SECONDS);
        onTrimVideoClip(snapped, origEnd);
        setDragLabel({ pct: (snapped / safeDuration) * 100, text: formatTimeFine(snapped) });
      } else {
        const raw = clampS(origEnd + deltaS, origStart + MIN_DRAG_SECONDS, safeDuration);
        const candidates = [safeDuration, currentTime, ...zoomEdgeCandidates(), ...maskEdgeCandidates()];
        const snapped = clampS(snapEdge(raw, candidates), origStart + MIN_DRAG_SECONDS, safeDuration);
        onTrimVideoClip(origStart, snapped);
        setDragLabel({ pct: (snapped / safeDuration) * 100, text: formatTimeFine(snapped) });
      }
    });
  }

  function handleSliceClick(e: React.MouseEvent, slice: ClipSlice) {
    e.stopPropagation();
    if (splitArmed) {
      onSplitClip(secondsAtClientX(e.clientX));
    } else {
      onSeek(secondsAtClientX(e.clientX));
      onSelectSlice(slice.id);
    }
  }

  function handleZoomClick(e: React.MouseEvent, index: number) {
    if (!splitArmed) return; // plain click-to-select is handled by the move handle's `onClick`
    e.stopPropagation();
    onSplitZoomKeyframe(index, secondsAtClientX(e.clientX) * 1e6 + videoStartUs);
  }

  function zoomBy(delta: number) {
    setZoomLevel((z) => clampS(z + delta, MIN_ZOOM_LEVEL, MAX_ZOOM_LEVEL));
  }

  function resetZoom() {
    setZoomLevel(MIN_ZOOM_LEVEL);
  }

  /** Ctrl/Cmd+wheel (and trackpad pinch, which the browser reports as the
   * same event with `ctrlKey` set) zooms the timeline in/out centered on
   * wherever the pointer is — a plain wheel/trackpad-scroll still just
   * scrolls the (possibly-zoomed) timeline horizontally, native browser
   * behavior, untouched. */
  function handleWheelZoom(e: React.WheelEvent<HTMLDivElement>) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const atS = secondsAtClientX(e.clientX);
    zoomAnchorRef.current = { atS, clientX: e.clientX };
    zoomBy(e.deltaY > 0 ? -1 : 1);
  }

  // After a zoom-level change from `handleWheelZoom`, re-scrolls so the
  // time position that was under the cursor when the wheel fired is still
  // under it now that `trackRef` has actually re-rendered at its new
  // width — "zoom toward the cursor" instead of always zooming from the
  // left edge. A no-op for zoom-level changes from the +/- buttons (no
  // anchor was recorded, so there's nothing to restore).
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const scrollEl = scrollRef.current;
    const track = trackRef.current;
    if (!anchor || !scrollEl || !track) return;
    zoomAnchorRef.current = null;
    const trackWidth = track.getBoundingClientRect().width;
    const scrollRect = scrollEl.getBoundingClientRect();
    const targetX = (anchor.atS / safeDuration) * trackWidth;
    scrollEl.scrollLeft = targetX - (anchor.clientX - scrollRect.left);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel]);

  // Keeps the playhead scrolled into view while zoomed in — otherwise
  // playback (or a seek elsewhere, e.g. clicking a slice) could carry it
  // clean off the edge of whatever's currently visible with no way to
  // tell where it went short of zooming back out.
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    const track = trackRef.current;
    if (!scrollEl || !track || zoomLevel <= 1) return;
    const trackWidth = track.getBoundingClientRect().width;
    const playheadX = (currentTime / safeDuration) * trackWidth;
    const viewLeft = scrollEl.scrollLeft;
    const viewRight = viewLeft + scrollEl.clientWidth;
    const margin = scrollEl.clientWidth * 0.15;
    if (playheadX < viewLeft + margin || playheadX > viewRight - margin) {
      scrollEl.scrollLeft = Math.max(0, playheadX - scrollEl.clientWidth / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, zoomLevel]);

  return (
    <div className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="flex items-center gap-2 pb-3">
        <button
          type="button"
          onClick={() => onSeek(clipStartS)}
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label="Skip to start"
        >
          <SkipBack className="h-4 w-4" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          className="rounded p-1.5 text-neutral-200 hover:bg-neutral-800"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="h-5 w-5" fill="currentColor" />
          ) : (
            <Play className="h-5 w-5" fill="currentColor" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onSeek(clipEndS > 0 ? clipEndS : safeDuration)}
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label="Skip to end"
        >
          <SkipForward className="h-4 w-4" fill="currentColor" />
        </button>
        <span className="ml-2 font-mono text-xs text-neutral-500">{formatTime(currentTime)}</span>
        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setSplitArmed((v) => !v)}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            splitArmed ? "bg-indigo-500/20 text-indigo-400" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          }`}
          title="Split clip"
          aria-label="Split clip"
        >
          <Scissors className="h-3.5 w-3.5" />
        </button>
        <ResolutionPicker
          resolution={resolution}
          onChange={onChangeResolution}
          sourceWidthPx={sourceWidthPx}
          sourceHeightPx={sourceHeightPx}
        />

        <span className="ml-2 font-mono text-xs text-neutral-600">{formatTime(safeDuration)}</span>

        {/* Horizontal timeline zoom — see `zoomLevel`'s doc comment.
         * Ctrl/Cmd+wheel (or trackpad pinch) over the track area does the
         * same thing, anchored to the cursor instead of always the left
         * edge. */}
        <div className="ml-2 flex items-center gap-0.5 rounded-md border border-neutral-800 p-0.5">
          <button
            type="button"
            onClick={() => zoomBy(-1)}
            disabled={zoomLevel <= MIN_ZOOM_LEVEL}
            className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:cursor-not-allowed disabled:text-neutral-700 disabled:hover:bg-transparent"
            aria-label="Zoom timeline out"
            title="Zoom timeline out"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            disabled={zoomLevel === MIN_ZOOM_LEVEL}
            className="min-w-[28px] px-0.5 text-center text-[10px] font-medium text-neutral-500 hover:text-neutral-200 disabled:cursor-default disabled:hover:text-neutral-500"
            title="Reset zoom to fit"
          >
            {zoomLevel}x
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1)}
            disabled={zoomLevel >= MAX_ZOOM_LEVEL}
            className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:cursor-not-allowed disabled:text-neutral-700 disabled:hover:bg-transparent"
            aria-label="Zoom timeline in"
            title="Zoom timeline in"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Floating timecode readout while dragging any handle — positioned
       * by percentage against the same (possibly zoomed/scrolled) track
       * coordinate space everything else uses. */}
      {dragLabel && (
        <div className="relative mb-1 h-0">
          <span
            className="pointer-events-none absolute -top-6 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-100 shadow-lg"
            style={{ left: `${clampPct(dragLabel.pct)}%` }}
          >
            {dragLabel.text}
          </span>
        </div>
      )}

      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden" onWheel={handleWheelZoom}>
        {/* Ruler + clip/zoom/mask tracks, sharing one relative wrapper so
         * the playhead can be positioned once by percentage and span all
         * of them. Widened to `zoomLevel * 100%` of `scrollRef` above when
         * zoomed in — every child position below is a percentage of *this*
         * element, so it keeps working unchanged at any zoom level. */}
        <div
          ref={trackRef}
          className="relative"
          style={{ width: `${zoomLevel * 100}%`, minWidth: "100%" }}
          onMouseMove={handleTrackMouseMove}
          onMouseLeave={handleTrackMouseLeave}
          onClick={handleTrackClick}
        >
          <div className="relative h-4 text-[10px] text-neutral-600">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2"
                style={{ left: `${(t / safeDuration) * 100}%` }}
              >
                {tickInterval < 1 ? formatTimeFine(t) : formatTime(t)}
              </span>
            ))}
          </div>

          {/* Tick markers — a dot right under each ruler label, with a line
           * dropping from it through the gap and down into the video clip
           * block, so it's visible exactly which time interval each part of
           * the clip falls under. Drawn *after* (so on top of) the clip
           * block below, spanning from the ruler's own bottom edge (16px)
           * down through the 4px gap and the clip block's full 48px height. */}
          <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: 16, height: 52 }}>
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 -translate-x-1/2" style={{ left: `${(t / safeDuration) * 100}%` }}>
                <div className="mx-auto h-1 w-1 rounded-full bg-neutral-400" />
                <div className="mx-auto w-px bg-white/20" style={{ height: 48 }} />
              </div>
            ))}
          </div>

          <div
            className={`relative mt-1 h-12 overflow-hidden rounded-md bg-neutral-900 ${splitArmed ? "cursor-crosshair" : ""}`}
          >
            {slices.map((slice, i) => {
              const leftPct = clampPct((slice.startS / safeDuration) * 100);
              const widthPct = clampPct(((slice.endS - slice.startS) / safeDuration) * 100);
              const isFirst = i === 0;
              const isLast = i === slices.length - 1;
              const isSelected = selectedSliceId === slice.id;
              return (
                <div
                  key={slice.id}
                  className={`group absolute top-0 flex h-full items-center justify-center overflow-hidden transition-[filter] hover:brightness-110 ${
                    isFirst ? "rounded-l-md" : ""
                  } ${isLast ? "rounded-r-md" : ""} ${
                    isSelected ? "outline outline-2 -outline-offset-2 outline-white" : ""
                  } ${
                    slice.removed
                      ? "bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.55)_0_6px,rgba(0,0,0,0.35)_6px_12px)]"
                      : "bg-gradient-to-b from-amber-700 to-amber-300 shadow-[inset_0_-3px_5px_rgba(0,0,0,0.45)]"
                  } ${!isFirst ? "border-l border-neutral-950/40" : ""} ${splitArmed ? "" : "cursor-pointer"}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  onClick={(e) => handleSliceClick(e, slice)}
                  title={
                    splitArmed
                      ? "Click to split here"
                      : `${slice.removed ? "Removed slice" : "Clip"} ${formatTime(slice.startS)}–${formatTime(slice.endS)}${
                          slice.speed !== 1 ? ` · ${slice.speed}x` : ""
                        }`
                  }
                >
                  {widthPct > 8 && (
                    <span className="pointer-events-none truncate px-2 text-[10px] font-medium text-amber-950">
                      {slice.removed ? "Removed" : slice.speed !== 1 ? `${slice.speed}x` : ""}
                    </span>
                  )}
                  {isFirst && (
                    <div
                      onPointerDown={(e) => handleVideoTrim(e, "left")}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute inset-y-0 left-0 z-10 flex w-3 cursor-col-resize items-stretch justify-start"
                    >
                      <div
                        className={`w-1 transition-opacity ${
                          activeDrag?.kind === "video-trim-left" ? "bg-white opacity-100" : "bg-white opacity-0 group-hover:opacity-100"
                        }`}
                      />
                    </div>
                  )}
                  {isLast && (
                    <div
                      onPointerDown={(e) => handleVideoTrim(e, "right")}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute inset-y-0 right-0 z-10 flex w-3 cursor-col-resize items-stretch justify-end"
                    >
                      <div
                        className={`w-1 transition-opacity ${
                          activeDrag?.kind === "video-trim-right" ? "bg-white opacity-100" : "bg-white opacity-0 group-hover:opacity-100"
                        }`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div
            className={`relative mt-1.5 rounded-md bg-neutral-800/60 transition-[height] duration-150 ease-out ${splitArmed ? "cursor-crosshair" : ""}`}
            style={{ height: zoomFocused ? TRACK_HEIGHT_NORMAL_PX : TRACK_HEIGHT_COMPACT_PX }}
            onMouseEnter={() => setHoveredTrack("zoom")}
            onMouseLeave={() => setHoveredTrack((t) => (t === "zoom" ? null : t))}
          >
            {zoomKeyframes.map((kf, index) => {
              const startS = (kf.startT - videoStartUs) / 1e6;
              const endS = (kf.endT - videoStartUs) / 1e6;
              const leftPct = clampPct((startS / safeDuration) * 100);
              const widthPct = clampPct(((endS - startS) / safeDuration) * 100);
              if (widthPct <= 0) return null;
              const isSelected = selectedZoomIndex === index;
              return (
                <div
                  key={index}
                  className={`group absolute top-0 flex h-full items-center justify-center overflow-hidden rounded-md text-[10px] font-medium text-white shadow-[inset_0_-3px_5px_rgba(0,0,0,0.45)] transition-[filter] hover:brightness-110 ${
                    kf.disabled ? "bg-gradient-to-b from-neutral-700 to-neutral-400" : "bg-gradient-to-b from-indigo-800 to-indigo-400"
                  } ${isSelected ? "outline outline-2 -outline-offset-2 outline-white" : ""} ${
                    splitArmed
                      ? "cursor-crosshair"
                      : activeDrag?.kind === "zoom-move" && activeDrag?.index === index
                        ? "cursor-grabbing"
                        : "cursor-grab"
                  }`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  title={splitArmed ? "Click to split here" : `Zoom ${kf.level.toFixed(1)}x`}
                  onPointerDown={(e) => handleZoomMove(e, kf, index)}
                  onClick={(e) => handleZoomClick(e, index)}
                >
                  {zoomFocused && widthPct > 6 ? `${kf.level.toFixed(1)}x` : ""}
                  <div
                    onPointerDown={(e) => handleZoomTrim(e, kf, index, "left")}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 left-0 z-10 flex w-3 cursor-col-resize items-stretch justify-start"
                  >
                    <div
                      className={`w-1 transition-opacity ${
                        activeDrag?.kind === "zoom-trim-left" && activeDrag?.index === index
                          ? "bg-white opacity-100"
                          : "bg-white opacity-0 group-hover:opacity-100"
                      }`}
                    />
                  </div>
                  <div
                    onPointerDown={(e) => handleZoomTrim(e, kf, index, "right")}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 right-0 z-10 flex w-3 cursor-col-resize items-stretch justify-end"
                  >
                    <div
                      className={`w-1 transition-opacity ${
                        activeDrag?.kind === "zoom-trim-right" && activeDrag?.index === index
                          ? "bg-white opacity-100"
                          : "bg-white opacity-0 group-hover:opacity-100"
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mask track — same move/trim-handle drag pattern the zoom track
           * above uses (masks are independent, possibly-overlapping ranges,
           * not a gapless partition like slices — see `masks.ts`), just its
           * own row and color so all three tracks stay visually distinct at
           * a glance: amber (slices), indigo (zoom), rose/amber (masks,
           * matching the sensitive/highlight colors `MaskEditorPanel` and
           * the renderer's mask fill both use). */}
          <div
            className="relative mt-1.5 rounded-md bg-neutral-800/60 transition-[height] duration-150 ease-out"
            style={{ height: maskFocused ? TRACK_HEIGHT_NORMAL_PX : TRACK_HEIGHT_COMPACT_PX }}
            onMouseEnter={() => setHoveredTrack("mask")}
            onMouseLeave={() => setHoveredTrack((t) => (t === "mask" ? null : t))}
          >
            {masks.map((mask) => {
              const leftPct = clampPct((mask.startS / safeDuration) * 100);
              const widthPct = clampPct(((mask.endS - mask.startS) / safeDuration) * 100);
              if (widthPct <= 0) return null;
              const isSelected = selectedMaskId === mask.id;
              const colorClass = mask.disabled
                ? "bg-gradient-to-b from-neutral-700 to-neutral-400"
                : mask.type === "sensitive"
                  ? "bg-gradient-to-b from-rose-800 to-rose-400"
                  : "bg-gradient-to-b from-amber-600 to-amber-300";
              return (
                <div
                  key={mask.id}
                  className={`group absolute top-0 flex h-full items-center justify-center overflow-hidden rounded-md text-[10px] font-medium text-white shadow-[inset_0_-3px_5px_rgba(0,0,0,0.45)] transition-[filter] hover:brightness-110 ${colorClass} ${
                    isSelected ? "outline outline-2 -outline-offset-2 outline-white" : ""
                  } ${activeDrag?.kind === "mask-move" && activeDrag?.id === mask.id ? "cursor-grabbing" : "cursor-grab"}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  title={`${mask.type === "sensitive" ? "Sensitive data mask" : "Highlight mask"} ${formatTime(mask.startS)}–${formatTime(mask.endS)}${mask.disabled ? " (disabled)" : ""}`}
                  onPointerDown={(e) => handleMaskMove(e, mask)}
                >
                  {maskFocused && widthPct > 8 ? (mask.type === "sensitive" ? "Sensitive" : "Highlight") : ""}
                  <div
                    onPointerDown={(e) => handleMaskTrim(e, mask, "left")}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 left-0 z-10 flex w-3 cursor-col-resize items-stretch justify-start"
                  >
                    <div
                      className={`w-1 transition-opacity ${
                        activeDrag?.kind === "mask-trim-left" && activeDrag?.id === mask.id
                          ? "bg-white opacity-100"
                          : "bg-white opacity-0 group-hover:opacity-100"
                      }`}
                    />
                  </div>
                  <div
                    onPointerDown={(e) => handleMaskTrim(e, mask, "right")}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 right-0 z-10 flex w-3 cursor-col-resize items-stretch justify-end"
                  >
                    <div
                      className={`w-1 transition-opacity ${
                        activeDrag?.kind === "mask-trim-right" && activeDrag?.id === mask.id
                          ? "bg-white opacity-100"
                          : "bg-white opacity-0 group-hover:opacity-100"
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Snap guide — a distinct highlighted line at whatever position
           * the current drag just snapped to (see `snapEdge`/
           * `snapMoveStart`), separate from both the hover-scrub and split
           * indicators below and the playhead itself. */}
          {snapAtS !== null && (
            <div
              className="pointer-events-none absolute bottom-0 top-4 z-20 w-px bg-indigo-300"
              style={{ left: `${clampPct((snapAtS / safeDuration) * 100)}%` }}
            />
          )}

          {hoverS !== null &&
            !activeDrag &&
            (splitArmed ? (
              <div
                className="pointer-events-none absolute bottom-0 top-4 w-px border-l border-dashed border-indigo-300"
                style={{ left: `${clampPct((hoverS / safeDuration) * 100)}%` }}
              >
                <span className="absolute -top-4 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-indigo-400 text-neutral-950">
                  <Scissors className="h-3 w-3" />
                </span>
              </div>
            ) : (
              // Plain scrub-hover indicator — distinct from both the split
              // line above and the actual (solid white) playhead below, so
              // hovering to preview a spot doesn't look like it already
              // committed the seek.
              <div
                className="pointer-events-none absolute bottom-0 top-4 w-px bg-neutral-400/60"
                style={{ left: `${clampPct((hoverS / safeDuration) * 100)}%` }}
              />
            ))}

          <div
            className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-neutral-100"
            style={{ left: `${playheadPct}%` }}
          >
            {/* Draggable scrubber handle — grab and drag to scrub, same as
             * clicking anywhere else on the track but continuous, and
             * without needing to look away from the handle itself to see
             * where you're dropping it (the canvas updates live as it
             * moves, same as a video player's own scrubber). */}
            <div
              onPointerDown={handlePlayheadPointerDown}
              className={`pointer-events-auto absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 cursor-ew-resize rounded-full bg-neutral-100 shadow-sm transition-transform hover:scale-125 ${
                isDraggingPlayhead ? "scale-125" : ""
              }`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
