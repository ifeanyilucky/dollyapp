/** `m:ss` — shared by `Timeline` and `PreviewControls` so the two places
 * that render a clip position/duration can never drift out of sync on
 * formatting. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
