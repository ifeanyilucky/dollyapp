/**
 * macOS virtual-keycode → display-label mapping for the keystrokes overlay.
 *
 * The recorder captures `NSEvent.keyCode()` — a keyboard-layout-independent
 * *position* code (see `src-tauri/src/cursor/macos.rs`'s `install_global_monitor`),
 * never resolved text. Rendering those codes back into something readable is
 * this module's job. The map covers the ANSI layout's codes (the de-facto
 * standard; ISO only differs on the grave/backslash slots, which still map
 * reasonably here). Modifier codes (`cmd`/`shift`/...) never appear *as keys*,
 * because `modifier_names` only records them in the combo's `modifiers` array —
 * but they're mapped anyway in case a lone modifier event slips through.
 */

const KEY_CODE_LABELS: Record<number, string> = {
  0: "A",
  1: "S",
  2: "D",
  3: "F",
  4: "H",
  5: "G",
  6: "Z",
  7: "X",
  8: "C",
  9: "V",
  11: "B",
  12: "Q",
  13: "W",
  14: "E",
  15: "R",
  16: "Y",
  17: "T",
  18: "1",
  19: "2",
  20: "3",
  21: "4",
  22: "6",
  23: "5",
  24: "=",
  25: "9",
  26: "7",
  27: "-",
  28: "8",
  29: "0",
  30: "]",
  31: "O",
  32: "U",
  33: "[",
  34: "I",
  35: "P",
  36: "Return",
  37: "L",
  38: "J",
  39: "'",
  40: "K",
  41: ";",
  42: "\\",
  43: ",",
  44: "/",
  45: "N",
  46: "M",
  47: ".",
  48: "Tab",
  49: "Space",
  50: "`",
  51: "Delete",
  53: "Esc",
  54: "Cmd",
  55: "Shift",
  56: "Caps Lock",
  57: "Option",
  58: "Control",
  59: "Shift",
  60: "Option",
  61: "Control",
  63: "Fn",
  65: "Num .",
  67: "Num *",
  69: "Num +",
  71: "Num /",
  75: "Num -",
  78: "Num 0",
  79: "Num 1",
  80: "Num 2",
  81: "Num 3",
  82: "Num 4",
  83: "Num 5",
  84: "Num 6",
  85: "Num 7",
  86: "Num 8",
  87: "Num 9",
  96: "F5",
  97: "F6",
  98: "F7",
  99: "F3",
  100: "F8",
  101: "F9",
  103: "F11",
  105: "F13",
  106: "F16",
  107: "F14",
  109: "F10",
  111: "F12",
  113: "F15",
  114: "Help",
  115: "Home",
  116: "Page Up",
  117: "Forward Delete",
  118: "F4",
  119: "End",
  120: "F2",
  121: "Page Down",
  122: "F1",
  123: "Left Arrow",
  124: "Right Arrow",
  125: "Down Arrow",
  126: "Up Arrow",
};

/** Display symbols for the modifier names the recorder records (`cmd`,
 * `shift`, `option`, `control` — see `modifier_names` in macos.rs), in
 * the conventional left-to-right order. */
export const MODIFIER_SYMBOLS: Record<string, string> = {
  cmd: "⌘",
  shift: "⇧",
  option: "⌥",
  control: "⌃",
};

/** Virtual keycodes that are themselves modifier keys — pressing e.g.
 * Shift alone is recorded as `modifiers: ["shift"]` *and* `code: 55`, and
 * the combo should show one "⇧" chip, not a second "Shift" chip for the
 * main key. */
const MODIFIER_CODES = new Set([54, 55, 56, 57, 58, 59, 60, 61, 63]);

/** Human-readable label for a virtual keycode — the mapped text when known,
 * a bare "Key N" fallback otherwise (so an unmapped code is still visible
 * rather than silently dropped). */
export function keyCodeLabel(code: number): string {
  return KEY_CODE_LABELS[code] ?? `Key ${code}`;
}

/** Splits a recorded key press into chip texts — ordered modifier symbols
 * (per `MODIFIER_SYMBOLS`, falling back to the raw name for an unknown
 * one) followed by the main key's label, omitted entirely when the main
 * key is itself a modifier. */
export function keyComboParts(modifiers: string[], code: number): string[] {
  const chips = modifiers.map((m) => MODIFIER_SYMBOLS[m] ?? m);
  if (!MODIFIER_CODES.has(code)) chips.push(keyCodeLabel(code));
  return chips;
}
