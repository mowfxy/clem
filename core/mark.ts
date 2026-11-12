// Clem's mark: a soft pebble with a leaf cut out of it. The mark never animates; thinking is the separate tumble below.
// Everything that draws the mark (the app's Logo, the boot screen, icons, favicons, email art, the browser sign-in page)
// uses this file, so the geometry lives in one place. Coordinates are in a 100-unit box.

/** The pebble's outline, centred in the box. */
export const MARK_BODY = "M70.89 15.56C78.88 19.44 86.71 29.77 89.89 37.94C92.77 45.35 92.92 52.63 88.85 59.66C84.46 67.24 65.87 80.58 57.77 84.27C51.49 87.13 44.84 87.6 38.77 83.89C35.63 81.96 11.04 58.55 9.48 55.83C7.34 52.07 7.45 48.27 10.22 44.88C13.26 41.13 44.74 19.42 50.21 16.47C56.68 12.98 64.17 12.31 70.89 15.56Z";
/** The leaf cut out of it, tip to tip. */
export const MARK_LEAF = "M73.25 31.75C61.68 33.22 51.39 38.98 45.85 44.76C40.22 50.65 34.1 61.01 37.34 74.86C43.36 65.18 53.84 64.07 60.49 58.13C66.5 52.76 73.53 45 73.25 31.75Z";
/** Both outlines as one path; draw it with fill-rule evenodd so the leaf is a real hole. */
export const MARK_PATH = MARK_BODY + MARK_LEAF;

/** Brand colours from the identity sheet. */
export const CLEM_INK = "#0b0b0a";
export const CLEM_PAPER = "#F4F2EC";
export const CLEM_MUTED = "#8a897f";
export const CLEM_LINE = "#23231f";
/** The app icon's tile: the same background as the website, so the app and the site read as one. */
export const CLEM_TILE = "#0e1017";

/** The mark's inner SVG (no <svg> wrapper), drawn in `color`. */
export function markInner(color = "currentColor") {
  return `<path d="${MARK_PATH}" fill="${color}" fill-rule="evenodd"/>`;
}

/** A standalone SVG of the mark in a 100-unit box, for icons, email frames and static pages. */
export function markSvg({ color = CLEM_PAPER, extra = "", attrs = "" }: { size?: number; color?: string; extra?: string; attrs?: string } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${attrs}>${extra}${markInner(color)}</svg>`;
}

/** One of the mark's outlines as points along its curves, for drawings that trace it by hand. */
export function markOutline(path: string, steps = 14): [number, number][] {
  const n = path.match(/-?\d*\.?\d+/g)!.map(Number), points: [number, number][] = [[n[0], n[1]]];
  for (let i = 2; i + 5 < n.length; i += 6) {
    const [ax, ay] = [n[i - 2], n[i - 1]];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, m = 1 - t;
      points.push([m ** 3 * ax + 3 * m * m * t * n[i] + 3 * m * t * t * n[i + 2] + t ** 3 * n[i + 4], m ** 3 * ay + 3 * m * m * t * n[i + 1] + 3 * m * t * t * n[i + 3] + t ** 3 * n[i + 5]]);
    }
  }
  return points;
}

/** How much of the app icon's tile the mark fills: it is a solid shape, so it needs the size to hold up on a taskbar. */
export const MARK_TILE_SCALE = 0.84;

/** The app icon: the mark on a rounded tile, black (dark ink tile, paper mark) or white (paper tile, ink mark). */
export function tileSvg({ tone = "black", attrs = "" }: { tone?: "black" | "white"; attrs?: string } = {}) {
  const black = tone === "black";
  const tile = `<rect width="100" height="100" rx="23" fill="${black ? CLEM_TILE : CLEM_PAPER}"/>` + (black ? `<rect x="0.5" y="0.5" width="99" height="99" rx="22.5" fill="none" stroke="#262a38"/>` : "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${attrs}>${tile}<g transform="translate(50 50) scale(${MARK_TILE_SCALE}) translate(-50 -50)">${markInner(black ? CLEM_PAPER : CLEM_INK)}</g></svg>`;
}

/** The mark's share of a glow tile, as on @M4ClemBot's picture: roomier than the black tile's. */
export const MARK_GLOW_SCALE = 0.66;
/**
 * The Windows app icon (and @M4ClemBot's picture): the paper mark on the app's dark tile, lit by the main thread's two
 * glows, red low on the left and blue high on the right. `scale` is the mark's share of the tile.
 */
export function glowTileSvg({ attrs = "", scale = MARK_GLOW_SCALE }: { attrs?: string; scale?: number } = {}) {
  const defs = `<defs><radialGradient id="cg-base" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#151a2a"/><stop offset=".8" stop-color="${CLEM_TILE}"/></radialGradient>`
    + `<radialGradient id="cg-red" cx=".18" cy=".82" r=".58"><stop offset="0" stop-color="#8a2a17" stop-opacity=".8"/><stop offset=".7" stop-color="#8a2a17" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="cg-blue" cx=".88" cy=".3" r=".58"><stop offset="0" stop-color="#1f4fd0" stop-opacity=".73"/><stop offset=".7" stop-color="#1f4fd0" stop-opacity="0"/></radialGradient>`
    + `<clipPath id="cg-clip"><rect width="100" height="100" rx="23"/></clipPath></defs>`;
  const tile = `<g clip-path="url(#cg-clip)"><rect width="100" height="100" fill="url(#cg-base)"/><rect width="100" height="100" fill="url(#cg-red)"/><rect width="100" height="100" fill="url(#cg-blue)"/></g>`
    + `<rect x="0.5" y="0.5" width="99" height="99" rx="22.5" fill="none" stroke="#262a38"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${attrs}>${defs}${tile}<g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${markInner(CLEM_PAPER)}</g></svg>`;
}

/** The thinking animation: one soft shape rolling a quarter turn at a time, 2.4 s a full turn. Shared CSS keyframes. */
export const TUMBLE_PERIOD = 2.4;
export function tumbleKeyframes(name = "clem-tumble") {
  return `@keyframes ${name}{0%{transform:rotate(0) scale(1);border-radius:34%}25%{transform:rotate(90deg) scale(.86);border-radius:0 100% 0 100%}50%{transform:rotate(180deg) scale(1);border-radius:50%}75%{transform:rotate(270deg) scale(.86);border-radius:100% 0 100% 0}100%{transform:rotate(360deg) scale(1);border-radius:34%}}`;
}
