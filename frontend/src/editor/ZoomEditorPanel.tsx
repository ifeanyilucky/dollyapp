import { ArrowLeft, ChevronDown, Crosshair, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ZoomKeyframe } from "../motion-engine";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";

const MIN_ZOOM_LEVEL = 1;
const MAX_ZOOM_LEVEL = 5;

/**
 * Per-keyframe zoom editor — appears in place of the Style/Cursor panel
 * once a zoom clip on the timeline is selected (see `EditorView`). Level,
 * pan mode, instant animation, disable, and snap-to-edges are all real,
 * wired straight into `MotionEngine`/`viewportForKeyframe` (see
 * `motion-engine/autoZoom.ts`'s `ZoomKeyframe` fields).
 */
export function ZoomEditorPanel({
  keyframe,
  onChange,
  onApplyLevelToAll,
  onRemove,
  onClose,
}: {
  keyframe: ZoomKeyframe;
  onChange: (next: ZoomKeyframe) => void;
  onApplyLevelToAll: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  return (
    <div className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto rounded-xl border border-neutral-800/80 bg-neutral-950/70 p-5">
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 self-start rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] font-medium text-neutral-200 hover:bg-neutral-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Close Zoom editor
      </button>

      <div>
        <h3 className="text-[13px] font-medium text-neutral-200">Zoom level</h3>
        <p className="mb-2.5 mt-1 text-[11px] leading-relaxed text-neutral-500">
          How close to zoom on the cursor during this zoom phase
        </p>
        <Slider
          value={keyframe.level}
          min={MIN_ZOOM_LEVEL}
          max={MAX_ZOOM_LEVEL}
          step={0.1}
          onChange={(level) => onChange({ ...keyframe, level })}
          onReset={() => onChange({ ...keyframe, level: 2 })}
        />
      </div>

      <button
        type="button"
        onClick={onApplyLevelToAll}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 hover:bg-neutral-800"
      >
        <Plus className="h-3.5 w-3.5" />
        Apply zoom level to all other zooms
      </button>

      <div className="border-t border-neutral-800" />

      <div>
        <h3 className="mb-2.5 text-[13px] font-medium text-neutral-200">Zoom mode</h3>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ ...keyframe, panMode: "auto" })}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              keyframe.panMode === "auto"
                ? "border-indigo-400 bg-neutral-900 text-neutral-50"
                : "border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Auto
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...keyframe, panMode: "manual" })}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              keyframe.panMode === "manual"
                ? "border-indigo-400 bg-neutral-900 text-neutral-50"
                : "border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700"
            }`}
          >
            <Crosshair className="h-3.5 w-3.5" />
            Manual
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          Zoomed camera will automatically try to keep the mouse cursor visible.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <span className="text-[13px] font-medium text-neutral-200">Instant animation</span>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
            If enabled, the zoom will be applied instantly without any animation.
          </p>
        </div>
        <Toggle
          checked={keyframe.instantAnimation}
          onChange={(v) => onChange({ ...keyframe, instantAnimation: v })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-[13px] font-medium text-neutral-200">Disable zoom</span>
        <Toggle checked={keyframe.disabled} onChange={(v) => onChange({ ...keyframe, disabled: v })} />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAdvancedExpanded((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <span className="text-[13px] font-medium text-neutral-200">Advanced</span>
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300 transition-transform ${
              advancedExpanded ? "rotate-180" : ""
            }`}
          >
            <ChevronDown className="h-4 w-4" />
          </span>
        </button>

        {advancedExpanded && (
          <div className="mt-4">
            <h4 className="text-[13px] font-medium text-neutral-200">Snap to edges</h4>
            <p className="mb-2.5 mt-1 text-[11px] leading-relaxed text-neutral-500">
              If zoom center is close to edge of recording - it will snap to it, showing a bit of background
              on the side
            </p>
            <Slider
              value={keyframe.snapToEdges}
              min={0}
              max={100}
              onChange={(snapToEdges) => onChange({ ...keyframe, snapToEdges })}
              onReset={() => onChange({ ...keyframe, snapToEdges: 100 })}
            />
          </div>
        )}
      </div>

      <div className="border-t border-neutral-800" />

      <button
        type="button"
        onClick={onRemove}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 hover:bg-red-950 hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove zoom
      </button>
    </div>
  );
}
