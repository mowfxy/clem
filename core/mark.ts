// Mowr's mark: a sunflower seed head, seeds set at the golden angle (chosen 2026-10-18, "Fine" seed head).
// One source for the app (src/Icons.tsx), the desktop sign-in page and the icon renderers. public/boot.js and
// scripts/build-email-art.mjs repeat the same few lines in plain JS; change them together.

export type Seed = readonly [x: number, y: number, r: number];

const GOLD = 2.39996323;
function head(count: number, radius: number, from: number, to: number, curve: number): Seed[] {
  const step = radius / Math.sqrt(count + 0.5);
  return Array.from({ length: count }, (_, k) => {
    const a = k * GOLD, r = step * Math.sqrt(k + 0.5), u = (k + 1) / count;
    const size = step * (from + (to - from) * u ** curve);
    return [+(r * Math.cos(a)).toFixed(2), +(r * Math.sin(a)).toFixed(2), +size.toFixed(2)] as const;
  });
}

/** 61 seeds, small in the middle and fuller at the rim. */
export const SEEDS = head(61, 39, 0.3, 0.78, 1.3);
/** 24 seeds for 25–40 px (sidebar, message marks), where the centre seeds of the full head would vanish. */
export const MEDIUM_SEEDS = head(24, 39.5, 0.45, 0.82, 1.1);
/** Nine larger seeds for 24 px and below, where more would turn to speckle. */
export const SMALL_SEEDS = head(9, 40, 0.62, 0.9, 1);
export const MARK_VIEWBOX = "-45 -45 90 90";
/** The seed head that reads best at a size in CSS px. */
export const seedsFor = (size: number) => (size <= 24 ? SMALL_SEEDS : size <= 40 ? MEDIUM_SEEDS : SEEDS);

/** Thinking: the head turns slowly while a ripple runs out from the centre. Seed k's scale at time t (seconds). */
export const rippleScale = (k: number, t: number) => 1 + 0.32 * Math.sin((2 * Math.PI * t) / 1.9 - Math.sqrt(k) * 1.15);
/** Degrees the head has turned after t seconds of thinking. */
export const rippleTurn = (t: number) => (t * 24) % 360;

/** The still mark as an SVG string, for pages and renderers outside React. */
export function markSvg(fill: string, opts: { size?: number; attrs?: string } = {}) {
  const seeds = seedsFor(opts.size ?? 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" fill="${fill}"${opts.attrs ? " " + opts.attrs : ""}>${seeds.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("")}</svg>`;
}
