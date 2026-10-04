import { plainMath } from "./docx-math.ts";
import { markMath } from "./deck-math.ts";

/**
 * Text on slides: inline **bold** and $maths$ become text runs. Inline maths is read as Pandoc reads it: a $ followed
 * by a non-space, closed by a $ after a non-space and not followed by a digit. So "$x^2$" is maths, while
 * "$1.2M budget" and "costs $5 and $10" are money and stay as written.
 */
const MATH = /\$(?=[^\s$])(?:[^$\n]*?[^\s$])?\$(?!\d)/;
const PARTS = new RegExp(`(\\*\\*[^*]+\\*\\*|${MATH.source})`, "g");
export const isMath = (part: string) => new RegExp(`^${MATH.source}$`).test(part);
export function runs(text: string, base: Record<string, unknown> = {}) {
  return String(text).split(PARTS).filter(Boolean).map((part) =>
    /^\*\*[^*]+\*\*$/.test(part) ? { text: part.slice(2, -2), options: { ...base, bold: true } } : isMath(part) ? { text: markMath(part.slice(1, -1), plainMath(part.slice(1, -1))), options: { ...base, italic: true } } : { text: part, options: base });
}
/** The same text as one plain string (for measuring and for boxes with a single style). */
export const strip = (text: string) => String(text).replace(/\*\*([^*]+)\*\*/g, "$1").replace(new RegExp(MATH.source, "g"), (m) => plainMath(m.slice(1, -1)));
