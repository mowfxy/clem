/**
 * Kinetra SVG style contract, extracted from the Scene2D template family
 * (free-body, projectile, optics, pulley, fields) and its golden outputs.
 * See docs/toolkit/style-contract.md. The toolkit renders through
 * renderScene2D, so these values describe what that pipeline emits; the
 * checker below verifies a finished SVG against them.
 */

/** Named colours a composition may use. Every value occurs in a template. */
export const TOOLKIT_PALETTE = {
  ink: "#222",
  text: "#333",
  dimension: "#444",
  caption: "#555",
  constraint: "#666",
  axis: "#777",
  component: "#888",
  guide: "#aaa",
  componentLight: "#c8c8c8",
  grid: "#eee",
  white: "#fff",
  body: "#1f4f8b",
  bodyFill: "#cfe4ff",
  force: "#c0392b",
  normal: "#377f5c",
  friction: "#357aa6",
  frame: "#66717a",
  velocity: "#117a3a",
  acceleration: "#7a3a11",
  ray: "#ba4b37",
  rayAlt: "#2679a0",
  optic: "#237f9b",
  mechanism: "#526873",
  mechanismDark: "#50616b",
  mechanismMid: "#586d78",
  mechanismLight: "#65757d",
  steel: "#8a969c",
  rope: "#a0a0a0",
  mechanismFill: "#d6e1e6",
  surfaceFill: "#e8edef",
  greenDark: "#38775c",
  point: "#225",
} as const;

export type PaletteName = keyof typeof TOOLKIT_PALETTE;

/** Pixel stroke widths found in template output. */
export const TOOLKIT_STROKE_WIDTHS = [0.6, 0.8, 1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3] as const;
export const TOOLKIT_DASHES = ["", "4 4", "3 3"] as const;

export const TOOLKIT_FONTS = {
  body: "Arial, Helvetica, sans-serif",
  title: "Inter, system-ui, sans-serif",
} as const;

/** Text sizes: labels use 11-13 px like the templates; title and caption are fixed. */
export const TOOLKIT_TEXT = {
  labelSizes: [11, 12, 13] as const,
  defaultLabelSize: 12,
  title: { size: 14, weight: "600", color: "#222", y: 16 },
  caption: { size: 11, color: "#555", bottomOffset: 8 },
  /** renderScene2D keeps label boxes this far inside the viewport. */
  edgeInset: 2,
} as const;

/**
 * Real sub/superscripts (toolkit addition): a <tspan> with font-size =
 * round(size x scale) and a dy shift (+0.3 em sub, -0.4 em sup), followed by a
 * <tspan dy> that returns to the baseline. Template output never has tspans.
 */
export const TOOLKIT_SCRIPT = { scale: 0.75, subShiftEm: 0.3, supShiftEm: -0.4, maxShiftEm: 0.71 } as const;

/** Arrow marker emitted by renderScene2D for every vector. */
export const TOOLKIT_MARKER = {
  idPattern: /^arr-[0-9a-f]+-\d+$/,
  size: 7, refX: 6, refY: 3.5,
  path: "M0,0 L7,3.5 L0,7 Z",
  lineWidth: 1.6,
} as const;

const hexAll = new Set<string>(Object.values(TOOLKIT_PALETTE).flatMap(c => [c, expandHex(c)]));
hexAll.add("#ffffff");
hexAll.add("none");

function expandHex(c: string): string {
  return /^#[0-9a-f]{3}$/i.test(c) ? "#" + [...c.slice(1)].map(ch => ch + ch).join("") : c.toLowerCase();
}

/** Resolve a palette name or palette hex value; undefined if not allowed. */
export function resolvePaletteColor(c: string): string | undefined {
  if (c in TOOLKIT_PALETTE) return TOOLKIT_PALETTE[c as PaletteName];
  const lower = c.toLowerCase();
  for (const v of Object.values(TOOLKIT_PALETTE)) if (v === lower || expandHex(v) === expandHex(lower)) return v;
  return undefined;
}

export interface StyleViolation { rule: string; detail: string }

function attrs(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]));
}

/**
 * Check a finished SVG against the style contract. Returns every violation;
 * an empty list means the SVG conforms. `expect` pins title/caption text.
 */
export function checkToolkitStyle(svg: string, expect: { title?: string; caption?: string } = {}): StyleViolation[] {
  const v: StyleViolation[] = [];
  const add = (rule: string, detail: string) => v.push({ rule, detail });
  const head = svg.match(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 ([\d.]+) ([\d.]+)" width="([\d.]+)" height="([\d.]+)">\n/);
  if (!head) { add("root", "XML header and root <svg> must match renderSvg exactly"); return v; }
  const [w, h] = [Number(head[1]), Number(head[2])];
  if (head[3] !== head[1] || head[4] !== head[2]) add("root", "width/height must equal the viewBox size");
  const rest = svg.slice(head[0].length);
  if (!rest.startsWith(`\n<rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>\n<g>\n`)) add("background", "white background rect followed by the scene <g> expected");
  if (!svg.endsWith("</g>\n</svg>")) add("root", "document must end with </g></svg>");
  if (/NaN|Infinity/.test(svg)) add("finite", "non-finite number in SVG");
  for (const m of svg.matchAll(/ (fill|stroke)="([^"]*)"/g)) {
    const c = m[2]!;
    if (c.startsWith("url(")) continue;
    if (!hexAll.has(c) && !hexAll.has(expandHex(c))) add("palette", `${m[1]} colour ${c} is not in the palette`);
  }
  for (const m of svg.matchAll(/ stroke-width="([^"]*)"/g)) {
    const n = Number(m[1]);
    if (n !== 0 && !(TOOLKIT_STROKE_WIDTHS as readonly number[]).includes(n)) add("stroke-width", `stroke-width ${m[1]} not in contract`);
  }
  for (const m of svg.matchAll(/ stroke-dasharray="([^"]*)"/g)) if (!(TOOLKIT_DASHES as readonly string[]).includes(m[1]!)) add("dash", `dash ${m[1]} not in contract`);
  // Text content may carry sub/superscript tspans (toolkit addition, see the contract's "Scripts").
  const texts = [...svg.matchAll(/<text ([^>]*)>((?:[^<]|<tspan [^>]*>[^<]*<\/tspan>|<tspan>[^<]*<\/tspan>)*)<\/text>/g)].map(m => ({ a: attrs(m[1]!), t: m[2]!.replace(/<\/?tspan[^>]*>/g, "").trim(), spans: [...m[2]!.matchAll(/<tspan([^>]*)>/g)].map(x => attrs(x[1]!)) }));
  if (texts.length !== (svg.match(/<text /g) ?? []).length) add("text", "every <text> must hold plain text or script tspans only");
  for (const { a, t, spans } of texts) {
    const size = Number(a["font-size"]);
    if (spans.length && a["font-family"] === TOOLKIT_FONTS.title) add("script", `title "${t}" may not contain tspans`);
    for (const sp of spans) {
      const keys = Object.keys(sp);
      if (keys.some(k => k !== "font-size" && k !== "dy")) add("script", `tspan in "${t}" has attributes other than font-size and dy`);
      if (sp["font-size"] !== undefined && Number(sp["font-size"]) !== Math.round(size * TOOLKIT_SCRIPT.scale)) add("script", `script font-size ${sp["font-size"]} in "${t}" must be round(${size} x ${TOOLKIT_SCRIPT.scale})`);
      if (sp.dy !== undefined && !(Math.abs(Number(sp.dy)) <= size * TOOLKIT_SCRIPT.maxShiftEm)) add("script", `script shift ${sp.dy} in "${t}" exceeds ${TOOLKIT_SCRIPT.maxShiftEm} em`);
    }
    const isTitle = a["font-family"] === TOOLKIT_FONTS.title;
    if (isTitle) {
      if (size !== TOOLKIT_TEXT.title.size || a["font-weight"] !== TOOLKIT_TEXT.title.weight || Number(a.y) !== TOOLKIT_TEXT.title.y || Number(a.x) !== w / 2 || a["text-anchor"] !== "middle") add("title", `title "${t}" must be ${TOOLKIT_TEXT.title.size}px/600, centred at y=16`);
      if (expect.title !== undefined && t !== escapeText(expect.title)) add("title", `title text "${t}" != "${expect.title}"`);
      continue;
    }
    if (a["font-family"] !== TOOLKIT_FONTS.body) add("font", `font-family ${a["font-family"]} on "${t}"`);
    if (a["font-weight"] !== "normal") add("font", `font-weight ${a["font-weight"]} on "${t}"`);
    if (![...TOOLKIT_TEXT.labelSizes, TOOLKIT_TEXT.caption.size].includes(size as 11)) add("font-size", `font-size ${size} on "${t}"`);
  }
  if (expect.title !== undefined && !texts.some(x => x.a["font-family"] === TOOLKIT_FONTS.title)) add("title", "title missing");
  if (expect.caption !== undefined) {
    const cap = texts.find(x => Number(x.a.y) === h - TOOLKIT_TEXT.caption.bottomOffset && x.a.fill === TOOLKIT_TEXT.caption.color);
    if (!cap) add("caption", "caption missing or misplaced (11px #555, centred, height-8)");
    else if (cap.t !== escapeText(expect.caption) || Number(cap.a["font-size"]) !== TOOLKIT_TEXT.caption.size || cap.a["text-anchor"] !== "middle" || Number(cap.a.x) !== w / 2) add("caption", `caption "${cap.t}" not in contract form`);
  }
  const markerIds = new Set<string>();
  for (const m of svg.matchAll(/<marker ([^>]*)>([\s\S]*?)<\/marker>/g)) {
    const a = attrs(m[1]!);
    markerIds.add(a.id!);
    if (!TOOLKIT_MARKER.idPattern.test(a.id ?? "")) add("marker", `marker id ${a.id} does not follow arr-<hex colour>-<n>`);
    if (Number(a.markerWidth) !== TOOLKIT_MARKER.size || Number(a.markerHeight) !== TOOLKIT_MARKER.size || Number(a.refX) !== TOOLKIT_MARKER.refX || Number(a.refY) !== TOOLKIT_MARKER.refY || a.orient !== "auto-start-reverse" || a.markerUnits !== "userSpaceOnUse") add("marker", `marker ${a.id} geometry differs`);
    if (!m[2]!.includes(`d="${TOOLKIT_MARKER.path}"`)) add("marker", `marker ${a.id} path differs`);
  }
  for (const m of svg.matchAll(/marker-end="url\(#([^)]*)\)"/g)) if (!markerIds.has(m[1]!)) add("marker", `unresolved marker reference ${m[1]}`);
  return v;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
