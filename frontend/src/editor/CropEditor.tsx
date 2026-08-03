import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, CornerDownLeft, Crop as CropIcon, Frame, Keyboard } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { ASPECT_RATIO_PRESETS } from "./aspect";
import { centeredCropForAspect, clampCropRect, fullFrameCrop, type CropRect } from "./crop";

/**
 * Crop mode's UI, split into three pieces `EditorView` places at three
 * different spots in its layout (toolbar row above the normal top bar,
 * an interactive overlay directly on the canvas, a Confirm/Discard footer
 * below everything) — all operating on the same `draftCrop`/`onChangeDraft`
 * `EditorView` owns, so the three pieces can never see a different crop
 * than each other. Nothing here touches `EditorDocument` directly: crop
 * mode is an explicit "draft, then Confirm or Discard" workflow (see
 * `EditorView`'s `confirmCrop`/`discardCrop`), not a live-edits-as-you-go
 * one like every other panel, since a crop is a more drastic, deliberate
 * change than a style tweak.
 */

interface CropEditorSharedProps {
  draftCrop: CropRect;
  onChangeDraft: (next: CropRect) => void;
  /** The recording's own point-space dimensions (see `crop.ts`) — the
   * bounds `draftCrop` is clamped within, independent of the output
   * canvas's own (resolution/aspect-driven) pixel size. */
  sourceFrameWidth: number;
  sourceFrameHeight: number;
}

function numberInputClass() {
  return "w-16 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-center text-[12px] text-neutral-200 outline-none focus:border-neutral-600 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
}

/** Parses a text input's value into an integer, falling back to `fallback`
 * for anything that doesn't parse (an empty field while still typing, a
 * stray non-numeric paste) rather than propagating `NaN` into the rect. */
function parseIntOr(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** The Size/Position/Select/Reset row — rendered above the normal top bar
 * while `cropMode` is active. */
export function CropToolbar({ draftCrop, onChangeDraft, sourceFrameWidth, sourceFrameHeight }: CropEditorSharedProps) {
  function set(patch: Partial<CropRect>) {
    onChangeDraft(clampCropRect({ ...draftCrop, ...patch }, sourceFrameWidth, sourceFrameHeight));
  }

  return (
    <div className="flex items-center gap-2 border-b border-neutral-800/80 bg-neutral-950 px-4 py-2.5 text-neutral-300">
      <span className="text-[12px] text-neutral-500">Size</span>
      <input
        type="number"
        value={Math.round(draftCrop.width)}
        onChange={(e) => set({ width: parseIntOr(e.target.value, draftCrop.width) })}
        className={numberInputClass()}
        aria-label="Crop width"
      />
      <span className="text-neutral-600">×</span>
      <input
        type="number"
        value={Math.round(draftCrop.height)}
        onChange={(e) => set({ height: parseIntOr(e.target.value, draftCrop.height) })}
        className={numberInputClass()}
        aria-label="Crop height"
      />

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="ml-2 flex items-center gap-1.5 rounded-md border border-neutral-800 px-2.5 py-1.5 text-[12px] text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900"
          >
            <Frame className="h-3.5 w-3.5" />
            Select...
            <ChevronDown className="h-3 w-3 text-neutral-500" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={6}
            align="start"
            className="z-50 min-w-40 rounded-lg border border-neutral-800 bg-neutral-900 p-1 text-neutral-200 shadow-2xl [&_.crop-preset-item]:cursor-pointer [&_.crop-preset-item]:rounded-md [&_.crop-preset-item]:px-2.5 [&_.crop-preset-item]:py-1.5 [&_.crop-preset-item]:text-[12px] [&_.crop-preset-item]:outline-none [&_.crop-preset-item[data-highlighted]]:bg-neutral-800"
          >
            {ASPECT_RATIO_PRESETS.map((p) => (
              <DropdownMenu.Item
                key={p.id}
                className="crop-preset-item"
                onSelect={() => onChangeDraft(centeredCropForAspect(sourceFrameWidth, sourceFrameHeight, p.ratio))}
              >
                {p.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <span className="ml-3 text-[12px] text-neutral-500">Position</span>
      <input
        type="number"
        value={Math.round(draftCrop.x)}
        onChange={(e) => set({ x: parseIntOr(e.target.value, draftCrop.x) })}
        className={numberInputClass()}
        aria-label="Crop X position"
      />
      <input
        type="number"
        value={Math.round(draftCrop.y)}
        onChange={(e) => set({ y: parseIntOr(e.target.value, draftCrop.y) })}
        className={numberInputClass()}
        aria-label="Crop Y position"
      />

      <button
        type="button"
        onClick={() => onChangeDraft(fullFrameCrop(sourceFrameWidth, sourceFrameHeight))}
        className="ml-3 flex items-center gap-1.5 rounded-md border border-neutral-800 px-2.5 py-1.5 text-[12px] text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900"
      >
        <CropIcon className="h-3.5 w-3.5" />
        Reset
      </button>

      <div className="flex-1" />

      <div
        className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500"
        title="Arrow keys nudge the crop by 1px, Shift+arrow by 10px"
      >
        <Keyboard className="h-4 w-4" />
      </div>
    </div>
  );
}

export type HandleKind = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

/** How dragging by `(dx, dy)` (canvas-pixel space) from the rect captured
 * at drag-start transforms it, per handle. `move` (dragging the crop
 * body, not an edge/corner) translates without resizing. Exported —
 * `MaskEditor.tsx`'s `MaskOverlay` reuses this verbatim (a mask's on-canvas
 * box is the exact same "8 handles + move" rect-editing interaction as
 * crop's, just applied to a sub-region rather than the whole frame). */
export function applyHandleDelta(kind: HandleKind, start: CropRect, dx: number, dy: number): CropRect {
  switch (kind) {
    case "move":
      return { ...start, x: start.x + dx, y: start.y + dy };
    case "nw":
      return { x: start.x + dx, y: start.y + dy, width: start.width - dx, height: start.height - dy };
    case "n":
      return { ...start, y: start.y + dy, height: start.height - dy };
    case "ne":
      return { ...start, y: start.y + dy, width: start.width + dx, height: start.height - dy };
    case "e":
      return { ...start, width: start.width + dx };
    case "se":
      return { ...start, width: start.width + dx, height: start.height + dy };
    case "s":
      return { ...start, height: start.height + dy };
    case "sw":
      return { ...start, x: start.x + dx, width: start.width - dx, height: start.height + dy };
    case "w":
      return { ...start, x: start.x + dx, width: start.width - dx };
  }
}

/** Exported for `MaskOverlay`'s reuse — see `applyHandleDelta`. */
export const HANDLE_POSITIONS: { kind: HandleKind; className: string; cursor: string }[] = [
  { kind: "nw", className: "-left-1.5 -top-1.5", cursor: "cursor-nwse-resize" },
  { kind: "ne", className: "-right-1.5 -top-1.5", cursor: "cursor-nesw-resize" },
  { kind: "sw", className: "-left-1.5 -bottom-1.5", cursor: "cursor-nesw-resize" },
  { kind: "se", className: "-right-1.5 -bottom-1.5", cursor: "cursor-nwse-resize" },
  { kind: "n", className: "-top-1.5 left-1/2 -translate-x-1/2", cursor: "cursor-ns-resize" },
  { kind: "s", className: "-bottom-1.5 left-1/2 -translate-x-1/2", cursor: "cursor-ns-resize" },
  { kind: "w", className: "-left-1.5 top-1/2 -translate-y-1/2", cursor: "cursor-ew-resize" },
  { kind: "e", className: "-right-1.5 top-1/2 -translate-y-1/2", cursor: "cursor-ew-resize" },
];

/**
 * The interactive part — dims everything outside `draftCrop`, draws a
 * rule-of-thirds grid and 8 drag handles inside it. Rendered as an
 * absolutely-positioned sibling of the `<canvas>` element (see
 * `EditorView`, which makes the canvas's wrapper `relative` for exactly
 * this), sized/positioned to match not the canvas's own on-screen box but
 * specifically the *video content*'s box within it (`contentRect`, in
 * canvas-pixel space — padding around it isn't part of the recording, so
 * there's nothing to crop-select there) — tracked live via
 * `ResizeObserver` since that box changes with the window, the sidebar,
 * and preview-mode toggling, none of which this component hears about
 * directly.
 *
 * All drag math happens in *source-point* space (the same space
 * `draftCrop` itself is in — see `crop.ts`), converting from on-screen CSS
 * pixels via the measured content box's scale (canvas-pixel -> CSS, via
 * `canvasPxWidth`/`canvasPxHeight` vs. the box's own measured size, then
 * source-point -> canvas-pixel, via `contentRect` vs.
 * `sourceFrameWidth`/`sourceFrameHeight`) — composed into one factor so
 * call sites don't need to care that two different unit conversions are
 * actually happening.
 */
export function CropOverlay({
  draftCrop,
  onChangeDraft,
  sourceFrameWidth,
  sourceFrameHeight,
  contentRect,
  canvasPxWidth,
  canvasPxHeight,
  canvasRef,
}: CropEditorSharedProps & {
  /** Where the video is actually drawn within the canvas — same units as
   * `canvasPxWidth`/`canvasPxHeight` (canvas-pixel space, not CSS or
   * source-point space) — see `renderer.ts`'s `computeContentRect`, which
   * `EditorView` calls with the exact same inputs `SceneRenderer` itself
   * uses, so this can never drift from where the video is really drawn. */
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
      // Canvas-pixel -> CSS-pixel scale, then apply it to `contentRect` to
      // get the *content* box's on-screen position/size specifically,
      // rather than the whole (possibly padded) canvas's.
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
    // Primitive fields rather than the `contentRect` object itself, which
    // is a fresh literal every `EditorView` render (including every
    // pointermove while dragging a handle) — depending on the object
    // would tear this `ResizeObserver` down and rebuild it that often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, contentRect.x, contentRect.y, contentRect.width, contentRect.height, canvasPxWidth, canvasPxHeight]);

  if (!box) return null;

  const scaleX = box.width / sourceFrameWidth;
  const scaleY = box.height / sourceFrameHeight;
  const cropLeft = draftCrop.x * scaleX;
  const cropTop = draftCrop.y * scaleY;
  const cropWidth = draftCrop.width * scaleX;
  const cropHeight = draftCrop.height * scaleY;

  function beginDrag(e: React.PointerEvent, kind: HandleKind) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const start = draftCrop;
    target.setPointerCapture(pointerId);

    const handleMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startClientX) / scaleX;
      const dy = (ev.clientY - startClientY) / scaleY;
      onChangeDraft(clampCropRect(applyHandleDelta(kind, start, dx, dy), sourceFrameWidth, sourceFrameHeight));
    };
    const handleEnd = () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleEnd);
      target.removeEventListener("pointercancel", handleEnd);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    };
    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleEnd);
    target.addEventListener("pointercancel", handleEnd);
  }

  return (
    <div className="pointer-events-none absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      {/* Dims everything outside the crop rect — four bands (top/bottom
       * span the full width, left/right fill exactly the crop's own
       * height) rather than a single overlay with a cutout, since Canvas/
       * DOM has no cheap "punch a hole" primitive without SVG masking. */}
      <div className="absolute inset-x-0 top-0 bg-black/60" style={{ height: cropTop }} />
      <div className="absolute inset-x-0 bottom-0 bg-black/60" style={{ top: cropTop + cropHeight }} />
      <div className="absolute left-0 bg-black/60" style={{ top: cropTop, height: cropHeight, width: cropLeft }} />
      <div
        className="absolute right-0 bg-black/60"
        style={{ top: cropTop, height: cropHeight, left: cropLeft + cropWidth }}
      />

      <div
        className="pointer-events-auto absolute cursor-move border border-white/80"
        style={{ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight }}
        onPointerDown={(e) => beginDrag(e, "move")}
      >
        {/* Rule-of-thirds grid — purely visual, matches every other crop
         * tool's alignment aid. */}
        {[1 / 3, 2 / 3].map((f) => (
          <div key={`v${f}`} className="absolute inset-y-0 w-px border-l border-dashed border-white/40" style={{ left: `${f * 100}%` }} />
        ))}
        {[1 / 3, 2 / 3].map((f) => (
          <div key={`h${f}`} className="absolute inset-x-0 h-px border-t border-dashed border-white/40" style={{ top: `${f * 100}%` }} />
        ))}

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

/** The Confirm/Discard bar — rendered below everything else while
 * `cropMode` is active. */
export function CropFooter({ onConfirm, onDiscard }: { onConfirm: () => void; onDiscard: () => void }) {
  return (
    <div className="flex items-center justify-center gap-3 border-t border-neutral-800/80 bg-neutral-950 px-6 py-4">
      <button
        type="button"
        onClick={onConfirm}
        className="flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-400"
      >
        Confirm changes
        <CornerDownLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="rounded-md border border-neutral-800 px-4 py-2 text-[13px] font-medium text-neutral-300 hover:bg-neutral-900"
      >
        Discard changes
      </button>
    </div>
  );
}

