import type { ZoomKeyframe } from "../motion-engine";
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "./icons";

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

export function Timeline({
  duration,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
  zoomKeyframes,
  videoStartUs,
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
}) {
  const safeDuration = duration > 0 ? duration : 1;
  const tickInterval = pickTickInterval(safeDuration);
  const ticks: number[] = [];
  for (let t = 0; t <= safeDuration; t += tickInterval) ticks.push(t);
  const playheadPct = clampPct((currentTime / safeDuration) * 100);

  function seekFromPointer(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(frac * safeDuration);
  }

  return (
    <div className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="flex items-center gap-2 pb-3">
        <button
          type="button"
          onClick={() => onSeek(0)}
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label="Skip to start"
        >
          <SkipBackIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          className="rounded p-1.5 text-neutral-200 hover:bg-neutral-800"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={() => onSeek(safeDuration)}
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label="Skip to end"
        >
          <SkipForwardIcon className="h-4 w-4" />
        </button>
        <span className="ml-2 font-mono text-xs text-neutral-500">{formatTime(currentTime)}</span>
        <div className="flex-1" />
        <span className="font-mono text-xs text-neutral-600">{formatTime(safeDuration)}</span>
      </div>

      {/* Ruler + clip track + zoom track, sharing one relative wrapper so
       * the playhead can be positioned once by percentage and span all
       * three. */}
      <div className="relative">
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
          className="relative mt-1 h-9 cursor-pointer overflow-hidden rounded-md bg-amber-600/70"
          onClick={seekFromPointer}
        >
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-amber-950">
            Clip · {formatTime(safeDuration)}
          </span>
        </div>

        <div className="relative mt-1.5 h-7 cursor-pointer rounded-md bg-neutral-800/60" onClick={seekFromPointer}>
          {zoomKeyframes.map((kf) => {
            const startS = (kf.startT - videoStartUs) / 1e6;
            const endS = (kf.endT - videoStartUs) / 1e6;
            const leftPct = clampPct((startS / safeDuration) * 100);
            const widthPct = clampPct(((endS - startS) / safeDuration) * 100);
            if (widthPct <= 0) return null;
            return (
              <div
                key={kf.startT}
                className="pointer-events-none absolute top-0 flex h-full items-center justify-center rounded-md bg-indigo-500/80 text-[10px] font-medium text-white"
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                title={`Zoom ${kf.level.toFixed(1)}x`}
              >
                {widthPct > 6 ? `${kf.level.toFixed(1)}x` : ""}
              </div>
            );
          })}
        </div>

        <div
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-neutral-100"
          style={{ left: `${playheadPct}%` }}
        />
      </div>
    </div>
  );
}
