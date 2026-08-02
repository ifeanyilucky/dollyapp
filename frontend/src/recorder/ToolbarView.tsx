import { useEffect, useRef } from "react";
import { closeToolbar, setToolbarHitRect } from "./api";
import { RecordingControls } from "./RecordingControls";
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
 * The window itself (see `toolbar::show`) is taller *and* wider than the
 * pill below — top-aligned here, on purpose, so the extra space stays
 * invisible until the Display dropdown needs room to render into it. That
 * invisible remainder would otherwise sit on top of, and block clicks
 * into, whatever's underneath it on screen, so the pill's actual bounds
 * get reported to the Rust side (`setToolbarHitRect`) every time they
 * might change, and `toolbar::spawn_hit_test_loop` uses that to keep the
 * rest of the window OS-level click-through.
 */
export function ToolbarView() {
  const { isRecording, isPaused, busy, error, elapsedMs, start, stop, discard, restart, togglePause } =
    useRecordingState();
  const pillRef = useRef<HTMLDivElement>(null);

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

  // Keeps the Rust side's click-through hit-test in sync with the pill's
  // actual bounds — it moves (recording vs. picker mode are different
  // widths/heights) and this window is much bigger than it, so without
  // this the rest of the window would block clicks into whatever's behind
  // it (see `toolbar::spawn_hit_test_loop`).
  useEffect(() => {
    const el = pillRef.current;
    if (!el) return;

    const report = () => {
      // A Radix dropdown's content (the Display picker) portals to
      // `document.body`, outside the pill's own DOM subtree — while one's
      // open, report the *whole* window as interactive instead of just
      // the pill, or the hit-test loop would treat the open menu itself
      // as "outside" and make it unclickable.
      if (document.querySelector('[role="menu"]')) {
        void setToolbarHitRect(0, 0, window.innerWidth, window.innerHeight);
        return;
      }
      const rect = el.getBoundingClientRect();
      void setToolbarHitRect(rect.x, rect.y, rect.width, rect.height);
    };

    report();
    const resizeObserver = new ResizeObserver(report);
    resizeObserver.observe(el);
    // Catches the dropdown's portal mounting/unmounting anywhere under
    // `body` — `ResizeObserver` on the pill alone wouldn't see it, since
    // the portal content isn't a descendant of the pill.
    const menuObserver = new MutationObserver(report);
    menuObserver.observe(document.body, { childList: true, subtree: true });
    return () => {
      resizeObserver.disconnect();
      menuObserver.disconnect();
    };
  }, []);

  async function handleDiscard() {
    if (!window.confirm("Discard this recording? This can't be undone.")) return;
    await discard();
  }

  async function handleRestart() {
    if (!window.confirm("Restart recording? The current progress will be discarded.")) return;
    await restart();
  }

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
      <div ref={pillRef} className="flex flex-col items-center gap-1.5">
        {isRecording ? (
          <RecordingControls
            elapsedMs={elapsedMs}
            isPaused={isPaused}
            busy={busy}
            onStop={() => void stop()}
            onTogglePause={() => void togglePause()}
            onRestart={() => void handleRestart()}
            onDiscard={() => void handleDiscard()}
          />
        ) : (
          <SourcePickerBar
            disabled={busy}
            busy={busy}
            onClose={() => void closeToolbar()}
            onStartRecording={() => void start()}
          />
        )}
        {error && (
          <p className="max-w-md text-center text-[11px] text-red-400 [text-shadow:0_1px_2px_black]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
