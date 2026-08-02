import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
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

  // A transparent Tauri window still sits on an opaque `<html>/<body>`
  // canvas by default — clear it explicitly, like `AreaSelectorView` and
  // `WindowPickerView`. Without this the WKWebView's default background
  // shows through as a faded box the size of the whole (much bigger than
  // the pill) window, most visible once the pill shrinks to the compact
  // `RecordingControls` during recording — and gets captured in the
  // recording itself.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  // Custom "drag from anywhere" instead of Tauri's `data-tauri-drag-region`
  // (which is what the old comment below described): the built-in handler
  // won't start a drag from any clickable element (button/link/...) and it
  // steals the mousedown the instant it fires, so pressing on the pill's
  // buttons could never move the window and clicking a button would fight
  // with the drag. This instead waits for a few pixels of movement after
  // mousedown before handing off to the OS window drag (`startDragging`),
  // so a plain click still lands on the control underneath while pressing
  // and holding anywhere drags the toolbar. Both the picker (non-recording)
  // and the recording controls live under this root, so both modes get it.
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const DRAG_THRESHOLD_PX = 4;

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    // A fresh press is never a drag yet — clears any leftover "suppress
    // the next click" flag from a drag that ended without delivering one.
    suppressClickRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const start = dragStartRef.current;
    if (!start) return;
    if (e.buttons === 0) {
      dragStartRef.current = null;
      return;
    }
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    dragStartRef.current = null;
    suppressClickRef.current = true;
    getCurrentWindow()
      .startDragging()
      .catch(() => {
        suppressClickRef.current = false;
      });
  }

  function handlePointerUp() {
    dragStartRef.current = null;
  }

  // The OS window drag eats the mouseup, but a synthesized click can still
  // arrive on the element the press started on — swallow it so a drag that
  // began on a button doesn't also trigger that button.
  function handleClickCapture(e: React.MouseEvent) {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
    }
  }

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

  // Native `window.confirm()` isn't reliable in this window — it's
  // undecorated/transparent/always-on-top, and WKWebView's default dialog
  // handling doesn't consistently attach a visible panel to a window like
  // that, so the call can silently no-op instead of actually prompting.
  // `@tauri-apps/plugin-dialog` shows a real native alert independent of
  // the window's own chrome.
  async function handleDiscard() {
    const confirmed = await confirm("Discard this recording? This can't be undone.", {
      title: "Discard recording",
      kind: "warning",
    });
    if (!confirmed) return;
    await discard();
  }

  async function handleRestart() {
    const confirmed = await confirm("Restart recording? The current progress will be discarded.", {
      title: "Restart recording",
      kind: "warning",
    });
    if (!confirmed) return;
    await restart();
  }

  return (
    <div
      className="flex h-screen w-screen items-start justify-center bg-transparent pt-2"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClickCapture={handleClickCapture}
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
