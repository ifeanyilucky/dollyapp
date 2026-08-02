import { DEFAULT_STYLE, type StyleSettings } from "./style";

const BACKGROUND_SWATCHES = ["#1e1b2e", "#0f172a", "#111111", "#f4f3ec", "#2d1b1b", "#0b3d2e"];

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-400">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-neutral-500">{Math.round(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-neutral-100"
      />
    </label>
  );
}

/**
 * Background/spacing/shadow controls — the "Backgrounds" + "Shadow and
 * inset" features. Aspect-ratio switching and cut/speed are separate,
 * larger features not covered here (see ARCHITECTURE.md / project tasks).
 */
export function StylePanel({
  style,
  onChange,
}: {
  style: StyleSettings;
  onChange: (next: StyleSettings) => void;
}) {
  function set<K extends keyof StyleSettings>(key: K, value: StyleSettings[K]) {
    onChange({ ...style, [key]: value });
  }

  return (
    <div className="flex w-64 shrink-0 flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Background & Spacing</h2>

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

      <Slider label="Padding" value={style.padding} min={0} max={160} onChange={(v) => set("padding", v)} />
      <Slider
        label="Corner radius"
        value={style.cornerRadius}
        min={0}
        max={48}
        onChange={(v) => set("cornerRadius", v)}
      />

      <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Shadow</h2>
      <Slider label="Blur" value={style.shadowBlur} min={0} max={100} onChange={(v) => set("shadowBlur", v)} />
      <Slider
        label="Offset"
        value={style.shadowOffsetY}
        min={0}
        max={60}
        onChange={(v) => set("shadowOffsetY", v)}
      />

      <button
        type="button"
        onClick={() => onChange(DEFAULT_STYLE)}
        className="mt-1 self-start text-xs text-neutral-500 underline underline-offset-2"
      >
        Reset to defaults
      </button>
    </div>
  );
}
