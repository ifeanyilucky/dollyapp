import { useEffect } from "react";
import { closeToolbar } from "./api";
import { SourcePickerBar } from "./SourcePickerBar";
import { useRecordingState } from "./useRecordingState";

/**
 * Root component for the floating toolbar window (see `toolbar::show` in
 * the Rust backend — a separate, always-on-top, undecorated, translucent
 * window, not a route inside the regular app window). This is the app's
 * primary UI: by the time it's shown, Screen Recording permission is
 * already guaranteed granted (see `lib.rs::setup`), so unlike the regular
 * window's root this doesn't need `PermissionsGate`.
 *
 * Recording is started/stopped here, but the *result* opens in the
 * regular window instead — see `recorder::RECORDING_FINISHED_EVENT`,
 * which that window listens for, since this is a different webview with
 * no shared React state.
 *
 * The window itself (see `toolbar::show`) is taller than the pill below —
 * top-aligned here, on purpose, so the extra space stays invisible until
 * the Display dropdown needs room to render into it.
 */
export function ToolbarView() {
  const { isRecording, isPaused, busy, error, start, stop, togglePause } = useRecordingState();

  // Escape closes the toolbar (the app keeps running — the tray menu's
  // "Show Toolbar" brings it back). Skipped while a dropdown menu is open,
  // where Escape is already claimed by the menu itself.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !document.querySelector('[role="menu"]')) {
        void closeToolbar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    // `data-tauri-drag-region="deep"` turns the whole window (its visible
    // pill included) into a drag handle, so the floating toolbar can be
    // moved around — Tauri's drag-region script walks the mousedown path
    // and buttons/links without the attribute block the drag, so the
    // controls stay clickable.
    <div
      data-tauri-drag-region="deep"
      className="flex h-screen w-screen justify-center bg-transparent pt-2"
    >
      <div className="flex flex-col items-center gap-1.5">
        <SourcePickerBar
          disabled={isRecording || busy}
          isRecording={isRecording}
          isPaused={isPaused}
          busy={busy}
          onClose={() => void closeToolbar()}
          onToggleRecording={() => void (isRecording ? stop() : start())}
          onTogglePause={() => void togglePause()}
        />
        {error && (
          <p className="max-w-md text-center text-[11px] text-red-400 [text-shadow:0_1px_2px_black]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
