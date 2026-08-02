import { ArrowLeft, ChevronDown, Gauge, Trash2 } from "lucide-react";
import { useState } from "react";
import { SLICE_SPEED_PRESETS, type ClipSlice, type SliceCursorOverride } from "./slices";
import { Toggle } from "./Toggle";

/**
 * Per-slice editor — appears in place of the Style/Cursor panel once a
 * slice on the timeline is selected (see `EditorView`). Speed and the
 * cursor override are both real, per-slice settings; "Remove slice"
 * marks it `removed` (skipped during playback, same mechanism the old
 * drag-selected cut regions used) rather than actually deleting anything,
 * since there's no export pipeline yet to ripple-delete from.
 */
export function SliceEditorPanel({
  slice,
  onChange,
  onApplySpeedToAll,
  onRemove,
  canRemove,
  onClose,
}: {
  slice: ClipSlice;
  onChange: (next: ClipSlice) => void;
  onApplySpeedToAll: () => void;
  onRemove: () => void;
  canRemove: boolean;
  onClose: () => void;
}) {
  const [cursorExpanded, setCursorExpanded] = useState(false);

  const override: SliceCursorOverride = slice.cursorOverride ?? {
    hideCursor: false,
    disableSmoothMovement: false,
  };

  function setOverride(next: Partial<SliceCursorOverride>) {
    onChange({ ...slice, cursorOverride: { ...override, ...next } });
  }

  return (
    <div className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto rounded-xl border border-neutral-800/80 bg-neutral-950/70 p-5">
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 self-start rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] font-medium text-neutral-200 hover:bg-neutral-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Close Slice editor
      </button>

      <div>
        <h3 className="mb-2.5 text-[13px] font-medium text-neutral-200">Speed</h3>
        <div className="flex flex-wrap gap-1.5">
          {SLICE_SPEED_PRESETS.map((speed) => (
            <button
              key={speed}
              type="button"
              onClick={() => onChange({ ...slice, speed })}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                slice.speed === speed
                  ? "border-indigo-400 bg-neutral-900 text-neutral-50"
                  : "border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700"
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onApplySpeedToAll}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 hover:bg-neutral-800"
      >
        <Gauge className="h-3.5 w-3.5" />
        Apply speed to all slices
      </button>

      <div className="border-t border-neutral-800" />

      <div>
        <button
          type="button"
          onClick={() => setCursorExpanded((v) => !v)}
          className="flex w-full items-start justify-between gap-4"
        >
          <div className="text-left">
            <p className="text-[13px] font-medium text-neutral-200">Cursor settings</p>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
              Change appearance of mouse cursor in this part of the recording.
            </p>
          </div>
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300 transition-transform ${
              cursorExpanded ? "rotate-180" : ""
            }`}
          >
            <ChevronDown className="h-4 w-4" />
          </span>
        </button>

        {cursorExpanded && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[13px] font-medium text-neutral-200">Hide cursor</span>
              <Toggle checked={override.hideCursor} onChange={(v) => setOverride({ hideCursor: v })} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <span className="text-[13px] font-medium text-neutral-200">Disable smooth mouse movement</span>
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                  This is useful, for example, when recording drop-down menus, where precise alignment is
                  required.
                </p>
              </div>
              <Toggle
                checked={override.disableSmoothMovement}
                onChange={(v) => setOverride({ disableSmoothMovement: v })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-neutral-800" />

      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        title={canRemove ? undefined : "Split the clip first — there must be at least one slice left"}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 hover:bg-red-950 hover:text-red-400 disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-neutral-900"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove slice
      </button>
    </div>
  );
}
