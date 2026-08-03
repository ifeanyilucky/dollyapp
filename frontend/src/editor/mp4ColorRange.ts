/**
 * WebKit's `MediaRecorder` encodes canvas captures as limited-range (16-235)
 * H.264 but writes the MP4's `nclx` colour box with the full-range flag set.
 * Players honour that flag and decode the limited data as full range, so
 * exported videos come out washed out — black lifted to 16, white capped at
 * 235, saturation reduced. Clearing the flag makes the limited data decode
 * correctly. No-op for anything without an `nclx` box (e.g. WebM).
 */
export function fixMp4ColorRange(bytes: Uint8Array): Uint8Array {
  const haystack = new TextDecoder("iso-8859-1").decode(bytes);
  let pos = haystack.indexOf("nclx");
  while (pos >= 0) {
    // nclx layout: 'nclx'(4) | colour_primaries(2) | transfer(2) | matrix(2) | full_range_flag(1)
    const flagPos = pos + 10;
    if (flagPos < bytes.length) {
      bytes[flagPos] &= 0x7f;
    }
    pos = haystack.indexOf("nclx", pos + 1);
  }
  return bytes;
}
