import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { listen } from "@tauri-apps/api/event";
import {
  AppWindowMac,
  ChevronDown,
  Circle,
  Crop,
  Mic,
  MicOff,
  Monitor,
  MonitorSpeaker,
  Pause,
  Play,
  Settings,
  Smartphone,
  Square,
  Video,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getMicrophoneStatus, openMicrophoneSettings, requestMicrophonePermission } from "../permissions/api";
import { setMicEnabled } from "./api";
import {
  AREA_SELECTED_EVENT,
  listCaptureTargets,
  openAreaSelector,
  selectCaptureTarget,
  type TargetInfo,
} from "./targets";

type SourceMode = "display" | "window" | "area" | "device";

interface AreaSelectedPayload {
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The floating toolbar's contents (see `ToolbarView`) — source/device
 * picker (full display, a specific window, a custom-dragged area, or not
 * built, a connected device), camera/mic/system-audio toggles, and the
 * start/stop/pause controls. Mic is real; camera and system audio aren't
 * implemented anywhere in the capture pipeline yet (see `recorder::start`'s
 * doc comment), so those two stay visibly inert rather than pretending to
 * work.
 */
export function SourcePickerBar({
  disabled,
  isRecording,
  isPaused,
  busy,
  onToggleRecording,
  onTogglePause,
}: {
  disabled: boolean;
  isRecording: boolean;
  isPaused: boolean;
  busy: boolean;
  onToggleRecording: () => void;
  onTogglePause: () => void;
}) {
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [mode, setMode] = useState<SourceMode>("display");
  const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null);
  const [areaLabel, setAreaLabel] = useState<string | null>(null);
  const [micEnabled, setMicEnabledState] = useState(false);
  const [micDeniedHint, setMicDeniedHint] = useState(false);

  useEffect(() => {
    void listCaptureTargets().then(setTargets);
  }, []);

  useEffect(() => {
    const unlisten = listen<AreaSelectedPayload>(AREA_SELECTED_EVENT, (event) => {
      setMode("area");
      setAreaLabel(`${Math.round(event.payload.width)} × ${Math.round(event.payload.height)}`);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const displays = targets.filter((t) => t.kind === "display");
  const windows = targets.filter((t) => t.kind === "window");
  const selectedWindow = windows.find((w) => w.id === selectedWindowId);

  async function pickDisplay(target: TargetInfo | null) {
    setMode("display");
    setAreaLabel(null);
    await selectCaptureTarget(target);
  }

  async function pickWindow(target: TargetInfo) {
    setMode("window");
    setSelectedWindowId(target.id);
    setAreaLabel(null);
    await selectCaptureTarget(target);
  }

  async function reset() {
    setMode("display");
    setSelectedWindowId(null);
    setAreaLabel(null);
    if (micEnabled) {
      setMicEnabledState(false);
      setMicDeniedHint(false);
      await setMicEnabled(false);
    }
    await selectCaptureTarget(null);
  }

  async function toggleMic() {
    if (micEnabled) {
      setMicEnabledState(false);
      setMicDeniedHint(false);
      await setMicEnabled(false);
      return;
    }
    const status = await getMicrophoneStatus();
    const granted = status === "authorized" || (await requestMicrophonePermission());
    if (!granted) {
      setMicDeniedHint(true);
      return;
    }
    setMicDeniedHint(false);
    setMicEnabledState(true);
    await setMicEnabled(true);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-1 rounded-2xl border border-neutral-800 bg-neutral-900/95 px-2 py-2 shadow-2xl backdrop-blur">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void reset()}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-900 hover:bg-white disabled:opacity-40"
          aria-label="Reset source selection"
          title="Reset"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mx-1 h-8 w-px bg-neutral-800" />

        {displays.length > 1 ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <TabButton icon={Monitor} label="Display" active={mode === "display"} disabled={disabled} />
            </DropdownMenu.Trigger>
            <PickerMenu>
              <DropdownMenu.Item className="picker-menu-item" onSelect={() => void pickDisplay(null)}>
                Main Display
              </DropdownMenu.Item>
              {displays.map((d) => (
                <DropdownMenu.Item key={d.id} className="picker-menu-item" onSelect={() => void pickDisplay(d)}>
                  {d.title || `Display ${d.id}`}
                </DropdownMenu.Item>
              ))}
            </PickerMenu>
          </DropdownMenu.Root>
        ) : (
          <TabButton
            icon={Monitor}
            label="Display"
            active={mode === "display"}
            disabled={disabled}
            onClick={() => void pickDisplay(null)}
          />
        )}

        {windows.length > 1 ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <TabButton
                icon={AppWindowMac}
                label="Window"
                sublabel={mode === "window" ? selectedWindow?.title : undefined}
                active={mode === "window"}
                disabled={disabled}
              />
            </DropdownMenu.Trigger>
            <PickerMenu>
              {windows.map((w) => (
                <DropdownMenu.Item key={w.id} className="picker-menu-item" onSelect={() => void pickWindow(w)}>
                  {w.title || `Window ${w.id}`}
                </DropdownMenu.Item>
              ))}
            </PickerMenu>
          </DropdownMenu.Root>
        ) : (
          <TabButton
            icon={AppWindowMac}
            label="Window"
            sublabel={mode === "window" ? selectedWindow?.title : undefined}
            active={mode === "window"}
            disabled={disabled || windows.length === 0}
            onClick={windows.length === 1 ? () => void pickWindow(windows[0]) : undefined}
            title={windows.length === 0 ? "No open windows" : undefined}
          />
        )}

        <TabButton
          icon={Crop}
          label="Area"
          sublabel={mode === "area" ? (areaLabel ?? undefined) : undefined}
          active={mode === "area"}
          disabled={disabled}
          onClick={() => void openAreaSelector()}
        />

        <TabButton
          icon={Smartphone}
          label="Device"
          active={false}
          disabled
          title="Recording a connected device isn't supported yet"
        />

        <div className="mx-1 h-8 w-px bg-neutral-800" />

        <ToggleChip icon={Video} offIcon={Video} label="No camera" enabled={false} disabled title="Not built yet" />
        <ToggleChip
          icon={Mic}
          offIcon={MicOff}
          label={micEnabled ? "Microphone" : "No microphone"}
          enabled={micEnabled}
          disabled={disabled}
          onClick={() => void toggleMic()}
        />
        <ToggleChip
          icon={MonitorSpeaker}
          offIcon={MonitorSpeaker}
          label="No system audio"
          enabled={false}
          disabled
          title="Not built yet"
        />

        <div className="mx-1 h-8 w-px bg-neutral-800" />

        <button
          type="button"
          disabled
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-neutral-600"
          title="Settings — not built yet"
        >
          <Settings className="h-4 w-4" />
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        <div className="mx-1 h-8 w-px bg-neutral-800" />

        {isRecording && (
          <button
            type="button"
            disabled={busy}
            onClick={onTogglePause}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            aria-label={isPaused ? "Resume recording" : "Pause recording"}
            title={isPaused ? "Resume" : "Pause"}
          >
            {isPaused ? <Play className="h-4 w-4" fill="currentColor" /> : <Pause className="h-4 w-4" fill="currentColor" />}
          </button>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={onToggleRecording}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500 disabled:opacity-40"
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          title={isRecording ? "Stop recording" : "Start recording"}
        >
          {isRecording ? (
            <Square className="h-3.5 w-3.5" fill="currentColor" />
          ) : (
            <Circle className="h-4 w-4" fill="currentColor" />
          )}
        </button>
      </div>

      {micDeniedHint && (
        <button
          type="button"
          onClick={() => void openMicrophoneSettings()}
          className="text-xs text-amber-400 underline underline-offset-2"
        >
          Microphone access denied — enable in System Settings
        </button>
      )}
    </div>
  );
}

function PickerMenu({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={8}
        className="z-50 max-h-72 min-w-[220px] overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-1 text-neutral-200 shadow-2xl [&_.picker-menu-item]:cursor-pointer [&_.picker-menu-item]:truncate [&_.picker-menu-item]:rounded-md [&_.picker-menu-item]:px-2.5 [&_.picker-menu-item]:py-1.5 [&_.picker-menu-item]:text-[12px] [&_.picker-menu-item]:outline-none [&_.picker-menu-item[data-highlighted]]:bg-neutral-800"
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

function TabButton({
  icon: Icon,
  label,
  sublabel,
  active,
  disabled,
  onClick,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sublabel?: string;
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title ?? (sublabel ? `${label}: ${sublabel}` : label)}
      className={`flex h-12 w-16 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        active ? "bg-neutral-800 text-neutral-50" : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="max-w-[60px] truncate">{sublabel ?? label}</span>
    </button>
  );
}

function ToggleChip({
  icon: Icon,
  offIcon: OffIcon,
  label,
  enabled,
  disabled,
  onClick,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  offIcon: React.ComponentType<{ className?: string }>;
  label: string;
  enabled: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const IconToShow = enabled ? Icon : OffIcon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed ${
        enabled
          ? "text-indigo-400 hover:bg-neutral-800"
          : disabled
            ? "text-neutral-600"
            : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      }`}
    >
      <IconToShow className="h-4 w-4" />
      {label}
    </button>
  );
}
