// Mowr's mark, Peaks: one zig-zag stroke of a broad pen, drawn as parallel lines laid along the nib's angle.
// Large marks use nine lines, small ones fewer and thicker so the ribbon still reads at 16 px. Everything that draws
// the mark (the app's Logo, the boot screen, icons, favicons, email art, the browser sign-in page) uses this file.

export const PEAKS = "M20 64 L36 32 L52 66 L68 32 L80 56";
/** The mark's centre of motion in its 100-unit box. */
export const PEAKS_ORIGIN = "50px 49px";
/** The three hand-drawn poses the stroke boils between while Mowr thinks. */
export const PEAKS_BOIL = [PEAKS, "M20.6 63.4 L35.5 32.6 L52.4 65.3 L67.6 32.5 L80.5 55.4", "M19.6 64.5 L36.4 31.6 L51.6 66.6 L68.5 31.4 L79.6 56.6"];

export type PeaksTier = { offsets: [number, number][]; width: number };
const nine: [number, number][] = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => [+(k * 0.6275).toFixed(2), +(-k * 0.5275).toFixed(2)]);
/** Lines and stroke width for a mark drawn `size` pixels wide. */
export function peaksTier(size: number): PeaksTier {
  if (size <= 20) return { offsets: [[-2.2, 1.8], [0, 0], [2.2, -1.8]], width: 4 };
  if (size <= 40) return { offsets: [nine[0], nine[2], nine[4], nine[6], nine[8]], width: 2.8 };
  return { offsets: nine, width: size >= 200 ? 2 : 2.2 };
}

/** A standalone SVG of the mark in a 100-unit box, for icons, email frames and static pages. */
export function peaksSvg({ size = 100, color = "#ef5340", d = PEAKS, extra = "", attrs = "" }: { size?: number; color?: string; d?: string; extra?: string; attrs?: string } = {}) {
  const { offsets, width } = peaksTier(size);
  const lines = offsets.map(([x, y]) => `<path d="${d}"${x || y ? ` transform="translate(${x} ${y})"` : ""}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${attrs}>${extra}<g fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${lines}</g></svg>`;
}
