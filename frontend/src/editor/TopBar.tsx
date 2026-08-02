import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crop,
  Eye,
  EyeOff,
  Folder,
  FolderClock,
  Gauge,
  Loader,
  Redo2,
  Shapes,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ASPECT_RATIO_PRESETS, type AspectRatioId } from "./aspect";
import { listRecentProjects, type RecentProject } from "./api";

const SPEED_STEPS = [1, 1.5, 2, 0.5];

/**
 * Top toolbar. Real actions: export (renders the movie with every applied
 * setting baked in — zoom keyframes, clip trim, slices, styling, cursor
 * overlay, aspect ratio — via a save dialog), reveal-in-Finder, delete
 * (confirms first), cursor-overlay toggle, playback-speed cycling, output
 * aspect ratio (PRD §9, "Horizontal and vertical output"). Undo/redo and
 * Presets are inert — there's no edit-history system or preset library yet.
 * Crop / Mask are separate, larger features not covered here.
 */
export function TopBar({
  title,
  aspectRatioId,
  onChangeAspectRatio,
  showCursor,
  onToggleCursor,
  playbackRate,
  onCyclePlaybackRate,
  onExport,
  exporting,
  exportProgress,
  onRevealInFinder,
  onOpenProject,
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
  onExport: () => void;
  exporting: boolean;
  /** 0..1 while exporting, for the button label — omit/undefined when idle. */
  exportProgress?: number;
  onRevealInFinder: () => void;
  /** Switches the editor to a different past recording (from the folder
   * dropdown's "Show previous projects" submenu) — a no-op if it's already
   * the one being edited. */
  onOpenProject: (bundlePath: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  useEffect(() => {
    void listRecentProjects(10).then(setRecentProjects);
  }, []);
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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
              aria-label="Project folder options"
              title="Project folder"
            >
              <Folder className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={6}
              align="start"
              className="z-50 min-w-50 rounded-lg border border-neutral-800 bg-neutral-900 p-1 text-neutral-200 shadow-2xl [&_.folder-item]:flex [&_.folder-item]:cursor-pointer [&_.folder-item]:items-center [&_.folder-item]:gap-2 [&_.folder-item]:rounded-md [&_.folder-item]:px-2.5 [&_.folder-item]:py-1.5 [&_.folder-item]:text-[12px] [&_.folder-item]:outline-none [&_.folder-item[data-highlighted]]:bg-neutral-800 [&_.folder-item[data-state=open]]:bg-neutral-800"
            >
              <DropdownMenu.Item className="folder-item" onSelect={onRevealInFinder}>
                <Folder className="h-3.5 w-3.5" />
                Reveal in Finder
              </DropdownMenu.Item>

              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="folder-item justify-between">
                  <span className="flex items-center gap-2">
                    <FolderClock className="h-3.5 w-3.5" />
                    Show previous projects
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-neutral-500" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={4}
                    className="z-50 max-h-72 min-w-55 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-1 text-neutral-200 shadow-2xl [&_.folder-item]:flex [&_.folder-item]:cursor-pointer [&_.folder-item]:items-center [&_.folder-item]:truncate [&_.folder-item]:rounded-md [&_.folder-item]:px-2.5 [&_.folder-item]:py-1.5 [&_.folder-item]:text-[12px] [&_.folder-item]:outline-none [&_.folder-item[data-highlighted]]:bg-neutral-800"
                  >
                    {recentProjects.length === 0 ? (
                      <span className="block px-2.5 py-1.5 text-[12px] text-neutral-600">No recordings yet</span>
                    ) : (
                      recentProjects.map((p) => (
                        <DropdownMenu.Item key={p.path} className="folder-item" onSelect={() => onOpenProject(p.path)}>
                          {p.name}
                        </DropdownMenu.Item>
                      ))
                    )}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
          onClick={onExport}
          disabled={exporting}
          className="ml-1 flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          title="Export the rendered video (asks where to save)"
        >
          {exporting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {exporting ? `Exporting ${Math.round((exportProgress ?? 0) * 100)}%` : "Export"}
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
