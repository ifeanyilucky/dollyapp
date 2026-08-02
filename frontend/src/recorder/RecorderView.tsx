import { SourcePickerBar } from "./SourcePickerBar";
import { useRecordingState } from "./useRecordingState";

/**
 * Idle/recording screen — `SourcePickerBar` (display/window/area/device +
 * camera/mic/system-audio) plus a Start/Stop/Pause control, all reflecting
 * the same state the tray menu and `⌥⌘2` control (PRD §9: menu bar is the
 * primary entry point, this window included for completeness).
 */
export function RecorderView({ onFinished }: { onFinished: (bundlePath: string) => void }) {
  const { isRecording, isPaused, busy, error, start, stop, togglePause } =
    useRecordingState(onFinished);

  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-neutral-950 text-neutral-300">
      <h1 className="text-lg font-medium text-neutral-100">Dolly</h1>

      <SourcePickerBar disabled={isRecording || busy} />

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void (isRecording ? stop() : start())}
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          {isRecording ? "Stop Recording" : "Start Recording"}
        </button>

        {isRecording && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void togglePause()}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 disabled:opacity-50"
          >
            {isPaused ? "Resume" : "Pause"}
          </button>
        )}
      </div>

      <p className="text-xs text-neutral-500">
        {isRecording ? (isPaused ? "Paused" : "Recording…") : "Idle"} — or press{" "}
        <kbd className="rounded bg-neutral-800 px-1 py-0.5">⌥⌘2</kbd>
      </p>

      {error && <p className="max-w-sm text-center text-xs text-red-400">{error}</p>}
    </main>
  );
}
