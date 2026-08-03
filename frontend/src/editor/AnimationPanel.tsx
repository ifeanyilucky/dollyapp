import { ChevronDown, MousePointer, MousePointer2, Radar, Spline, Target, Zap } from "lucide-react";
import { useState, type ComponentType } from "react";
import {
  DEFAULT_ANIMATION_SETTINGS,
  type AnimationSettings,
  type CursorAnimationStyle,
  type ScreenAnimationStyle,
} from "./animationSettings";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";

const SCREEN_ANIMATION_PRESETS: { id: ScreenAnimationStyle; icon: ComponentType<{ className?: string }>; label: string }[] = [
  { id: "focused", icon: Target, label: "Focused" },
  { id: "smooth", icon: Spline, label: "Smooth" },
];

const CURSOR_ANIMATION_PRESETS: { id: CursorAnimationStyle; icon: ComponentType<{ className?: string }>; label: string }[] = [
  { id: "smooth", icon: Radar, label: "Smooth" },
  { id: "medium", icon: MousePointer2, label: "Medium" },
  { id: "rapid", icon: Zap, label: "Rapid" },
  { id: "none", icon: MousePointer, label: "None" },
];

const SCREEN_ANIMATION_DESCRIPTION: Record<ScreenAnimationStyle, string> = {
  focused: "Animation stabilizes quickly, making it easier to follow and read the content.",
  smooth: "Animation eases in and out slowly, for a more cinematic, flowing feel.",
};

/**
 * Animations panel — last icon in the sidebar rail (see `IconRail`).
 * "Screen animation style" reshapes the pan/zoom spring stiffness
 * `MotionEngine` steps with (`renderer.ts`'s `setScreenAnimationStyle`);
 * "Cursor animation style" picks (or bypasses) the One Euro filter the
 * recorded cursor path is smoothed through (`setCursorAnimationStyle`);
 * "Motion blur" scales the existing speed-derived content-trail/cursor-blur
 * effect already in `renderer.ts` rather than replacing it — 0 turns it
 * off entirely regardless of how fast something is moving.
 */
export function AnimationPanel({
  settings,
  onChange,
  onCommit,
}: {
  settings: AnimationSettings;
  /** Live update — called on every change, including every intermediate
   * value during a slider drag. */
  onChange: (next: AnimationSettings) => void;
  /** Turns whatever's accumulated since the last commit into a single undo
   * step (see `history.ts`). The slider calls this itself once, on drag
   * release; every discrete control here calls it immediately after
   * `onChange` via the local `set` helper. */
  onCommit: () => void;
}) {
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  function set<K extends keyof AnimationSettings>(key: K, value: AnimationSettings[K]) {
    onChange({ ...settings, [key]: value });
    onCommit();
  }

  function setLive<K extends keyof AnimationSettings>(key: K, value: AnimationSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto rounded-xl border border-neutral-800/80 bg-neutral-950/70 p-5">
      <div>
        <h3 className="mb-2.5 text-[13px] font-medium text-neutral-200">Screen animation style</h3>
        <div className="flex gap-1.5">
          {SCREEN_ANIMATION_PRESETS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => set("screenAnimationStyle", id)}
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-[12px] font-medium transition-colors ${
                settings.screenAnimationStyle === id
                  ? "border-indigo-400 bg-neutral-900 text-neutral-50"
                  : "border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          {SCREEN_ANIMATION_DESCRIPTION[settings.screenAnimationStyle]}
        </p>
      </div>

      <div className="border-t border-neutral-800" />

      <div>
        <h3 className="mb-2.5 text-[13px] font-medium text-neutral-200">Cursor animation style</h3>
        <div className="flex gap-1.5">
          {CURSOR_ANIMATION_PRESETS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => set("cursorAnimationStyle", id)}
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-[12px] font-medium transition-colors ${
                settings.cursorAnimationStyle === id
                  ? "border-indigo-400 bg-neutral-900 text-neutral-50"
                  : "border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-neutral-800" />

      <div>
        <h3 className="text-[13px] font-medium text-neutral-200">Motion blur</h3>
        <p className="mb-2.5 mt-1 text-[11px] leading-relaxed text-neutral-500">
          While mouse cursor or screen is moving, a cinematic motion blur effect will be applied.
        </p>
        <Slider
          value={settings.motionBlur}
          min={0}
          max={100}
          onChange={(v) => setLive("motionBlur", v)}
          onCommit={onCommit}
          onReset={() => set("motionBlur", DEFAULT_ANIMATION_SETTINGS.motionBlur)}
        />
        <div className="mt-4">
          <ToggleRow
            label="Blur the cursor glyph itself while it's moving fast."
            checked={settings.motionBlurAppliesToCursor}
            onChange={(v) => set("motionBlurAppliesToCursor", v)}
          />
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAdvancedExpanded((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <span className="text-[13px] font-medium text-neutral-200">Advanced motion blur settings</span>
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300 transition-transform ${
              advancedExpanded ? "rotate-180" : ""
            }`}
          >
            <ChevronDown className="h-4 w-4" />
          </span>
        </button>

        {advancedExpanded && (
          <div className="mt-4 flex flex-col gap-4">
            <ToggleRow
              label="Apply to screen movement"
              description="Blur the content trail during zoom/pan transitions."
              checked={settings.motionBlurAppliesToScreen}
              onChange={(v) => set("motionBlurAppliesToScreen", v)}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          onChange(DEFAULT_ANIMATION_SETTINGS);
          onCommit();
        }}
        className="self-start text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-400"
      >
        Reset all to defaults
      </button>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <span className="text-[13px] font-medium text-neutral-200">{label}</span>
        {description && <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
