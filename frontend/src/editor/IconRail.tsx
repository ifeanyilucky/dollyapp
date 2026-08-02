import { Command, Frame, MessageSquare, MousePointer2, Share2, SquareUser, Volume2 } from "lucide-react";
import { useState } from "react";

const TOOLS = [
  { id: "select", icon: Frame, label: "Style" },
  { id: "pointer", icon: MousePointer2, label: "Pointer" },
  { id: "webcam", icon: SquareUser, label: "Webcam" },
  { id: "comment", icon: MessageSquare, label: "Comments" },
  { id: "audio", icon: Volume2, label: "Audio" },
  { id: "shortcuts", icon: Command, label: "Shortcuts" },
  { id: "share", icon: Share2, label: "Share" },
] as const;

/**
 * Narrow tool rail to the left of the Background panel. Only "select"
 * (the panel currently shown) does anything — the rest are structural
 * placeholders for features that don't exist yet (webcam overlay,
 * comments, audio mixing, shortcut config, sharing).
 */
export function IconRail() {
  const [active, setActive] = useState<(typeof TOOLS)[number]["id"]>("select");

  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1 py-1">
      {TOOLS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => setActive(id)}
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            active === id ? "bg-indigo-500/15 text-indigo-400" : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
          }`}
          aria-label={label}
          title={label}
        >
          <Icon className="h-[18px] w-[18px]" />
        </button>
      ))}
    </div>
  );
}
