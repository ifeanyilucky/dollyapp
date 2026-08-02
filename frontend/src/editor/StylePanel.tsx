import { useState } from "react";
import { DEFAULT_STYLE, type StyleSettings } from "./style";

const BACKGROUND_SWATCHES = ["#1e1b2e", "#0f172a", "#111111", "#f4f3ec", "#2d1b1b", "#0b3d2e"];
const BACKGROUND_TABS = ["Wallpaper", "Gradient", "Color", "Image"] as const;
type BackgroundTab = (typeof BACKGROUND_TABS)[number];

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onReset?: () => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-400">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        {onReset && (
          <button type="button" onClick={onReset} className="text-neutral-600 hover:text-neutral-400">
            Reset
          </button>
        )}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-indigo-400"
      />
    </label>
  );
}

/**
 * Background/spacing/shadow controls — the "Backgrounds", "Shadow and
 * inset" features. Only the Color tab actually changes anything;
 * Wallpaper/Gradient/Image are structural placeholders (no asset pipeline
 * behind them yet). Aspect-ratio switching and cut/speed are separate,
 * larger features not covered here.
 */
export function StylePanel({
  style,
  onChange,
}: {
  style: StyleSettings;
  onChange: (next: StyleSettings) => void;
}) {
  const [tab, setTab] = useState<BackgroundTab>("Color");

  function set<K extends keyof StyleSettings>(key: K, value: StyleSettings[K]) {
    onChange({ ...style, [key]: value });
  }

  return (
    <div className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Background</h2>

      <div className="flex gap-1 rounded-md bg-neutral-950 p-1">
        {BACKGROUND_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded px-2 py-1 text-[11px] font-medium ${
              tab === t ? "bg-neutral-700 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Color" ? (
        <div className="flex flex-wrap gap-2">
          {BACKGROUND_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => set("backgroundColor", color)}
              className="h-6 w-6 rounded-full border border-neutral-700"
              style={{
                backgroundColor: color,
                outline: style.backgroundColor === color ? "2px solid #e5e5e5" : "none",
                outlineOffset: 2,
              }}
              aria-label={`Background ${color}`}
            />
          ))}
          <input
            type="color"
            value={style.backgroundColor}
            onChange={(e) => set("backgroundColor", e.target.value)}
            className="h-6 w-6 cursor-pointer rounded-full border border-neutral-700 bg-transparent"
            aria-label="Custom background color"
          />
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-neutral-800 px-3 py-6 text-center text-[11px] text-neutral-600">
          {tab} backgrounds aren't built yet — Color is the only one wired up so far.
        </p>
      )}

      <div className="border-t border-neutral-800 pt-4" />

      <Slider
        label="Padding"
        value={style.padding}
        min={0}
        max={160}
        onChange={(v) => set("padding", v)}
        onReset={() => set("padding", DEFAULT_STYLE.padding)}
      />
      <Slider
        label="Rounded corners"
        value={style.cornerRadius}
        min={0}
        max={48}
        onChange={(v) => set("cornerRadius", v)}
        onReset={() => set("cornerRadius", DEFAULT_STYLE.cornerRadius)}
      />
      <Slider
        label="Inset"
        value={style.inset}
        min={0}
        max={12}
        onChange={(v) => set("inset", v)}
        onReset={() => set("inset", DEFAULT_STYLE.inset)}
      />

      <h2 className="pt-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Shadow</h2>
      <Slider
        label="Blur"
        value={style.shadowBlur}
        min={0}
        max={100}
        onChange={(v) => set("shadowBlur", v)}
        onReset={() => set("shadowBlur", DEFAULT_STYLE.shadowBlur)}
      />
      <Slider
        label="Offset"
        value={style.shadowOffsetY}
        min={0}
        max={60}
        onChange={(v) => set("shadowOffsetY", v)}
        onReset={() => set("shadowOffsetY", DEFAULT_STYLE.shadowOffsetY)}
      />

      <button
        type="button"
        onClick={() => onChange(DEFAULT_STYLE)}
        className="mt-1 self-start text-xs text-neutral-500 underline underline-offset-2"
      >
        Reset all to defaults
      </button>
    </div>
  );
}
