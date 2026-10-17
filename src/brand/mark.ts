// Mowr's mark: a lowercase m written in one ink stroke, in Mowr red. While Mowr thinks, the pen writes the m, holds,
// and lifts it off the page from the start, then writes it again. public/boot.js and desktop/browser-login.ts draw
// the same stroke and timing in plain script and CSS; keep them in step with this file.
export const MARK_PATH = "M15 113 V63 C15 43 25 31 40 31 C55 31 65 43 65 63 V105 V63 C65 43 75 31 90 31 C105 31 115 43 115 63 V93 C115 105 121 113 129 109";
export const MARK_STROKE = 19;
/** One loop of the writing animation, in milliseconds. */
export const MARK_LOOP = 3200;
const ease = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** How much of the stroke shows at a moment of the loop: drawn from `from` to `to`, as fractions of its length. */
export function markSpan(ms: number) {
  const t = (ms % MARK_LOOP) / MARK_LOOP;
  return t < 0.5 ? { from: 0, to: ease(t / 0.5) } : t < 0.62 ? { from: 0, to: 1 } : { from: ease((t - 0.62) / 0.38), to: 1 };
}

/** The mark as SVG markup for a 144-unit box, at rest (no `ms`) or at a moment of the writing loop. */
export function markSvg(ms?: number, color = "currentColor") {
  const span = ms === undefined ? { from: 0, to: 1 } : markSpan(ms);
  const dash = ms === undefined ? "" : ` pathLength="1" stroke-dasharray="${(span.to - span.from).toFixed(3)} 2" stroke-dashoffset="${(-span.from).toFixed(3)}"${span.to - span.from < 0.01 ? ' opacity="0"' : ""}`;
  return `<path d="${MARK_PATH}" fill="none" stroke="${color}" stroke-width="${MARK_STROKE}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
}
