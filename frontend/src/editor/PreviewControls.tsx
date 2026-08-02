import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { formatTime } from "./time";

/**
 * Minimal floating transport bar shown only in preview mode (the top bar's
 * eye dropdown, "Enter preview mode" — see `EditorView`), which hides the
 * full `Timeline` — scrubber, clip track, zoom track — entirely. Without
 * this there'd be no way to play/pause or jump to the start/end while
 * previewing, since those live inside `Timeline` the rest of the time; a
 * click on the canvas also toggles play (see `EditorView`) as a second,
 * even lower-friction way to do the single most common thing.
 *
 * `visible` drives a fade (see `EditorView`'s `previewControlsVisible`) —
 * auto-hidden a few seconds after the mouse stops moving, same convention
 * as a fullscreen video player, but only while playing; paused, there's no
 * "distraction" to clear away from a static frame, so it stays put. The
 * wrapper is `pointer-events-none` and only the pill itself re-enables
 * clicks when visible, so a faded-out bar never blocks a click-to-play on
 * the canvas underneath it.
 */
export function PreviewControls({
  isPlaying,
  currentTime,
  duration,
  clipStartS,
  clipEndS,
  onTogglePlay,
  onSeek,
  visible,
  onPointerEnter,
  onPointerLeave,
}: {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  clipStartS: number;
  clipEndS: number;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  visible: boolean;
  /** Pauses the auto-hide timer while the pointer's over the bar, so it
   * can never fade out from under an in-progress interaction. */
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const safeDuration = duration > 0 ? duration : 1;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
      <div
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        className={`flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900/90 px-3 py-2 shadow-2xl backdrop-blur transition-opacity duration-300 ${
          visible ? "pointer-events-auto opacity-100" : "opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={() => onSeek(clipStartS)}
          className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label="Skip to start"
          title="Skip to start"
        >
          <SkipBack className="h-4 w-4" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          className="rounded-full p-2 text-neutral-100 hover:bg-neutral-800"
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
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
          className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label="Skip to end"
          title="Skip to end"
        >
          <SkipForward className="h-4 w-4" fill="currentColor" />
        </button>
        <span className="ml-2 select-none font-mono text-xs text-neutral-400">
          {formatTime(currentTime)} <span className="text-neutral-600">/</span> {formatTime(safeDuration)}
        </span>
      </div>
    </div>
  );
}
