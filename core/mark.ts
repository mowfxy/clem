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

/** 61 seeds, small in the middle and fuller at the rim. The same head at every size: the owner wants no simplified
 *  small versions, inside the app or on the Windows icon. */
export const SEEDS = head(61, 39, 0.3, 0.78, 1.3);
export const MARK_VIEWBOX = "-45 -45 90 90";

/** Thinking: the head stays still while a ripple runs out from the centre. Seed k's scale at time t (seconds). */
export const rippleScale = (k: number, t: number) => 1 + 0.32 * Math.sin((2 * Math.PI * t) / 1.9 - Math.sqrt(k) * 1.15);

/** The still mark as an SVG string, for pages and renderers outside React. */
export function markSvg(fill: string, attrs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" fill="${fill}"${attrs ? " " + attrs : ""}>${SEEDS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("")}</svg>`;
}
