import { Sparkles, Star, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Slider } from "./Slider";
import { DEFAULT_STYLE, type BackgroundType, type StyleSettings } from "./style";
import {
  cssGradient,
  GRADIENT_CATEGORIES,
  GRADIENT_PRESETS,
  type GradientCategory,
  WALLPAPER_IMAGES,
} from "./wallpapers";

const BACKGROUND_TABS: { id: BackgroundType; label: string }[] = [
  { id: "wallpaper", label: "Wallpaper" },
  { id: "gradient", label: "Gradient" },
  { id: "color", label: "Color" },
  { id: "image", label: "Image" },
];

const COLOR_SWATCHES = ["#1e1b2e", "#0f172a", "#111111", "#f4f3ec", "#2d1b1b", "#0b3d2e"];

/**
 * Background/spacing/shadow controls — "Backgrounds" and "Shadow and
 * inset". Wallpaper (real bundled photos, see `public/wallpaper/`),
 * Gradient (procedural), Color, and Image (user upload) are all real and
 * selectable. Aspect-ratio switching and cut/speed are separate, larger
 * features not covered here.
 */
export function StylePanel({
  style,
  onChange,
  onCommit,
}: {
  style: StyleSettings;
  /** Live update — called on every change, including every intermediate
   * value during a slider drag. */
  onChange: (next: StyleSettings) => void;
  /** Turns whatever's accumulated since the last commit into a single undo
   * step (see `history.ts`). Sliders call this themselves once, on drag
   * release; every discrete control here (a tab/swatch/button click) calls
   * it immediately after `onChange` via the local `set` helper, so a
   * one-off click is still exactly one undo step. */
  onCommit: () => void;
}) {
  const [category, setCategory] = useState<GradientCategory | "favorites">("macOS");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Discrete change: applies `value` and immediately commits it as one
   * undo step. Sliders bypass this — they call `onChange` live and only
   * `Slider`'s own `onCommit` (wired below) commits, once, on release. */
  function set<K extends keyof StyleSettings>(key: K, value: StyleSettings[K]) {
    onChange({ ...style, [key]: value });
    onCommit();
  }

  /** Live change for slider-driven fields — no commit here; the `Slider`
   * itself calls `onCommit` once, on drag release (see its `onCommit`
   * prop below), so a drag collapses into one undo step. */
  function setLive<K extends keyof StyleSettings>(key: K, value: StyleSettings[K]) {
    onChange({ ...style, [key]: value });
  }

  const visibleGradients = useMemo(
    () => (category === "favorites" ? [] : GRADIENT_PRESETS.filter((g) => g.category === category)),
    [category],
  );

  function pickRandomWallpaper() {
    const next = WALLPAPER_IMAGES[Math.floor(Math.random() * WALLPAPER_IMAGES.length)];
    onChange({ ...style, backgroundType: "wallpaper", wallpaperId: next.id });
    onCommit();
  }

  function pickRandomGradient() {
    const next = GRADIENT_PRESETS[Math.floor(Math.random() * GRADIENT_PRESETS.length)];
    onChange({ ...style, backgroundType: "gradient", gradientId: next.id });
    onCommit();
  }

  function handleFileChosen(file: File) {
    if (style.customImageUrl?.startsWith("blob:")) URL.revokeObjectURL(style.customImageUrl);
    const url = URL.createObjectURL(file);
    onChange({ ...style, backgroundType: "image", customImageUrl: url });
    onCommit();
  }

  function clearCustomImage() {
    if (style.customImageUrl?.startsWith("blob:")) URL.revokeObjectURL(style.customImageUrl);
    set("customImageUrl", null);
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

      {style.backgroundType === "wallpaper" && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[13px] font-medium text-neutral-200">Wallpaper</h3>

          <button
            type="button"
            onClick={pickRandomWallpaper}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 hover:bg-neutral-800"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Pick random wallpaper
          </button>

          <div className="grid grid-cols-4 gap-1.5">
            {WALLPAPER_IMAGES.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => set("wallpaperId", w.id)}
                className="aspect-square overflow-hidden rounded-md bg-cover bg-center"
                style={{
                  backgroundImage: `url(${w.url})`,
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
            onChange={(v) => setLive("backgroundBlur", v)}
            onCommit={onCommit}
          />
        </div>
      )}

      {style.backgroundType === "gradient" && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[13px] font-medium text-neutral-200">Gradient</h3>

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
            {GRADIENT_CATEGORIES.map((c) => (
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
            onClick={pickRandomGradient}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 hover:bg-neutral-800"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Pick random gradient
          </button>

          <div className="grid grid-cols-7 gap-1.5">
            {visibleGradients.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => set("gradientId", g.id)}
                className="aspect-square rounded-md"
                style={{
                  background: cssGradient(g),
                  outline: style.gradientId === g.id ? "2px solid #f5f5f5" : "none",
                  outlineOffset: 1,
                }}
                aria-label={g.id}
              />
            ))}
          </div>

          <Slider
            label="Background blur"
            value={style.backgroundBlur}
            min={0}
            max={40}
            onChange={(v) => setLive("backgroundBlur", v)}
            onCommit={onCommit}
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
            // Native color pickers fire `onChange` continuously while the
            // user drags inside the OS picker UI, same as a slider — live
            // update here, commit once the picker closes and the input
            // loses focus (there's no native "picker closed" event).
            onChange={(e) => setLive("backgroundColor", e.target.value)}
            onBlur={onCommit}
            className="h-7 w-7 cursor-pointer rounded-full border border-neutral-700 bg-transparent"
            aria-label="Custom background color"
          />
        </div>
      )}

      {style.backgroundType === "image" && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[13px] font-medium text-neutral-200">Image</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileChosen(file);
              e.target.value = "";
            }}
          />
          {style.customImageUrl ? (
            <div className="relative overflow-hidden rounded-lg border border-neutral-800">
              <img src={style.customImageUrl} alt="" className="aspect-video w-full object-cover" />
              <button
                type="button"
                onClick={clearCustomImage}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-neutral-200 hover:bg-black/80"
                aria-label="Remove image"
                title="Remove image"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-700 py-6 text-[12px] font-medium text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
          >
            <Upload className="h-3.5 w-3.5" />
            {style.customImageUrl ? "Upload a different image" : "Upload an image"}
          </button>
          {style.customImageUrl && (
            <Slider
              label="Background blur"
              value={style.backgroundBlur}
              min={0}
              max={40}
              onChange={(v) => setLive("backgroundBlur", v)}
              onCommit={onCommit}
            />
          )}
        </div>
      )}

      <div className="flex flex-col gap-4 border-t border-neutral-800 pt-4">
        <Slider
          label="Padding"
          value={style.padding}
          min={0}
          max={160}
          onChange={(v) => setLive("padding", v)}
          onCommit={onCommit}
          onReset={() => set("padding", DEFAULT_STYLE.padding)}
        />
        <Slider
          label="Rounded corners"
          value={style.cornerRadius}
          min={0}
          max={48}
          onChange={(v) => setLive("cornerRadius", v)}
          onCommit={onCommit}
          onReset={() => set("cornerRadius", DEFAULT_STYLE.cornerRadius)}
        />
        <Slider
          label="Inset"
          value={style.inset}
          min={0}
          max={12}
          onChange={(v) => setLive("inset", v)}
          onCommit={onCommit}
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
          onChange={(v) => setLive("shadowBlur", v)}
          onCommit={onCommit}
          onReset={() => set("shadowBlur", DEFAULT_STYLE.shadowBlur)}
        />
        <Slider
          label="Offset"
          value={style.shadowOffsetY}
          min={0}
          max={60}
          onChange={(v) => setLive("shadowOffsetY", v)}
          onCommit={onCommit}
          onReset={() => set("shadowOffsetY", DEFAULT_STYLE.shadowOffsetY)}
        />
      </div>

      <button
        type="button"
        onClick={() => {
          onChange(DEFAULT_STYLE);
          onCommit();
        }}
        className="self-start text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-400"
      >
        Reset all to defaults
      </button>
    </div>
  );
}
