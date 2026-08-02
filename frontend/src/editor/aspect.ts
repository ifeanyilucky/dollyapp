/**
 * Output aspect ratio presets (PRD §9, "Horizontal and vertical output" —
 * "With one click, change the desired output of your video. All
 * animations will be automatically adjusted."). "Original" keeps the
 * recording's own aspect (the pre-this-feature behavior); the others
 * reframe the motion engine's viewport to that shape — see
 * `motion-engine/autoZoom.ts`'s `viewportForKeyframe` doc comment.
 */
export type AspectRatioId = "original" | "16:9" | "9:16" | "1:1" | "4:5";

export interface AspectRatioPreset {
  id: AspectRatioId;
  label: string;
  /** width / height, or `null` for "Original" (source recording's own
   * aspect — resolved at render time, since it depends on the recording). */
  ratio: number | null;
}

export const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
  { id: "original", label: "Original", ratio: null },
  { id: "16:9", label: "Wide 16:9", ratio: 16 / 9 },
  { id: "9:16", label: "Vertical 9:16", ratio: 9 / 16 },
  { id: "1:1", label: "Square 1:1", ratio: 1 },
  { id: "4:5", label: "Portrait 4:5", ratio: 4 / 5 },
];

export function aspectRatioPreset(id: AspectRatioId): AspectRatioPreset {
  return ASPECT_RATIO_PRESETS.find((p) => p.id === id) ?? ASPECT_RATIO_PRESETS[0];
}
