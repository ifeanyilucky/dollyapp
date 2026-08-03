import { BellRing, CloudRain, Moon, Trash2, Upload, Volume2, VolumeX, Waves, Wind, X } from "lucide-react";
import { useRef, type ComponentType } from "react";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings, type AudioTrackSelection } from "./audioSettings";
import { AMBIENT_TRACK_PRESETS, type AmbientTrackId } from "./backgroundAudio";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";

const PRESET_ICONS: Record<AmbientTrackId, ComponentType<{ className?: string }>> = {
  "calm-drone": Moon,
  "soft-pulse": Waves,
  "airy-chimes": BellRing,
  "gentle-rain": CloudRain,
  "deep-focus": Wind,
};

/**
 * Audio panel — speaker icon in the sidebar rail. One optional background
 * track (a built-in synthesized ambient loop, or a user-uploaded file —
 * see `backgroundAudio.ts`), looped under the recording with independent
 * volume/mute, real playback wired into both the live preview and export
 * via `EditorView`'s `BackgroundAudioPlayer`.
 */
export function AudioPanel({
  settings,
  onChange,
  onCommit,
}: {
  settings: AudioSettings;
  /** Live update — called on every change, including every intermediate
   * value during a slider drag. */
  onChange: (next: AudioSettings) => void;
  /** Turns whatever's accumulated since the last commit into a single undo
   * step (see `history.ts`). The volume slider calls this itself once, on
   * drag release; every discrete control here calls it immediately after
   * `onChange` via the local `set` helper. */
  onCommit: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) {
    onChange({ ...settings, [key]: value });
    onCommit();
  }

  function setLive<K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  function selectPreset(id: AudioTrackSelection) {
    if (settings.customAudioUrl?.startsWith("blob:")) URL.revokeObjectURL(settings.customAudioUrl);
    onChange({ ...settings, trackId: id, customAudioUrl: null, customAudioName: null });
    onCommit();
  }

  function handleFileChosen(file: File) {
    if (settings.customAudioUrl?.startsWith("blob:")) URL.revokeObjectURL(settings.customAudioUrl);
    const url = URL.createObjectURL(file);
    onChange({ ...settings, trackId: "custom", customAudioUrl: url, customAudioName: file.name });
    onCommit();
  }

  function removeBackgroundAudio() {
    if (settings.customAudioUrl?.startsWith("blob:")) URL.revokeObjectURL(settings.customAudioUrl);
    onChange({ ...settings, trackId: null, customAudioUrl: null, customAudioName: null });
    onCommit();
  }

  const hasTrack = settings.trackId !== null;

  return (
    <div className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto rounded-xl border border-neutral-800/80 bg-neutral-950/70 p-5">
      <div>
        <h3 className="mb-2.5 text-[13px] font-medium text-neutral-200">Background audio</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-neutral-500">
          Loops under the whole recording at whatever volume you set below.
        </p>
        <div className="flex flex-col gap-1.5">
          {AMBIENT_TRACK_PRESETS.map((preset) => {
            const Icon = PRESET_ICONS[preset.id];
            const active = settings.trackId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset.id)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-indigo-400 bg-neutral-900"
                    : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                    active ? "bg-indigo-500/20 text-indigo-300" : "bg-neutral-800 text-neutral-400"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-[12px] font-medium text-neutral-200">{preset.label}</span>
                  <span className="block text-[11px] text-neutral-500">{preset.mood}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-neutral-800" />

      <div>
        <h3 className="mb-2.5 text-[13px] font-medium text-neutral-200">Custom track</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileChosen(file);
            e.target.value = "";
          }}
        />
        {settings.trackId === "custom" && settings.customAudioName ? (
          <div className="flex items-center gap-2 rounded-lg border border-indigo-400 bg-neutral-900 px-3 py-2">
            <span className="flex-1 truncate text-[12px] font-medium text-neutral-200">
              {settings.customAudioName}
            </span>
            <button
              type="button"
              onClick={removeBackgroundAudio}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
              aria-label="Remove custom track"
              title="Remove custom track"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-700 py-3 text-[12px] font-medium text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload an audio file
          </button>
        )}
      </div>

      <div className="border-t border-neutral-800" />

      <div className={`flex flex-col gap-4 ${hasTrack ? "" : "opacity-40"}`}>
        <Slider
          label="Volume"
          value={settings.volume}
          min={0}
          max={100}
          onChange={(v) => setLive("volume", v)}
          onCommit={onCommit}
          onReset={() => set("volume", DEFAULT_AUDIO_SETTINGS.volume)}
          className={hasTrack ? "" : "pointer-events-none"}
        />

        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-200">
            {settings.muted ? <VolumeX className="h-3.5 w-3.5 text-neutral-400" /> : <Volume2 className="h-3.5 w-3.5 text-neutral-400" />}
            Mute background audio
          </span>
          <Toggle checked={settings.muted} onChange={(v) => set("muted", v)} disabled={!hasTrack} />
        </div>
      </div>

      <button
        type="button"
        onClick={removeBackgroundAudio}
        disabled={!hasTrack}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 enabled:hover:bg-red-950 enabled:hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove background audio
      </button>
    </div>
  );
}
