import { ArrowLeft, CircleAlert, Crosshair, Highlighter, MousePointerClick, Shield, Trash2 } from "lucide-react";
import { DEFAULT_MASK_OPACITY, type MaskClip, type MaskType } from "./masks";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";

/**
 * Per-mask editor — appears in place of the Style/Cursor panel once a mask
 * clip on the timeline is selected (see `EditorView`), following the same
 * pattern `SliceEditorPanel`/`ZoomEditorPanel` already establish. The
 * masked *region* itself isn't edited here at all — that's a drag/resize
 * box directly on the canvas (`MaskEditor.tsx`'s `MaskOverlay`, shown
 * automatically while this panel is open); this panel only covers what
 * doesn't have an obvious on-canvas equivalent: type, the highlight-only
 * opacity (see `masks.ts`'s doc comment — it dims everything *outside* the
 * box, never the box itself), disabling, and jumping the playhead to it.
 */
export function MaskEditorPanel({
  mask,
  onChange,
  onCommit,
  onRemove,
  onFocusStart,
  onClose,
}: {
  mask: MaskClip;
  /** Live update — called on every change, including every intermediate
   * value during the opacity slider's drag. */
  onChange: (next: MaskClip) => void;
  /** Turns whatever's accumulated since the last commit into a single undo
   * step (see `history.ts`). The opacity slider calls this itself once, on
   * drag release; every discrete control here (type, disabled) calls it
   * immediately after `onChange` via the local `set` helper. */
  onCommit: () => void;
  onRemove: () => void;
  /** Seeks the timeline/playhead to this mask's `startS` — lets a user jump
   * straight to where a mask begins without hunting for it by eye. */
  onFocusStart: () => void;
  onClose: () => void;
}) {
  function set(next: MaskClip) {
    onChange(next);
    onCommit();
  }

  function setType(type: MaskType) {
    set({ ...mask, type });
  }

  return (
    <div className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto rounded-xl border border-neutral-800/80 bg-neutral-950/70 p-5">
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 self-start rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] font-medium text-neutral-200 hover:bg-neutral-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Close Mask editor
      </button>

      <div>
        <h3 className="mb-2.5 text-[13px] font-medium text-neutral-200">Mask type</h3>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setType("sensitive")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              mask.type === "sensitive"
                ? "border-indigo-400 bg-neutral-900 text-neutral-50"
                : "border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700"
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            Sensitive
          </button>
          <button
            type="button"
            onClick={() => setType("highlight")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              mask.type === "highlight"
                ? "border-indigo-400 bg-neutral-900 text-neutral-50"
                : "border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700"
            }`}
          >
            <Highlighter className="h-3.5 w-3.5" />
            Highlight
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onFocusStart}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 hover:bg-neutral-800"
      >
        <Crosshair className="h-3.5 w-3.5" />
        Focus timeline on mask start
      </button>

      <div className="flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
        <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500" />
        <p className="text-[11px] leading-relaxed text-neutral-500">
          Drag the box directly on the video preview to reposition it, or its corners/edges to resize it.
        </p>
      </div>

      <div className="border-t border-neutral-800" />

      {mask.type === "highlight" ? (
        <div>
          <h3 className="text-[13px] font-medium text-neutral-200">Dim outside area</h3>
          <p className="mb-2.5 mt-1 text-[11px] leading-relaxed text-neutral-500">
            How dark everything *outside* the box gets. The box itself always stays at full, normal visibility —
            that's the whole point of a highlight.
          </p>
          <Slider
            value={mask.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(opacity) => onChange({ ...mask, opacity })}
            onCommit={onCommit}
            onReset={() => set({ ...mask, opacity: DEFAULT_MASK_OPACITY })}
          />
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-[11px] leading-relaxed text-amber-200/80">
            Make sure the box covers the sensitive content on screen, and its time range on the timeline covers the
            entire period it's visible for.
          </p>
        </div>
      )}

      <div className="border-t border-neutral-800" />

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <span className="text-[13px] font-medium text-neutral-200">Disable mask</span>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
            Keeps this mask on the timeline without applying it to playback or export.
          </p>
        </div>
        <Toggle checked={mask.disabled} onChange={(v) => set({ ...mask, disabled: v })} />
      </div>

      <div className="border-t border-neutral-800" />

      <button
        type="button"
        onClick={onRemove}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 hover:bg-red-950 hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove mask
      </button>
    </div>
  );
}
