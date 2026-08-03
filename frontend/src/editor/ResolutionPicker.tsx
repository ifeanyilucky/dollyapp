import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Monitor } from "lucide-react";
import { resolutionAvailable, resolutionPreset, RESOLUTION_PRESETS, type ResolutionId } from "./resolution";

/**
 * Output-resolution picker — shared by `Timeline` (next to the split/
 * scissors button) and `PreviewControls` (preview mode hides `Timeline`
 * entirely, so it needs its own way to reach this). Both render the exact
 * same component against the exact same `EditorDocument` field
 * (`EditorView`'s `resolution`), so there's only ever one place this can
 * drift out of sync with itself.
 *
 * This isn't preview-only: the chosen tier is also what `exportVideo`
 * renders at (see `resolution.ts`'s `computeOutputSize`) — "preview and
 * export must never diverge" (ARCHITECTURE.md) applies here too. Tiers
 * that would upscale past the source recording's own pixels are disabled
 * rather than silently doing nothing when picked.
 */
export function ResolutionPicker({
  resolution,
  onChange,
  sourceWidthPx,
  sourceHeightPx,
}: {
  resolution: ResolutionId;
  onChange: (id: ResolutionId) => void;
  sourceWidthPx: number;
  sourceHeightPx: number;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label="Output resolution"
          title="Output resolution"
        >
          <Monitor className="h-3.5 w-3.5" />
          {resolutionPreset(resolution).label}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={6}
          className="z-50 min-w-32 rounded-lg border border-neutral-800 bg-neutral-900 p-1 text-neutral-200 shadow-2xl [&_.resolution-item]:cursor-pointer [&_.resolution-item]:rounded-md [&_.resolution-item]:px-2.5 [&_.resolution-item]:py-1.5 [&_.resolution-item]:text-[12px] [&_.resolution-item]:outline-none [&_.resolution-item[data-highlighted]]:bg-neutral-800 [&_.resolution-item[data-disabled]]:cursor-not-allowed [&_.resolution-item[data-disabled]]:text-neutral-600"
        >
          {RESOLUTION_PRESETS.map((preset) => {
            const available = resolutionAvailable(preset, sourceWidthPx, sourceHeightPx);
            return (
              <DropdownMenu.Item
                key={preset.id}
                disabled={!available}
                className={`resolution-item ${preset.id === resolution ? "text-indigo-400" : ""}`}
                onSelect={() => onChange(preset.id)}
                title={available ? undefined : "Larger than this recording's source resolution"}
              >
                {preset.label}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
