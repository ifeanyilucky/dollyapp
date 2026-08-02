import { Gauge, Pause, Play, Scissors, SkipBack, SkipForward, X } from "lucide-react";
import { useRef, useState } from "react";
import type { ZoomKeyframe } from "../motion-engine";
import { SPEED_REGION_RATES, type CutRegion, type SpeedRegion } from "./regions";

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

type Tool = "none" | "cut" | "speed";
const MIN_DRAG_SECONDS = 0.15;

/** Which handle is being dragged right now — drives the grabbing/col-resize
 * cursor and keeps the white trim lines visible while a trim drag is in
 * flight even if the pointer strays off the element. */
type ActiveDrag =
  | { kind: "zoom-move" | "zoom-trim-left" | "zoom-trim-right"; index: number }
  | { kind: "video-move" | "video-trim-left" | "video-trim-right" };

function clampS(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

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
  cutRegions,
  speedRegions,
  onAddCut,
  onRemoveCut,
  onAddSpeed,
  onRemoveSpeed,
  onCycleSpeedRate,
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
  cutRegions: CutRegion[];
  speedRegions: SpeedRegion[];
  onAddCut: (region: CutRegion) => void;
  onRemoveCut: (id: string) => void;
  onAddSpeed: (region: SpeedRegion) => void;
  onRemoveSpeed: (id: string) => void;
  onCycleSpeedRate: (id: string) => void;
}) {
  const [tool, setTool] = useState<Tool>("none");
  const [drag, setDrag] = useState<{ startS: number; endS: number } | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const safeDuration = duration > 0 ? duration : 1;
  const tickInterval = pickTickInterval(safeDuration);
  const ticks: number[] = [];
  for (let t = 0; t <= safeDuration; t += tickInterval) ticks.push(t);
  const playheadPct = clampPct((currentTime / safeDuration) * 100);

  function secondsAtPointer(e: { clientX: number }, rect: DOMRect): number {
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return frac * safeDuration;
  }

  function handleTrackMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (tool === "none") {
      onSeek(secondsAtPointer(e, rect));
      return;
    }

    const startS = secondsAtPointer(e, rect);
    setDrag({ startS, endS: startS });

    function onMove(ev: MouseEvent) {
      setDrag({ startS, endS: secondsAtPointer(ev, rect) });
    }
    function onUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const endS = secondsAtPointer(ev, rect);
      const lo = Math.min(startS, endS);
      const hi = Math.max(startS, endS);
      setDrag(null);
      if (hi - lo < MIN_DRAG_SECONDS) return;
      const id = crypto.randomUUID();
      if (tool === "cut") onAddCut({ id, startS: lo, endS: hi });
      else onAddSpeed({ id, startS: lo, endS: hi, rate: SPEED_REGION_RATES[0] });
      setTool("none");
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Attaches window mousemove/mouseup listeners for a drag, computing each
   * move's `deltaS` from the pointer position — same pattern as
   * `handleTrackMouseDown`'s region drag. */
  function startDrag(startX: number, rect: DOMRect, onMove: (deltaS: number) => void, onEnd?: () => void) {
    function handleMove(ev: MouseEvent) {
      onMove(((ev.clientX - startX) / rect.width) * safeDuration);
    }
    function handleUp() {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      onEnd?.();
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  /** Applies a drag result to a zoom keyframe, preserving `level`/`center`
   * and converting the video-relative seconds back to absolute µs. */
  function commitZoom(original: ZoomKeyframe, startS: number, endS: number) {
    const updated: ZoomKeyframe = {
      ...original,
      startT: Math.round(startS * 1e6 + videoStartUs),
      endT: Math.round(endS * 1e6 + videoStartUs),
    };
    onChangeZoomKeyframes(zoomKeyframes.map((k) => (k === original ? updated : k)));
  }

  function startZoomMove(kf: ZoomKeyframe, index: number) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (tool !== "none") return;
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      e.preventDefault();
      e.stopPropagation();
      const origStartS = (kf.startT - videoStartUs) / 1e6;
      const durS = (kf.endT - kf.startT) / 1e6;
      setActiveDrag({ kind: "zoom-move", index });
      startDrag(
        e.clientX,
        rect,
        (deltaS) => {
          const newStart = clampS(origStartS + deltaS, 0, safeDuration - durS);
          commitZoom(kf, newStart, newStart + durS);
        },
        () => setActiveDrag(null),
      );
    };
  }

  function startZoomTrim(kf: ZoomKeyframe, index: number, edge: "left" | "right") {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (tool !== "none") return;
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      e.preventDefault();
      e.stopPropagation();
      const origStartS = (kf.startT - videoStartUs) / 1e6;
      const origEndS = (kf.endT - videoStartUs) / 1e6;
      setActiveDrag({ kind: edge === "left" ? "zoom-trim-left" : "zoom-trim-right", index });
      startDrag(
        e.clientX,
        rect,
        (deltaS) => {
          if (edge === "left") {
            const newStart = clampS(origStartS + deltaS, 0, origEndS - MIN_DRAG_SECONDS);
            commitZoom(kf, newStart, origEndS);
          } else {
            const newEnd = clampS(origEndS + deltaS, origStartS + MIN_DRAG_SECONDS, safeDuration);
            commitZoom(kf, origStartS, newEnd);
          }
        },
        () => setActiveDrag(null),
      );
    };
  }

  function startVideoMove(e: React.PointerEvent<HTMLDivElement>) {
    if (tool !== "none") return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    const origStart = clipStartS;
    const durS = clipEndS - clipStartS;
    setActiveDrag({ kind: "video-move" });
    startDrag(
      e.clientX,
      rect,
      (deltaS) => {
        const newStart = clampS(origStart + deltaS, 0, safeDuration - durS);
        onTrimVideoClip(newStart, newStart + durS);
      },
      () => setActiveDrag(null),
    );
  }

  function startVideoTrim(edge: "left" | "right") {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (tool !== "none") return;
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      e.preventDefault();
      e.stopPropagation();
      const origStart = clipStartS;
      const origEnd = clipEndS;
      setActiveDrag({ kind: edge === "left" ? "video-trim-left" : "video-trim-right" });
      startDrag(
        e.clientX,
        rect,
        (deltaS) => {
          if (edge === "left") {
            const newStart = clampS(origStart + deltaS, 0, origEnd - MIN_DRAG_SECONDS);
            onTrimVideoClip(newStart, origEnd);
          } else {
            const newEnd = clampS(origEnd + deltaS, origStart + MIN_DRAG_SECONDS, safeDuration);
            onTrimVideoClip(origStart, newEnd);
          }
        },
        () => setActiveDrag(null),
      );
    };
  }

  const dragLeftPct = drag ? clampPct((Math.min(drag.startS, drag.endS) / safeDuration) * 100) : 0;
  const dragWidthPct = drag
    ? clampPct((Math.abs(drag.endS - drag.startS) / safeDuration) * 100)
    : 0;

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
          onClick={() => setTool(tool === "cut" ? "none" : "cut")}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
            tool === "cut" ? "bg-red-500/20 text-red-400" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          }`}
          title="Drag on the clip below to cut a range"
        >
          <Scissors className="h-3.5 w-3.5" />
          Cut
        </button>
        <button
          type="button"
          onClick={() => setTool(tool === "speed" ? "none" : "speed")}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
            tool === "speed"
              ? "bg-amber-500/20 text-amber-400"
              : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          }`}
          title="Drag on the clip below to speed up a range"
        >
          <Gauge className="h-3.5 w-3.5" />
          Speed
        </button>

        <span className="ml-2 font-mono text-xs text-neutral-600">{formatTime(safeDuration)}</span>
      </div>

      {/* Ruler + clip track + zoom track, sharing one relative wrapper so
       * the playhead can be positioned once by percentage and span all
       * three. */}
      <div ref={trackRef} className="relative">
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
          className={`relative mt-1 h-9 overflow-hidden rounded-md bg-neutral-800/60 ${
            tool !== "none" ? "cursor-crosshair" : "cursor-pointer"
          }`}
          onMouseDown={handleTrackMouseDown}
        >
          {/* The clip itself — a sub-bar spanning the in/out window. Hover
           * reveals white trim lines at both edges (col-resize); the body
           * drags the window once it's been trimmed. Disabled while a
           * cut/speed tool is active so region drags win. */}
          <div
            className={`group absolute top-0 flex h-full items-center justify-center overflow-hidden rounded-md bg-amber-600/70 ${
              tool !== "none"
                ? "cursor-crosshair"
                : activeDrag?.kind === "video-move"
                  ? "cursor-grabbing"
                  : "cursor-grab"
            }`}
            style={{
              left: `${clampPct((clipStartS / safeDuration) * 100)}%`,
              width: `${clampPct(((clipEndS - clipStartS) / safeDuration) * 100)}%`,
            }}
            onPointerDown={startVideoMove}
            onMouseDown={(e) => {
              if (tool === "none") e.stopPropagation();
            }}
            title={`Clip ${formatTime(clipStartS)}–${formatTime(clipEndS)}`}
          >
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-amber-950">
              Clip · {formatTime(clipStartS)}–{formatTime(clipEndS)}
            </span>
            <div
              onPointerDown={startVideoTrim("left")}
              onMouseDown={(e) => {
                if (tool === "none") e.stopPropagation();
              }}
              className={`absolute inset-y-0 left-0 w-1.5 cursor-col-resize bg-white transition-opacity ${
                activeDrag?.kind === "video-trim-left"
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              }`}
              title="Trim start"
            />
            <div
              onPointerDown={startVideoTrim("right")}
              onMouseDown={(e) => {
                if (tool === "none") e.stopPropagation();
              }}
              className={`absolute inset-y-0 right-0 w-1.5 cursor-col-resize bg-white transition-opacity ${
                activeDrag?.kind === "video-trim-right"
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              }`}
              title="Trim end"
            />
          </div>

          {cutRegions.map((r) => {
            const leftPct = clampPct((r.startS / safeDuration) * 100);
            const widthPct = clampPct(((r.endS - r.startS) / safeDuration) * 100);
            return (
              <div
                key={r.id}
                className="group absolute top-0 flex h-full items-center justify-center bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.55)_0_6px,rgba(0,0,0,0.35)_6px_12px)]"
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                title={`Cut ${formatTime(r.startS)}–${formatTime(r.endS)}`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveCut(r.id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-950/80 text-neutral-200 opacity-0 group-hover:opacity-100"
                  aria-label="Remove cut"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}

          {speedRegions.map((r) => {
            const leftPct = clampPct((r.startS / safeDuration) * 100);
            const widthPct = clampPct(((r.endS - r.startS) / safeDuration) * 100);
            return (
              <div
                key={r.id}
                className="group absolute top-0 flex h-full items-center justify-center gap-1 bg-amber-400/40"
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                title={`${r.rate}x speed ${formatTime(r.startS)}–${formatTime(r.endS)}`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCycleSpeedRate(r.id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="rounded bg-neutral-950/70 px-1 text-[10px] font-medium text-amber-200"
                >
                  {r.rate}x
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveSpeed(r.id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-950/80 text-neutral-200 opacity-0 group-hover:opacity-100"
                  aria-label="Remove speed region"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}

          {drag && (
            <div
              className={`pointer-events-none absolute top-0 h-full border-2 ${
                tool === "cut" ? "border-red-400 bg-red-400/20" : "border-amber-400 bg-amber-400/20"
              }`}
              style={{ left: `${dragLeftPct}%`, width: `${dragWidthPct}%` }}
            />
          )}
        </div>

        <div
          className={`relative mt-1.5 h-7 rounded-md bg-neutral-800/60 ${
            tool !== "none" ? "cursor-crosshair" : "cursor-pointer"
          }`}
          onMouseDown={handleTrackMouseDown}
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
                className={`group absolute top-0 flex h-full items-center justify-center overflow-hidden rounded-md bg-indigo-500/80 text-[10px] font-medium text-white ${
                  tool !== "none"
                    ? "cursor-crosshair"
                    : activeDrag?.kind === "zoom-move" && activeDrag?.index === index
                      ? "cursor-grabbing"
                      : "cursor-grab"
                }`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                title={`Zoom ${kf.level.toFixed(1)}x`}
                onPointerDown={startZoomMove(kf, index)}
                onMouseDown={(e) => {
                  if (tool === "none") e.stopPropagation();
                }}
              >
                {widthPct > 6 ? `${kf.level.toFixed(1)}x` : ""}
                <div
                  onPointerDown={startZoomTrim(kf, index, "left")}
                  onMouseDown={(e) => {
                    if (tool === "none") e.stopPropagation();
                  }}
                  className={`absolute inset-y-0 left-0 w-1.5 cursor-col-resize bg-white transition-opacity ${
                    activeDrag?.kind === "zoom-trim-left" && activeDrag?.index === index
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                  title="Trim zoom start"
                />
                <div
                  onPointerDown={startZoomTrim(kf, index, "right")}
                  onMouseDown={(e) => {
                    if (tool === "none") e.stopPropagation();
                  }}
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
