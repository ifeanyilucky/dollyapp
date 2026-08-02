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

function clampS(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

type Tool = "none" | "cut" | "speed";
const MIN_DRAG_SECONDS = 0.15;

/** Which handle is being dragged right now — drives the grabbing/col-resize
 * cursor and keeps the white trim lines visible while a trim drag is in
 * flight even if the pointer strays off the element. Exactly one of these
 * can be active at a time: every drag goes through `beginDrag`, which uses
 * native Pointer Capture (see its doc comment) so a single physical
 * gesture can never be picked up by two handles at once. */
type ActiveDrag =
  | { kind: "zoom-move" | "zoom-trim-left" | "zoom-trim-right"; index: number }
  | { kind: "video-move" | "video-trim-left" | "video-trim-right" };

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
  const [regionDrag, setRegionDrag] = useState<{ startS: number; endS: number } | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const safeDuration = duration > 0 ? duration : 1;
  const tickInterval = pickTickInterval(safeDuration);
  const ticks: number[] = [];
  for (let t = 0; t <= safeDuration; t += tickInterval) ticks.push(t);
  const playheadPct = clampPct((currentTime / safeDuration) * 100);

  function secondsAtClientX(clientX: number, rect: DOMRect): number {
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return frac * safeDuration;
  }

  /**
   * Starts a drag on `e.currentTarget` using native Pointer Capture
   * instead of `window`-level mouse listeners. Capturing the pointer on
   * the exact element the user pressed down on means every subsequent
   * `pointermove`/`pointerup` for that gesture is routed *directly* to
   * that element regardless of what's visually under the cursor as it
   * moves — the browser handles this, not manual hit-testing — so two
   * drags started from two different handles can never cross-talk, and
   * there's no `window` listener that could outlive its drag if a
   * `pointerup` is ever missed (a `pointercancel` still fires and cleans
   * up the same way). `onMove` receives the total horizontal delta since
   * the press, in seconds, already clamped to the track's own width.
   */
  function beginDrag(
    e: React.PointerEvent<HTMLDivElement>,
    kind: ActiveDrag,
    onMove: (deltaS: number) => void,
  ) {
    if (tool !== "none") return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    target.setPointerCapture(pointerId);
    setActiveDrag(kind);

    function handleMove(ev: PointerEvent) {
      onMove(((ev.clientX - startX) / rect.width) * safeDuration);
    }
    function handleEnd() {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleEnd);
      target.removeEventListener("pointercancel", handleEnd);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      setActiveDrag(null);
    }
    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleEnd);
    target.addEventListener("pointercancel", handleEnd);
  }

  /** Same idea as `beginDrag`, for the cut/speed region tools: drags out a
   * brand-new region between the press point and the current pointer,
   * instead of moving/trimming an existing one. */
  function beginRegionDrag(e: React.PointerEvent<HTMLDivElement>) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (tool === "none") {
      onSeek(secondsAtClientX(e.clientX, rect));
      return;
    }

    e.preventDefault();
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    target.setPointerCapture(pointerId);
    const startS = secondsAtClientX(e.clientX, rect);
    setRegionDrag({ startS, endS: startS });

    function handleMove(ev: PointerEvent) {
      setRegionDrag({ startS, endS: secondsAtClientX(ev.clientX, rect) });
    }
    function handleEnd(ev: PointerEvent) {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleEnd);
      target.removeEventListener("pointercancel", handleEnd);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);

      const endS = secondsAtClientX(ev.clientX, rect);
      const lo = Math.min(startS, endS);
      const hi = Math.max(startS, endS);
      setRegionDrag(null);
      if (hi - lo < MIN_DRAG_SECONDS) return;
      const id = crypto.randomUUID();
      if (tool === "cut") onAddCut({ id, startS: lo, endS: hi });
      else onAddSpeed({ id, startS: lo, endS: hi, rate: SPEED_REGION_RATES[0] });
      setTool("none");
    }
    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleEnd);
    target.addEventListener("pointercancel", handleEnd);
  }

  /** Applies a drag result to one zoom keyframe by index — index rather
   * than object identity, so this can't accidentally touch a different
   * keyframe even if the array was replaced from under it mid-drag. */
  function commitZoom(index: number, startS: number, endS: number) {
    onChangeZoomKeyframes(
      zoomKeyframes.map((k, i) =>
        i === index
          ? { ...k, startT: Math.round(startS * 1e6 + videoStartUs), endT: Math.round(endS * 1e6 + videoStartUs) }
          : k,
      ),
    );
  }

  function handleZoomMove(e: React.PointerEvent<HTMLDivElement>, kf: ZoomKeyframe, index: number) {
    const origStartS = (kf.startT - videoStartUs) / 1e6;
    const durS = (kf.endT - kf.startT) / 1e6;
    beginDrag(e, { kind: "zoom-move", index }, (deltaS) => {
      const newStart = clampS(origStartS + deltaS, 0, safeDuration - durS);
      commitZoom(index, newStart, newStart + durS);
    });
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

  function handleVideoMove(e: React.PointerEvent<HTMLDivElement>) {
    const origStart = clipStartS;
    const durS = clipEndS - clipStartS;
    beginDrag(e, { kind: "video-move" }, (deltaS) => {
      const newStart = clampS(origStart + deltaS, 0, safeDuration - durS);
      onTrimVideoClip(newStart, newStart + durS);
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

  const dragLeftPct = regionDrag
    ? clampPct((Math.min(regionDrag.startS, regionDrag.endS) / safeDuration) * 100)
    : 0;
  const dragWidthPct = regionDrag
    ? clampPct((Math.abs(regionDrag.endS - regionDrag.startS) / safeDuration) * 100)
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
          onPointerDown={beginRegionDrag}
        >
          {/* The clip itself — a sub-bar spanning the in/out window. Hover
           * reveals white trim lines at both edges (col-resize); the body
           * drags the window once it's been trimmed. Disabled while a
           * cut/speed tool is active so region drags win — `beginDrag`
           * itself already no-ops in that case, `pointer-events-none`
           * here just also lets clicks fall through to the track under it
           * so a region can still be started *on top of* the clip. */}
          <div
            className={`group absolute top-0 flex h-full items-center justify-center overflow-hidden rounded-md bg-amber-600/70 ${
              tool !== "none"
                ? "pointer-events-none"
                : activeDrag?.kind === "video-move"
                  ? "cursor-grabbing"
                  : "cursor-grab"
            }`}
            style={{
              left: `${clampPct((clipStartS / safeDuration) * 100)}%`,
              width: `${clampPct(((clipEndS - clipStartS) / safeDuration) * 100)}%`,
            }}
            onPointerDown={handleVideoMove}
            title={`Clip ${formatTime(clipStartS)}–${formatTime(clipEndS)}`}
          >
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-amber-950">
              Clip · {formatTime(clipStartS)}–{formatTime(clipEndS)}
            </span>
            <div
              onPointerDown={(e) => handleVideoTrim(e, "left")}
              className={`absolute inset-y-0 left-0 w-1.5 cursor-col-resize bg-white transition-opacity ${
                activeDrag?.kind === "video-trim-left"
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              }`}
              title="Trim start"
            />
            <div
              onPointerDown={(e) => handleVideoTrim(e, "right")}
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
                  onPointerDown={(e) => e.stopPropagation()}
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
                  onPointerDown={(e) => e.stopPropagation()}
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
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-950/80 text-neutral-200 opacity-0 group-hover:opacity-100"
                  aria-label="Remove speed region"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}

          {regionDrag && (
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
          onPointerDown={beginRegionDrag}
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
                    ? "pointer-events-none"
                    : activeDrag?.kind === "zoom-move" && activeDrag?.index === index
                      ? "cursor-grabbing"
                      : "cursor-grab"
                }`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                title={`Zoom ${kf.level.toFixed(1)}x`}
                onPointerDown={(e) => handleZoomMove(e, kf, index)}
              >
                {widthPct > 6 ? `${kf.level.toFixed(1)}x` : ""}
                <div
                  onPointerDown={(e) => handleZoomTrim(e, kf, index, "left")}
                  className={`absolute inset-y-0 left-0 w-1.5 cursor-col-resize bg-white transition-opacity ${
                    activeDrag?.kind === "zoom-trim-left" && activeDrag?.index === index
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                  title="Trim zoom start"
                />
                <div
                  onPointerDown={(e) => handleZoomTrim(e, kf, index, "right")}
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
