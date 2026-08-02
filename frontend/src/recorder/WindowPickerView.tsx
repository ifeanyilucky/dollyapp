import { Circle, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cancelWindowPicker,
  pickWindowAndRecord,
  windowInfoAtCursor,
  windowInfoAtPoint,
  type WindowInfo,
} from "./targets";

/**
 * Root component for the window-picker overlay window (see
 * `open_window_picker` — a separate, transparent, always-on-top window
 * covering the main display, same setup as the area selector). Instead of
 * listing windows in a menu, the user moves their cursor over a window:
 * it gets a purple highlight + a label showing the app name and its
 * current on-screen size, and a "Start recording" button that records
 * that window right away. Escape cancels; clicking the highlighted window
 * is the same as clicking Start.
 *
 * Coordinates: the overlay window sits exactly on the main display's
 * origin (`open_window_picker` positions it at `display_bounds`), so the
 * webview's `clientX/clientY` and the windows' hit-test bounds share one
 * global point space. The `ox`/`oy` URL params carry that origin for the
 * rare setup where it isn't (0, 0).
 */
export function WindowPickerView() {
  const params = new URLSearchParams(window.location.search);
  const originX = Number(params.get("ox") ?? "0");
  const originY = Number(params.get("oy") ?? "0");

  const [windowInfo, setWindowInfo] = useState<WindowInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coalescing: only one hit-test invoke in flight at a time, always
  // answering against the latest cursor position, and never re-rendering
  // when the window under the cursor hasn't actually changed.
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const inFlightRef = useRef(false);
  const lastInfoRef = useRef<WindowInfo | null>(null);

  // A transparent Tauri window still sits on an opaque `<html>/<body>`
  // canvas by default — clear it explicitly, like `AreaSelectorView`.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  // Seed the highlight with the window under the cursor right now, so the
  // overlay shows something the moment it opens instead of waiting for the
  // first mousemove.
  useEffect(() => {
    let cancelled = false;
    void windowInfoAtCursor().then((info) => {
      if (!cancelled) {
        lastInfoRef.current = info;
        setWindowInfo(info);
      }
    });
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") void cancelWindowPicker();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function onMouseMove(e: React.MouseEvent) {
    pendingRef.current = { x: originX + e.clientX, y: originY + e.clientY };
    void pump();
  }

  async function pump() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      let point: { x: number; y: number } | null;
      while ((point = pendingRef.current)) {
        pendingRef.current = null;
        let info: WindowInfo | null;
        try {
          info = await windowInfoAtPoint(point.x, point.y);
        } catch {
          continue;
        }
        const prev = lastInfoRef.current;
        const unchanged =
          info !== null &&
          prev !== null &&
          info.windowId === prev.windowId &&
          info.x === prev.x &&
          info.y === prev.y &&
          info.width === prev.width &&
          info.height === prev.height;
        if (!unchanged) {
          lastInfoRef.current = info;
          setWindowInfo(info);
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }

  async function startRecording() {
    if (!windowInfo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await pickWindowAndRecord(windowInfo.windowId);
      // On success the Rust side closes this overlay window.
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const info = windowInfo;
  const rect = info
    ? {
        left: info.x - originX,
        top: info.y - originY,
        width: info.width,
        height: info.height,
      }
    : null;

  return (
    <div className="fixed inset-0 cursor-crosshair select-none" onMouseMove={onMouseMove}>
      {/* Dim the whole screen underneath the highlight. */}
      <div className="absolute inset-0 bg-black/35" />

      {rect && (
        <>
          {/* Push the dim further down everywhere *except* the hovered
              window (the div's own rect stays transparent). */}
          <div
            className="absolute"
            style={{ ...rect, boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)" }}
          />
          {/* Purple highlight on the window itself — click records it. */}
          <div
            className="absolute border-2 border-purple-400/90 bg-purple-500/25"
            style={{ ...rect, borderRadius: 6 }}
            onClick={(e) => {
              e.stopPropagation();
              void startRecording();
            }}
          />
        </>
      )}

      {/* Window label + Start recording — centered on the *hovered
          window's own rect*, not the screen, so it sits over whatever
          you're about to record rather than always sitting in the middle
          of the display regardless of where that window actually is.
          `overflow-visible` (the default) lets the content spill outside
          a window rect that's smaller than the label/button need. */}
      {rect ? (
        <div
          className="pointer-events-none absolute flex flex-col items-center justify-center gap-4"
          style={rect}
        >
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-neutral-900/90 px-4 py-2.5 shadow-2xl backdrop-blur">
            <div className="text-center">
              <p className="truncate text-[14px] font-semibold leading-tight text-white">
                {info?.ownerName || info?.title || "Window"}
              </p>
              <p className="truncate text-[11px] leading-tight text-neutral-400">
                {info?.title && `${info.title} · `}
                {info && `${Math.round(info.width)} × ${Math.round(info.height)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void startRecording()}
            className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-red-600 px-6 py-3 text-[15px] font-semibold text-white shadow-2xl ring-4 ring-red-600/30 transition-all hover:bg-red-500 hover:ring-red-500/30 disabled:opacity-50"
          >
            {busy ? (
              <LoaderCircle className="h-4.5 w-4.5 animate-spin" />
            ) : (
              <Circle className="h-4.5 w-4.5" fill="currentColor" />
            )}
            {busy ? "Starting…" : "Start recording"}
          </button>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg bg-black/70 px-4 py-2 text-[13px] text-neutral-200 shadow-xl backdrop-blur">
            Move your cursor over a window to record it
          </div>
        </div>
      )}

      {error && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-red-950/90 px-3 py-2 text-[12px] text-red-200 shadow-xl">
          <X className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
    </div>
  );
}
