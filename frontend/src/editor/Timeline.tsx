import { Pause, Play, Scissors, SkipBack, SkipForward } from "lucide-react";
import { useRef, useState } from "react";
import type { ZoomKeyframe } from "../motion-engine";
import type { ClipSlice } from "./slices";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Picks a tick spacing that keeps ~6-12 labeled ticks regardless of clip
 * length, rounded to a "nice" number of seconds. */
function pickTickInterval(duration: number): number {
  const target = duration / 8;
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s >= target) ?? steps[steps.length - 1];
}

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function clampS(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

const MIN_DRAG_SECONDS = 0.15;
/** A pointer that moved less than this (px) between down and up counts as
 * a click/select rather than a drag — lets the zoom track's move-handle
 * double as its select-handle without a separate gesture. */
const CLICK_MOVE_THRESHOLD_PX = 4;

/** Which handle is being dragged right now — drives the grabbing/col-resize
 * cursor and keeps the white trim lines visible while a trim drag is in
 * flight even if the pointer strays off the element. */
type ActiveDrag =
  | { kind: "zoom-move" | "zoom-trim-left" | "zoom-trim-right"; index: number }
  | { kind: "video-trim-left" | "video-trim-right" };

export function Timeline({
  duration,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
  zoomKeyframes,
  videoStartUs,
  clipStartS,
  clipEndS,
  onTrimVideoClip,
  onChangeZoomKeyframes,
  slices,
  onSplitClip,
  onSelectSlice,
  onSplitZoomKeyframe,
  onSelectZoomKeyframe,
}: {
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  /** Absolute `t` (microseconds since clockEpoch), same as `cursor.json` —
   * converted to video-relative seconds internally via `videoStartUs`. */
  zoomKeyframes: ZoomKeyframe[];
  videoStartUs: number;
  /** Effective in/out of the whole clip (video-relative seconds) — the
   * amber bar's trimmed range. */
  clipStartS: number;
  clipEndS: number;
  onTrimVideoClip: (startS: number, endS: number) => void;
  onChangeZoomKeyframes: (keyframes: ZoomKeyframe[]) => void;
  slices: ClipSlice[];
  onSplitClip: (atS: number) => void;
  onSelectSlice: (id: string) => void;
  onSplitZoomKeyframe: (index: number, atT: number) => void;
  onSelectZoomKeyframe: (index: number) => void;
}) {
  const [splitArmed, setSplitArmed] = useState(false);
  const [hoverS, setHoverS] = useState<number | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const safeDuration = duration > 0 ? duration : 1;
  const tickInterval = pickTickInterval(safeDuration);
  const ticks: number[] = [];
  for (let t = 0; t <= safeDuration; t += tickInterval) ticks.push(t);
  const playheadPct = clampPct((currentTime / safeDuration) * 100);

  function secondsAtClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return frac * safeDuration;
  }

  function handleTrackMouseMove(e: React.MouseEvent) {
    // Don't fight an in-progress trim/move drag with a scrub-preview seek.
    if (activeDrag) return;
    const s = secondsAtClientX(e.clientX);
    setHoverS(s);
    // Live scrub preview — the canvas shows exactly the frame under the
    // cursor, whether that's to line up a split or just to look around.
    onSeek(s);
  }

  function handleTrackMouseLeave() {
    setHoverS(null);
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
      if (onClick && maxMoved < CLICK_MOVE_THRESHOLD_PX) onClick();
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
        const newStart = clampS(origStartS + deltaS, 0, safeDuration - durS);
        commitZoom(index, newStart, newStart + durS);
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
        commitZoom(index, clampS(origStartS + deltaS, 0, origEndS - MIN_DRAG_SECONDS), origEndS);
      } else {
        commitZoom(index, origStartS, clampS(origEndS + deltaS, origStartS + MIN_DRAG_SECONDS, safeDuration));
      }
    });
  }

  function handleVideoTrim(e: React.PointerEvent<HTMLDivElement>, edge: "left" | "right") {
    const origStart = clipStartS;
    const origEnd = clipEndS;
    beginDrag(e, { kind: edge === "left" ? "video-trim-left" : "video-trim-right" }, (deltaS) => {
      if (edge === "left") {
        onTrimVideoClip(clampS(origStart + deltaS, 0, origEnd - MIN_DRAG_SECONDS), origEnd);
      } else {
        onTrimVideoClip(origStart, clampS(origEnd + deltaS, origStart + MIN_DRAG_SECONDS, safeDuration));
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

        <span className="ml-2 font-mono text-xs text-neutral-600">{formatTime(safeDuration)}</span>
      </div>

      {/* Ruler + clip track + zoom track, sharing one relative wrapper so
       * the playhead can be positioned once by percentage and span all
       * three. */}
      <div
        ref={trackRef}
        className="relative"
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
              {formatTime(t)}
            </span>
          ))}
        </div>

        <div
          className={`relative mt-1 h-9 overflow-hidden rounded-md bg-neutral-900 ${splitArmed ? "cursor-crosshair" : ""}`}
        >
          {slices.map((slice, i) => {
            const leftPct = clampPct((slice.startS / safeDuration) * 100);
            const widthPct = clampPct(((slice.endS - slice.startS) / safeDuration) * 100);
            const isFirst = i === 0;
            const isLast = i === slices.length - 1;
            return (
              <div
                key={slice.id}
                className={`group absolute top-0 flex h-full items-center justify-center overflow-hidden ${
                  isFirst ? "rounded-l-md" : ""
                } ${isLast ? "rounded-r-md" : ""} ${
                  slice.removed
                    ? "bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.55)_0_6px,rgba(0,0,0,0.35)_6px_12px)]"
                    : "bg-amber-600/70"
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
                    className={`absolute inset-y-0 left-0 w-1.5 cursor-col-resize bg-white transition-opacity ${
                      activeDrag?.kind === "video-trim-left" ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                    title="Trim start"
                  />
                )}
                {isLast && (
                  <div
                    onPointerDown={(e) => handleVideoTrim(e, "right")}
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute inset-y-0 right-0 w-1.5 cursor-col-resize bg-white transition-opacity ${
                      activeDrag?.kind === "video-trim-right" ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                    title="Trim end"
                  />
                )}
              </div>
            );
          })}
        </div>

        <div
          className={`relative mt-1.5 h-7 rounded-md bg-neutral-800/60 ${splitArmed ? "cursor-crosshair" : ""}`}
        >
          {zoomKeyframes.map((kf, index) => {
            const startS = (kf.startT - videoStartUs) / 1e6;
            const endS = (kf.endT - videoStartUs) / 1e6;
            const leftPct = clampPct((startS / safeDuration) * 100);
            const widthPct = clampPct(((endS - startS) / safeDuration) * 100);
            if (widthPct <= 0) return null;
            return (
              <div
                key={index}
                className={`group absolute top-0 flex h-full items-center justify-center overflow-hidden rounded-md text-[10px] font-medium text-white ${
                  kf.disabled ? "bg-neutral-600/70" : "bg-indigo-500/80"
                } ${
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
                {widthPct > 6 ? `${kf.level.toFixed(1)}x` : ""}
                <div
                  onPointerDown={(e) => handleZoomTrim(e, kf, index, "left")}
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute inset-y-0 left-0 w-1.5 cursor-col-resize bg-white transition-opacity ${
                    activeDrag?.kind === "zoom-trim-left" && activeDrag?.index === index
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                  title="Trim zoom start"
                />
                <div
                  onPointerDown={(e) => handleZoomTrim(e, kf, index, "right")}
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute inset-y-0 right-0 w-1.5 cursor-col-resize bg-white transition-opacity ${
                    activeDrag?.kind === "zoom-trim-right" && activeDrag?.index === index
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                  title="Trim zoom end"
                />
              </div>
            );
          })}
        </div>

        {hoverS !== null &&
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
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-neutral-100"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-neutral-100" />
        </div>
      </div>
    </div>
  );
}
