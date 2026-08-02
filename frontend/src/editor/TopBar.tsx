import {
  ChevronLeft,
  Crop,
  Eye,
  EyeOff,
  Folder,
  Gauge,
  Redo2,
  Shapes,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";

const SPEED_STEPS = [1, 1.5, 2, 0.5];

/**
 * Top toolbar. Real actions: reveal-in-Finder, delete (confirms first),
 * cursor-overlay toggle, playback-speed cycling. Undo/redo and Presets
 * are inert — there's no edit-history system or preset library yet.
 * "Export" currently reveals the bundle in Finder rather than rendering
 * an output file — a true export (motion/style baked in) isn't built.
 * Aspect ratio / Crop / Mask are placeholders — switching aspect ratio is
 * a separate, larger feature (see project tasks).
 */
export function TopBar({
  title,
  aspectLabel,
  showCursor,
  onToggleCursor,
  playbackRate,
  onCyclePlaybackRate,
  onRevealInFinder,
  onDelete,
  onClose,
}: {
  title: string;
  aspectLabel: string;
  showCursor: boolean;
  onToggleCursor: () => void;
  playbackRate: number;
  onCyclePlaybackRate: () => void;
  onRevealInFinder: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex w-full flex-col border-b border-neutral-800/80 bg-neutral-950">
      <div className="flex items-center gap-1 px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
          aria-label="Back to recordings"
          title="Back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRevealInFinder}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
          aria-label="Reveal in Finder"
          title="Reveal in Finder"
        >
          <Folder className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-red-950 hover:text-red-400"
          aria-label="Delete recording"
          title="Delete recording"
        >
          <Trash2 className="h-4 w-4" />
        </button>

        <span className="flex-1 truncate text-center text-[13px] text-neutral-500">{title}</span>

        <button
          type="button"
          disabled
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-700"
          aria-label="Undo (not available yet)"
          title="Undo — not available yet"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-700"
          aria-label="Redo (not available yet)"
          title="Redo — not available yet"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          disabled
          className="ml-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-neutral-600"
          title="Presets — not available yet"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Presets
        </button>

        <button
          type="button"
          onClick={onToggleCursor}
          className={`flex h-7 w-7 items-center justify-center rounded-md ${
            showCursor ? "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200" : "text-indigo-400"
          }`}
          aria-label={showCursor ? "Hide cursor overlay" : "Show cursor overlay"}
          title={showCursor ? "Hide cursor overlay" : "Show cursor overlay"}
        >
          {showCursor ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onCyclePlaybackRate}
          className="flex h-7 items-center gap-1 rounded-md px-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
          aria-label="Playback speed"
          title="Cycle playback speed"
        >
          <Gauge className="h-4 w-4" />
          <span className="text-[11px] font-medium">{playbackRate}x</span>
        </button>

        <button
          type="button"
          onClick={onRevealInFinder}
          className="ml-1 flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-400"
          title="Reveals the recording in Finder — full rendered export isn't built yet"
        >
          <Upload className="h-3.5 w-3.5" />
          Export
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 pb-2.5">
        <span className="flex items-center gap-1.5 rounded-md border border-neutral-800 px-2 py-1 text-[12px] text-neutral-400">
          {aspectLabel}
        </span>
        <span
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-neutral-600"
          title="Crop — not available yet"
        >
          <Crop className="h-3.5 w-3.5" />
          Crop
        </span>
        <span
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-neutral-600"
          title="Mask — not available yet"
        >
          <Shapes className="h-3.5 w-3.5" />
          Mask
        </span>
      </div>
    </div>
  );
}

export function nextPlaybackRate(current: number): number {
  const idx = SPEED_STEPS.indexOf(current);
  return SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
}
