// Clem's mark: a letter C drawn as one thick round-capped arc, with a block cursor sitting in its opening.
// Everything that draws the mark (the app's Logo, the boot screen, icons, favicons, email art, the browser sign-in page)
// uses this file, so the geometry lives in one place. Coordinates are in a 100-unit box.

/** The C: a 30-unit-radius arc that opens to the right. */
export const MARK_ARC = "M72.29 29.93A30 30 0 1 0 72.29 70.07";
export const MARK_ARC_WIDTH = 13;
/** The block cursor in the C's opening. */
export const MARK_CURSOR = { x: 56, y: 40, width: 11, height: 20, rx: 2 };
/** Optical centring: the C's weight sits left of its box, so the drawing shifts right a little. */
export const MARK_NUDGE = "translate(3.8 0)";

/** Brand colours from the identity sheet. */
export const CLEM_INK = "#0b0b0a";
export const CLEM_PAPER = "#F4F2EC";
export const CLEM_MUTED = "#8a897f";
export const CLEM_LINE = "#23231f";
export const CLEM_TILE = "#161614";

/** The mark's inner SVG (no <svg> wrapper), drawn in `color`. */
export function markInner(color = "currentColor") {
  const c = MARK_CURSOR;
  return `<g transform="${MARK_NUDGE}"><path d="${MARK_ARC}" fill="none" stroke="${color}" stroke-width="${MARK_ARC_WIDTH}" stroke-linecap="round"/><rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="${c.rx}" fill="${color}"/></g>`;
}

/** A standalone SVG of the mark in a 100-unit box, for icons, email frames and static pages. */
export function markSvg({ color = CLEM_PAPER, extra = "", attrs = "" }: { size?: number; color?: string; extra?: string; attrs?: string } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${attrs}>${extra}${markInner(color)}</svg>`;
}

/** The app icon: the mark at 72% on a rounded tile, black (dark ink tile, paper mark) or white (paper tile, ink mark). */
export function tileSvg({ tone = "black", attrs = "" }: { tone?: "black" | "white"; attrs?: string } = {}) {
  const black = tone === "black";
  const tile = `<rect width="100" height="100" rx="23" fill="${black ? CLEM_TILE : CLEM_PAPER}"/>` + (black ? `<rect x="0.5" y="0.5" width="99" height="99" rx="22.5" fill="none" stroke="#2a2a26"/>` : "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${attrs}>${tile}<g transform="translate(50 50) scale(0.72) translate(-50 -50)">${markInner(black ? CLEM_PAPER : CLEM_INK)}</g></svg>`;
}

/** The thinking animation: three block cursors that hop in turn, 1.35 s loop, 0.45 s apart. Shared CSS keyframes. */
export const HOP_PERIOD = 1.35;
export const HOP_STAGGER = 0.45;
export function hopKeyframes(name = "clem-hop", lift = "-30%") {
  return `@keyframes ${name}{0%{opacity:.18;transform:translateY(0)}12%{opacity:1;transform:translateY(${lift})}30%{opacity:1;transform:translateY(0)}42%,100%{opacity:.18;transform:translateY(0)}}`;
}
