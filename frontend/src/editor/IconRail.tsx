import { Command, Frame, MessageSquare, MousePointer2, Share2, SquareUser, Volume2 } from "lucide-react";

const WIRED_TOOLS = new Set<ToolId>(["style", "cursor"]);

export const TOOLS = [
  { id: "style", icon: Frame, label: "Style" },
  { id: "cursor", icon: MousePointer2, label: "Cursor" },
  { id: "webcam", icon: SquareUser, label: "Webcam" },
  { id: "comment", icon: MessageSquare, label: "Comments" },
  { id: "audio", icon: Volume2, label: "Audio" },
  { id: "shortcuts", icon: Command, label: "Shortcuts" },
  { id: "share", icon: Share2, label: "Share" },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];

/**
 * Narrow tool rail — sits between the canvas and whichever settings panel
 * is active (see `EditorView`). Controlled from the parent (not local
 * state) since the selected tool decides *which panel renders*, not just
 * which icon is highlighted. Only "style" and "cursor" do anything —
 * clicking one of the rest is a no-op (they don't call `onSelect`, so
 * `active`/the rendered panel don't change) since there's no panel behind
 * them yet (webcam overlay, comments, audio mixing, shortcut config,
 * sharing).
 *
 * `active` is `null` while a timeline slice/zoom-keyframe editor is
 * showing instead of the Style/Cursor panel — none of these icons are
 * "selected" in that case (selecting a clip on the timeline isn't a rail
 * tool), so none should render highlighted.
 */
export function IconRail({
  active,
  onSelect,
}: {
  active: ToolId | null;
  onSelect: (id: ToolId) => void;
}) {
  return (
    <div className="flex w-11 min-h-0 shrink-0 flex-col items-center gap-1 overflow-y-auto rounded-xl border border-neutral-800/80 bg-neutral-950/70 py-1">
      {TOOLS.map(({ id, icon: Icon, label }) => {
        const wired = WIRED_TOOLS.has(id);
        return (
          <button
            key={id}
            type="button"
            onClick={wired ? () => onSelect(id) : undefined}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              !wired
                ? "cursor-default text-neutral-700"
                : active === id
                  ? "bg-indigo-500/15 text-indigo-400"
                  : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
            }`}
            aria-label={label}
            title={wired ? label : `${label} — not built yet`}
          >
            <Icon className="h-[18px] w-[18px]" />
          </button>
        );
      })}
    </div>
  );
}
