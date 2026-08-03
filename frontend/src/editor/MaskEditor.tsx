import { EyeOff } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { applyHandleDelta, HANDLE_POSITIONS } from "./CropEditor";
import { clampCropRect, type CropRect } from "./crop";
import type { MaskType } from "./masks";

/**
 * The selected mask's on-canvas box — reuses `CropEditor.tsx`'s 8-handle
 * drag interaction (`applyHandleDelta`/`HANDLE_POSITIONS`) verbatim, since
 * "drag/resize a rect within a frame" is the exact same gesture crop
 * already implemented; only the *visual treatment* differs, and differs
 * *by mask type* (see `masks.ts`'s module doc comment for what each type
 * actually does):
 *
 *  - "highlight" looks like crop's own overlay (dim outside, clear inside)
 *    since that's literally the same effect: the box stays visible, the
 *    rest darkens.
 *  - "sensitive" doesn't dim the outside at all (nothing out there is
 *    affected) — instead the box itself gets a live `backdrop-blur` (a
 *    real, on-canvas preview of the blur the renderer bakes in, not just a
 *    placeholder) plus an eye-slash glyph, so it reads as "this part gets
 *    redacted" rather than "this part is excluded."
 *
 * Unlike `CropOverlay` (a draft-then-Confirm/Discard workflow — see
 * `CropEditor.tsx`'s module doc comment), this edits `EditorDocument.masks`
 * live, the same as every other panel: `onChangeRect` is a
 * `setDocTransient` call and `onCommit` is `commitDoc`, called once on
 * drag release.
 */
export function MaskOverlay({
  rect,
  onChangeRect,
  onCommit,
  type,
  frameWidth,
  frameHeight,
  contentRect,
  canvasPxWidth,
  canvasPxHeight,
  canvasRef,
}: {
  rect: CropRect;
  /** Live update, called continuously while dragging a handle. */
  onChangeRect: (next: CropRect) => void;
  /** Turns whatever's accumulated since the last commit into a single undo
   * step (see `history.ts`) — called once, on drag release. */
  onCommit: () => void;
  type: MaskType;
  /** The *effective* frame's point-space dimensions (the confirmed crop's
   * own size once one exists, the full recording otherwise) — see
   * `MaskClip.rect`'s doc comment for why this differs from
   * `CropOverlay`'s `sourceFrameWidth`/`sourceFrameHeight`, which are
   * always the *original*, pre-crop dimensions. */
  frameWidth: number;
  frameHeight: number;
  /** Where the video is actually drawn within the canvas — same units/
   * source as `CropOverlay`'s identical prop (`renderer.ts`'s
   * `computeContentRect`). */
  contentRect: { x: number; y: number; width: number; height: number };
  canvasPxWidth: number;
  canvasPxHeight: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function measure() {
      const c = canvasRef.current;
      const parent = c?.offsetParent as HTMLElement | null;
      if (!c || !parent) return;
      const canvasRect = c.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const canvasLeft = canvasRect.left - parentRect.left;
      const canvasTop = canvasRect.top - parentRect.top;
      const cssPerPxX = canvasRect.width / canvasPxWidth;
      const cssPerPxY = canvasRect.height / canvasPxHeight;
      setBox({
        left: canvasLeft + contentRect.x * cssPerPxX,
        top: canvasTop + contentRect.y * cssPerPxY,
        width: contentRect.width * cssPerPxX,
        height: contentRect.height * cssPerPxY,
      });
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
    // Primitive fields rather than the `contentRect` object itself — see
    // `CropOverlay`'s identical effect for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, contentRect.x, contentRect.y, contentRect.width, contentRect.height, canvasPxWidth, canvasPxHeight]);

  if (!box) return null;

  const scaleX = box.width / frameWidth;
  const scaleY = box.height / frameHeight;
  const left = rect.x * scaleX;
  const top = rect.y * scaleY;
  const width = rect.width * scaleX;
  const height = rect.height * scaleY;

  function beginDrag(e: React.PointerEvent, kind: Parameters<typeof applyHandleDelta>[0]) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const start = rect;
    target.setPointerCapture(pointerId);

    const handleMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startClientX) / scaleX;
      const dy = (ev.clientY - startClientY) / scaleY;
      onChangeRect(clampCropRect(applyHandleDelta(kind, start, dx, dy), frameWidth, frameHeight));
    };
    const handleEnd = () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleEnd);
      target.removeEventListener("pointercancel", handleEnd);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      onCommit();
    };
    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleEnd);
    target.addEventListener("pointercancel", handleEnd);
  }

  return (
    <div className="pointer-events-none absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      {type === "highlight" && (
        <>
          <div className="absolute inset-x-0 top-0 bg-black/70" style={{ height: top }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/70" style={{ top: top + height }} />
          <div className="absolute left-0 bg-black/70" style={{ top, height, width: left }} />
          <div className="absolute right-0 bg-black/70" style={{ top, height, left: left + width }} />
        </>
      )}

      <div
        className={`pointer-events-auto absolute cursor-move border-2 ${
          type === "sensitive" ? "border-rose-400 bg-white/5 backdrop-blur-md" : "border-amber-300"
        }`}
        style={{ left, top, width, height }}
        onPointerDown={(e) => beginDrag(e, "move")}
      >
        {type === "sensitive" ? (
          <div className="pointer-events-none flex h-full w-full items-center justify-center">
            <EyeOff className="h-5 w-5 text-white/80 drop-shadow" />
          </div>
        ) : (
          // Rule-of-thirds grid, same alignment aid `CropOverlay` shows.
          <>
            {[1 / 3, 2 / 3].map((f) => (
              <div key={`v${f}`} className="absolute inset-y-0 w-px border-l border-dashed border-white/40" style={{ left: `${f * 100}%` }} />
            ))}
            {[1 / 3, 2 / 3].map((f) => (
              <div key={`h${f}`} className="absolute inset-x-0 h-px border-t border-dashed border-white/40" style={{ top: `${f * 100}%` }} />
            ))}
          </>
        )}

        {HANDLE_POSITIONS.map(({ kind, className, cursor }) => (
          <div
            key={kind}
            onPointerDown={(e) => beginDrag(e, kind)}
            className={`absolute h-3 w-3 rounded-full border-2 border-white bg-neutral-900 ${className} ${cursor}`}
          />
        ))}
      </div>
    </div>
  );
}
