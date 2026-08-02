/**
 * Top toolbar. Aspect ratio (currently always the recording's native
 * ratio — switching is task #26, not built), Crop/Mask are inert
 * placeholders for now. "Reveal in Finder" is real; a true "Export" (with
 * motion/background baked into an output file) isn't built yet, so it's
 * not labeled as one — see ARCHITECTURE.md for what's still ahead.
 */
export function TopBar({
  title,
  aspectLabel,
  onRevealInFinder,
  onClose,
}: {
  title: string;
  aspectLabel: string;
  onRevealInFinder: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex w-full flex-col border-b border-neutral-800">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          ← Back
        </button>
        <span className="flex-1 truncate text-center text-xs text-neutral-500">{title}</span>
        <button
          type="button"
          onClick={onRevealInFinder}
          className="rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400"
        >
          Reveal in Finder
        </button>
      </div>
      <div className="flex items-center gap-2 px-4 pb-2.5">
        <span className="flex items-center gap-1.5 rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-400">
          {aspectLabel}
        </span>
        <span className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-600">Crop</span>
        <span className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-600">Mask</span>
      </div>
    </div>
  );
}
