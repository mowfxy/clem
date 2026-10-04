import { all, attr, kid, kids, num, find, type Pkg } from "./package";

/** The theme a file's colours and fonts refer to ("accent1", "+mj-lt"), and DrawingML's colour model with its modifiers. */
export type Theme = { colors: Record<string, string>; major: string; minor: string };
export const defaultTheme: Theme = { colors: { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folHlink: "954F72" }, major: "Calibri Light", minor: "Calibri" };

export function parseTheme(pkg: Pkg, part: string | undefined): Theme {
  const doc = part ? pkg.xml(part) : undefined;
  if (!doc) return defaultTheme;
  const colors: Record<string, string> = { ...defaultTheme.colors };
  const scheme = find(doc, "clrScheme");
  for (const c of kids(scheme)) {
    const inner = c.firstElementChild;
    const v = inner?.getAttribute("val") && inner.localName === "srgbClr" ? inner.getAttribute("val") : inner?.getAttribute("lastClr");
    if (v) colors[c.localName] = v.toUpperCase();
  }
  const fonts = find(doc, "fontScheme");
  const latin = (name: string) => attr(find(find(fonts, name), "latin"), "typeface") || "";
  return { colors, major: latin("majorFont") || defaultTheme.major, minor: latin("minorFont") || defaultTheme.minor };
}

const PRESET: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", grey: "808080", orange: "FFA500", purple: "800080", cyan: "00FFFF", magenta: "FF00FF", dkGray: "A9A9A9", ltGray: "D3D3D3", darkBlue: "00008B", darkRed: "8B0000", darkGreen: "006400" };
function rgb(hex: string): [number, number, number] { return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]; }
function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function fromHsl([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
/** The theme names a slide's colour map points at: bg1 → lt1, tx1 → dk1. */
export const defaultMap: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };

/** The CSS colour of a DrawingML colour element (a:srgbClr, a:schemeClr, a:sysClr, a:prstClr, with lumMod, lumOff, tint, shade and alpha applied). */
export function color(el: Element | null | undefined, theme: Theme, map: Record<string, string> = defaultMap): string | undefined {
  if (!el) return undefined;
  let hex: string | undefined;
  const v = attr(el, "val");
  if (el.localName === "srgbClr") hex = v;
  else if (el.localName === "sysClr") hex = attr(el, "lastClr") || (v === "windowText" ? "000000" : "FFFFFF");
  else if (el.localName === "prstClr") hex = PRESET[v || ""] || "000000";
  else if (el.localName === "schemeClr") hex = v === "phClr" ? undefined : theme.colors[map[v || ""] || v || ""];
  else return undefined;
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  let alpha = 1, c = rgb(hex);
  for (const m of kids(el)) {
    const x = num(attr(m, "val"), 100000) / 100000;
    if (m.localName === "alpha") alpha = x;
    else if (m.localName === "lumMod" || m.localName === "lumOff") { const hsl = toHsl(c); hsl[2] = Math.min(1, Math.max(0, m.localName === "lumMod" ? hsl[2] * x : hsl[2] + x)); c = fromHsl(hsl); }
    else if (m.localName === "tint") c = c.map((k) => k + (255 - k) * (1 - x)) as [number, number, number];
    else if (m.localName === "shade") c = c.map((k) => k * x) as [number, number, number];
  }
  const [r, g, b] = c.map((k) => Math.round(Math.min(255, Math.max(0, k))));
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha.toFixed(3)})` : "#" + [r, g, b].map((k) => k.toString(16).padStart(2, "0")).join("");
}
/** The colour inside a fill element: a:solidFill → its colour; a:gradFill → its first stop (a close enough single colour). */
export function fillColor(parent: Element | null | undefined, theme: Theme, map?: Record<string, string>): string | undefined | null {
  if (!parent) return undefined;
  const solid = kid(parent, "solidFill");
  if (solid) return color(solid.firstElementChild, theme, map);
  if (kid(parent, "noFill")) return null;
  const grad = kid(parent, "gradFill");
  if (grad) { const stops = all(grad, "gs"); return color(stops[0]?.firstElementChild, theme, map); }
  const pattern = kid(parent, "pattFill");
  if (pattern) return color(kid(pattern, "fgClr")?.firstElementChild, theme, map);
  return undefined;
}
/** A gradient as CSS, when the fill is a linear gradient of two or more stops. */
export function gradientCss(parent: Element | null | undefined, theme: Theme, map?: Record<string, string>) {
  const grad = kid(parent, "gradFill");
  if (!grad) return undefined;
  const stops = all(grad, "gs").map((g) => `${color(g.firstElementChild, theme, map) || "#fff"} ${num(attr(g, "pos")) / 1000}%`);
  if (stops.length < 2) return undefined;
  const lin = kid(grad, "lin");
  return `linear-gradient(${lin ? num(attr(lin, "ang")) / 60000 + 90 : 180}deg, ${stops.join(", ")})`;
}
/** A theme font reference ("+mj-lt", "+mn-lt") or a typeface name as a CSS font-family, with a fallback for fonts this PC lacks. */
export function fontFamily(face: string | undefined, theme: Theme) {
  const name = face === "+mj-lt" ? theme.major : face === "+mn-lt" ? theme.minor : face;
  if (!name || name.startsWith("+")) return undefined;
  const serif = /cambria|georgia|garamond|times|constantia|palatino|book antiqua|minion|baskerville|charter/i.test(name);
  return `"${name.replace(/"/g, "")}", ${serif ? "Georgia, 'Times New Roman', serif" : "'Segoe UI', Arial, sans-serif"}`;
}
export const EMU = 9525;
