import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ChevronDown,
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
import { ASPECT_RATIO_PRESETS, type AspectRatioId } from "./aspect";

const SPEED_STEPS = [1, 1.5, 2, 0.5];

/**
 * Top toolbar. Real actions: reveal-in-Finder, delete (confirms first),
 * cursor-overlay toggle, playback-speed cycling, output aspect ratio
 * (PRD §9, "Horizontal and vertical output"). Undo/redo and Presets are
 * inert — there's no edit-history system or preset library yet. "Export"
 * currently reveals the bundle in Finder rather than rendering an output
 * file — a true export (motion/style baked in) isn't built. Crop / Mask
 * are separate, larger features not covered here.
 */
export function TopBar({
  title,
  aspectRatioId,
  onChangeAspectRatio,
  showCursor,
  onToggleCursor,
  playbackRate,
  onCyclePlaybackRate,
  onRevealInFinder,
  onDelete,
  onClose,
}: {
  title: string;
  aspectRatioId: AspectRatioId;
  onChangeAspectRatio: (id: AspectRatioId) => void;
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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md border border-neutral-800 px-2 py-1 text-[12px] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
            >
              {ASPECT_RATIO_PRESETS.find((p) => p.id === aspectRatioId)?.label}
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={6}
              className="z-50 min-w-[160px] rounded-lg border border-neutral-800 bg-neutral-900 p-1 text-neutral-200 shadow-2xl [&_.aspect-item]:cursor-pointer [&_.aspect-item]:rounded-md [&_.aspect-item]:px-2.5 [&_.aspect-item]:py-1.5 [&_.aspect-item]:text-[12px] [&_.aspect-item]:outline-none [&_.aspect-item[data-highlighted]]:bg-neutral-800"
            >
              {ASPECT_RATIO_PRESETS.map((p) => (
                <DropdownMenu.Item
                  key={p.id}
                  className={`aspect-item ${p.id === aspectRatioId ? "text-indigo-400" : ""}`}
                  onSelect={() => onChangeAspectRatio(p.id)}
                >
                  {p.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
