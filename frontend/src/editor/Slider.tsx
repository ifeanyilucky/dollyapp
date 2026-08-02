import * as RadixSlider from "@radix-ui/react-slider";

/**
 * Shared slider look: thin track, filled range from the left edge, small
 * circular thumb — matches the reference screenshots' minimal style.
 * Built on Radix rather than a bare `<input type="range">` for real
 * keyboard/pointer accessibility and consistent cross-platform rendering
 * (native range inputs vary a lot between browsers/OSes).
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  onReset,
  className,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Fires once, when the drag ends (Radix's `onValueCommit`) — pairs with
   * a history-aware `onChange` that only wants one undo step per drag
   * rather than one per intermediate value. Optional: callers that don't
   * need undo granularity (or aren't wired into history at all) can omit
   * it. */
  onCommit?: () => void;
  onReset?: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      {label && (
        <span className="flex items-center justify-between text-xs text-neutral-300">
          <span>{label}</span>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="text-neutral-600 transition-colors hover:text-neutral-400"
            >
              Reset
            </button>
          )}
        </span>
      )}
      <RadixSlider.Root
        className="relative flex h-4 w-full touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={() => onCommit?.()}
      >
        <RadixSlider.Track className="relative h-[3px] flex-1 rounded-full bg-neutral-700">
          <RadixSlider.Range className="absolute h-full rounded-full bg-indigo-400" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          className="block h-4 w-4 rounded-full bg-indigo-400 shadow-sm transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          aria-label={label}
        />
      </RadixSlider.Root>
    </div>
  );
}
