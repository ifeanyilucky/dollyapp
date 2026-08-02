/**
 * Timeline regions — "Cut & Speed up" (PRD §9: "Easily trim, cut, or speed
 * up parts of your recording"). Both are ranges of *video-relative*
 * seconds (the same space `Timeline`'s `currentTime`/`duration` already
 * use), applied only to preview playback for now — there's no real export
 * pipeline yet (see `TopBar`'s "Export" doc comment), so nothing bakes
 * these into an output file.
 */

export interface CutRegion {
  id: string;
  startS: number;
  endS: number;
}

export interface SpeedRegion {
  id: string;
  startS: number;
  endS: number;
  /** Multiplier on top of the timeline's base playback rate. */
  rate: number;
}

export const SPEED_REGION_RATES = [2, 4, 8];

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Adds a region, dropping any existing region of the same list that
 * overlaps it — keeps the model simple (no partial-overlap splitting)
 * while still behaving predictably when a new drag covers old ones. */
export function addRegion<T extends { startS: number; endS: number }>(regions: T[], region: T): T[] {
  return [...regions.filter((r) => !overlaps(r.startS, r.endS, region.startS, region.endS)), region];
}

export function removeRegion<T extends { id: string }>(regions: T[], id: string): T[] {
  return regions.filter((r) => r.id !== id);
}

/** The region (if any) covering `t`. Regions never overlap within one
 * list (see `addRegion`), so at most one can match. */
export function regionAt<T extends { startS: number; endS: number }>(
  regions: T[],
  t: number,
): T | undefined {
  return regions.find((r) => t >= r.startS && t < r.endS);
}
