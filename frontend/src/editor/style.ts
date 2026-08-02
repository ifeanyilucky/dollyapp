import { WALLPAPER_PRESETS } from "./wallpapers";

/**
 * Style panel state — background, spacing, corner radius, and shadow
 * around the video (PRD's "Backgrounds" feature, brought forward from M5
 * since it's one rendering pass on top of the preview canvas that already
 * exists).
 */
export type BackgroundType = "wallpaper" | "gradient" | "color" | "image";

export interface StyleSettings {
  backgroundType: BackgroundType;
  /** Wallpaper preset id (see wallpapers.ts) — used when backgroundType
   * is "wallpaper" or "gradient" (gradient reuses the same preset list
   * for now; a custom gradient builder is a follow-up). */
  wallpaperId: string;
  backgroundColor: string;
  backgroundBlur: number;
  /** Canvas px between the frame edge and the video content. */
  padding: number;
  /** Corner radius of the video content itself, canvas px. */
  cornerRadius: number;
  shadowBlur: number;
  shadowOffsetY: number;
  shadowColor: string;
  /** Width (canvas px) of a subtle light border inset from the video's
   * own edge — a glass-bezel look, distinct from the drop shadow cast
   * outside the video. 0 disables it. */
  inset: number;
  insetColor: string;
}

export const DEFAULT_STYLE: StyleSettings = {
  backgroundType: "wallpaper",
  wallpaperId: WALLPAPER_PRESETS[0].id,
  backgroundColor: "#1e1b2e",
  backgroundBlur: 0,
  padding: 64,
  cornerRadius: 18,
  shadowBlur: 50,
  shadowOffsetY: 24,
  shadowColor: "rgba(0,0,0,0.5)",
  inset: 0,
  insetColor: "rgba(255,255,255,0.5)",
};
