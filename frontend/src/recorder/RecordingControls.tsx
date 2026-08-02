import { Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * The toolbar's contents *while a recording is in progress* — replaces
 * `SourcePickerBar` entirely (the source/target picker doesn't make sense
 * once capture has already started against a fixed target). Stop, pause/
 * resume, restart (discard + start over), and discard are all real,
 * wired to `useRecordingState`.
 */
export function RecordingControls({
  elapsedMs,
  isPaused,
  busy,
  onStop,
  onTogglePause,
  onRestart,
  onDiscard,
}: {
  elapsedMs: number;
  isPaused: boolean;
  busy: boolean;
  onStop: () => void;
  onTogglePause: () => void;
  onRestart: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-neutral-800 bg-neutral-900/95 px-2 py-2 shadow-2xl backdrop-blur">
      <button
        type="button"
        disabled={busy}
        onClick={onStop}
        className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-red-500 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Stop recording"
        title="Stop recording"
      >
        <Square className="h-3.5 w-3.5" fill="currentColor" />
        {formatElapsed(elapsedMs)}
      </button>

      <div className="mx-1 h-8 w-px bg-neutral-800" />

      <button
        type="button"
        disabled={busy}
        onClick={onTogglePause}
        className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={isPaused ? "Resume recording" : "Pause recording"}
        title={isPaused ? "Resume" : "Pause"}
      >
        {isPaused ? (
          <Play className="h-4 w-4" fill="currentColor" />
        ) : (
          <Pause className="h-4 w-4" fill="currentColor" />
        )}
      </button>

      <div className="mx-1 h-8 w-px bg-neutral-800" />

      <button
        type="button"
        disabled={busy}
        onClick={onRestart}
        className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Restart recording"
        title="Restart recording (discards current progress)"
      >
        <RotateCcw className="h-4 w-4" />
      </button>

      <div className="mx-1 h-8 w-px bg-neutral-800" />

      <button
        type="button"
        disabled={busy}
        onClick={onDiscard}
        className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-red-950 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Discard recording"
        title="Discard recording"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
