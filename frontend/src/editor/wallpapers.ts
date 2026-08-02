/**
 * Procedural gradient "wallpapers" — stand in for real wallpaper image
 * assets (which don't exist yet) while still giving the background
 * picker a real, selectable grid instead of an empty placeholder.
 * `cssGradient` renders the sidebar swatch/thumbnail; `paintCanvasGradient`
 * renders the same data as an actual `CanvasGradient` for the preview
 * canvas — Canvas2D can't consume a CSS gradient string directly, so both
 * read from the same stop data to stay in sync.
 */

export interface GradientStop {
  offset: number;
  color: string;
}

export type WallpaperCategory = "macOS" | "Spring" | "Sunset" | "Radiant";

export interface WallpaperPreset {
  id: string;
  category: WallpaperCategory;
  type: "linear" | "radial";
  /** Degrees, linear only. */
  angleDeg?: number;
  stops: GradientStop[];
}

export const WALLPAPER_CATEGORIES: WallpaperCategory[] = ["macOS", "Spring", "Sunset", "Radiant"];

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  // macOS — cool blues/teals, evoking the stock Sonoma/Sequoia gradients
  {
    id: "macos-1",
    category: "macOS",
    type: "linear",
    angleDeg: 135,
    stops: [
      { offset: 0, color: "#0b2f6b" },
      { offset: 0.5, color: "#3f6fc2" },
      { offset: 1, color: "#a9cdf0" },
    ],
  },
  {
    id: "macos-2",
    category: "macOS",
    type: "linear",
    angleDeg: 160,
    stops: [
      { offset: 0, color: "#0a0f2e" },
      { offset: 1, color: "#20409e" },
    ],
  },
  {
    id: "macos-3",
    category: "macOS",
    type: "radial",
    stops: [
      { offset: 0, color: "#6f4fd8" },
      { offset: 1, color: "#1c2b6b" },
    ],
  },
  {
    id: "macos-4",
    category: "macOS",
    type: "linear",
    angleDeg: 120,
    stops: [
      { offset: 0, color: "#123a5e" },
      { offset: 0.5, color: "#1c6e8c" },
      { offset: 1, color: "#5fd0c7" },
    ],
  },
  // Spring — greens
  {
    id: "spring-1",
    category: "Spring",
    type: "linear",
    angleDeg: 140,
    stops: [
      { offset: 0, color: "#123a1e" },
      { offset: 1, color: "#4c9a4c" },
    ],
  },
  {
    id: "spring-2",
    category: "Spring",
    type: "linear",
    angleDeg: 200,
    stops: [
      { offset: 0, color: "#2b2b2f" },
      { offset: 1, color: "#5c5c66" },
    ],
  },
  {
    id: "spring-3",
    category: "Spring",
    type: "linear",
    angleDeg: 150,
    stops: [
      { offset: 0, color: "#0d3b4f" },
      { offset: 0.6, color: "#1f6f8a" },
      { offset: 1, color: "#bcd9de" },
    ],
  },
  {
    id: "spring-4",
    category: "Spring",
    type: "linear",
    angleDeg: 170,
    stops: [
      { offset: 0, color: "#0a2233" },
      { offset: 1, color: "#123a52" },
    ],
  },
  // Sunset — warm oranges/pinks
  {
    id: "sunset-1",
    category: "Sunset",
    type: "linear",
    angleDeg: 135,
    stops: [
      { offset: 0, color: "#ff7a45" },
      { offset: 0.5, color: "#ffb347" },
      { offset: 1, color: "#4fa8fe" },
    ],
  },
  {
    id: "sunset-2",
    category: "Sunset",
    type: "linear",
    angleDeg: 135,
    stops: [
      { offset: 0, color: "#ff6b8b" },
      { offset: 1, color: "#ffd6e8" },
    ],
  },
  {
    id: "sunset-3",
    category: "Sunset",
    type: "radial",
    stops: [
      { offset: 0, color: "#ff8a3d" },
      { offset: 1, color: "#7a2e1f" },
    ],
  },
  {
    id: "sunset-4",
    category: "Sunset",
    type: "linear",
    angleDeg: 120,
    stops: [
      { offset: 0, color: "#e05a2b" },
      { offset: 1, color: "#f4a13a" },
    ],
  },
  // Radiant — vivid purples/multicolor
  {
    id: "radiant-1",
    category: "Radiant",
    type: "linear",
    angleDeg: 135,
    stops: [
      { offset: 0, color: "#6a3dd8" },
      { offset: 1, color: "#2a2ea0" },
    ],
  },
  {
    id: "radiant-2",
    category: "Radiant",
    type: "radial",
    stops: [
      { offset: 0, color: "#8b5cf6" },
      { offset: 1, color: "#1e1b4b" },
    ],
  },
  {
    id: "radiant-3",
    category: "Radiant",
    type: "linear",
    angleDeg: 145,
    stops: [
      { offset: 0, color: "#f97316" },
      { offset: 1, color: "#db2777" },
    ],
  },
  {
    id: "radiant-4",
    category: "Radiant",
    type: "linear",
    angleDeg: 135,
    stops: [
      { offset: 0, color: "#7c3aed" },
      { offset: 0.5, color: "#c026d3" },
      { offset: 1, color: "#f97316" },
    ],
  },
];

export function cssGradient(preset: WallpaperPreset): string {
  const stops = preset.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ");
  return preset.type === "radial"
    ? `radial-gradient(circle, ${stops})`
    : `linear-gradient(${preset.angleDeg ?? 135}deg, ${stops})`;
}

export function paintCanvasGradient(
  ctx: CanvasRenderingContext2D,
  preset: WallpaperPreset,
  width: number,
  height: number,
): CanvasGradient {
  let gradient: CanvasGradient;
  if (preset.type === "radial") {
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.max(width, height) / 2;
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  } else {
    const angle = ((preset.angleDeg ?? 135) * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const halfDiag = (Math.abs(dx) * width + Math.abs(dy) * height) / 2;
    const cx = width / 2;
    const cy = height / 2;
    gradient = ctx.createLinearGradient(cx - dx * halfDiag, cy - dy * halfDiag, cx + dx * halfDiag, cy + dy * halfDiag);
  }
  for (const stop of preset.stops) gradient.addColorStop(stop.offset, stop.color);
  return gradient;
}
