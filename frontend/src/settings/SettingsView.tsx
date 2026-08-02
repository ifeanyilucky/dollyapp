import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { getSettings, revealInFinder, setShowInDock } from "./api";

/** Root of the settings window (`?mode=settings` — see `main.tsx` and
 * `commands::open_settings_window`). A regular decorated window, unlike
 * the toolbar/overlays, so no transparent-background dance is needed here.
 *
 * Deliberately narrow in scope: everything here is real and working, but
 * the only preference that currently exists is Dock visibility (mirrors
 * the tray's "Show Dolly in Dock" checkbox — both call the same
 * `set_show_in_dock` command, see `tray::set_show_in_dock`). The
 * recordings-location and shortcuts sections are read-only reference.
 */
export function SettingsView() {
  const [showInDock, setShowInDockState] = useState(true);
  const [recordingsDir, setRecordingsDir] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getSettings().then((info) => {
      setShowInDockState(info.showInDock);
      setRecordingsDir(info.recordingsDir);
      setLoaded(true);
    });
  }, []);

  async function toggleShowInDock() {
    const next = !showInDock;
    // Optimistic — the tray checkbox and this toggle both drive the same
    // persisted preference, but there's no live sync between the two
    // windows while both happen to be open at once.
    setShowInDockState(next);
    await setShowInDock(next);
  }

  if (!loaded) {
    return <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-500">Loading…</div>;
  }

  return (
    <div className="flex h-screen w-screen flex-col gap-6 overflow-y-auto bg-neutral-950 px-6 py-5 text-neutral-300">
      <h1 className="text-sm font-semibold text-neutral-100">Settings</h1>

      <Section title="General">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] text-neutral-200">Show Dolly in Dock</p>
            <p className="text-[11px] text-neutral-500">
              Turn off to keep Dolly in the menu bar only, with no Dock icon.
            </p>
          </div>
          <ToggleSwitch checked={showInDock} onChange={() => void toggleShowInDock()} />
        </div>
      </Section>

      <Section title="Recordings">
        <div className="flex items-center justify-between gap-4">
          <p className="truncate text-[12px] text-neutral-400" title={recordingsDir}>
            {recordingsDir}
          </p>
          <button
            type="button"
            onClick={() => void revealInFinder(recordingsDir)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-800 px-2.5 py-1.5 text-[12px] font-medium text-neutral-300 hover:bg-neutral-900"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Reveal in Finder
          </button>
        </div>
      </Section>

      <Section title="Keyboard shortcuts">
        <ul className="flex flex-col gap-1.5">
          <ShortcutRow label="Start / stop recording" combo="⌥⌘2" />
          <ShortcutRow label="New recording…" combo="⌃⌘⏎" />
          <ShortcutRow label="Record display" combo="⌥⌘3" />
          <ShortcutRow label="Record window" combo="⌥⌘4" />
          <ShortcutRow label="Record area" combo="⌥⌘5" />
        </ul>
        <p className="mt-2 text-[11px] text-neutral-600">
          These work anywhere, even while another app is active. "Show settings," "Open project…," and "Open last
          project" show shortcuts in the menu bar item too, but only trigger from that menu — they're common
          Preferences/Open/Redo shortcuts in other apps, so Dolly doesn't claim them system-wide.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3.5">{children}</div>
    </section>
  );
}

function ShortcutRow({ label, combo }: { label: string; combo: string }) {
  return (
    <li className="flex items-center justify-between text-[12px]">
      <span className="text-neutral-300">{label}</span>
      <kbd className="rounded-md border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 font-sans text-[11px] text-neutral-300">
        {combo}
      </kbd>
    </li>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-indigo-500" : "bg-neutral-700"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? "translate-x-4.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
