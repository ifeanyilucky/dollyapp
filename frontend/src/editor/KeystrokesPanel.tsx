import { Command } from "lucide-react";
import {
  DEFAULT_KEYSTROKE_SETTINGS,
  KEYSTROKE_POSITION_LABELS,
  type KeystrokePosition,
  type KeystrokeSettings,
} from "./keystrokeSettings";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";

const POSITIONS: KeystrokePosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

/**
 * Shortcuts panel (keystrokes overlay) — command icon in the sidebar rail.
 * Renders recent recorded key presses (see `keycodeMap.ts`) as chips over
 * the video, in preview and export alike (the renderer's `draw` is the
 * single code path for both — see `renderer.ts`'s `drawKeystrokes`).
 */
export function KeystrokesPanel({
  settings,
  onChange,
  onCommit,
}: {
  settings: KeystrokeSettings;
  /** Live update — called on every change, including every intermediate
   * value during a slider drag. */
  onChange: (next: KeystrokeSettings) => void;
  /** Turns whatever's accumulated since the last commit into a single undo
   * step (see `history.ts`). Sliders call this themselves on drag release;
   * every discrete control here calls it immediately after `onChange` via
   * the local `set` helper. */
  onCommit: () => void;
}) {
  function set<K extends keyof KeystrokeSettings>(key: K, value: KeystrokeSettings[K]) {
    onChange({ ...settings, [key]: value });
    onCommit();
  }

  function setLive<K extends keyof KeystrokeSettings>(key: K, value: KeystrokeSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto rounded-xl border border-neutral-800/80 bg-neutral-950/70 p-5">
      <div>
        <h3 className="mb-2.5 flex items-center gap-1.5 text-[13px] font-medium text-neutral-200">
          <Command className="h-3.5 w-3.5 text-neutral-400" />
          Keystrokes
        </h3>
        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] leading-relaxed text-neutral-500">
            Show keys pressed during the recording as on-screen chips, over the video in
            preview and export.
          </p>
          <Toggle checked={settings.enabled} onChange={(v) => set("enabled", v)} />
        </div>
      </div>

      {settings.enabled && (
        <>
          <div className="flex flex-col gap-4">
            <div>
              <span className="mb-2 block text-[13px] font-medium text-neutral-200">Position</span>
              <div className="grid grid-cols-3 gap-1.5">
                {POSITIONS.map((pos) => {
                  const active = settings.position === pos;
                  return (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => set("position", pos)}
                      className={`rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors ${
                        active
                          ? "border-indigo-400 bg-neutral-900 text-neutral-100"
                          : "border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700"
                      }`}
                    >
                      {KEYSTROKE_POSITION_LABELS[pos]}
                    </button>
                  );
                })}
              </div>
            </div>

            <Slider
              label="Size"
              value={settings.size}
              min={0}
              max={100}
              onChange={(v) => setLive("size", v)}
              onCommit={onCommit}
              onReset={() => set("size", DEFAULT_KEYSTROKE_SETTINGS.size)}
            />
            <Slider
              label="Max keys shown"
              value={settings.maxKeys}
              min={1}
              max={5}
              onChange={(v) => setLive("maxKeys", v)}
              onCommit={onCommit}
              onReset={() => set("maxKeys", DEFAULT_KEYSTROKE_SETTINGS.maxKeys)}
            />
            <Slider
              label="Show for (seconds)"
              value={settings.durationS}
              min={0.5}
              max={3}
              step={0.5}
              onChange={(v) => setLive("durationS", v)}
              onCommit={onCommit}
              onReset={() => set("durationS", DEFAULT_KEYSTROKE_SETTINGS.durationS)}
            />
          </div>

          <div className="border-t border-neutral-800" />

          <button
            type="button"
            onClick={() => set("enabled", false)}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 py-2 text-[12px] font-medium text-neutral-300 hover:bg-red-950 hover:text-red-400"
          >
            Hide keystrokes
          </button>
        </>
      )}
    </div>
  );
}
