import type { AmbientTrackId } from "./backgroundAudio";

/** Either one of the built-in ambient presets, or "custom" (a user-uploaded
 * track — see `AudioSettings.customAudioUrl`). */
export type AudioTrackSelection = AmbientTrackId | "custom";

/**
 * The Audio panel (speaker icon in the sidebar rail) — a single optional
 * background audio track, looped under the recording. `trackId: null`
 * means no background audio at all (the "Remove background audio" state,
 * also the default — a freshly loaded recording never gains audio the user
 * didn't ask for). See `backgroundAudio.ts` for how a preset/custom track
 * actually gets rendered and played, identically in the live preview and
 * in export.
 */
export interface AudioSettings {
  trackId: AudioTrackSelection | null;
  /** Set only when `trackId === "custom"` — a `blob:` URL from the file the
   * user uploaded (same pattern as `StyleSettings.customImageUrl`). */
  customAudioUrl: string | null;
  /** Original filename, for display next to the "Remove" control — the
   * blob URL itself isn't human-readable. */
  customAudioName: string | null;
  /** 0-100. */
  volume: number;
  muted: boolean;
  /** Narration (recorded microphone audio — `RecordingMeta.hasMicAudio`,
   * see `narration.ts`) — independent volume/mute from the background
   * track above. Only surfaced in `AudioPanel` when the loaded recording
   * actually has a mic track; harmless unused defaults otherwise. */
  micVolume: number;
  micMuted: boolean;
  /** System audio (recorded machine output — `RecordingMeta.hasSystemAudio`,
   * same single-shot playback mechanics as narration, see `narration.ts`) —
   * independent volume/mute, only surfaced in `AudioPanel` when the loaded
   * recording actually has a system track. */
  systemAudioVolume: number;
  systemAudioMuted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  trackId: null,
  customAudioUrl: null,
  customAudioName: null,
  volume: 70,
  muted: false,
  micVolume: 100,
  micMuted: false,
  systemAudioVolume: 100,
  systemAudioMuted: false,
};
