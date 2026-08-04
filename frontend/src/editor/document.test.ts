import { describe, expect, it } from "vitest";
import { DEFAULT_ANIMATION_SETTINGS } from "./animationSettings";
import { DEFAULT_AUDIO_SETTINGS } from "./audioSettings";
import { DEFAULT_CURSOR_SETTINGS } from "./cursorSettings";
import { parseProject, serializeDocument, type EditorDocument } from "./document";
import { createMask } from "./masks";
import { createSlice } from "./slices";
import { DEFAULT_STYLE } from "./style";
import type { ZoomKeyframe } from "../motion-engine";

function zoomKeyframe(overrides: Partial<ZoomKeyframe>): ZoomKeyframe {
  return {
    startT: 0,
    endT: 1_000_000,
    level: 1.5,
    center: { x: 100, y: 200 },
    panMode: "auto",
    instantAnimation: false,
    disabled: false,
    snapToEdges: 100,
    ...overrides,
  };
}

function fullDocument(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    style: DEFAULT_STYLE,
    showCursor: true,
    aspectRatioId: "16:9",
    resolution: "1080p",
    crop: { x: 1, y: 2, width: 300, height: 200 },
    zoomKeyframes: [zoomKeyframe({})],
    clipStartS: 0,
    clipEndS: 10,
    slices: [createSlice(0, 10)],
    cursorSettings: DEFAULT_CURSOR_SETTINGS,
    masks: [createMask(2, 6, "sensitive", { x: 0, y: 0, width: 100, height: 100 })],
    animationSettings: DEFAULT_ANIMATION_SETTINGS,
    audioSettings: DEFAULT_AUDIO_SETTINGS,
    ...overrides,
  };
}

describe("serializeDocument/parseProject", () => {
  it("round-trips a full document unchanged", () => {
    const doc = fullDocument();
    expect(parseProject(serializeDocument(doc))).toEqual(doc);
  });

  it("returns null for non-JSON and non-object input", () => {
    expect(parseProject("not json")).toBeNull();
    expect(parseProject("[1, 2, 3]")).toBeNull();
    expect(parseProject("42")).toBeNull();
  });

  it("tolerates missing and unknown fields, falling back to defaults", () => {
    const parsed = parseProject(JSON.stringify({ crop: { x: 5, y: 6, width: 100, height: 100 } }));
    expect(parsed).not.toBeNull();
    expect(parsed!.crop).toEqual({ x: 5, y: 6, width: 100, height: 100 });
    // Missing top-level fields fall back to document defaults.
    expect(parsed!.showCursor).toBe(true);
    expect(parsed!.aspectRatioId).toBe("original");
    expect(parsed!.slices).toEqual([]);
    // Unknown keys are dropped, not propagated.
    expect(parseProject('{ "bogusField": 1, "crop": null }')).toEqual(
      expect.objectContaining({ crop: null }),
    );
  });

  it("rejects malformed sub-values instead of corrupting the doc", () => {
    // A corrupt slice (string start) is dropped entirely.
    const parsed = parseProject(JSON.stringify({ slices: [{ id: "x", startS: "bad", endS: 5, speed: 1, removed: false, cursorOverride: null }] }));
    expect(parsed!.slices).toEqual([]);
    // A non-object crop is treated as "no crop".
    expect(parseProject('{ "crop": "not-a-rect" }')!.crop).toBeNull();
    // Wrong-typed scalar fields keep the default.
    expect(parseProject('{ "showCursor": "yes" }')!.showCursor).toBe(true);
  });

  it("resets a degenerate saved trim so the video metadata can fill it in", () => {
    const parsed = parseProject(JSON.stringify({ clipStartS: 5, clipEndS: 5 }));
    expect(parsed!.clipStartS).toBe(0);
    expect(parsed!.clipEndS).toBe(0);
  });

  it("does not persist runtime-only object/blob URLs", () => {
    const doc = fullDocument({
      style: {
        ...DEFAULT_STYLE,
        backgroundType: "image",
        customImageUrl: "object:abc-123",
      },
      audioSettings: {
        ...DEFAULT_AUDIO_SETTINGS,
        trackId: "custom",
        customAudioUrl: "blob:xyz",
        customAudioName: "clip.m4a",
      },
    });
    const parsed = parseProject(serializeDocument(doc))!;
    expect(parsed.style.customImageUrl).toBeNull();
    // "image" can only be reached through an uploaded (now-dead) URL — the
    // dependent selection resets to the wallpaper default with it.
    expect(parsed.style.backgroundType).toBe(DEFAULT_STYLE.backgroundType);
    expect(parsed.audioSettings.customAudioUrl).toBeNull();
    expect(parsed.audioSettings.customAudioName).toBeNull();
    expect(parsed.audioSettings.trackId).toBeNull();
  });
});
