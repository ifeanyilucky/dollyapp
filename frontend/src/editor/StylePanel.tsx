import { Sparkles, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Slider } from "./Slider";
import { DEFAULT_STYLE, type BackgroundType, type StyleSettings } from "./style";
import { cssGradient, WALLPAPER_CATEGORIES, WALLPAPER_PRESETS, type WallpaperCategory } from "./wallpapers";

const BACKGROUND_TABS: { id: BackgroundType; label: string }[] = [
  { id: "wallpaper", label: "Wallpaper" },
  { id: "gradient", label: "Gradient" },
  { id: "color", label: "Color" },
  { id: "image", label: "Image" },
];

const COLOR_SWATCHES = ["#1e1b2e", "#0f172a", "#111111", "#f4f3ec", "#2d1b1b", "#0b3d2e"];

/**
 * Background/spacing/shadow controls — "Backgrounds" and "Shadow and
 * inset". Wallpaper and Gradient are both real and selectable (procedural
 * gradients, see wallpapers.ts — no image assets yet); Image is a
 * placeholder. Aspect-ratio switching and cut/speed are separate, larger
 * features not covered here.
 */
export function StylePanel({
  style,
  onChange,
}: {
  style: StyleSettings;
  onChange: (next: StyleSettings) => void;
}) {
  const [category, setCategory] = useState<WallpaperCategory | "favorites">("macOS");

  function set<K extends keyof StyleSettings>(key: K, value: StyleSettings[K]) {
    onChange({ ...style, [key]: value });
  }

  const visibleWallpapers = useMemo(
    () =>
      category === "favorites" ? [] : WALLPAPER_PRESETS.filter((w) => w.category === category),
    [category],
  );

  function pickRandomWallpaper() {
    const pool = WALLPAPER_PRESETS;
    const next = pool[Math.floor(Math.random() * pool.length)];
    onChange({ ...style, backgroundType: "wallpaper", wallpaperId: next.id });
  }

  return (
    <div className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto rounded-xl border border-neutral-800/80 bg-neutral-950/70 p-5">
      <div>
        <h2 className="mb-2.5 text-[13px] font-medium text-neutral-200">Background</h2>
        <div className="flex gap-1 rounded-lg bg-neutral-900 p-1">
          {BACKGROUND_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set("backgroundType", t.id)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors ${
                style.backgroundType === t.id
                  ? "bg-neutral-700 text-neutral-50"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {(style.backgroundType === "wallpaper" || style.backgroundType === "gradient") && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[13px] font-medium text-neutral-200">
            {style.backgroundType === "wallpaper" ? "Wallpaper" : "Gradient"}
          </h3>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCategory("favorites")}
              className={`flex h-7 w-7 items-center justify-center rounded-md border text-neutral-400 ${
                category === "favorites" ? "border-neutral-600 bg-neutral-800" : "border-transparent hover:bg-neutral-900"
              }`}
              aria-label="Favorites"
            >
              <Star className="h-3.5 w-3.5" />
            </button>
            {WALLPAPER_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${
                  category === c
                    ? "bg-neutral-700 text-neutral-50"
                    : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={pickRandomWallpaper}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 hover:bg-neutral-800"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Pick random wallpaper
          </button>

          <div className="grid grid-cols-7 gap-1.5">
            {visibleWallpapers.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => set("wallpaperId", w.id)}
                className="aspect-square rounded-md"
                style={{
                  background: cssGradient(w),
                  outline: style.wallpaperId === w.id ? "2px solid #f5f5f5" : "none",
                  outlineOffset: 1,
                }}
                aria-label={w.id}
              />
            ))}
          </div>

          <Slider
            label="Background blur"
            value={style.backgroundBlur}
            min={0}
            max={40}
            onChange={(v) => set("backgroundBlur", v)}
          />
        </div>
      )}

      {style.backgroundType === "color" && (
        <div className="flex flex-wrap gap-2">
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => set("backgroundColor", color)}
              className="h-7 w-7 rounded-full border border-neutral-700"
              style={{
                backgroundColor: color,
                outline: style.backgroundColor === color ? "2px solid #f5f5f5" : "none",
                outlineOffset: 2,
              }}
              aria-label={`Background ${color}`}
            />
          ))}
          <input
            type="color"
            value={style.backgroundColor}
            onChange={(e) => set("backgroundColor", e.target.value)}
            className="h-7 w-7 cursor-pointer rounded-full border border-neutral-700 bg-transparent"
            aria-label="Custom background color"
          />
        </div>
      )}

      {style.backgroundType === "image" && (
        <p className="rounded-md border border-dashed border-neutral-800 px-3 py-6 text-center text-[11px] text-neutral-600">
          Image backgrounds aren't built yet.
        </p>
      )}

      <div className="flex flex-col gap-4 border-t border-neutral-800 pt-4">
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
      </div>

      <div className="flex flex-col gap-4 border-t border-neutral-800 pt-4">
        <h2 className="text-[13px] font-medium text-neutral-200">Shadow</h2>
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
      </div>

      <button
        type="button"
        onClick={() => onChange(DEFAULT_STYLE)}
        className="self-start text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-400"
      >
        Reset all to defaults
      </button>
    </div>
  );
}
