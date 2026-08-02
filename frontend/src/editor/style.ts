/**
 * Style panel state — background, spacing, corner radius, and shadow
 * around the video (PRD's "Backgrounds" feature, brought forward from M5
 * since it's one rendering pass on top of the preview canvas that already
 * exists). Background is solid-color only for now; gradient/image/
 * wallpaper backgrounds are a follow-up on top of this same struct.
 */
export interface StyleSettings {
  /** Canvas px between the frame edge and the video content. */
  padding: number;
  backgroundColor: string;
  /** Corner radius of the video content itself, canvas px. */
  cornerRadius: number;
  shadowBlur: number;
  shadowOffsetY: number;
  shadowColor: string;
}

export const DEFAULT_STYLE: StyleSettings = {
  padding: 64,
  backgroundColor: "#1e1b2e",
  cornerRadius: 18,
  shadowBlur: 50,
  shadowOffsetY: 24,
  shadowColor: "rgba(0,0,0,0.5)",
};
