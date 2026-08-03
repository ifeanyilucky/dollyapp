import { useEffect, useState, type RefObject } from "react";
import { applyHandleDelta, HANDLE_POSITIONS } from "./CropEditor";
import { clampCropRect, type CropRect } from "./crop";

/**
 * The selected mask's on-canvas box — reuses `CropEditor.tsx`'s 8-handle
 * drag interaction (`applyHandleDelta`/`HANDLE_POSITIONS`) verbatim, since
 * "drag/resize a rect within a frame" is the exact same gesture crop
 * already implemented. Deliberately does *not* draw its own approximation
 * of the mask's actual effect (an earlier version did — a fixed-alpha dim/
 * a CSS `backdrop-blur` standing in for the real thing) — that was its own
 * source of bugs: it didn't reflect the mask's real `opacity`, ignored
 * `disabled` entirely, and could never actually match the canvas's real
 * rendering exactly. Instead, `EditorView` lets the *canvas itself* keep
 * rendering the mask's real, actual effect underneath this overlay
 * whenever it isn't being actively dragged (see its `tick`'s
 * `suppressSelectedMaskRender`) — what you see *is* what gets exported,
 * the same rule every other part of this app already follows — and only
 * swaps to raw, unmasked content for the moment a handle is actually held
 * down, so a "sensitive" box can be lined up against picture that isn't
 * already blurred out from under it. This overlay's only job is the thin
 * outline + drag handles on top of whichever of those two the canvas is
 * currently showing.
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
  onDraggingChange,
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
  /** Whether *any* handle is currently being held down — `EditorView`
   * mirrors this into a ref its render loop reads, to decide whether to
   * show the mask's real effect or briefly suppress it (see the module
   * doc comment). */
  onDraggingChange: (dragging: boolean) => void;
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
    onDraggingChange(true);

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
      onDraggingChange(false);
      onCommit();
    };
    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleEnd);
    target.addEventListener("pointercancel", handleEnd);
  }

  return (
    <div className="pointer-events-none absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <div
        className="pointer-events-auto absolute cursor-move border border-transparent"
        style={{ left, top, width, height }}
        onPointerDown={(e) => beginDrag(e, "move")}
      >
        {HANDLE_POSITIONS.map(({ kind, className, cursor }) => (
          <div
            key={kind}
            onPointerDown={(e) => beginDrag(e, kind)}
            className={`absolute h-2 w-2 rounded-full border border-white bg-neutral-900 ${className} ${cursor}`}
          />
        ))}
      </div>
    </div>
  );
}
