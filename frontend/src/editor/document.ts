import type { ZoomKeyframe } from "../motion-engine";
import { DEFAULT_ANIMATION_SETTINGS, type AnimationSettings } from "./animationSettings";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "./audioSettings";
import type { AspectRatioId } from "./aspect";
import type { CropRect } from "./crop";
import { DEFAULT_CURSOR_SETTINGS, type CursorSettings } from "./cursorSettings";
import type { MaskClip } from "./masks";
import { DEFAULT_RESOLUTION, type ResolutionId } from "./resolution";
import type { ClipSlice } from "./slices";
import { DEFAULT_STYLE, type StyleSettings } from "./style";
/**
 * Every user-editable setting that (a) undoes/redoes as one linear timeline
 * (see `history.ts`) and (b) is what `exportVideo` bakes into the rendered
 * output. Playback-only state (current time, playback rate, which panel is
 * open, current selection, ...) is deliberately not part of this — none of
 * it survives into the export, and undoing it wouldn't mean anything.
 */
export interface EditorDocument {
  style: StyleSettings;
  showCursor: boolean;
  aspectRatioId: AspectRatioId;
  /** Output resolution tier (also what the live preview canvas renders at
   * — see `resolution.ts`'s `computeOutputSize`). */
  resolution: ResolutionId;
  /** A sub-window of the *recorded* content to treat as the entire
   * recording — `null` means uncropped (today's pre-crop behavior
   * unchanged). See `crop.ts`'s doc comment for the coordinate space this
   * lives in. */
  crop: CropRect | null;
  zoomKeyframes: ZoomKeyframe[];
  /** Effective in/out of the whole clip (video-relative seconds) — both 0
   * until the video's metadata loads (see `EditorView`'s `patch` call on
   * `onLoadedMetadata`). */
  clipStartS: number;
  clipEndS: number;
  slices: ClipSlice[];
  cursorSettings: CursorSettings;
  /** Independent, possibly-overlapping full-frame time ranges — see
   * `masks.ts`'s module doc comment for how these differ from `slices`. */
  masks: MaskClip[];
  animationSettings: AnimationSettings;
  audioSettings: AudioSettings;
}

export const DEFAULT_DOCUMENT: EditorDocument = {
  style: DEFAULT_STYLE,
  showCursor: true,
  aspectRatioId: "original",
  resolution: DEFAULT_RESOLUTION,
  crop: null,
  zoomKeyframes: [],
  clipStartS: 0,
  clipEndS: 0,
  slices: [],
  cursorSettings: DEFAULT_CURSOR_SETTINGS,
  masks: [],
  animationSettings: DEFAULT_ANIMATION_SETTINGS,
  audioSettings: DEFAULT_AUDIO_SETTINGS,
};

/** Serializes the whole document to the `project.json` bundle entry — the
 * inverse of `parseProject`. Everything here is JSON-safe (plain objects,
 * numbers, strings, booleans, nulls — no functions, classes, or dates), so
 * a straight `JSON.stringify` round-trips exactly. */
export function serializeDocument(doc: EditorDocument): string {
  return JSON.stringify(doc);
}

// --- parseProject: defensive hydration of a saved project.json ---------------
//
// project.json is written by this app's own code, but it's still untrusted
// input on load: it may have been edited by hand, truncated by a crash, or
// written by an older/newer build with a different schema. `parseProject`
// therefore never trusts a field's presence or type — every value is checked
// against the known `EditorDocument` shape and falls back to `DEFAULT_DOCUMENT`
// on any mismatch, so a damaged file loads as a usable (if reset) document
// instead of throwing.

const ASPECT_RATIO_IDS = new Set<AspectRatioId>(["original", "16:9", "9:16", "1:1", "4:5"]);
const RESOLUTION_IDS = new Set<ResolutionId>(["480p", "720p", "1080p", "1440p", "2160p"]);

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asCropRect(v: unknown): CropRect | null {
  const o = asObject(v);
  if (!o) return null;
  const x = asFiniteNumber(o.x);
  const y = asFiniteNumber(o.y);
  const width = asFiniteNumber(o.width);
  const height = asFiniteNumber(o.height);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

function isZoomKeyframe(v: unknown): v is ZoomKeyframe {
  const o = asObject(v);
  if (!o) return false;
  if (o.panMode !== "auto" && o.panMode !== "manual") return false;
  if (typeof o.instantAnimation !== "boolean" || typeof o.disabled !== "boolean") return false;
  const center = asObject(o.center);
  if (!center || asFiniteNumber(center.x) === null || asFiniteNumber(center.y) === null) return false;
  return (
    asFiniteNumber(o.startT) !== null &&
    asFiniteNumber(o.endT) !== null &&
    asFiniteNumber(o.level) !== null &&
    asFiniteNumber(o.snapToEdges) !== null
  );
}

function isClipSlice(v: unknown): v is ClipSlice {
  const o = asObject(v);
  if (!o) return false;
  if (typeof o.id !== "string" || typeof o.removed !== "boolean") return false;
  if (o.cursorOverride !== null) {
    const co = asObject(o.cursorOverride);
    if (!co || typeof co.hideCursor !== "boolean" || typeof co.disableSmoothMovement !== "boolean") {
      return false;
    }
  }
  return (
    asFiniteNumber(o.startS) !== null &&
    asFiniteNumber(o.endS) !== null &&
    asFiniteNumber(o.speed) !== null
  );
}

function isMaskClip(v: unknown): v is MaskClip {
  const o = asObject(v);
  if (!o) return false;
  if (typeof o.id !== "string" || typeof o.disabled !== "boolean") return false;
  if (o.type !== "sensitive" && o.type !== "highlight") return false;
  if (!asCropRect(o.rect)) return false;
  return asFiniteNumber(o.startS) !== null && asFiniteNumber(o.endS) !== null && asFiniteNumber(o.opacity) !== null;
}

/// Walks a nested settings object, keeping each key whose value's type
/// matches the default's and discarding anything else — so a saved doc with
/// a slightly-off field (older schema, manual edit) degrades to the default
/// for that key rather than corrupting the settings panel.
function sanitizeSettings<T extends object>(defaults: T, raw: unknown): T {
  const o = asObject(raw);
  if (!o) return defaults;
  const out: Record<string, unknown> = {};
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const value = o[key];
    if (value === undefined) {
      out[key] = defaultValue;
    } else if (defaultValue !== null && typeof defaultValue === "object") {
      out[key] = sanitizeSettings(defaultValue as object, value);
    } else if (typeof defaultValue === "number") {
      out[key] = asFiniteNumber(value) ?? defaultValue;
    } else if (typeof defaultValue === "boolean") {
      out[key] = typeof value === "boolean" ? value : defaultValue;
    } else if (typeof defaultValue === "string") {
      out[key] = typeof value === "string" ? value : defaultValue;
    } else {
      out[key] = value === null || typeof value === "string" ? value : defaultValue;
    }
  }
  return out as T;
}

/** Parses a saved `project.json` back into a fully-validated
 * `EditorDocument`. Returns `null` when the JSON doesn't parse or isn't an
 * object (the caller then falls back to `DEFAULT_DOCUMENT` + auto-generated
 * keyframes). */
export function parseProject(json: string): EditorDocument | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const o = asObject(raw);
  if (!o) return null;

  const style = sanitizeSettings(DEFAULT_STYLE, o.style);
  const cursorSettings = sanitizeSettings(DEFAULT_CURSOR_SETTINGS, o.cursorSettings);
  const animationSettings = sanitizeSettings(DEFAULT_ANIMATION_SETTINGS, o.animationSettings);
  const audioSettings = sanitizeSettings(DEFAULT_AUDIO_SETTINGS, o.audioSettings);

  // Runtime-only object/blob URLs are dropped on hydration — the underlying
  // File is gone after a reload, so a restored `object:`/`blob:` URL would
  // point at a dead blob and render/play blank. Anything that can only have
  // been selected *through* one of those URLs (`backgroundType: "image"`,
  // `trackId: "custom"`) is reset to its default along with it, so the doc
  // never enters a "points at nothing" state.
  style.customImageUrl = null;
  if (style.backgroundType === "image") style.backgroundType = DEFAULT_STYLE.backgroundType;
  audioSettings.customAudioUrl = null;
  audioSettings.customAudioName = null;
  if (audioSettings.trackId === "custom") audioSettings.trackId = null;

  const clipStartS = asFiniteNumber(o.clipStartS) ?? 0;
  const clipEndS = asFiniteNumber(o.clipEndS) ?? 0;

  const doc: EditorDocument = {
    style,
    showCursor: typeof o.showCursor === "boolean" ? o.showCursor : DEFAULT_DOCUMENT.showCursor,
    aspectRatioId:
      typeof o.aspectRatioId === "string" && ASPECT_RATIO_IDS.has(o.aspectRatioId as AspectRatioId)
        ? (o.aspectRatioId as AspectRatioId)
        : DEFAULT_DOCUMENT.aspectRatioId,
    resolution:
      typeof o.resolution === "string" && RESOLUTION_IDS.has(o.resolution as ResolutionId)
        ? (o.resolution as ResolutionId)
        : DEFAULT_DOCUMENT.resolution,
    crop: asCropRect(o.crop),
    zoomKeyframes: Array.isArray(o.zoomKeyframes) ? o.zoomKeyframes.filter(isZoomKeyframe) : [],
    clipStartS,
    clipEndS,
    slices: Array.isArray(o.slices) ? o.slices.filter(isClipSlice) : [],
    cursorSettings,
    masks: Array.isArray(o.masks) ? o.masks.filter(isMaskClip) : [],
    animationSettings,
    audioSettings,
  };

  // A saved doc whose trim is degenerate (never trimmed, or a corrupt file)
  // is reset to "no trim" — the video-metadata callback then fills in the
  // real clip bounds, as for a fresh recording.
  if (doc.clipEndS <= doc.clipStartS) {
    doc.clipStartS = 0;
    doc.clipEndS = 0;
  }
  return doc;
}
