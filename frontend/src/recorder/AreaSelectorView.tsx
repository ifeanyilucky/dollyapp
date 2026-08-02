import { useEffect, useRef, useState } from "react";
import { cancelAreaSelection, confirmAreaSelection } from "./targets";

interface Point {
  x: number;
  y: number;
}

/** Minimum drag distance (px) before a selection counts as real rather
 * than a stray click — matches the native macOS screenshot tool's feel. */
const MIN_SELECTION_SIZE = 4;

/**
 * Root component for the area-selector overlay window (see
 * `open_area_selector` — a separate, transparent, always-on-top window
 * created just for this, not a route inside the main app window).
 * Dims the whole screen, lets the user drag a rectangle, and on release
 * reports it back to the Rust side and closes itself. Escape cancels.
 */
export function AreaSelectorView() {
  const displayId = Number(new URLSearchParams(window.location.search).get("displayId") ?? "0");

  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const draggingRef = useRef(false);

  // A transparent Tauri window still sits on an opaque `<html>/<body>`
  // canvas by default (`color-scheme` in index.css makes WebKit paint one)
  // — clear it explicitly rather than relying on global CSS that the main
  // window's dark theme also depends on.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") void cancelAreaSelection();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    draggingRef.current = true;
    setStart({ x: e.clientX, y: e.clientY });
    setCurrent({ x: e.clientX, y: e.clientY });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!draggingRef.current) return;
    setCurrent({ x: e.clientX, y: e.clientY });
  }

  function onMouseUp() {
    draggingRef.current = false;
    if (!start || !current) {
      void cancelAreaSelection();
      return;
    }
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    if (width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE) {
      void cancelAreaSelection();
      return;
    }
    void confirmAreaSelection({ displayId, x, y, width, height });
  }

  const rect =
    start && current
      ? {
          x: Math.min(start.x, current.x),
          y: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null;

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {rect ? (
        <div
          className="absolute border border-indigo-400"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
          }}
        >
          <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
        </div>
      ) : (
        <div className="absolute inset-0 bg-black/25" />
      )}
    </div>
  );
}
