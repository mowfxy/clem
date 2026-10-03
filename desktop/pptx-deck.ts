import PptxGenJS from "pptxgenjs";
import { kinetraCall } from "./kinetra-runtime.ts";
import { rasterizer } from "./rasterize.ts";
import { latexMathml, plainMath } from "./docx-math.ts";
import { brandFont } from "./pdf-document.ts";

/**
 * PowerPoint decks Mowr designs itself. A deck is a list of slides, each with a layout (title, bullets, chart,
 * stats, timeline, figure…), drawn in one of ten design systems chosen to suit the talk (editorial, boardroom,
 * academic, studio…), with the colours and fonts the person asked for on top. Everything stays editable in
 * PowerPoint: text boxes, native charts and tables, shapes and speaker notes; only Kinetra figures and typeset
 * equations are pictures. Text is sized to fit its box here, since PowerPoint does not shrink text on open.
 */
export type Theme = {
  bg: string; surface: string; text: string; muted: string; accent: string; accent2: string; accent3: string;
  head: string; body: string;
  /** How the title and section slides are composed. */
  cover: "left" | "band" | "full" | "center" | "panel";
  /** The decoration that recurs on content slides, so decks in different themes do not look alike. */
  decor: "rule" | "bar" | "tracker" | "topband" | "block" | "dots" | "none" | "corner" | "frame" | "grid";
  rounded: boolean;
  dark: boolean;
};
export const themes: Record<string, Theme & { use: string }> = {
  editorial: { use: "essays, humanities, culture, journalism, book and history talks", bg: "F6F3EC", surface: "FFFFFF", text: "1C1B19", muted: "6E6A62", accent: "B23A2E", accent2: "2B4C6F", accent3: "C9A227", head: "Georgia", body: "Segoe UI", cover: "left", decor: "rule", rounded: false, dark: false },
  midnight: { use: "technology, software, AI, product launches, engineering demos", bg: "0B1220", surface: "16203A", text: "F3F6FB", muted: "9AA7BD", accent: "4CC9F0", accent2: "F72585", accent3: "FFD166", head: "Segoe UI Semibold", body: "Segoe UI", cover: "left", decor: "bar", rounded: true, dark: true },
  boardroom: { use: "business reviews, strategy, consulting, finance, board and investor updates", bg: "FFFFFF", surface: "F2F4F7", text: "1A2433", muted: "5B6676", accent: "0B5CAD", accent2: "13A89E", accent3: "F2A900", head: "Arial", body: "Arial", cover: "panel", decor: "tracker", rounded: false, dark: false },
  academic: { use: "lectures, seminars, thesis defences, conference talks, research results", bg: "FFFFFF", surface: "F3F5F8", text: "1F2328", muted: "5F6670", accent: "7A1F2B", accent2: "1F4E79", accent3: "C08A2E", head: "Cambria", body: "Calibri", cover: "band", decor: "topband", rounded: false, dark: false },
  studio: { use: "creative pitches, marketing, design, branding, startups, bold launches", bg: "FFF6EC", surface: "FFFFFF", text: "141414", muted: "5A5A5A", accent: "FF4F2E", accent2: "2747FF", accent3: "FFC233", head: "Arial Black", body: "Arial", cover: "full", decor: "block", rounded: false, dark: false },
  classroom: { use: "school lessons, younger students, workshops, training, onboarding", bg: "FFFCF5", surface: "FFFFFF", text: "2B2A33", muted: "6B6A75", accent: "3A86FF", accent2: "FF7F50", accent3: "2EC4B6", head: "Trebuchet MS", body: "Trebuchet MS", cover: "center", decor: "dots", rounded: true, dark: false },
  minimal: { use: "keynotes, design reviews, portfolios, talks that should feel calm and premium", bg: "FFFFFF", surface: "F5F5F5", text: "111111", muted: "8A8A8A", accent: "E63946", accent2: "111111", accent3: "8A8A8A", head: "Segoe UI Light", body: "Segoe UI", cover: "left", decor: "none", rounded: false, dark: false },
  earth: { use: "sustainability, environment, health, wellbeing, food, community and NGO work", bg: "F3EFE6", surface: "FFFFFF", text: "2E3A2F", muted: "6D7468", accent: "3F6E3A", accent2: "C08B3E", accent3: "8A5A44", head: "Constantia", body: "Corbel", cover: "left", decor: "corner", rounded: true, dark: false },
  noir: { use: "luxury, fashion, architecture, events, awards, premium brands", bg: "0F0F0F", surface: "1B1B1B", text: "F4EFE6", muted: "A8A196", accent: "C9A45C", accent2: "7F8C8D", accent3: "E5D3B3", head: "Garamond", body: "Segoe UI Light", cover: "center", decor: "frame", rounded: false, dark: true },
  lab: { use: "science, engineering, medicine, data analysis, lab reports and technical results", bg: "FFFFFF", surface: "EEF3F7", text: "0F2A37", muted: "5D7380", accent: "0077B6", accent2: "E76F51", accent3: "2A9D8F", head: "Bahnschrift", body: "Segoe UI", cover: "left", decor: "grid", rounded: true, dark: false },
};
export const layouts = ["title", "section", "agenda", "bullets", "text", "two-column", "comparison", "cards", "stats", "chart", "table", "figure", "equation", "timeline", "process", "quote", "closing"] as const;
type Layout = (typeof layouts)[number];
type Bullet = string | { text: string; sub?: string[] };
type Slide = {
  layout: Layout; title?: string; subtitle?: string; kicker?: string; notes?: string;
  bullets?: Bullet[]; text?: string; number?: string | number;
  left?: { heading?: string; bullets?: Bullet[]; text?: string }; right?: { heading?: string; bullets?: Bullet[]; text?: string };
  columns?: { heading: string; points: string[] }[];
  items?: (string | { title: string; text?: string })[];
  stats?: { value: string; label: string; detail?: string }[];
  chart?: { type: string; labels: string[]; series: { name: string; values: number[] }[]; unit?: string; stacked?: boolean };
  table?: { header: string[]; rows: (string | number)[][] };
  figure?: { module: string; fn: string; args: unknown[] }; caption?: string;
  math?: string; steps?: { label?: string; title?: string; text?: string }[];
  quote?: string; by?: string; takeaway?: string; source?: string;
};
export type DeckSpec = { title: string; subtitle?: string; author?: string; date?: string; theme?: Partial<Theme> & { preset?: string; headingFont?: string; bodyFont?: string; background?: string }; aspect?: "16:9" | "4:3"; footer?: string | false; slides: Slide[] };

const isHex = (v: unknown) => typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v);
const fontOk = (v: unknown) => typeof v === "string" && /^[\p{L}\p{N} -]{2,48}$/u.test(v) && !brandFont.test(v);
/** The deck's theme: a preset with the person's colours and fonts on top. */
export function deckTheme(spec: DeckSpec): Theme {
  const t = spec.theme || {};
  const preset = themes[String(t.preset || "").toLowerCase()] || themes.editorial;
  const pick = (key: keyof Theme, value: unknown) => (isHex(value) ? String(value).replace("#", "").toUpperCase() : (preset[key] as string));
  const bg = pick("bg", t.background ?? t.bg);
  return {
    ...preset,
    bg, surface: pick("surface", t.surface), text: pick("text", t.text), muted: pick("muted", t.muted),
    accent: pick("accent", t.accent), accent2: pick("accent2", t.accent2), accent3: pick("accent3", t.accent3),
    head: fontOk(t.headingFont ?? t.head) ? String(t.headingFont ?? t.head) : preset.head,
    body: fontOk(t.bodyFont ?? t.body) ? String(t.bodyFont ?? t.body) : preset.body,
    cover: (["left", "band", "full", "center", "panel"] as const).includes(t.cover as any) ? (t.cover as Theme["cover"]) : preset.cover,
    decor: (["rule", "bar", "tracker", "topband", "block", "dots", "none", "corner", "frame", "grid"] as const).includes(t.decor as any) ? (t.decor as Theme["decor"]) : preset.decor,
    rounded: typeof t.rounded === "boolean" ? t.rounded : preset.rounded,
    dark: luminance(bg) < 0.4,
  };
}
const luminance = (hex: string) => { const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** Text that reads on a fill: white on dark colours, near-black on light ones. */
const on = (fill: string) => (luminance(fill) < 0.55 ? "FFFFFF" : "141414");

/** Every problem in a deck, reported together so the model fixes them in one pass. */
export function deckProblems(spec: any): string[] {
  const problems: string[] = [];
  if (!spec || typeof spec.title !== "string" || !spec.title.trim()) problems.push('A deck needs a "title".');
  if (!Array.isArray(spec?.slides) || !spec.slides.length) return [...problems, 'A deck needs "slides": [{"layout":…}, …].'];
  if (spec.slides.length > 150) problems.push("A deck holds at most 150 slides.");
  if (spec.theme?.preset !== undefined && !themes[String(spec.theme.preset).toLowerCase()]) problems.push(`Unknown theme preset "${spec.theme.preset}". Use one of: ${Object.keys(themes).join(", ")}.`);
  spec.slides.forEach((s: any, i: number) => {
    const at = `Slide ${i + 1}`;
    if (!s || !layouts.includes(s.layout)) { problems.push(`${at}: "layout" must be one of ${layouts.join(", ")}.`); return; }
    const need = (ok: boolean, what: string) => { if (!ok) problems.push(`${at} (${s.layout}) needs ${what}.`); };
    const list = (v: any, min = 1) => Array.isArray(v) && v.length >= min;
    if (!["title", "closing", "quote", "figure", "equation", "chart", "table"].includes(s.layout)) need(typeof s.title === "string" && !!s.title.trim(), '"title"');
    if (s.layout === "bullets") need(list(s.bullets), '"bullets"');
    if (s.layout === "text") need(typeof s.text === "string", '"text"');
    if (s.layout === "agenda") need(list(s.items), '"items"');
    if (s.layout === "two-column") need(!!s.left && !!s.right, '"left" and "right" ({heading, bullets or text})');
    if (s.layout === "comparison") need(list(s.columns, 2) && s.columns.length <= 4 && s.columns.every((c: any) => c && typeof c.heading === "string" && Array.isArray(c.points)), '"columns": 2–4 of {heading, points:[…]}');
    if (s.layout === "cards") need(list(s.items, 2) && s.items.length <= 8, '"items": 2–8 of {title, text}');
    if (s.layout === "stats") need(list(s.stats) && s.stats.length <= 4 && s.stats.every((x: any) => x && x.value !== undefined && typeof x.label === "string"), '"stats": 1–4 of {value, label}');
    if (s.layout === "chart") {
      const c = s.chart;
      need(!!c && ["bar", "column", "line", "area", "pie", "doughnut", "scatter", "radar"].includes(c.type), '"chart" with "type" bar, column, line, area, pie, doughnut, scatter or radar');
      if (c && (!Array.isArray(c.labels) || !Array.isArray(c.series) || !c.series.length || c.series.some((x: any) => !Array.isArray(x?.values) || x.values.length !== c.labels.length || x.values.some((v: any) => typeof v !== "number" || !Number.isFinite(v)))))
        problems.push(`${at} chart: "labels" and every series' "values" (numbers) must have the same length.`);
    }
    if (s.layout === "table") need(!!s.table && Array.isArray(s.table.header) && Array.isArray(s.table.rows) && s.table.rows.length <= 18, '"table": {header:[…], rows:[[…]]} with at most 18 rows (split longer tables)');
    if (s.layout === "figure") need(!!s.figure && typeof s.figure.module === "string" && typeof s.figure.fn === "string" && Array.isArray(s.figure.args), '"figure": {module, fn, args} (a Kinetra figure)');
    if (s.layout === "equation") need(typeof s.math === "string" && !!s.math.trim(), '"math" (LaTeX)');
    if (s.layout === "timeline" || s.layout === "process") need(list(s.steps, 2) && s.steps.length <= (s.layout === "timeline" ? 7 : 6), `"steps": 2–${s.layout === "timeline" ? 7 : 6} of {label, title, text}`);
    if (s.layout === "quote") need(typeof s.quote === "string", '"quote"');
  });
  if (spec.theme !== undefined && (typeof spec.theme !== "object" || Array.isArray(spec.theme))) problems.push('"theme" must be an object.');
  return problems;
}

/** Notes on the deck's design, returned to the model with the result so it can improve the deck if it chooses. */
export function deckReview(spec: DeckSpec): string[] {
  const notes: string[] = [];
  let run = 0;
  spec.slides.forEach((s, i) => {
    run = s.layout === "bullets" || s.layout === "text" ? run + 1 : 0;
    if (run === 4) notes.push(`Slides ${i - 2}–${i + 1} are all text: where the content allows, use stats, chart, cards, process, timeline, comparison or a figure.`);
    const long = (s.bullets || []).filter((b) => (typeof b === "string" ? b : b.text).split(/\s+/).length > 22).length;
    if (long) notes.push(`Slide ${i + 1} has ${long} bullet${long > 1 ? "s" : ""} over 22 words: shorten them and move detail to the notes.`);
  });
  if (spec.slides.length >= 6 && !spec.slides.some((s) => s.notes)) notes.push("No slide has speaker notes; add them when the deck will be presented.");
  return notes;
}

/** Inline **bold** and $maths$ as text runs. */
function runs(text: string, base: Record<string, unknown> = {}) {
  return String(text).split(/(\*\*[^*]+\*\*|\$[^$]+\$)/g).filter(Boolean).map((part) =>
    part.startsWith("**") ? { text: part.slice(2, -2), options: { ...base, bold: true } } : part.startsWith("$") ? { text: plainMath(part.slice(1, -1)), options: { ...base, italic: true } } : { text: part, options: base });
}
const strip = (text: string) => String(text).replace(/\*\*/g, "").replace(/\$([^$]+)\$/g, (_, m) => plainMath(m));

/** The largest font size (points) at which `paragraphs` fit a w×h inch box. Rough widths, erring on the safe side. */
export function fitSize(paragraphs: string[], w: number, h: number, max: number, min: number, { line = 1.2, width = 0.52, gap = 0.4 } = {}) {
  for (let size = max; size > min; size -= 1) {
    const perLine = Math.max(1, Math.floor((w * 72) / (size * width)));
    const lines = paragraphs.reduce((n, p) => n + Math.max(1, ...String(p).split("\n").map((l) => Math.ceil((l.length || 1) / perLine))), 0);
    const height = (lines * size * line + (paragraphs.length - 1) * size * gap) / 72;
    if (height <= h) return size;
  }
  return min;
}
/** One size for several boxes of the same shape (cards, steps): the largest at which every one of them fits. */
const fitEach = (texts: string[], w: number, h: number, max: number, min: number, options?: Parameters<typeof fitSize>[5]) =>
  Math.min(max, ...texts.filter(Boolean).map((t) => fitSize([t], w, h, max, min, options)));
/** A short display value (a statistic) on one line. */
const oneLine = (texts: string[], w: number, max: number, min: number, width = 0.66) => Math.max(min, Math.min(max, ...texts.map((t) => Math.floor((w * 72) / (Math.max(1, t.length) * width)))));
/** How tall `paragraphs` set at `size` points are in a box `w` inches wide. */
const textHeight = (paragraphs: string[], w: number, size: number, { line = 1.2, width = 0.52, gap = 0.4 } = {}) => {
  const perLine = Math.max(1, Math.floor((w * 72) / (size * width)));
  const lines = paragraphs.reduce((n, p) => n + Math.max(1, Math.ceil((p.length || 1) / perLine)), 0);
  return (lines * size * line + (paragraphs.length - 1) * size * gap) / 72;
};

export async function powerpointDeck(input: DeckSpec) {
  const problems = deckProblems(input);
  // Figures are drawn first, so every problem (structure and figures) is reported at once.
  const figures = new Map<number, string>();
  await Promise.all(input.slides?.map(async (s, i) => {
    if (s?.layout !== "figure" || !s.figure) return;
    try {
      const svg = await kinetraCall(s.figure);
      if (typeof svg !== "string" || !svg.includes("<svg")) throw Error(`${s.figure.module}.${s.figure.fn} returned data, not a drawing`);
      if (/<script|<foreignObject|\bon\w+\s*=/i.test(svg)) throw Error("the figure contained unsupported content");
      figures.set(i, svg);
    } catch (error) {
      problems.push(`Slide ${i + 1} figure failed: ${(error as Error).message}.`);
    }
  }) || []);
  if (problems.length) throw Error(problems.join(" ") + " No deck was created. Fix these and send the pptx action again.");
  const spec = { ...input, slides: splitDense(input.slides) };
  const theme = deckTheme(spec);
  const raster = await rasterizer();
  try {
    const bytes = await draw(spec, theme, figures, raster);
    return { bytes, slides: spec.slides.length, review: deckReview(spec) };
  } finally {
    raster.close();
  }
}

/** A bullet slide with more than seven points continues on a second slide rather than shrinking to unreadable text. */
function splitDense(slides: Slide[]) {
  return slides.flatMap((s) => {
    if (s.layout !== "bullets" || !s.bullets || s.bullets.length <= 7) return [s];
    const parts: Slide[] = [];
    for (let i = 0; i < s.bullets.length; i += 6) parts.push({ ...s, title: i ? `${s.title} (continued)` : s.title, bullets: s.bullets.slice(i, i + 6), notes: i ? undefined : s.notes });
    return parts;
  });
}

async function draw(spec: DeckSpec, t: Theme, figures: Map<number, string>, raster: Awaited<ReturnType<typeof rasterizer>>) {
  const pptx = new PptxGenJS();
  const wide = spec.aspect !== "4:3";
  pptx.layout = wide ? "LAYOUT_WIDE" : "LAYOUT_4x3";
  const W = wide ? 13.333 : 10, H = 7.5;
  pptx.author = spec.author || "Mowr";
  pptx.title = spec.title;
  pptx.company = "Mowr";
  const M = W > 11 ? 0.7 : 0.55;
  const shape = (name: string) => (pptx.ShapeType as any)[name] ?? name;
  const card = t.rounded ? shape("roundRect") : shape("rect");
  const chartColors = [t.accent, t.accent2, t.accent3, t.muted, mix(t.accent, t.bg, 0.45), mix(t.accent2, t.bg, 0.45)];
  const total = spec.slides.length;
  const footer = spec.footer === false ? "" : typeof spec.footer === "string" ? spec.footer : t.decor === "tracker" || t.decor === "topband" ? spec.title : "";
  let section = "";

  const text = (slide: any, value: any, o: Record<string, unknown>) => slide.addText(value, { fontFace: t.body, color: t.text, margin: 0, valign: "top", ...o });
  const fill = (color: string, transparency = 0) => ({ color, transparency });
  const decorate = (slide: any, kind: "content" | "cover") => {
    slide.background = { color: t.bg };
    if (kind === "cover") return;
    switch (t.decor) {
      case "topband": slide.addShape(shape("rect"), { x: 0, y: 0, w: W, h: 0.14, fill: fill(t.accent), line: { color: t.accent } }); break;
      case "block": slide.addShape(shape("rect"), { x: 0, y: 0, w: 0.28, h: H, fill: fill(t.accent), line: { color: t.accent } }); break;
      case "dots": [t.accent, t.accent2, t.accent3].forEach((c, i) => slide.addShape(shape("ellipse"), { x: W - M - 0.9 + i * 0.32, y: 0.42, w: 0.2, h: 0.2, fill: fill(c), line: { color: c } })); break;
      case "corner": slide.addShape(shape("ellipse"), { x: W - 1.6, y: H - 1.4, w: 2.6, h: 2.6, fill: fill(t.accent2, 78), line: { color: t.accent2, transparency: 100 } }); break;
      case "frame": slide.addShape(shape("rect"), { x: 0.28, y: 0.28, w: W - 0.56, h: H - 0.56, fill: { color: t.bg, transparency: 100 }, line: { color: t.accent, width: 0.75 } }); break;
      case "grid": for (let x = 0; x < W; x += 0.5) slide.addShape(shape("line"), { x, y: 0, w: 0, h: 0.32, line: { color: t.surface, width: 0.75 } }); break;
    }
    if (t.decor === "tracker" && section) text(slide, section.toUpperCase(), { x: M, y: 0.28, w: W - 2 * M, h: 0.25, fontSize: 10, color: t.accent, bold: true, charSpacing: 1.5 });
    if (footer) text(slide, footer, { x: M, y: H - 0.42, w: W * 0.6, h: 0.25, fontSize: 9, color: t.muted });
  };
  const number = (slide: any, n: number) => text(slide, t.decor === "topband" ? `${n} / ${total}` : String(n).padStart(2, "0"), { x: W - M - 1.2, y: H - 0.45, w: 1.2, h: 0.28, fontSize: 10, color: t.muted, align: "right" });
  /** The slide title and its accent, in the theme's manner. Returns where the content area starts. */
  const heading = (slide: any, title: string, kicker?: string) => {
    let y = t.decor === "tracker" ? 0.6 : 0.5;
    const x = t.decor === "block" ? M + 0.15 : M;
    if (kicker) { text(slide, kicker.toUpperCase(), { x, y, w: W - 2 * M, h: 0.28, fontSize: 11, color: t.accent, bold: true, charSpacing: 2 }); y += 0.34; }
    if (t.decor === "rule") slide.addShape(shape("line"), { x, y: y - 0.05, w: 1.1, h: 0, line: { color: t.accent, width: 2 } });
    if (t.decor === "bar") slide.addShape(shape("rect"), { x: x - 0.25, y: y + 0.08, w: 0.07, h: 0.62, fill: fill(t.accent), line: { color: t.accent } });
    if (t.decor === "grid") slide.addShape(shape("rect"), { x, y: y + 0.2, w: 0.16, h: 0.16, fill: fill(t.accent), line: { color: t.accent } });
    const tx = t.decor === "grid" ? x + 0.32 : x, w = W - M - tx - (t.decor === "dots" ? 1.1 : 0);
    const size = fitSize([strip(title)], w, 1.05, t.head === "Arial Black" ? 30 : 32, 18, { width: t.head === "Arial Black" ? 0.62 : 0.5, line: 1.1 });
    text(slide, strip(title), { x: tx, y, w, h: 1.05, fontFace: t.head, fontSize: size, color: t.text, bold: !/light|black|garamond|georgia|cambria|constantia/i.test(t.head), valign: "middle", fit: "shrink" });
    if (t.decor === "tracker") slide.addShape(shape("line"), { x: M, y: y + 1.12, w: W - 2 * M, h: 0, line: { color: "D5DAE1", width: 0.75 } });
    return y + 1.3;
  };
  const bulletList = (slide: any, items: Bullet[], box: { x: number; y: number; w: number; h: number }, max = 28) => {
    const flat = items.flatMap((b) => (typeof b === "string" ? [b] : [b.text, ...(b.sub || [])]));
    const size = fitSize(flat.map(strip), box.w - 0.35, box.h, max, 13, { line: 1.25, gap: 0.6 });
    const paragraphs = items.flatMap((b) => {
      const main = typeof b === "string" ? b : b.text;
      const sub = typeof b === "string" ? [] : b.sub || [];
      return [
        ...runs(main).map((r, i, all) => ({ text: r.text, options: { ...r.options, ...(i === 0 ? { bullet: { code: t.rounded ? "25CF" : "25A0", indent: size * 1.1 }, paraSpaceBefore: size * 0.45 } : {}), ...(i === all.length - 1 ? { breakLine: true } : {}) } })),
        ...sub.flatMap((s) => runs(s, { fontSize: size - 3, color: t.muted }).map((r, i, all) => ({ text: r.text, options: { ...r.options, ...(i === 0 ? { bullet: { code: "2013", indent: size }, indentLevel: 1, paraSpaceBefore: size * 0.2 } : {}), ...(i === all.length - 1 ? { breakLine: true } : {}) } }))),
      ];
    });
    text(slide, paragraphs, { ...box, fontSize: size, lineSpacingMultiple: 1.1, color: t.text });
  };
  const panel = (slide: any, box: { x: number; y: number; w: number; h: number }, color = t.surface, edge?: string) => {
    slide.addShape(card, { ...box, fill: fill(color), line: { color: edge || color, width: edge ? 1 : 0 }, ...(t.rounded ? { rectRadius: 0.12 } : {}) });
  };
  const notes = (slide: any, s: Slide) => { if (s.notes) slide.addNotes(strip(s.notes)); };

  const cover = (slide: any, title: string, subtitle?: string, kicker?: string, meta?: string, big?: string) => {
    decorate(slide, "cover");
    const titleSize = (w: number, h: number, max: number) => fitSize([title], w, h, max, 26, { width: /black/i.test(t.head) ? 0.62 : 0.52, line: 1.05 });
    const head = { fontFace: t.head, bold: !/light|black|garamond|georgia|cambria|constantia/i.test(t.head) };
    if (t.cover === "full") {
      slide.background = { color: t.accent };
      slide.addShape(shape("rect"), { x: W * 0.7, y: 0, w: W * 0.3, h: H, fill: fill(t.accent2), line: { color: t.accent2 } });
      slide.addShape(shape("ellipse"), { x: W * 0.7 - 0.9, y: H - 2.4, w: 1.8, h: 1.8, fill: fill(t.accent3), line: { color: t.accent3 } });
      if (big) text(slide, big, { x: M, y: 0.6, w: 3, h: 1.4, fontFace: t.head, fontSize: 72, color: on(t.accent), bold: true });
      if (kicker) text(slide, kicker.toUpperCase(), { x: M, y: big ? 2.1 : 1.0, w: W * 0.6, h: 0.35, fontSize: 13, color: on(t.accent), bold: true, charSpacing: 2 });
      text(slide, title, { x: M, y: 2.5, w: W * 0.62, h: 2.6, ...head, fontSize: titleSize(W * 0.62, 2.6, 54), color: on(t.accent), valign: "bottom" });
      if (subtitle) text(slide, subtitle, { x: M, y: 5.25, w: W * 0.6, h: 0.9, fontSize: 18, color: on(t.accent) });
      if (meta) text(slide, meta, { x: M, y: H - 0.8, w: W * 0.6, h: 0.3, fontSize: 11, color: on(t.accent) });
      return;
    }
    if (t.cover === "band") {
      slide.addShape(shape("rect"), { x: 0, y: 0, w: W, h: H * 0.56, fill: fill(t.accent), line: { color: t.accent } });
      if (big) text(slide, big, { x: M, y: 0.45, w: 3, h: 1.1, fontFace: t.head, fontSize: 60, color: on(t.accent), bold: true, valign: "top" });
      if (kicker) text(slide, kicker.toUpperCase(), { x: M, y: big ? 1.6 : 0.7, w: W - 2 * M, h: 0.35, fontSize: 13, color: on(t.accent), bold: true, charSpacing: 2 });
      text(slide, title, { x: M, y: 1.2, w: W - 2 * M, h: H * 0.56 - 1.5, ...head, fontSize: titleSize(W - 2 * M, H * 0.56 - 1.5, 44), color: on(t.accent), valign: "bottom" });
      if (subtitle) text(slide, subtitle, { x: M, y: H * 0.56 + 0.4, w: W - 2 * M, h: 1.0, fontSize: 20, color: t.text });
      if (meta) text(slide, meta, { x: M, y: H - 1.0, w: W - 2 * M, h: 0.35, fontSize: 12, color: t.muted });
      return;
    }
    if (t.cover === "panel") {
      slide.addShape(shape("rect"), { x: 0, y: 0, w: W * 0.36, h: H, fill: fill(t.accent), line: { color: t.accent } });
      slide.addShape(shape("rect"), { x: W * 0.36, y: H - 0.22, w: W * 0.64, h: 0.22, fill: fill(t.accent2), line: { color: t.accent2 } });
      if (big) text(slide, big, { x: M * 0.8, y: 0.8, w: W * 0.36 - M, h: 1.6, fontFace: t.head, fontSize: 80, color: on(t.accent), bold: true });
      if (kicker) text(slide, kicker.toUpperCase(), { x: W * 0.36 + M, y: 1.4, w: W * 0.64 - 2 * M, h: 0.35, fontSize: 12, color: t.accent, bold: true, charSpacing: 2 });
      text(slide, title, { x: W * 0.36 + M, y: 1.9, w: W * 0.64 - 2 * M, h: 2.7, ...head, fontSize: titleSize(W * 0.64 - 2 * M, 2.7, 40), color: t.text, valign: "bottom" });
      if (subtitle) text(slide, subtitle, { x: W * 0.36 + M, y: 4.8, w: W * 0.64 - 2 * M, h: 1.0, fontSize: 18, color: t.muted });
      if (meta) text(slide, meta, { x: W * 0.36 + M, y: H - 1.0, w: W * 0.64 - 2 * M, h: 0.3, fontSize: 11, color: t.muted });
      return;
    }
    if (t.cover === "center") {
      if (t.decor === "frame") {
        slide.addShape(shape("rect"), { x: 0.4, y: 0.4, w: W - 0.8, h: H - 0.8, fill: { color: t.bg, transparency: 100 }, line: { color: t.accent, width: 1 } });
        slide.addShape(shape("line"), { x: W / 2 - 0.6, y: 4.62, w: 1.2, h: 0, line: { color: t.accent, width: 1.25 } });
      } else {
        panel(slide, { x: M + 0.6, y: 1.1, w: W - 2 * M - 1.2, h: H - 2.2 }, t.surface);
        [t.accent, t.accent2, t.accent3].forEach((c, i) => slide.addShape(shape("ellipse"), { x: W / 2 - 0.55 + i * 0.4, y: 1.45, w: 0.26, h: 0.26, fill: fill(c), line: { color: c } }));
      }
      const label = [big, kicker].filter(Boolean).join("  ·  ");
      if (label) text(slide, label.toUpperCase(), { x: M, y: 1.95, w: W - 2 * M, h: 0.4, fontSize: big && !kicker ? 20 : 13, color: t.accent, bold: true, charSpacing: 3, align: "center" });
      text(slide, title, { x: M + 1, y: 2.35, w: W - 2 * M - 2, h: 2.15, ...head, fontSize: titleSize(W - 2 * M - 2, 2.15, 46), color: t.text, align: "center", valign: "middle" });
      if (subtitle) text(slide, subtitle, { x: M + 1, y: 4.8, w: W - 2 * M - 2, h: 0.9, fontSize: 18, color: t.muted, align: "center" });
      if (meta) text(slide, meta, { x: M + 1, y: H - 1.55, w: W - 2 * M - 2, h: 0.3, fontSize: 11, color: t.muted, align: "center" });
      return;
    }
    // left
    if (t.decor === "bar") slide.addShape(shape("ellipse"), { x: W - 4.4, y: -1.2, w: 6, h: 6, fill: { color: t.bg, transparency: 100 }, line: { color: t.accent, width: 1.5, transparency: 40 } });
    if (t.decor === "corner") slide.addShape(shape("ellipse"), { x: W - 3.2, y: H - 3, w: 5, h: 5, fill: fill(t.accent, 20), line: { color: t.accent, transparency: 100 } });
    if (t.decor === "grid") for (let x = 0; x <= W; x += 0.5) slide.addShape(shape("line"), { x, y: 0, w: 0, h: H, line: { color: t.surface, width: 0.75 } });
    // The block (number, kicker, title, subtitle) is stacked from its measured height and centred on the slide.
    const size = titleSize(W * 0.72, 2.6, t.decor === "none" ? 58 : 52);
    const titleH = Math.min(2.6, textHeight([title], W * 0.72, size, { line: 1.1, width: /black/i.test(t.head) ? 0.62 : 0.52 }) + 0.15);
    const blockH = (big ? 1.25 : 0) + (kicker ? 0.5 : 0) + 0.25 + titleH + (subtitle ? 1.1 : 0);
    let y = Math.max(0.7, (H - blockH) / 2 - 0.2);
    if (big) { text(slide, big, { x: M, y, w: 3, h: 1.2, fontFace: t.head, fontSize: 66, color: t.accent, bold: !/light/i.test(t.head), valign: "top" }); y += 1.25; }
    if (kicker) { text(slide, kicker.toUpperCase(), { x: M, y, w: W - 2 * M, h: 0.35, fontSize: 14, color: t.accent, bold: true, charSpacing: 2 }); y += 0.5; }
    if (t.decor === "rule") slide.addShape(shape("line"), { x: M, y: y - 0.05, w: 1.6, h: 0, line: { color: t.text, width: 1.5 } });
    y += 0.25;
    text(slide, title, { x: M, y, w: W * 0.72, h: titleH, ...head, fontSize: size, color: t.text, valign: "top" });
    y += titleH;
    if (subtitle) text(slide, subtitle, { x: M, y: y + 0.15, w: W * 0.62, h: 0.9, fontSize: 22, color: t.muted, valign: "top" });
    if (meta) text(slide, meta, { x: M, y: H - 0.9, w: W * 0.6, h: 0.3, fontSize: 12, color: t.muted });
  };

  const today = spec.date || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  let sectionNo = 0;
  for (const [i, s] of spec.slides.entries()) {
    const slide = pptx.addSlide();
    const n = i + 1;
    const content = () => { decorate(slide, "content"); return heading(slide, s.title || "", s.kicker); };
    const area = (top: number) => ({ x: (t.decor === "block" ? M + 0.15 : M), y: top, w: W - 2 * M - (t.decor === "block" ? 0.15 : 0), h: H - top - 0.75 });
    switch (s.layout) {
      case "title":
        cover(slide, s.title || spec.title, s.subtitle ?? spec.subtitle, s.kicker, [spec.author, today].filter(Boolean).join("  ·  "));
        break;
      case "closing":
        cover(slide, s.title || "Thank you", s.subtitle, s.kicker, s.text || [spec.author].filter(Boolean).join(""));
        break;
      case "section": {
        section = s.title || "";
        cover(slide, s.title || "", s.subtitle, s.kicker, undefined, String(s.number ?? ++sectionNo).padStart(2, "0"));
        number(slide, n);
        break;
      }
      case "agenda": {
        const top = content(), box = area(top), items = (s.items || []).map((x) => (typeof x === "string" ? x : x.title));
        const cols = items.length > 5 ? 2 : 1, per = Math.ceil(items.length / cols), rowH = Math.min(0.85, box.h / per);
        items.forEach((item, k) => {
          const col = Math.floor(k / per), row = k % per, x = box.x + col * (box.w / cols), y = box.y + row * rowH;
          text(slide, String(k + 1).padStart(2, "0"), { x, y, w: 0.8, h: rowH, fontFace: t.head, fontSize: 28, color: t.accent, bold: true, valign: "middle" });
          text(slide, strip(item), { x: x + 0.85, y, w: box.w / cols - 1.1, h: rowH, fontSize: fitSize([item], box.w / cols - 1.1, rowH, 26, 14), valign: "middle" });
          slide.addShape(shape("line"), { x: x + 0.85, y: y + rowH - 0.04, w: box.w / cols - 1.2, h: 0, line: { color: t.dark ? t.surface : "DADCE0", width: 0.75 } });
        });
        number(slide, n);
        break;
      }
      case "bullets": {
        const top = content(), box = area(top);
        if (s.takeaway) {
          bulletList(slide, s.bullets || [], { ...box, w: box.w * 0.62 });
          panel(slide, { x: box.x + box.w * 0.66, y: box.y, w: box.w * 0.34, h: Math.min(box.h, 3.2) }, t.dark ? t.surface : t.accent);
          text(slide, strip(s.takeaway), { x: box.x + box.w * 0.66 + 0.3, y: box.y + 0.3, w: box.w * 0.34 - 0.6, h: Math.min(box.h, 3.2) - 0.6, fontFace: t.head, fontSize: fitSize([s.takeaway], box.w * 0.34 - 0.6, Math.min(box.h, 3.2) - 0.6, 24, 13), color: t.dark ? t.accent : on(t.accent), valign: "middle" });
        } else bulletList(slide, s.bullets || [], box);
        number(slide, n);
        break;
      }
      case "text": {
        const top = content(), box = area(top), paragraphs = String(s.text).split(/\n{2,}/);
        const size = fitSize(paragraphs.map(strip), box.w * 0.82, box.h, 24, 12, { line: 1.35, gap: 0.6 });
        text(slide, paragraphs.flatMap((p, k) => runs(p.replace(/\n/g, " ")).map((r, j, all) => ({ text: r.text, options: { ...r.options, ...(j === all.length - 1 && k < paragraphs.length - 1 ? { breakLine: true } : {}), paraSpaceAfter: size * 0.6 } }))), { ...box, w: box.w * 0.82, fontSize: size, lineSpacingMultiple: 1.2 });
        number(slide, n);
        break;
      }
      case "two-column": {
        const top = content(), box = area(top), gap = 0.5, w = (box.w - gap) / 2;
        for (const [k, side] of [s.left!, s.right!].entries()) {
          const x = box.x + k * (w + gap);
          let y = box.y;
          if (side.heading) { text(slide, strip(side.heading), { x, y, w, h: 0.55, fontFace: t.head, fontSize: 24, bold: true, color: k ? t.accent2 : t.accent }); y += 0.7; }
          if (side.bullets) bulletList(slide, side.bullets, { x, y, w, h: box.y + box.h - y }, 24);
          else if (side.text) text(slide, runs(side.text), { x, y, w, h: box.y + box.h - y, fontSize: fitSize([strip(side.text)], w, box.y + box.h - y, 24, 13, { line: 1.3 }), lineSpacingMultiple: 1.15 });
        }
        slide.addShape(shape("line"), { x: box.x + w + gap / 2, y: box.y, w: 0, h: box.h, line: { color: t.dark ? t.surface : "DADCE0", width: 0.75 } });
        number(slide, n);
        break;
      }
      case "comparison": {
        const top = content(), box = area(top), cols = s.columns!, gap = 0.3, w = (box.w - gap * (cols.length - 1)) / cols.length;
        const colors = [t.accent, t.accent2, t.accent3, t.muted];
        // One type size for every column, and panels only as tall as the longest column needs.
        const size = Math.min(...cols.map((c) => fitSize(c.points.map(strip), w - 0.75, box.h - 1.1, 24, 13, { line: 1.25, gap: 0.6 })));
        const h = Math.min(box.h, Math.max(2.6, 1.25 + Math.max(...cols.map((c) => textHeight(c.points.map(strip), w - 0.75, size, { line: 1.25, gap: 0.6 })))));
        cols.forEach((c, k) => {
          const x = box.x + k * (w + gap);
          panel(slide, { x, y: box.y, w, h }, t.surface);
          slide.addShape(shape("rect"), { x, y: box.y, w, h: 0.7, fill: fill(colors[k]), line: { color: colors[k] } });
          text(slide, strip(c.heading), { x: x + 0.25, y: box.y, w: w - 0.5, h: 0.7, fontFace: t.head, fontSize: fitSize([c.heading], w - 0.5, 0.6, 22, 13), bold: true, color: on(colors[k]), valign: "middle" });
          bulletList(slide, c.points, { x: x + 0.25, y: box.y + 0.9, w: w - 0.5, h: h - 1.05 }, size);
        });
        number(slide, n);
        break;
      }
      case "cards": {
        const top = content(), box = area(top), items = (s.items || []).map((x) => (typeof x === "string" ? { title: x, text: "" } : x));
        const cols = items.length <= 3 ? items.length : items.length === 4 ? 2 : 3, rows = Math.ceil(items.length / cols), gap = 0.3;
        const w = (box.w - gap * (cols - 1)) / cols;
        const textSize = fitEach(items.map((x) => strip(x.text || "")), w - 0.5, (box.h - gap * (rows - 1)) / rows - 1.5, 20, 12, { line: 1.25 });
        // Cards are as tall as their text needs (with room to breathe), not stretched to the bottom of the slide.
        const need = 1.65 + Math.max(0, ...items.map((x) => (x.text ? textHeight([strip(x.text)], w - 0.5, textSize, { line: 1.25 }) : 0)));
        const h = Math.min((box.h - gap * (rows - 1)) / rows, Math.max(rows > 1 ? 1.9 : 2.6, need));
        items.forEach((item, k) => {
          const x = box.x + (k % cols) * (w + gap), y = box.y + Math.floor(k / cols) * (h + gap), color = [t.accent, t.accent2, t.accent3][k % 3];
          panel(slide, { x, y, w, h }, t.surface);
          if (t.rounded) { slide.addShape(shape("ellipse"), { x: x + 0.25, y: y + 0.25, w: 0.5, h: 0.5, fill: fill(color), line: { color } }); text(slide, String(k + 1), { x: x + 0.25, y: y + 0.25, w: 0.5, h: 0.5, fontSize: 15, bold: true, color: on(color), align: "center", valign: "middle" }); }
          else { slide.addShape(shape("rect"), { x, y, w, h: 0.07, fill: fill(color), line: { color } }); text(slide, String(k + 1).padStart(2, "0"), { x: x + 0.25, y: y + 0.25, w: 1, h: 0.5, fontFace: t.head, fontSize: 18, bold: true, color }); }
          text(slide, strip(item.title), { x: x + 0.25, y: y + 0.85, w: w - 0.5, h: 0.55, fontFace: t.head, fontSize: fitSize([item.title], w - 0.5, 0.55, 22, 13, { line: 1.05 }), bold: true });
          if (item.text) text(slide, runs(item.text, { color: t.muted }), { x: x + 0.25, y: y + 1.45, w: w - 0.5, h: Math.max(0.3, h - 1.6), fontSize: textSize, lineSpacingMultiple: 1.1 });
        });
        number(slide, n);
        break;
      }
      case "stats": {
        const top = content(), box = area(top), stats = s.stats!, gap = 0.35, w = (box.w - gap * (stats.length - 1)) / stats.length;
        const h = Math.min(s.takeaway ? box.h - 1.1 : box.h, 3.9);
        const valueSize = oneLine(stats.map((x) => String(x.value)), w - 0.5, 66, 24, /black|georgia|garamond|cambria|constantia/i.test(t.head) ? 0.72 : 0.62);
        stats.forEach((x, k) => {
          const left = box.x + k * (w + gap), color = [t.accent, t.accent2, t.accent3, t.text][k % 4];
          panel(slide, { x: left, y: box.y, w, h }, t.surface);
          text(slide, String(x.value), { x: left + 0.25, y: box.y + 0.35, w: w - 0.5, h: 1.5, fontFace: t.head, fontSize: valueSize, bold: true, color, valign: "middle" });
          text(slide, strip(x.label), { x: left + 0.25, y: box.y + 1.95, w: w - 0.5, h: 0.8, fontSize: fitEach(stats.map((v) => v.label), w - 0.5, 0.8, 22, 12), bold: true });
          if (x.detail) text(slide, strip(x.detail), { x: left + 0.25, y: box.y + 2.8, w: w - 0.5, h: h - 2.95, fontSize: fitEach(stats.map((v) => v.detail || ""), w - 0.5, h - 2.95, 18, 11), color: t.muted });
        });
        if (s.takeaway) text(slide, runs(s.takeaway), { x: box.x, y: box.y + h + 0.3, w: box.w, h: 0.8, fontFace: t.head, fontSize: fitSize([strip(s.takeaway)], box.w, 0.8, 24, 13), color: t.text, valign: "middle" });
        number(slide, n);
        break;
      }
      case "chart": {
        const top = s.title ? content() : (decorate(slide, "content"), 0.6), box = area(top), c = s.chart!;
        const side = s.takeaway ? box.w * 0.3 : 0;
        const kind = ({ bar: "bar", column: "bar", line: "line", area: "area", pie: "pie", doughnut: "doughnut", scatter: "scatter", radar: "radar" } as Record<string, string>)[c.type];
        const data = c.type === "scatter" ? [{ name: "X", values: c.labels.map(Number) }, ...c.series.map((x) => ({ name: x.name, values: x.values }))] : c.series.map((x) => ({ name: x.name, labels: c.labels.map(String), values: x.values }));
        const round = c.type === "pie" || c.type === "doughnut";
        slide.addChart((pptx.ChartType as any)[kind], data, {
          x: box.x, y: box.y, w: box.w - side - (side ? 0.3 : 0), h: box.h,
          barDir: c.type === "bar" ? "bar" : "col", barGrouping: c.stacked ? "stacked" : "clustered", barGapWidthPct: 60,
          chartColors: round ? c.labels.map((_, k) => chartColors[k % chartColors.length]) : chartColors,
          showLegend: round || c.series.length > 1, legendPos: round ? "r" : "b", legendFontFace: t.body, legendFontSize: 14, legendColor: t.text,
          catAxisLabelColor: t.muted, valAxisLabelColor: t.muted, catAxisLabelFontFace: t.body, valAxisLabelFontFace: t.body, catAxisLabelFontSize: 14, valAxisLabelFontSize: 12,
          valGridLine: { color: t.dark ? t.surface : "E3E6EA", size: 0.75 }, catGridLine: { style: "none" }, catAxisLineShow: !round, valAxisLineShow: false,
          showValue: round || (c.series.length === 1 && c.labels.length <= 8 && kind === "bar"), dataLabelColor: round ? "FFFFFF" : t.text, dataLabelFontSize: 13, dataLabelFontFace: t.body,
          showPercent: round, showTitle: false, lineSize: 2.5, lineDataSymbolSize: 7,
          ...(c.unit ? { valAxisTitle: c.unit, showValAxisTitle: true, valAxisTitleColor: t.muted, valAxisTitleFontSize: 11 } : {}),
          holeSize: 55,
        });
        if (s.takeaway) {
          const x = box.x + box.w - side;
          panel(slide, { x, y: box.y, w: side, h: box.h }, t.surface);
          slide.addShape(shape("rect"), { x, y: box.y, w: 0.07, h: box.h, fill: fill(t.accent), line: { color: t.accent } });
          text(slide, runs(s.takeaway), { x: x + 0.3, y: box.y + 0.3, w: side - 0.5, h: box.h - 0.6, fontFace: t.head, fontSize: fitSize([strip(s.takeaway)], side - 0.5, box.h - 0.6, 26, 13, { line: 1.25 }), valign: "middle" });
        }
        if (s.source) text(slide, "Source: " + s.source, { x: box.x, y: H - 0.72, w: box.w * 0.7, h: 0.25, fontSize: 9, color: t.muted, italic: true });
        number(slide, n);
        break;
      }
      case "table": {
        const top = s.title ? content() : (decorate(slide, "content"), 0.6), box = area(top), tb = s.table!;
        const cols = Math.max(tb.header.length, ...tb.rows.map((r) => r.length));
        const rowH = Math.min(0.62, (box.h - (s.takeaway ? 0.9 : 0)) / (tb.rows.length + 1));
        // The widest cell of each column decides how large the type can be.
        const widest = Array.from({ length: cols }, (_, j) => Math.max(String(tb.header[j] ?? "").length, ...tb.rows.map((r) => String(r[j] ?? "").length)));
        const size = Math.max(10, Math.min(20, Math.floor(rowH * 32), Math.floor((box.w * 72) / (widest.reduce((a, b) => a + b + 3, 0) * 0.55))));
        const numeric = (v: unknown) => typeof v === "number" || /^[-+−]?[$€£¥]?\d[\d,.]*%?$/.test(String(v).trim());
        const rows = [
          tb.header.map((h) => ({ text: strip(h), options: { bold: true, color: on(t.accent), fill: { color: t.accent }, fontFace: t.head } })),
          ...tb.rows.map((r, k) => Array.from({ length: cols }, (_, j) => ({ text: strip(String(r[j] ?? "")), options: { color: t.text, fill: { color: k % 2 ? t.bg : t.surface }, align: numeric(r[j]) ? "right" : "left" } }))),
        ];
        const total = widest.reduce((a, b) => a + Math.max(4, b), 0);
        slide.addTable(rows as any, { x: box.x, y: box.y, w: box.w, colW: widest.map((c) => (box.w * Math.max(4, c)) / total), rowH, fontFace: t.body, fontSize: size, border: { type: "solid", pt: 0.5, color: t.dark ? t.bg : "FFFFFF" }, valign: "middle", margin: 0.08, autoPage: false });
        if (s.takeaway) text(slide, runs(s.takeaway), { x: box.x, y: box.y + rowH * (tb.rows.length + 1) + 0.35, w: box.w, h: 0.8, fontFace: t.head, fontSize: fitSize([strip(s.takeaway)], box.w, 0.8, 24, 12), valign: "middle" });
        number(slide, n);
        break;
      }
      case "figure": {
        const top = s.title ? content() : (decorate(slide, "content"), 0.6), box = area(top);
        const shot = await raster.svg(figures.get(i)!, { maxWidth: 1400 });
        const side = s.bullets?.length ? box.w * 0.34 : 0;
        // The figure fills its area (white card included); the caption sits under the card.
        const room = { w: box.w - side - (side ? 0.45 : 0) - 0.3, h: box.h - (s.caption ? 0.55 : 0) - 0.3 };
        const scale = Math.min(room.w / (shot.width / 96), room.h / (shot.height / 96)), w = (shot.width / 96) * scale, h = (shot.height / 96) * scale;
        const x = box.x + 0.15 + (room.w - w) / 2, y = box.y + 0.15;
        // Kinetra draws for white paper, so anything but a white slide frames the figure on a white card.
        if (luminance(t.bg) < 0.97) panel(slide, { x: x - 0.15, y: y - 0.15, w: w + 0.3, h: h + 0.3 }, "FFFFFF");
        slide.addImage({ data: "image/png;base64," + Buffer.from(shot.png).toString("base64"), x, y, w, h, altText: s.caption || s.title || "Figure" });
        if (s.caption) text(slide, runs(s.caption, { color: t.muted }), { x: x - 0.15, y: y + h + 0.25, w: w + 0.3, h: 0.4, fontSize: 14, align: "center", italic: true });
        if (side) bulletList(slide, s.bullets!, { x: box.x + box.w - side, y: box.y + 0.15, w: side, h: box.h - 0.3 }, 24);
        number(slide, n);
        break;
      }
      case "equation": {
        const top = s.title ? content() : (decorate(slide, "content"), 0.6), box = area(top);
        const shot = await raster.math(latexMathml(s.math!, true), { color: "#" + t.text, size: 40 });
        const below = s.bullets?.length || s.text ? 2.2 : 0;
        const scale = Math.min((box.w * 0.9) / (shot.width / 96), (box.h - below) / (shot.height / 96), 1.6);
        const w = (shot.width / 96) * scale, h = (shot.height / 96) * scale;
        panel(slide, { x: box.x, y: box.y, w: box.w, h: box.h - below - 0.2 }, t.surface);
        slide.addImage({ data: "image/png;base64," + Buffer.from(shot.png).toString("base64"), x: box.x + (box.w - w) / 2, y: box.y + (box.h - below - 0.2 - h) / 2, w, h, altText: s.math });
        if (s.bullets?.length) bulletList(slide, s.bullets, { x: box.x, y: box.y + box.h - below, w: box.w, h: below }, 24);
        else if (s.text) text(slide, runs(s.text), { x: box.x, y: box.y + box.h - below, w: box.w, h: below, fontSize: fitSize([strip(s.text)], box.w, below, 24, 13, { line: 1.3 }) });
        number(slide, n);
        break;
      }
      case "timeline": {
        const top = content(), box = area(top), steps = s.steps!, gap = box.w / steps.length;
        const textSize = fitEach(steps.map((x) => strip(x.text || "")), gap - 0.25, box.h - 2.4, 18, 11, { line: 1.25 });
        const titleSize = fitEach(steps.map((x) => strip(x.title || "")), gap - 0.2, 0.7, 20, 12);
        // The axis sits a third of the way down when the steps have little text, so the slide does not look top-heavy.
        const below = 0.45 + (steps.some((x) => x.title) ? 0.8 : 0) + Math.max(0, ...steps.map((x) => (x.text ? textHeight([strip(x.text)], gap - 0.25, textSize, { line: 1.25 }) : 0)));
        const axis = Math.max(box.y + 1.25, box.y + (box.h - below) * 0.42);
        slide.addShape(shape("line"), { x: box.x, y: axis, w: box.w, h: 0, line: { color: t.muted, width: 1.5 } });
        steps.forEach((step, k) => {
          const cx = box.x + gap * k + gap / 2, color = [t.accent, t.accent2, t.accent3][k % 3];
          text(slide, strip(step.label || ""), { x: cx - gap / 2 + 0.05, y: axis - 0.95, w: gap - 0.1, h: 0.7, fontFace: t.head, fontSize: oneLine(steps.map((x) => x.label || ""), gap - 0.2, 30, 13, 0.62), bold: true, color, align: "center", valign: "bottom" });
          slide.addShape(shape("ellipse"), { x: cx - 0.19, y: axis - 0.19, w: 0.38, h: 0.38, fill: fill(color), line: { color: t.bg, width: 2 } });
          if (step.title) text(slide, strip(step.title), { x: cx - gap / 2 + 0.1, y: axis + 0.4, w: gap - 0.2, h: 0.7, fontSize: titleSize, bold: true, align: "center" });
          if (step.text) text(slide, runs(step.text, { color: t.muted }), { x: cx - gap / 2 + 0.1, y: axis + (step.title ? 1.15 : 0.45), w: gap - 0.2, h: Math.max(0.4, box.y + box.h - axis - 1.2), fontSize: textSize, align: "center" });
        });
        number(slide, n);
        break;
      }
      case "process": {
        const top = content(), box = area(top), steps = s.steps!, gap = 0.12, w = (box.w - gap * (steps.length - 1)) / steps.length;
        const textSize = fitEach(steps.map((x) => strip(x.text || "")), w - 0.3, box.h - 1.9, 20, 11, { line: 1.25 });
        const headSize = fitEach(steps.map((x) => strip(x.title || x.label || "")), w - 0.95, 1.0, 20, 11);
        // Steps sit a little below the title, with their notes under each arrow.
        const need = 1.25 + 0.3 + Math.max(0, ...steps.map((x) => (x.text ? textHeight([strip(x.text)], w - 0.3, textSize, { line: 1.25 }) : 0)));
        const y0 = box.y + Math.max(0, (box.h - need) * 0.3);
        steps.forEach((step, k) => {
          const x = box.x + k * (w + gap), color = k === steps.length - 1 ? t.accent2 : t.accent;
          slide.addShape(k === 0 ? shape("homePlate") : shape("chevron"), { x, y: y0, w, h: 1.25, fill: fill(color, k === steps.length - 1 ? 0 : Math.min(55, k * 14)), line: { color: t.bg, width: 1 } });
          // Text starts after a chevron's notch (about a third of its height) and stops before its point.
          text(slide, strip(step.title || step.label || ""), { x: x + (k ? 0.55 : 0.25), y: y0, w: w - (k ? 0.95 : 0.7), h: 1.25, fontFace: t.head, fontSize: headSize, bold: true, color: on(color), valign: "middle" });
          if (step.text) text(slide, runs(step.text), { x: x + 0.15, y: y0 + 1.5, w: w - 0.3, h: Math.max(0.4, box.y + box.h - y0 - 1.55), fontSize: textSize, color: t.text });
        });
        number(slide, n);
        break;
      }
      case "quote": {
        decorate(slide, "content");
        const q = strip(s.quote!);
        text(slide, "“", { x: M, y: 0.6, w: 2, h: 2, fontFace: t.head, fontSize: 160, color: t.accent, bold: true });
        text(slide, q, { x: M + 1.0, y: 1.7, w: W - 2 * M - 2, h: 3.6, fontFace: t.head, fontSize: fitSize([q], W - 2 * M - 2, 3.6, 40, 20, { line: 1.25 }), italic: !/black/i.test(t.head), valign: "middle" });
        if (s.by) text(slide, "— " + strip(s.by), { x: M + 1.0, y: 5.5, w: W - 2 * M - 2, h: 0.5, fontSize: 18, color: t.muted });
        number(slide, n);
        break;
      }
    }
    notes(slide, s);
  }
  const out = await pptx.write({ outputType: "nodebuffer" });
  return new Uint8Array(out as Buffer);
}

/** A colour part-way to another (for chart series beyond the three accents). */
function mix(a: string, b: string, amount: number) {
  return [0, 2, 4].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
}
