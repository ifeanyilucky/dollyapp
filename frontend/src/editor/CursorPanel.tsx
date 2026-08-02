import { ChevronDown, EyeOff } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  CURSOR_STYLE_PRESETS,
  DEFAULT_CURSOR_SETTINGS,
  type CursorSettings,
  type CursorStyleId,
} from "./cursorSettings";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";

/** Same arrow path `renderer.ts`'s `traceArrowPath` draws (translated to
 * SVG path data with a small margin so the stroke doesn't clip) — the
 * swatch previews should look like what actually gets drawn, not an
 * approximation of it. */
const ARROW_SVG_PATH = "M2,2 L2,24 L7.5,19.5 L11,27.5 L14,26 L10.7,18.5 L17,18.5 Z";

const STYLE_SWATCH_PAINT: Record<CursorStyleId, { fill: string; stroke: string; strokeWidth: number }> = {
  outline: { fill: "#ffffff", stroke: "#000000c0", strokeWidth: 1.5 },
  thin: { fill: "#ffffff", stroke: "#00000090", strokeWidth: 0.75 },
  dot: { fill: "#9ca3af", stroke: "#00000060", strokeWidth: 1 },
  solidBlack: { fill: "#111111", stroke: "#ffffff40", strokeWidth: 1 },
  solidGray: { fill: "#6b7280", stroke: "#00000060", strokeWidth: 1 },
};

/**
 * Cursor customization — size, style, and the behavior toggles below it
 * (PRD §9). "Click effect" reuses the click-ripple animation already in
 * `renderer.ts` (just a real on/off here, not a style picker yet); "Click
 * sound" is a real synthesized tick (see `clickSound.ts`, no bundled audio
 * asset needed); "Rotation" is a real canvas rotation on the drawn glyph.
 * "Hide cursor" is the *same* state as the top bar's eye icon, not a
 * second copy of it — see `EditorView`'s `showCursor`.
 */
export function CursorPanel({
  settings,
  onChange,
  showCursor,
  onToggleShowCursor,
}: {
  settings: CursorSettings;
  onChange: (next: CursorSettings) => void;
  showCursor: boolean;
  onToggleShowCursor: () => void;
}) {
  const [expandedClick, setExpandedClick] = useState(false);
  const [expandedSound, setExpandedSound] = useState(false);
  const [expandedRotation, setExpandedRotation] = useState(false);

  function set<K extends keyof CursorSettings>(key: K, value: CursorSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto rounded-xl border border-neutral-800/80 bg-neutral-950/70 p-5">
      <Slider
        label="Cursor size"
        value={settings.size}
        min={0}
        max={100}
        onChange={(v) => set("size", v)}
        onReset={() => set("size", DEFAULT_CURSOR_SETTINGS.size)}
      />

      <div>
        <h3 className="mb-2.5 text-[13px] font-medium text-neutral-200">Cursor style</h3>
        <div className="flex gap-1.5">
          {CURSOR_STYLE_PRESETS.map((preset) => {
            const paint = STYLE_SWATCH_PAINT[preset.id];
            const active = settings.style === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => set("style", preset.id)}
                className={`flex h-14 w-14 items-center justify-center rounded-lg border transition-colors ${
                  active
                    ? "border-indigo-400 bg-neutral-900"
                    : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700"
                }`}
                aria-label={preset.label}
                title={preset.label}
              >
                {preset.id === "dot" ? (
                  <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: paint.fill }} />
                ) : (
                  <svg viewBox="0 0 20 30" className="h-6 w-6">
                    <path
                      d={ARROW_SVG_PATH}
                      fill={paint.fill}
                      stroke={paint.stroke}
                      strokeWidth={paint.strokeWidth}
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ToggleRow
        label="Always use pointer cursor"
        description="Don't change cursor, even if selecting text, etc."
        checked={settings.alwaysPointerCursor}
        onChange={(v) => set("alwaysPointerCursor", v)}
      />

      <div className="border-t border-neutral-800" />

      <ToggleRow
        label="Hide cursor if not moving"
        checked={settings.hideCursorIfNotMoving}
        onChange={(v) => set("hideCursorIfNotMoving", v)}
      />
      <ToggleRow
        label="Loop cursor position"
        description="Near the end of the video, cursor will move back to its initial position"
        checked={settings.loopCursorPosition}
        onChange={(v) => set("loopCursorPosition", v)}
      />
      <ToggleRow icon={EyeOff} label="Hide cursor" checked={!showCursor} onChange={onToggleShowCursor} />

      <div className="border-t border-neutral-800" />

      <ExpandableRow label="Click effect" expanded={expandedClick} onToggleExpanded={() => setExpandedClick((v) => !v)}>
        <ToggleRow
          label="Show ripple on click"
          checked={settings.clickEffectEnabled}
          onChange={(v) => set("clickEffectEnabled", v)}
        />
      </ExpandableRow>
      <ExpandableRow label="Click sound" expanded={expandedSound} onToggleExpanded={() => setExpandedSound((v) => !v)}>
        <ToggleRow
          label="Play a click sound"
          checked={settings.clickSoundEnabled}
          onChange={(v) => set("clickSoundEnabled", v)}
        />
      </ExpandableRow>

      <div className="border-t border-neutral-800" />

      <ExpandableRow
        label="Rotation"
        expanded={expandedRotation}
        onToggleExpanded={() => setExpandedRotation((v) => !v)}
      >
        <Slider
          label="Degrees"
          value={settings.rotationDeg}
          min={0}
          max={360}
          onChange={(v) => set("rotationDeg", v)}
          onReset={() => set("rotationDeg", DEFAULT_CURSOR_SETTINGS.rotationDeg)}
        />
      </ExpandableRow>

      <button
        type="button"
        onClick={() => onChange(DEFAULT_CURSOR_SETTINGS)}
        className="self-start text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-400"
      >
        Reset all to defaults
      </button>
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-200">
          {Icon && <Icon className="h-3.5 w-3.5 text-neutral-400" />}
          {label}
        </span>
        {description && <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function ExpandableRow({
  label,
  expanded,
  onToggleExpanded,
  children,
}: {
  label: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button type="button" onClick={onToggleExpanded} className="flex w-full items-center justify-between">
        <span className="text-[13px] font-medium text-neutral-200">{label}</span>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        >
          <ChevronDown className="h-4 w-4" />
        </span>
      </button>
      {expanded && <div className="mt-3">{children}</div>}
    </div>
  );
}
