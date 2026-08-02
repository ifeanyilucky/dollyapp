import { MicToggle } from "./MicToggle";
import { TargetPicker } from "./TargetPicker";
import { useRecordingState } from "./useRecordingState";

/**
 * Minimal recorder screen — a Start/Stop button plus pause/resume, all
 * reflecting the same state the tray menu and `⌥⌘2` control (PRD §9: menu
 * bar is the primary entry point, this window included for completeness).
 * Region selection isn't built yet — `TargetPicker` only covers whole
 * displays/windows. System audio isn't built yet either (see
 * `src-tauri/src/recorder`'s doc comment) — `MicToggle` is mic-only.
 */
export function RecorderView() {
  const { isRecording, isPaused, busy, error, lastRecordingPath, start, stop, togglePause } =
    useRecordingState();

  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-neutral-950 text-neutral-300">
      <h1 className="text-lg font-medium text-neutral-100">Dolly</h1>

      <TargetPicker disabled={isRecording || busy} />
      <MicToggle disabled={isRecording || busy} />

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

      {!isRecording && lastRecordingPath && (
        <p className="max-w-sm text-center text-xs text-neutral-500">
          Saved to <span className="text-neutral-400">{lastRecordingPath}</span>
        </p>
      )}
    </main>
  );
}
