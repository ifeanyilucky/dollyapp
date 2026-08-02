import { useEffect, useState } from "react";
import { listCaptureTargets, selectCaptureTarget, type TargetInfo } from "./targets";

const MAIN_DISPLAY_VALUE = "main";

function targetValue(t: TargetInfo): string {
  return `${t.kind}:${t.id}`;
}

/**
 * Display/window picker (PRD §9: "Picker: full display / window / region").
 * Region selection isn't built yet — only whole displays and whole windows.
 * Disabled while recording; selecting only takes effect on the *next*
 * `start_recording` call, it can't retarget a recording in progress.
 */
export function TargetPicker({ disabled }: { disabled: boolean }) {
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [selected, setSelected] = useState(MAIN_DISPLAY_VALUE);

  useEffect(() => {
    void listCaptureTargets().then(setTargets);
  }, []);

  async function handleChange(value: string) {
    setSelected(value);
    const target = targets.find((t) => targetValue(t) === value) ?? null;
    await selectCaptureTarget(target);
  }

  const displays = targets.filter((t) => t.kind === "display");
  const windows = targets.filter((t) => t.kind === "window");

  return (
    <select
      value={selected}
      disabled={disabled}
      onChange={(e) => void handleChange(e.target.value)}
      className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 disabled:opacity-50"
    >
      <option value={MAIN_DISPLAY_VALUE}>Main Display</option>
      {displays.length > 0 && (
        <optgroup label="Displays">
          {displays.map((t) => (
            <option key={targetValue(t)} value={targetValue(t)}>
              {t.title || `Display ${t.id}`}
            </option>
          ))}
        </optgroup>
      )}
      {windows.length > 0 && (
        <optgroup label="Windows">
          {windows.map((t) => (
            <option key={targetValue(t)} value={targetValue(t)}>
              {t.title || `Window ${t.id}`}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
