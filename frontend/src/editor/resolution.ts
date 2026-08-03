export type ResolutionId = "480p" | "720p" | "1080p" | "1440p" | "2160p";

export interface ResolutionPreset {
  id: ResolutionId;
  label: string;
  /** Standard 16:9 *width* this tier conventionally refers to (e.g. 1080p
   * -> 1920, matching 1920x1080). Used as a cap on the longer edge in
   * `computeOutputSize` — see that function's doc comment for why one
   * number generalizes correctly across every output aspect, not just
   * 16:9 landscape. */
  longEdge: number;
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: "480p", label: "480p", longEdge: 854 },
  { id: "720p", label: "720p", longEdge: 1280 },
  { id: "1080p", label: "1080p", longEdge: 1920 },
  { id: "1440p", label: "1440p", longEdge: 2560 },
  { id: "2160p", label: "2160p", longEdge: 3840 },
];

export const DEFAULT_RESOLUTION: ResolutionId = "1080p";

export function resolutionPreset(id: ResolutionId): ResolutionPreset {
  return RESOLUTION_PRESETS.find((p) => p.id === id) ?? RESOLUTION_PRESETS[2];
}

/**
 * Output pixel dimensions for a chosen resolution tier at a given output
 * aspect ratio, never exceeding the source recording's own pixels ("never
 * upscale past the source" — the same rule the export pipeline already
 * used before this had a user-facing picker). Shared by the live preview
 * canvas and `exportVideo` so what you see while editing is genuinely what
 * you get (ARCHITECTURE.md, "preview and export must never diverge") —
 * neither one may compute this independently.
 *
 * `longEdge` is a tier's conventional 16:9 *width* (1080p -> 1920): for a
 * landscape output that lands directly on the familiar 1920x1080; for a
 * portrait output the same cap lands on the long (vertical) edge instead,
 * producing the equally-conventional 1080x1920 "1080p vertical" people
 * actually mean by that name. Either way, exactly one of width/height ends
 * up at (up to) `longEdge` and the other follows from `outputAspect`.
 */
export function computeOutputSize(
  longEdge: number,
  sourceWidthPx: number,
  sourceHeightPx: number,
  outputAspect: number,
): { width: number; height: number } {
  let width = Math.min(longEdge, sourceWidthPx);
  let height = Math.round(width / outputAspect);
  if (height > Math.min(longEdge, sourceHeightPx)) {
    height = Math.min(longEdge, sourceHeightPx);
    width = Math.round(height * outputAspect);
  }
  return { width, height };
}

/** Whether `preset` could produce anything actually different from a
 * smaller tier at this recording's native size — "never upscale past the
 * source" means a tier whose `longEdge` exceeds the source's own longest
 * edge can't do anything a lower tier wouldn't already, so it's disabled
 * rather than silently doing nothing when picked. */
export function resolutionAvailable(preset: ResolutionPreset, sourceWidthPx: number, sourceHeightPx: number): boolean {
  return preset.longEdge <= Math.max(sourceWidthPx, sourceHeightPx);
}
