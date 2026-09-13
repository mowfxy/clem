/**
 * PDF text helpers.
 *
 * The emitter's `Page.text()` method already handles font selection,
 * alignment and rotation. This module adds small typed wrappers and a
 * word-wrapping helper used by the document composer.
 */
export interface TextWrapResult {
  lines: string[];
  /** Width in points of the widest line. */
  widthPt: number;
}

/**
 * Greedy word-wrap. Caller chooses the font/size pair to estimate widths;
 * we fall back to a character-based heuristic that approximates Helvetica
 * metrics. For exact widths, callers should measure with a font engine.
 */
export function wrapText(text: string, maxWidthPt: number, avgCharWidthPt = 4.5): TextWrapResult {
  const maxChars = Math.max(1, Math.floor(maxWidthPt / avgCharWidthPt));
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let cur = "";
  let widest = 0;
  for (const w of words) {
    if ((cur + w).length > maxChars) {
      if (cur.length > 0) {
        widest = Math.max(widest, cur.length * avgCharWidthPt);
        lines.push(cur.trim());
        cur = "";
      }
      if (w.length > maxChars) {
        // Hard-break very long tokens.
        for (let i = 0; i < w.length; i += maxChars) {
          const piece = w.slice(i, i + maxChars);
          widest = Math.max(widest, piece.length * avgCharWidthPt);
          lines.push(piece);
        }
      } else {
        cur = w;
      }
    } else {
      cur += w;
    }
  }
  if (cur.trim().length > 0) {
    widest = Math.max(widest, cur.length * avgCharWidthPt);
    lines.push(cur.trim());
  }
  return { lines, widthPt: widest };
}
