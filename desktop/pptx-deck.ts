import PptxGenJS from "pptxgenjs";
import { kinetraCall } from "./kinetra-runtime.ts";
import { rasterizer, svgSize } from "./rasterize.ts";
import { unsafeSvg } from "./svg-safety.ts";
import { latexMathml } from "./docx-math.ts";
import { runs, strip } from "./deck-text.ts";
import { designTheme, ARCHETYPES, archetypes, luminance, on, mix, contrast, readable, type Theme, type Art } from "./deck-design.ts";
import { artSvg, iconSvg, iconFor, iconNames } from "./deck-art.ts";
import { recorded, staticFindings, slideReviewer, type Adjust, type SlideRecord } from "./deck-review.ts";

export type { Theme } from "./deck-design.ts";
/**
 * PowerPoint decks Mowr designs itself. A deck is a list of slides, each with a layout (title, statement, big number,
 * chart, matrix, roadmap, diagram, image-led…), drawn in a design worked out for that deck (desktop/deck-design.ts): its
 * archetype (lecture, pitch, report, workshop, defence, kids' lesson…) sets the structure and visual language, and its
 * colours and type come from the brand or the subject. Everything stays editable in PowerPoint: text boxes, native
 * charts, tables and diagram shapes, and speaker notes; only icons, generated art, Kinetra figures and typeset equations
 * are pictures. Each deck is drawn, measured in Chromium with the real fonts, corrected and checked before delivery
 * (desktop/deck-review.ts).
 */
type Preset = Pick<Theme, "bg" | "surface" | "text" | "muted" | "accent" | "accent2" | "accent3" | "head" | "body" | "cover" | "decor" | "rounded"> & { use: string };
export const themes: Record<string, Preset> = {
  editorial: { use: "essays, humanities, culture, journalism, book and history talks", bg: "F6F3EC", surface: "FFFFFF", text: "1C1B19", muted: "6E6A62", accent: "B23A2E", accent2: "2B4C6F", accent3: "C9A227", head: "Georgia", body: "Segoe UI", cover: "left", decor: "rule", rounded: false },
  midnight: { use: "technology, software, AI, product launches, engineering demos", bg: "0B1220", surface: "16203A", text: "F3F6FB", muted: "9AA7BD", accent: "4CC9F0", accent2: "F72585", accent3: "FFD166", head: "Segoe UI Semibold", body: "Segoe UI", cover: "left", decor: "bar", rounded: true },
  boardroom: { use: "business reviews, strategy, consulting, finance, board and investor updates", bg: "FFFFFF", surface: "F2F4F7", text: "1A2433", muted: "5B6676", accent: "0B5CAD", accent2: "13A89E", accent3: "F2A900", head: "Arial", body: "Arial", cover: "panel", decor: "tracker", rounded: false },
  academic: { use: "lectures, seminars, thesis defences, conference talks, research results", bg: "FFFFFF", surface: "F3F5F8", text: "1F2328", muted: "5F6670", accent: "7A1F2B", accent2: "1F4E79", accent3: "C08A2E", head: "Cambria", body: "Calibri", cover: "band", decor: "topband", rounded: false },
  studio: { use: "creative pitches, marketing, design, branding, startups, bold launches", bg: "FFF6EC", surface: "FFFFFF", text: "141414", muted: "5A5A5A", accent: "FF4F2E", accent2: "2747FF", accent3: "FFC233", head: "Arial Black", body: "Arial", cover: "full", decor: "block", rounded: false },
  classroom: { use: "school lessons, younger students, workshops, training, onboarding", bg: "FFFCF5", surface: "FFFFFF", text: "2B2A33", muted: "6B6A75", accent: "3A86FF", accent2: "FF7F50", accent3: "2EC4B6", head: "Trebuchet MS", body: "Trebuchet MS", cover: "center", decor: "dots", rounded: true },
  minimal: { use: "keynotes, design reviews, portfolios, talks that should feel calm and premium", bg: "FFFFFF", surface: "F5F5F5", text: "111111", muted: "8A8A8A", accent: "E63946", accent2: "111111", accent3: "8A8A8A", head: "Segoe UI Light", body: "Segoe UI", cover: "left", decor: "none", rounded: false },
  earth: { use: "sustainability, environment, health, wellbeing, food, community and NGO work", bg: "F3EFE6", surface: "FFFFFF", text: "2E3A2F", muted: "6D7468", accent: "3F6E3A", accent2: "C08B3E", accent3: "8A5A44", head: "Constantia", body: "Corbel", cover: "left", decor: "corner", rounded: true },
  noir: { use: "luxury, fashion, architecture, events, awards, premium brands", bg: "0F0F0F", surface: "1B1B1B", text: "F4EFE6", muted: "A8A196", accent: "C9A45C", accent2: "7F8C8D", accent3: "E5D3B3", head: "Garamond", body: "Segoe UI Light", cover: "center", decor: "frame", rounded: false },
  lab: { use: "science, engineering, medicine, data analysis, lab reports and technical results", bg: "FFFFFF", surface: "EEF3F7", text: "0F2A37", muted: "5D7380", accent: "0077B6", accent2: "E76F51", accent3: "2A9D8F", head: "Bahnschrift", body: "Segoe UI", cover: "left", decor: "grid", rounded: true },
};
export const layouts = ["title", "section", "agenda", "statement", "bullets", "text", "two-column", "comparison", "cards", "icons", "stats", "big-number", "chart", "table", "figure", "image", "diagram", "equation", "timeline", "process", "roadmap", "matrix", "before-after", "team", "quote", "closing"] as const;
type Layout = (typeof layouts)[number];
type Bullet = string | { text: string; sub?: string[] };
type Side = { heading?: string; bullets?: Bullet[]; text?: string; points?: string[]; icon?: string };
type Figure = { module: string; fn: string; args: unknown[] };
/** A picture for an image-led slide: a Kinetra figure, an SVG illustration, generated art, or a large icon. */
type Picture = { figure?: Figure; svg?: string; art?: boolean | Art; icon?: string };
type Slide = {
  layout: Layout; title?: string; subtitle?: string; kicker?: string; notes?: string;
  bullets?: Bullet[]; text?: string; number?: string | number; statement?: string;
  left?: Side; right?: Side; before?: Side; after?: Side;
  columns?: { heading: string; points: string[] }[];
  items?: (string | { title: string; text?: string; icon?: string })[];
  stats?: { value: string; label: string; detail?: string; icon?: string }[];
  value?: string | number; label?: string;
  chart?: { type: string; labels: string[]; series: { name: string; values: number[] }[]; unit?: string; stacked?: boolean };
  table?: { header: string[]; rows: (string | number)[][] };
  figure?: Figure; caption?: string; image?: Picture; side?: "left" | "right" | "full";
  diagram?: { type: string; items: (string | { title: string; text?: string })[]; center?: string };
  math?: string; steps?: { label?: string; title?: string; text?: string }[];
  phases?: { label: string; title?: string; items?: string[]; text?: string }[]; now?: number;
  quadrants?: { title: string; text?: string; items?: string[] }[]; x?: { label?: string; low?: string; high?: string }; y?: { label?: string; low?: string; high?: string }; highlight?: number; points?: { label: string; x: number; y: number }[];
  people?: { name: string; role?: string; text?: string; icon?: string }[];
  quote?: string; by?: string; takeaway?: string; source?: string;
};
export type DeckSpec = {
  title: string; subtitle?: string; author?: string; date?: string;
  /** What kind of talk this is (lecture, pitch, report…): its structure and visual language. Inferred from the title and brief when left out. */
  archetype?: string;
  /** Who the deck is for and what it must do; it shapes the design and the review. */
  brief?: { audience?: string; purpose?: string; setting?: string; message?: string; tone?: string; minutes?: number };
  /** The person's or organisation's colours and fonts. */
  brand?: { name?: string; colors?: string[]; primary?: string; secondary?: string; headingFont?: string; bodyFont?: string };
  theme?: Partial<Theme> & { preset?: string; headingFont?: string; bodyFont?: string; background?: string };
  aspect?: "16:9" | "4:3"; footer?: string | false; plan?: string[]; slides: Slide[];
};

/** The deck's design: derived for this deck, or a preset with the person's colours and fonts on top (desktop/deck-design.ts). */
export const deckTheme = (spec: DeckSpec): Theme => designTheme(spec as any, themes);

const DIAGRAMS = ["cycle", "hub", "pyramid", "funnel", "venn", "layers"];
/** Every problem in a deck, reported together so the model fixes them in one pass. */
export function deckProblems(spec: any): string[] {
  const problems: string[] = [];
  if (!spec || typeof spec.title !== "string" || !spec.title.trim()) problems.push('A deck needs a "title".');
  if (!Array.isArray(spec?.slides) || !spec.slides.length) return [...problems, 'A deck needs "slides": [{"layout":…}, …].'];
  if (spec.slides.length > 150) problems.push("A deck holds at most 150 slides.");
  if (spec.theme?.preset !== undefined && !themes[String(spec.theme.preset).toLowerCase()]) problems.push(`Unknown theme preset "${spec.theme.preset}". Use one of: ${Object.keys(themes).join(", ")}, or leave "preset" out to have the design derived for this deck.`);
  if (spec.archetype !== undefined && !(archetypes as string[]).includes(String(spec.archetype))) problems.push(`Unknown "archetype" "${spec.archetype}". Use one of: ${archetypes.join(", ")}.`);
  spec.slides.forEach((s: any, i: number) => {
    const at = `Slide ${i + 1}`;
    if (!s || !layouts.includes(s.layout)) { problems.push(`${at}: "layout" must be one of ${layouts.join(", ")}.`); return; }
    const need = (ok: boolean, what: string) => { if (!ok) problems.push(`${at} (${s.layout}) needs ${what}.`); };
    const list = (v: any, min = 1) => Array.isArray(v) && v.length >= min;
    const side = (v: any) => !!v && typeof v === "object" && (list(v.bullets) || list(v.points) || typeof v.text === "string");
    if (!["title", "closing", "quote", "figure", "equation", "chart", "table", "statement", "big-number", "image"].includes(s.layout)) need(typeof s.title === "string" && !!s.title.trim(), '"title"');
    if (s.layout === "bullets") need(list(s.bullets), '"bullets"');
    if (s.layout === "text") need(typeof s.text === "string", '"text"');
    if (s.layout === "agenda") need(list(s.items), '"items"');
    if (s.layout === "statement") need(typeof (s.statement ?? s.title) === "string" && !!String(s.statement ?? s.title).trim(), '"statement" (one sentence)');
    if (s.layout === "two-column") need(!!s.left && !!s.right, '"left" and "right" ({heading, bullets or text})');
    if (s.layout === "before-after") need(side(s.before) && side(s.after), '"before" and "after" ({heading?, points or text})');
    if (s.layout === "comparison") need(list(s.columns, 2) && s.columns.length <= 4 && s.columns.every((c: any) => c && typeof c.heading === "string" && Array.isArray(c.points)), '"columns": 2–4 of {heading, points:[…]}');
    if (s.layout === "cards") need(list(s.items, 2) && s.items.length <= 8, '"items": 2–8 of {title, text, icon?}');
    if (s.layout === "icons") need(list(s.items, 2) && s.items.length <= 8 && s.items.every((x: any) => x && typeof x.title === "string"), '"items": 2–8 of {icon, title, text?}');
    if (s.layout === "stats") need(list(s.stats) && s.stats.length <= 4 && s.stats.every((x: any) => x && x.value !== undefined && typeof x.label === "string"), '"stats": 1–4 of {value, label}');
    if (s.layout === "big-number") need(s.value !== undefined && String(s.value).trim().length > 0 && String(s.value).length <= 12, '"value" (a short figure such as "73%" or "$4.2B") and "label"');
    if (s.layout === "chart") {
      const c = s.chart;
      need(!!c && ["bar", "column", "line", "area", "pie", "doughnut", "scatter", "radar"].includes(c.type), '"chart" with "type" bar, column, line, area, pie, doughnut, scatter or radar');
      if (c && (!Array.isArray(c.labels) || !Array.isArray(c.series) || !c.series.length || c.series.some((x: any) => !Array.isArray(x?.values) || x.values.length !== c.labels.length || x.values.some((v: any) => typeof v !== "number" || !Number.isFinite(v)))))
        problems.push(`${at} chart: "labels" and every series' "values" (numbers) must have the same length.`);
    }
    if (s.layout === "table") need(!!s.table && Array.isArray(s.table.header) && Array.isArray(s.table.rows) && s.table.rows.length <= 18, '"table": {header:[…], rows:[[…]]} with at most 18 rows (split longer tables)');
    if (s.layout === "figure") need(isFigure(s.figure), '"figure": {module, fn, args} (a Kinetra figure)');
    if (s.layout === "image") {
      const p = s.image;
      need(!!p && (isFigure(p.figure) || typeof p.svg === "string" || !!p.art || typeof p.icon === "string"), '"image": {figure} (Kinetra), {svg} (your own drawing), {art:true} (generated art) or {icon}');
      if (p && typeof p.svg === "string" && (!p.svg.includes("<svg") || unsafeSvg.test(p.svg))) problems.push(`${at} image: "svg" must be a complete <svg> drawing with no scripts, event handlers or outside links.`);
    }
    if (s.layout === "diagram") need(!!s.diagram && DIAGRAMS.includes(s.diagram.type) && list(s.diagram.items, 2) && s.diagram.items.length <= (s.diagram.type === "venn" ? 3 : 6), `"diagram": {type: ${DIAGRAMS.join("|")}, items: 2–6 (venn 2–3) of {title, text?}, center?}`);
    if (s.layout === "equation") need(typeof s.math === "string" && !!s.math.trim(), '"math" (LaTeX)');
    if (s.layout === "timeline" || s.layout === "process") need(list(s.steps, 2) && s.steps.length <= (s.layout === "timeline" ? 7 : 6), `"steps": 2–${s.layout === "timeline" ? 7 : 6} of {label, title, text}`);
    if (s.layout === "roadmap") need(list(s.phases, 2) && s.phases.length <= 6 && s.phases.every((p: any) => p && typeof p.label === "string"), '"phases": 2–6 of {label, title?, items?:[…]}');
    if (s.layout === "matrix") need(list(s.quadrants, 4) && s.quadrants.length === 4 && s.quadrants.every((q: any) => q && typeof q.title === "string"), '"quadrants": exactly 4 of {title, text?} (top-left, top-right, bottom-left, bottom-right)');
    if (s.layout === "team") need(list(s.people) && s.people.length <= 8 && s.people.every((p: any) => p && typeof p.name === "string"), '"people": 1–8 of {name, role?, text?}');
    if (s.layout === "quote") need(typeof s.quote === "string", '"quote"');
  });
  if (spec.theme !== undefined && (typeof spec.theme !== "object" || Array.isArray(spec.theme))) problems.push('"theme" must be an object.');
  return problems;
}
const isFigure = (f: any) => !!f && typeof f.module === "string" && typeof f.fn === "string" && Array.isArray(f.args);
const label = (s: Slide) => s.title || s.statement || s.quote || (s.value !== undefined ? String(s.value) : "");

/** Notes on the deck's story and design, returned with the result so the model can improve the deck. */
export function deckReview(spec: DeckSpec): string[] {
  const notes: string[] = [];
  const slides = spec.slides;
  let run = 0;
  slides.forEach((s, i) => {
    run = s.layout === "bullets" || s.layout === "text" ? run + 1 : 0;
    if (run === 3) notes.push(`Slides ${i - 1}–${i + 1} are all text: where the content allows, use statement, stats, big-number, chart, icons, diagram, process, matrix or an image-led slide.`);
    const long = (s.bullets || []).filter((b) => (typeof b === "string" ? b : b.text).split(/\s+/).length > 22).length;
    if (long) notes.push(`Slide ${i + 1} has ${long} bullet${long > 1 ? "s" : ""} over 22 words: shorten them and move detail to the notes.`);
    const title = s.title || "";
    if (!["title", "section", "agenda", "closing", "quote", "statement", "big-number", "team"].includes(s.layout) && title && title.split(/\s+/).length <= 2 && !/\d/.test(title))
      notes.push(`Slide ${i + 1}'s title "${title}" is a topic label: make it the slide's point (what the audience should take away).`);
    if (i >= 2 && s.layout === slides[i - 1].layout && s.layout === slides[i - 2].layout && !["section", "figure", "chart", "equation"].includes(s.layout)) notes.push(`Slides ${i - 1}–${i + 1} use the same layout (${s.layout}) three times running: vary the rhythm.`);
  });
  if (slides.length >= 6 && !slides.some((s) => s.notes)) notes.push("No slide has speaker notes; add them when the deck will be presented.");
  if (slides.length >= 5 && slides[0].layout !== "title") notes.push("The deck does not open with a title slide.");
  if (slides.length >= 8 && !["closing", "statement", "big-number", "quote"].includes(slides[slides.length - 1].layout) && !/next|question|thank|summary|recap|takeaway|ask|conclusion/i.test(label(slides[slides.length - 1]))) notes.push("The deck stops without an ending: close on the takeaway, the ask or next steps.");
  if (slides.length >= 14 && !slides.some((s) => s.layout === "section")) notes.push("A long deck with no section slides: add them between its parts so the audience knows where they are.");
  const minutes = Number(spec.brief?.minutes);
  if (minutes > 0) {
    const content = slides.filter((s) => s.layout !== "section").length;
    if (content > minutes * 1.8) notes.push(`${content} slides for ${minutes} minutes is rushed (about one a minute is comfortable): merge or cut.`);
    if (content < minutes * 0.4 && content < 6) notes.push(`${content} slides for ${minutes} minutes: the talk may need more support.`);
  }
  return notes;
}


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
const initials = (name: string) => name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || name.slice(0, 1).toUpperCase();

type Raster = Awaited<ReturnType<typeof rasterizer>>;
type Shot = { png: Uint8Array; width: number; height: number };
/** What the review found and could not fix by itself, and pictures of the slides for the model to look at. */
export type DeckResult = { bytes: Uint8Array; slides: number; review: string[]; design: Record<string, unknown>; sheets: { name: string; jpeg: Uint8Array }[] };

/** `preview`: also photograph the slides (contact sheets) for the model to check. */
export async function powerpointDeck(input: DeckSpec, { preview = false }: { preview?: boolean } = {}): Promise<DeckResult> {
  const problems = deckProblems(input);
  // Figures are drawn first, so every problem (structure and figures) is reported at once.
  const figures = new Map<number, string>();
  await Promise.all(input.slides?.map(async (s, i) => {
    const figure = s?.layout === "figure" ? s.figure : s?.layout === "image" ? s.image?.figure : undefined;
    if (!figure || !isFigure(figure)) return;
    try {
      const svg = await kinetraCall(figure);
      if (typeof svg !== "string" || !svg.includes("<svg")) throw Error(`${figure.module}.${figure.fn} returned data, not a drawing`);
      if (unsafeSvg.test(svg)) throw Error("the figure contained unsupported content");
      figures.set(i, svg);
    } catch (error) {
      problems.push(`Slide ${i + 1} figure failed: ${(error as Error).message}.`);
    }
  }) || []);
  if (problems.length) throw Error(problems.join(" ") + " No deck was created. Fix these and send the pptx action again.");
  // A dense bullet slide may become two; each figure follows its own slide.
  const slides: Slide[] = [], drawn = new Map<number, string>();
  input.slides.forEach((s, i) => { if (figures.has(i)) drawn.set(slides.length, figures.get(i)!); slides.push(...splitDense([s])); });
  const spec = { ...input, slides };
  const theme = deckTheme(spec);
  const notes = deckReview(spec).concat(unknownIcons(spec));
  const W = spec.aspect === "4:3" ? 10 : 13.333;
  const raster = await rasterizer();
  const reviewer = await slideReviewer();
  try {
    const cache = new Map<string, Shot>();
    const adjust: Adjust = new Map();
    // Drawn once to learn which pictures are needed (they are then drawn together), then for real, measured and corrected.
    await draw(spec, theme, drawn, raster, cache, adjust, true);
    let bytes = new Uint8Array(), records: SlideRecord[] = [], findings: Awaited<ReturnType<typeof reviewer.overflow>> = [];
    for (let pass = 0; pass < 3; pass++) {
      ({ bytes, records } = await draw(spec, theme, drawn, raster, cache, adjust, false));
      findings = await reviewer.overflow(records, W, 7.5);
      const fixable = findings.filter((f) => f.key && f.factor);
      if (!fixable.length || pass === 2) break;
      for (const f of fixable) adjust.set(f.key!, (adjust.get(f.key!) || 1) * f.factor!);
    }
    const left = [...findings, ...staticFindings(records, W, 7.5)];
    const review = [...notes, ...[...new Map(left.map((f) => [`${f.slide}:${f.problem}`, f])).values()].slice(0, 25).map((f) => `Slide ${f.slide}: ${f.problem}.`)];
    if (adjust.size) review.push(`The review reduced the type in ${adjust.size} text box${adjust.size === 1 ? "" : "es"} so ${adjust.size === 1 ? "it fits" : "they fit"}; shorter text would read better there.`);
    const sheets = preview ? await reviewer.sheets(records, W, 7.5, 4) : [];
    const design = { archetype: theme.archetype, colors: { background: "#" + theme.bg, text: "#" + theme.text, accents: [theme.accent, theme.accent2, theme.accent3].map((c) => "#" + c) }, fonts: { heading: theme.head, body: theme.body }, cover: theme.cover, decoration: theme.decor, art: theme.art, icons: theme.icons };
    return { bytes, slides: spec.slides.length, review, design, sheets };
  } finally {
    reviewer.close();
    raster.close();
  }
}
/** Icons a deck names that are not in the set (they are drawn as a star): said once, with the names available. */
function unknownIcons(spec: DeckSpec) {
  const names = spec.slides.flatMap((s) => [...(s.items || []).map((x) => (typeof x === "string" ? undefined : x.icon)), ...(s.stats || []).map((x) => x.icon), ...(s.people || []).map((x) => x.icon), s.image?.icon, s.before?.icon, s.after?.icon]).filter((n): n is string => typeof n === "string" && !!n);
  const unknown = [...new Set(names.filter((n) => !iconFor(n)))];
  return unknown.length ? [`Unknown icon${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")} (drawn as a star). Icons: ${iconNames.join(", ")}.`] : [];
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

async function draw(spec: DeckSpec, t: Theme, figures: Map<number, string>, raster: Raster, cache: Map<string, Shot>, adjust: Adjust, collect: boolean) {
  const pptx = new PptxGenJS();
  const wide = spec.aspect !== "4:3";
  pptx.layout = wide ? "LAYOUT_WIDE" : "LAYOUT_4x3";
  const W = wide ? 13.333 : 10, H = 7.5;
  pptx.author = spec.author || "Mowr";
  pptx.title = spec.title;
  pptx.company = spec.brand?.name || "Mowr";
  const M = W > 11 ? 0.7 : 0.55;
  const shape = (name: string) => (pptx.ShapeType as any)[name] ?? name;
  const card = t.rounded ? shape("roundRect") : shape("rect");
  const chartColors = [t.accent, t.accent2, t.accent3, t.muted, mix(t.accent, t.bg, 0.45), mix(t.accent2, t.bg, 0.45)];
  const accents = [t.accent, t.accent2, t.accent3];
  const total = spec.slides.length;
  const footer = spec.footer === false ? "" : typeof spec.footer === "string" ? spec.footer : t.decor === "tracker" || t.decor === "topband" ? spec.title : "";
  const records: SlideRecord[] = [];
  const pending = new Map<string, { svg: string; width: number; height: number }>();
  const bodyW = t.bodyWidth + 0.02, headW = t.headWidth + 0.02;
  const maxBullet = t.density === "airy" ? 30 : t.density === "dense" ? 22 : 26;
  let section = "";

  /** A drawn picture by key: from the cache, or (while collecting) noted for the batch and left out. */
  const picture = (key: string, svg: () => string, width: number, height: number): Shot | undefined => {
    const hit = cache.get(key);
    if (hit) return hit;
    if (collect && !pending.has(key)) pending.set(key, { svg: svg(), width, height });
    return undefined;
  };
  const image = (slide: any, shot: Shot | undefined, box: { x: number; y: number; w: number; h: number }, alt: string) => {
    if (shot) slide.addImage({ data: "image/png;base64," + Buffer.from(shot.png).toString("base64"), ...box, altText: alt });
  };
  const iconColors = (k: number) => {
    const c = accents[k % 3];
    return t.icons === "line" ? { color: c, disc: undefined } : t.icons === "solid" ? { color: c, disc: on(c) } : { color: c, disc: mix(c, t.bg, 0.82) };
  };
  const icon = (slide: any, name: string, k: number, box: { x: number; y: number; w: number; h: number }) => {
    const { color, disc } = iconColors(k);
    const key = `icon:${iconFor(name) || "star"}:${t.icons}:${color}:${disc}`;
    image(slide, picture(key, () => iconSvg(name, t.icons, color, disc), 240, 240), box, name);
  };
  /** Generated art for a slot (cover, a section, an image slide), in `colors` (the slide's own by default). */
  const art = (slide: any, slot: string, box: { x: number; y: number; w: number; h: number }, style: Art = t.art, colors = { bg: t.bg, accent: t.accent, accent2: t.accent2, accent3: t.accent3, dark: t.dark }) => {
    if (style === "none") return;
    const w = Math.round(box.w * 100), h = Math.round(box.h * 100), px = Math.min(1600, w * 1.2);
    const key = `art:${style}:${slot}:${w}x${h}:${colors.bg}`;
    image(slide, picture(key, () => artSvg(style, t.seed + hashSlot(slot), w, h, colors), px, px * (h / w)), box, "Decorative art");
  };
  const memo = async (key: string, make: () => Promise<Shot>) => { const hit = cache.get(key); if (hit) return hit; const shot = await make(); cache.set(key, shot); return shot; };

  const text = (slide: any, value: any, o: Record<string, unknown>) => slide.addText(value, { fontFace: t.body, color: t.text, margin: 0, valign: "top", ...o });
  const fill = (color: string, transparency = 0) => ({ color, transparency });
  const head = { fontFace: t.head, bold: t.headBold };
  const decorate = (slide: any, kind: "content" | "cover") => {
    slide.background = { color: t.bg };
    if (kind === "cover") return;
    switch (t.decor) {
      case "topband": slide.addShape(shape("rect"), { x: 0, y: 0, w: W, h: 0.14, fill: fill(t.accent), line: { color: t.accent } }); break;
      case "block": slide.addShape(shape("rect"), { x: 0, y: 0, w: 0.28, h: H, fill: fill(t.accent), line: { color: t.accent } }); break;
      case "dots": accents.forEach((c, i) => slide.addShape(shape("ellipse"), { x: W - M - 0.9 + i * 0.32, y: 0.42, w: 0.2, h: 0.2, fill: fill(c), line: { color: c } })); break;
      case "corner": slide.addShape(shape("ellipse"), { x: W - 1.6, y: H - 1.4, w: 2.6, h: 2.6, fill: fill(t.accent2, 82), line: { color: t.accent2, transparency: 100 } }); break;
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
    const size = fitSize([strip(title)], w, 1.05, Math.round(32 * t.scale), 18, { width: headW, line: 1.1 });
    text(slide, strip(title), { x: tx, y, w, h: 1.05, ...head, fontSize: size, color: t.text, valign: "middle" });
    if (t.decor === "tracker") slide.addShape(shape("line"), { x: M, y: y + 1.12, w: W - 2 * M, h: 0, line: { color: t.dark ? t.surface : mix(t.bg, t.text, 0.15), width: 0.75 } });
    return y + 1.3;
  };
  const bulletList = (slide: any, items: Bullet[], box: { x: number; y: number; w: number; h: number }, max = maxBullet, color = t.text) => {
    const flat = items.flatMap((b) => (typeof b === "string" ? [b] : [b.text, ...(b.sub || [])]));
    const size = fitSize(flat.map(strip), box.w - 0.35, box.h, max, 13, { line: 1.25, gap: 0.6, width: bodyW });
    const paragraphs = items.flatMap((b) => {
      const main = typeof b === "string" ? b : b.text;
      const sub = typeof b === "string" ? [] : b.sub || [];
      return [
        ...runs(main).map((r, i, all) => ({ text: r.text, options: { ...r.options, ...(i === 0 ? { bullet: { code: t.rounded ? "25CF" : "25A0", indent: size * 1.1 }, paraSpaceBefore: size * 0.45 } : {}), ...(i === all.length - 1 ? { breakLine: true } : {}) } })),
        ...sub.flatMap((s) => runs(s, { fontSize: size - 3, color: t.muted }).map((r, i, all) => ({ text: r.text, options: { ...r.options, ...(i === 0 ? { bullet: { code: "2013", indent: size }, indentLevel: 1, paraSpaceBefore: size * 0.2 } : {}), ...(i === all.length - 1 ? { breakLine: true } : {}) } }))),
      ];
    });
    text(slide, paragraphs, { ...box, fontSize: size, lineSpacingMultiple: 1.1, color });
  };
  const panel = (slide: any, box: { x: number; y: number; w: number; h: number }, color = t.surface, edge?: string) => {
    slide.addShape(card, { ...box, fill: fill(color), line: { color: edge || color, width: edge ? 1 : 0 }, ...(t.rounded ? { rectRadius: 0.12 } : {}) });
  };
  /** A side of a two-part slide (before/after): heading, then points or text, in a box. */
  const sideBlock = (slide: any, side: Side, box: { x: number; y: number; w: number; h: number }, headingColor: string, textColor = t.text) => {
    let y = box.y;
    if (side.heading) { text(slide, strip(side.heading), { x: box.x, y, w: box.w, h: 0.55, ...head, fontSize: fitSize([side.heading], box.w, 0.55, 24, 14, { width: headW }), color: headingColor }); y += 0.7; }
    const points = side.bullets || side.points;
    if (points?.length) bulletList(slide, points, { x: box.x, y, w: box.w, h: box.y + box.h - y }, 24, textColor);
    else if (side.text) text(slide, runs(side.text), { x: box.x, y, w: box.w, h: box.y + box.h - y, fontSize: fitSize([strip(side.text)], box.w, box.y + box.h - y, 24, 13, { line: 1.3, width: bodyW }), lineSpacingMultiple: 1.15, color: textColor });
  };
  const notes = (slide: any, s: Slide) => { if (s.notes) slide.addNotes(strip(s.notes)); };

  const cover = (slide: any, slot: string, title: string, subtitle?: string, kicker?: string, meta?: string, big?: string) => {
    decorate(slide, "cover");
    const titleSize = (w: number, h: number, max: number) => fitSize([title], w, h, Math.round(max * t.scale), 26, { width: headW, line: 1.05 });
    const tinted = (bg: string) => ({ bg, accent: mix(bg, "FFFFFF", 0.3), accent2: mix(bg, "000000", 0.25), accent3: mix(bg, "FFFFFF", 0.55), dark: luminance(bg) < 0.18 });
    if (t.cover === "full") {
      slide.background = { color: t.accent };
      art(slide, slot, { x: W * 0.68, y: 0, w: W * 0.32, h: H }, t.art, tinted(t.accent2));
      if (t.art === "none") slide.addShape(shape("rect"), { x: W * 0.68, y: 0, w: W * 0.32, h: H, fill: fill(t.accent2), line: { color: t.accent2 } });
      if (big) text(slide, big, { x: M, y: 0.6, w: 3, h: 1.4, fontFace: t.head, fontSize: 72, color: on(t.accent), bold: true });
      if (kicker) text(slide, kicker.toUpperCase(), { x: M, y: big ? 2.1 : 1.0, w: W * 0.6, h: 0.35, fontSize: 13, color: on(t.accent), bold: true, charSpacing: 2 });
      text(slide, title, { x: M, y: 2.5, w: W * 0.6, h: 2.6, ...head, fontSize: titleSize(W * 0.6, 2.6, 54), color: on(t.accent), valign: "bottom" });
      if (subtitle) text(slide, subtitle, { x: M, y: 5.25, w: W * 0.58, h: 0.9, fontSize: 18, color: on(t.accent) });
      if (meta) text(slide, meta, { x: M, y: H - 0.8, w: W * 0.58, h: 0.3, fontSize: 11, color: on(t.accent) });
      return;
    }
    if (t.cover === "band") {
      slide.addShape(shape("rect"), { x: 0, y: 0, w: W, h: H * 0.56, fill: fill(t.accent), line: { color: t.accent } });
      art(slide, slot, { x: W * 0.62, y: 0, w: W * 0.38, h: H * 0.56 }, t.art, tinted(t.accent));
      if (big) text(slide, big, { x: M, y: 0.45, w: 3, h: 1.1, fontFace: t.head, fontSize: 60, color: on(t.accent), bold: true, valign: "top" });
      if (kicker) text(slide, kicker.toUpperCase(), { x: M, y: big ? 1.6 : 0.7, w: W * 0.55, h: 0.35, fontSize: 13, color: on(t.accent), bold: true, charSpacing: 2 });
      // Under the section number and kicker, never behind them.
      const ty = big ? 2.05 : kicker ? 1.15 : 0.7;
      text(slide, title, { x: M, y: ty, w: W * 0.56, h: H * 0.56 - ty - 0.3, ...head, fontSize: titleSize(W * 0.56, H * 0.56 - ty - 0.3, 44), color: on(t.accent), valign: "bottom" });
      if (subtitle) text(slide, subtitle, { x: M, y: H * 0.56 + 0.4, w: W - 2 * M, h: 1.0, fontSize: 20, color: t.text });
      if (meta) text(slide, meta, { x: M, y: H - 1.0, w: W - 2 * M, h: 0.35, fontSize: 12, color: t.muted });
      return;
    }
    if (t.cover === "panel") {
      slide.addShape(shape("rect"), { x: 0, y: 0, w: W * 0.36, h: H, fill: fill(t.accent), line: { color: t.accent } });
      art(slide, slot, { x: 0, y: big ? H * 0.42 : 0, w: W * 0.36, h: big ? H * 0.58 : H }, t.art, tinted(t.accent));
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
        art(slide, slot, { x: 0, y: 0, w: W, h: H });
        slide.addShape(shape("rect"), { x: 0.4, y: 0.4, w: W - 0.8, h: H - 0.8, fill: { color: t.bg, transparency: 100 }, line: { color: t.accent, width: 1 } });
        slide.addShape(shape("rect"), { x: M + 0.9, y: 1.6, w: W - 2 * M - 1.8, h: H - 3.0, fill: fill(t.bg), line: { color: t.bg } });
        slide.addShape(shape("line"), { x: W / 2 - 0.6, y: 4.62, w: 1.2, h: 0, line: { color: t.accent, width: 1.25 } });
      } else {
        art(slide, slot, { x: 0, y: 0, w: W, h: H });
        panel(slide, { x: M + 0.6, y: 1.1, w: W - 2 * M - 1.2, h: H - 2.2 }, t.surface);
        accents.forEach((c, i) => slide.addShape(shape("ellipse"), { x: W / 2 - 0.55 + i * 0.4, y: 1.45, w: 0.26, h: 0.26, fill: fill(c), line: { color: c } }));
      }
      const tag = [big, kicker].filter(Boolean).join("  ·  ");
      if (tag) text(slide, tag.toUpperCase(), { x: M + 1, y: 1.95, w: W - 2 * M - 2, h: 0.4, fontSize: big && !kicker ? 20 : 13, color: t.accent, bold: true, charSpacing: 3, align: "center" });
      text(slide, title, { x: M + 1.2, y: 2.35, w: W - 2 * M - 2.4, h: 2.15, ...head, fontSize: titleSize(W - 2 * M - 2.4, 2.15, 46), color: t.text, align: "center", valign: "middle" });
      if (subtitle) text(slide, subtitle, { x: M + 1.2, y: 4.8, w: W - 2 * M - 2.4, h: 0.9, fontSize: 18, color: t.muted, align: "center" });
      if (meta) text(slide, meta, { x: M + 1.2, y: H - 1.75, w: W - 2 * M - 2.4, h: 0.3, fontSize: 11, color: t.muted, align: "center" });
      return;
    }
    // left: the title block on the left, the deck's art on the right.
    const withArt = t.art !== "none";
    if (withArt) art(slide, slot, { x: W * 0.64, y: 0, w: W * 0.36, h: H });
    else {
      if (t.decor === "bar") slide.addShape(shape("ellipse"), { x: W - 4.4, y: -1.2, w: 6, h: 6, fill: { color: t.bg, transparency: 100 }, line: { color: t.accent, width: 1.5, transparency: 40 } });
      if (t.decor === "corner") slide.addShape(shape("ellipse"), { x: W - 3.2, y: H - 3, w: 5, h: 5, fill: fill(t.accent, 20), line: { color: t.accent, transparency: 100 } });
    }
    const tw = withArt ? W * 0.56 : W * 0.72;
    // The block (number, kicker, title, subtitle) is stacked from its measured height and centred on the slide.
    const size = titleSize(tw, 2.6, t.decor === "none" ? 58 : 52);
    const titleH = Math.min(2.6, textHeight([title], tw, size, { line: 1.1, width: headW }) + 0.15);
    const blockH = (big ? 1.25 : 0) + (kicker ? 0.5 : 0) + 0.25 + titleH + (subtitle ? 1.1 : 0);
    let y = Math.max(0.7, (H - blockH) / 2 - 0.2);
    if (big) { text(slide, big, { x: M, y, w: 3, h: 1.2, fontFace: t.head, fontSize: 66, color: t.accent, bold: t.headBold, valign: "top" }); y += 1.25; }
    if (kicker) { text(slide, kicker.toUpperCase(), { x: M, y, w: tw, h: 0.35, fontSize: 14, color: t.accent, bold: true, charSpacing: 2 }); y += 0.5; }
    if (t.decor === "rule") slide.addShape(shape("line"), { x: M, y: y - 0.05, w: 1.6, h: 0, line: { color: t.text, width: 1.5 } });
    y += 0.25;
    text(slide, title, { x: M, y, w: tw, h: titleH, ...head, fontSize: size, color: t.text, valign: "top" });
    y += titleH;
    if (subtitle) text(slide, subtitle, { x: M, y: y + 0.15, w: tw * 0.95, h: 0.9, fontSize: 22, color: t.muted, valign: "top" });
    if (meta) text(slide, meta, { x: M, y: H - 0.9, w: tw, h: 0.3, fontSize: 12, color: t.muted });
  };
  /** A picture for an image-led slide, filling `box`: generated art, an illustration, a figure (on white) or an icon on art. */
  const pictureIn = async (slide: any, s: Slide, i: number, box: { x: number; y: number; w: number; h: number }) => {
    const p = s.image || {};
    const figure = figures.get(i);
    if (figure || p.svg) {
      const svg = figure || p.svg!;
      const size = svgSize(svg);
      slide.addShape(shape("rect"), { ...box, fill: fill(figure ? "FFFFFF" : t.surface), line: { color: figure ? "FFFFFF" : t.surface } });
      const shot = await memo(`svg:${i}:${svg.length}`, () => raster.svg(svg, { maxWidth: 1400, background: figure ? "#ffffff" : "transparent" }));
      const room = { w: box.w - 0.6, h: box.h - 0.6 }, scale = Math.min(room.w / (size.width / 96), room.h / (size.height / 96));
      const w = (size.width / 96) * scale, h = (size.height / 96) * scale;
      image(slide, shot, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }, s.caption || s.title || "Illustration");
      return;
    }
    art(slide, `image-${i}`, box, typeof p.art === "string" && p.art !== "none" ? (p.art as Art) : t.art === "none" ? "blocks" : t.art);
    if (p.icon) {
      const d = Math.min(box.w, box.h) * 0.42;
      slide.addShape(shape("ellipse"), { x: box.x + (box.w - d * 1.3) / 2, y: box.y + (box.h - d * 1.3) / 2, w: d * 1.3, h: d * 1.3, fill: fill(t.bg), line: { color: t.bg } });
      icon(slide, p.icon, 0, { x: box.x + (box.w - d) / 2, y: box.y + (box.h - d) / 2, w: d, h: d });
    }
  };

  const today = spec.date || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  let sectionNo = 0;
  for (const [i, s] of spec.slides.entries()) {
    const slide = recorded(pptx.addSlide(), i, adjust, records);
    const n = i + 1;
    // Set when a layout writes the speaker notes itself.
    let noted = false;
    const content = () => { decorate(slide, "content"); return heading(slide, s.title || "", s.kicker); };
    const area = (top: number) => ({ x: (t.decor === "block" ? M + 0.15 : M), y: top, w: W - 2 * M - (t.decor === "block" ? 0.15 : 0), h: H - top - 0.75 });
    switch (s.layout) {
      case "title":
        cover(slide, "cover", s.title || spec.title, s.subtitle ?? spec.subtitle, s.kicker, [spec.author, today].filter(Boolean).join("  ·  "));
        break;
      case "closing":
        cover(slide, "closing", s.title || "Thank you", s.subtitle, s.kicker, s.text || [spec.author].filter(Boolean).join(""));
        break;
      case "section": {
        section = s.title || "";
        cover(slide, `section-${sectionNo + 1}`, s.title || "", s.subtitle, s.kicker, undefined, String(s.number ?? ++sectionNo).padStart(2, "0"));
        number(slide, n);
        break;
      }
      case "agenda": {
        const top = content(), box = area(top), items = (s.items || []).map((x) => (typeof x === "string" ? x : x.title));
        const cols = items.length > 5 ? 2 : 1, per = Math.ceil(items.length / cols), rowH = Math.min(0.85, box.h / per);
        items.forEach((item, k) => {
          const col = Math.floor(k / per), row = k % per, x = box.x + col * (box.w / cols), y = box.y + row * rowH;
          text(slide, String(k + 1).padStart(2, "0"), { x, y, w: 0.8, h: rowH, fontFace: t.head, fontSize: 28, color: t.accent, bold: true, valign: "middle" });
          text(slide, strip(item), { x: x + 0.85, y, w: box.w / cols - 1.1, h: rowH, fontSize: fitSize([item], box.w / cols - 1.1, rowH, 26, 14, { width: bodyW }), valign: "middle" });
          slide.addShape(shape("line"), { x: x + 0.85, y: y + rowH - 0.04, w: box.w / cols - 1.2, h: 0, line: { color: t.dark ? t.surface : mix(t.bg, t.text, 0.15), width: 0.75 } });
        });
        number(slide, n);
        break;
      }
      case "statement": {
        // One sentence the audience should remember, large, with room around it.
        decorate(slide, "content");
        const words = strip(s.statement ?? s.title ?? ""), x = M + 0.55, w = W - 2 * M - 1.4;
        slide.addShape(shape("rect"), { x: M, y: 1.55, w: 0.12, h: 2.9, fill: fill(t.accent), line: { color: t.accent } });
        if (s.kicker) text(slide, s.kicker.toUpperCase(), { x, y: 1.0, w, h: 0.35, fontSize: 13, color: t.accent, bold: true, charSpacing: 2 });
        text(slide, words, { x, y: 1.45, w, h: 3.1, ...head, fontSize: fitSize([words], w, 3.1, Math.round(50 * t.scale), 24, { width: headW, line: 1.12 }), color: t.text, valign: "middle", lineSpacingMultiple: 0.95 });
        if (s.text) text(slide, runs(s.text), { x, y: 4.85, w: w * 0.85, h: 1.4, fontSize: fitSize([strip(s.text)], w * 0.85, 1.4, 22, 13, { width: bodyW }), color: t.muted });
        number(slide, n);
        break;
      }
      case "bullets": {
        const top = content(), box = area(top);
        if (s.takeaway) {
          bulletList(slide, s.bullets || [], { ...box, w: box.w * 0.62 });
          const tb = { x: box.x + box.w * 0.66, y: box.y, w: box.w * 0.34, h: Math.min(box.h, 3.2) }, ground = t.dark ? t.surface : t.accent;
          panel(slide, tb, ground);
          text(slide, strip(s.takeaway), { x: tb.x + 0.3, y: tb.y + 0.3, w: tb.w - 0.6, h: tb.h - 0.6, fontFace: t.head, fontSize: fitSize([s.takeaway], tb.w - 0.6, tb.h - 0.6, 24, 13, { width: headW }), color: t.dark ? t.accent : on(t.accent), valign: "middle" });
        } else bulletList(slide, s.bullets || [], box);
        number(slide, n);
        break;
      }
      case "text": {
        const top = content(), box = area(top), paragraphs = String(s.text).split(/\n{2,}/);
        const size = fitSize(paragraphs.map(strip), box.w * 0.82, box.h, 24, 12, { line: 1.35, gap: 0.6, width: bodyW });
        text(slide, paragraphs.flatMap((p, k) => runs(p.replace(/\n/g, " ")).map((r, j, all) => ({ text: r.text, options: { ...r.options, ...(j === all.length - 1 && k < paragraphs.length - 1 ? { breakLine: true } : {}), paraSpaceAfter: size * 0.6 } }))), { ...box, w: box.w * 0.82, fontSize: size, lineSpacingMultiple: 1.2 });
        number(slide, n);
        break;
      }
      case "two-column": {
        const top = content(), box = area(top), gap = 0.5, w = (box.w - gap) / 2;
        for (const [k, side] of [s.left!, s.right!].entries()) sideBlock(slide, side, { x: box.x + k * (w + gap), y: box.y, w, h: box.h }, k ? t.accent2 : t.accent);
        slide.addShape(shape("line"), { x: box.x + w + gap / 2, y: box.y, w: 0, h: box.h, line: { color: t.dark ? t.surface : mix(t.bg, t.text, 0.15), width: 0.75 } });
        number(slide, n);
        break;
      }
      case "before-after": {
        // The old state muted on the left, the new one in the accent on the right, an arrow between them.
        const top = content(), box = area(top), arrow = 0.9, w = (box.w - arrow) / 2;
        const after = mix(t.accent, t.bg, t.dark ? 0.7 : 0.86);
        const sides: [Side, number, string, string, boolean][] = [[s.before!, box.x, t.surface, t.muted, false], [s.after!, box.x + w + arrow, after, t.accent, true]];
        for (const [side, x, ground, tone, isAfter] of sides) {
          panel(slide, { x, y: box.y, w, h: box.h }, ground, isAfter ? t.accent : undefined);
          if (side.icon) icon(slide, side.icon, isAfter ? 0 : 2, { x: x + 0.35, y: box.y + 0.35, w: 0.7, h: 0.7 });
          sideBlock(slide, { ...side, heading: side.heading || (isAfter ? "After" : "Before") }, { x: x + 0.35 + (side.icon ? 0.9 : 0), y: box.y + 0.35, w: w - 0.7 - (side.icon ? 0.9 : 0), h: box.h - 0.6 }, tone, contrast(t.text, ground) >= 4.5 ? t.text : on(ground));
        }
        slide.addShape(shape("rightArrow"), { x: box.x + w + 0.12, y: box.y + box.h / 2 - 0.35, w: arrow - 0.24, h: 0.7, fill: fill(t.accent), line: { color: t.accent } });
        number(slide, n);
        break;
      }
      case "comparison": {
        const top = content(), box = area(top), cols = s.columns!, gap = 0.3, w = (box.w - gap * (cols.length - 1)) / cols.length;
        const colors = [t.accent, t.accent2, t.accent3, t.muted];
        // One type size for every column, and panels only as tall as the longest column needs.
        const size = Math.min(...cols.map((c) => fitSize(c.points.map(strip), w - 0.75, box.h - 1.1, 24, 13, { line: 1.25, gap: 0.6, width: bodyW })));
        const h = Math.min(box.h, Math.max(2.6, 1.25 + Math.max(...cols.map((c) => textHeight(c.points.map(strip), w - 0.75, size, { line: 1.25, gap: 0.6, width: bodyW })))));
        cols.forEach((c, k) => {
          const x = box.x + k * (w + gap);
          panel(slide, { x, y: box.y, w, h }, t.surface);
          slide.addShape(shape("rect"), { x, y: box.y, w, h: 0.7, fill: fill(colors[k]), line: { color: colors[k] } });
          text(slide, strip(c.heading), { x: x + 0.25, y: box.y, w: w - 0.5, h: 0.7, ...head, fontSize: fitSize([c.heading], w - 0.5, 0.6, 22, 13, { width: headW }), color: on(colors[k]), valign: "middle" });
          bulletList(slide, c.points, { x: x + 0.25, y: box.y + 0.9, w: w - 0.5, h: h - 1.05 }, size);
        });
        number(slide, n);
        break;
      }
      case "cards": {
        const top = content(), box = area(top), items = (s.items || []).map((x) => (typeof x === "string" ? { title: x, text: "" } : x));
        const cols = items.length <= 3 ? items.length : items.length === 4 ? 2 : items.length <= 6 ? 3 : 4, rows = Math.ceil(items.length / cols), gap = 0.3;
        const w = (box.w - gap * (cols - 1)) / cols;
        const textSize = fitEach(items.map((x) => strip(x.text || "")), w - 0.5, (box.h - gap * (rows - 1)) / rows - 1.5, 20, 12, { line: 1.25, width: bodyW });
        // Cards are as tall as their text needs (with room to breathe), not stretched to the bottom of the slide.
        const need = 1.65 + Math.max(0, ...items.map((x) => (x.text ? textHeight([strip(x.text)], w - 0.5, textSize, { line: 1.25, width: bodyW }) : 0)));
        const h = Math.min((box.h - gap * (rows - 1)) / rows, Math.max(rows > 1 ? 1.9 : 2.6, need));
        items.forEach((item, k) => {
          const x = box.x + (k % cols) * (w + gap), y = box.y + Math.floor(k / cols) * (h + gap), color = readable(accents[k % 3], t.surface, 3);
          panel(slide, { x, y, w, h }, t.surface);
          if (item.icon) icon(slide, item.icon, k, { x: x + 0.25, y: y + 0.22, w: 0.55, h: 0.55 });
          else if (t.rounded) { slide.addShape(shape("ellipse"), { x: x + 0.25, y: y + 0.25, w: 0.5, h: 0.5, fill: fill(color), line: { color } }); text(slide, String(k + 1), { x: x + 0.25, y: y + 0.25, w: 0.5, h: 0.5, fontSize: 15, bold: true, color: on(color), align: "center", valign: "middle" }); }
          else { slide.addShape(shape("rect"), { x, y, w, h: 0.07, fill: fill(color), line: { color } }); text(slide, String(k + 1).padStart(2, "0"), { x: x + 0.25, y: y + 0.25, w: 1, h: 0.5, fontFace: t.head, fontSize: 18, bold: true, color }); }
          text(slide, strip(item.title), { x: x + 0.25, y: y + 0.85, w: w - 0.5, h: 0.55, ...head, fontSize: fitSize([item.title], w - 0.5, 0.55, 22, 13, { line: 1.05, width: headW }) });
          if (item.text) text(slide, runs(item.text, { color: t.muted }), { x: x + 0.25, y: y + 1.45, w: w - 0.5, h: Math.max(0.3, h - 1.6), fontSize: textSize, lineSpacingMultiple: 1.1 });
        });
        number(slide, n);
        break;
      }
      case "icons": {
        // Parallel ideas, each with an icon: no panels, just air, so it reads differently from cards.
        const top = content(), box = area(top), items = (s.items || []).map((x) => (typeof x === "string" ? { title: x } : x)) as { title: string; text?: string; icon?: string }[];
        const cols = items.length <= 4 ? items.length : items.length <= 6 ? 3 : 4, rows = Math.ceil(items.length / cols), gap = 0.4;
        const worded = items.some((x) => x.text);
        const w = (box.w - gap * (cols - 1)) / cols, d = Math.min(worded ? 1.0 : 1.5, ((box.h - 0.2 * (rows - 1)) / rows) * 0.4, w * 0.45);
        const titleSize = fitEach(items.map((x) => strip(x.title)), w, 0.6, worded ? 22 : 26, 13, { width: headW });
        const textSize = fitEach(items.map((x) => strip(x.text || "")), w, (box.h - 0.2 * (rows - 1)) / rows - d - 1.0, 18, 11, { line: 1.25, width: bodyW });
        // Each row is as tall as its content, and the rows sit in the optical middle of the content area.
        const textH = worded ? Math.max(0, ...items.map((x) => (x.text ? textHeight([strip(x.text)], w, textSize, { line: 1.25, width: bodyW }) : 0))) : 0;
        const h = Math.min((box.h - 0.2 * (rows - 1)) / rows, d + 0.85 + textH + 0.1), offset = Math.max(0, (box.h - rows * h - 0.2 * (rows - 1)) * 0.4);
        const centred = rows === 1;
        items.forEach((item, k) => {
          const x = box.x + (k % cols) * (w + gap), y = box.y + offset + Math.floor(k / cols) * (h + 0.2);
          icon(slide, item.icon || "star", k, { x: centred ? x + (w - d) / 2 : x, y, w: d, h: d });
          text(slide, strip(item.title), { x, y: y + d + 0.2, w, h: 0.6, ...head, fontSize: titleSize, align: centred ? "center" : "left", valign: "top" });
          if (item.text) text(slide, runs(item.text, { color: t.muted }), { x, y: y + d + 0.85, w, h: Math.max(0.4, h - d - 0.95), fontSize: textSize, align: centred ? "center" : "left", lineSpacingMultiple: 1.1 });
        });
        number(slide, n);
        break;
      }
      case "stats": {
        const top = content(), box = area(top), stats = s.stats!, gap = 0.35, w = (box.w - gap * (stats.length - 1)) / stats.length;
        const h = Math.min(s.takeaway ? box.h - 1.1 : box.h, 3.9);
        const lift = stats.some((x) => x.icon) ? 0.75 : 0;
        const valueSize = oneLine(stats.map((x) => String(x.value)), w - 0.5, 66, 24, headW + 0.12);
        stats.forEach((x, k) => {
          const left = box.x + k * (w + gap), color = readable([t.accent, t.accent2, t.accent3, t.text][k % 4], t.surface, 3);
          panel(slide, { x: left, y: box.y, w, h }, t.surface);
          if (x.icon) icon(slide, x.icon, k, { x: left + 0.25, y: box.y + 0.25, w: 0.6, h: 0.6 });
          text(slide, String(x.value), { x: left + 0.25, y: box.y + 0.35 + lift, w: w - 0.5, h: 1.5 - lift * 0.4, fontFace: t.head, fontSize: Math.round(valueSize * (lift ? 0.85 : 1)), bold: true, color, valign: "middle" });
          text(slide, strip(x.label), { x: left + 0.25, y: box.y + 1.95 + lift * 0.6, w: w - 0.5, h: 0.8, fontSize: fitEach(stats.map((v) => v.label), w - 0.5, 0.8, 22, 12, { width: bodyW }), bold: true });
          if (x.detail) text(slide, strip(x.detail), { x: left + 0.25, y: box.y + 2.8 + lift * 0.6, w: w - 0.5, h: h - 2.95 - lift * 0.6, fontSize: fitEach(stats.map((v) => v.detail || ""), w - 0.5, h - 2.95 - lift * 0.6, 18, 11, { width: bodyW }), color: t.muted });
        });
        if (s.takeaway) text(slide, runs(s.takeaway), { x: box.x, y: box.y + h + 0.3, w: box.w, h: 0.8, fontFace: t.head, fontSize: fitSize([strip(s.takeaway)], box.w, 0.8, 24, 13, { width: headW }), color: t.text, valign: "middle" });
        number(slide, n);
        break;
      }
      case "big-number": {
        // One figure the size of the slide, with what it means beside it.
        const top = s.title ? content() : (decorate(slide, "content"), 0.9), box = area(top);
        const value = String(s.value), vw = box.w * 0.56;
        const size = Math.min(Math.round(170 * t.scale), oneLine([value], vw, 200, 60, headW + 0.1), Math.floor(box.h * 72 * 0.62));
        text(slide, value, { x: box.x, y: box.y, w: vw, h: box.h, fontFace: t.head, fontSize: size, bold: true, color: t.accent, valign: "middle" });
        const x = box.x + vw + 0.3, w = box.w - vw - 0.3;
        slide.addShape(shape("rect"), { x, y: box.y + box.h * 0.2, w: 0.06, h: box.h * 0.6, fill: fill(t.accent2), line: { color: t.accent2 } });
        if (s.label) text(slide, strip(s.label), { x: x + 0.35, y: box.y + box.h * 0.2, w: w - 0.35, h: 1.4, ...head, fontSize: fitSize([s.label], w - 0.35, 1.4, 30, 16, { width: headW }), color: t.text, valign: "bottom" });
        if (s.text) text(slide, runs(s.text), { x: x + 0.35, y: box.y + box.h * 0.2 + 1.55, w: w - 0.35, h: box.h * 0.6 - 1.55, fontSize: fitSize([strip(s.text)], w - 0.35, box.h * 0.6 - 1.55, 20, 12, { width: bodyW }), color: t.muted });
        if (s.source) text(slide, "Source: " + s.source, { x: box.x, y: H - 0.72, w: box.w * 0.7, h: 0.25, fontSize: 9, color: t.muted, italic: true });
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
          // Horizontal bars read top to bottom in the order given (PowerPoint draws the first category at the bottom).
          ...(c.type === "bar" ? { catAxisOrientation: "maxMin", valAxisCrossesAt: "max" } : {}),
          // One series is one colour: bars in different colours would suggest the categories differ in kind.
          chartColors: round ? c.labels.map((_, k) => chartColors[k % chartColors.length]) : c.series.length === 1 ? [t.accent] : chartColors,
          showLegend: round || c.series.length > 1, legendPos: round ? "r" : "b", legendFontFace: t.body, legendFontSize: 14, legendColor: t.text,
          catAxisLabelColor: t.muted, valAxisLabelColor: t.muted, catAxisLabelFontFace: t.body, valAxisLabelFontFace: t.body, catAxisLabelFontSize: 14, valAxisLabelFontSize: 12,
          valGridLine: { color: t.dark ? t.surface : mix(t.bg, t.text, 0.1), size: 0.75 }, catGridLine: { style: "none" }, catAxisLineShow: !round, valAxisLineShow: false,
          showValue: round || (c.series.length === 1 && c.labels.length <= 8 && kind === "bar"), dataLabelColor: round ? "FFFFFF" : t.text, dataLabelFontSize: 13, dataLabelFontFace: t.body,
          showPercent: round, showTitle: false, lineSize: 2.5, lineDataSymbolSize: 7,
          ...(c.unit ? { valAxisTitle: c.unit, showValAxisTitle: true, valAxisTitleColor: t.muted, valAxisTitleFontSize: 11 } : {}),
          holeSize: 55,
        });
        if (s.takeaway) {
          const x = box.x + box.w - side;
          panel(slide, { x, y: box.y, w: side, h: box.h }, t.surface);
          slide.addShape(shape("rect"), { x, y: box.y, w: 0.07, h: box.h, fill: fill(t.accent), line: { color: t.accent } });
          text(slide, runs(s.takeaway), { x: x + 0.3, y: box.y + 0.3, w: side - 0.5, h: box.h - 0.6, fontFace: t.head, fontSize: fitSize([strip(s.takeaway)], side - 0.5, box.h - 0.6, 26, 13, { line: 1.25, width: headW }), valign: "middle" });
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
          Array.from({ length: cols }, (_, j) => ({ text: strip(String(tb.header[j] ?? "")), options: { bold: true, color: on(t.accent), fill: { color: t.accent }, fontFace: t.head } })),
          ...tb.rows.map((r, k) => Array.from({ length: cols }, (_, j) => ({ text: strip(String(r[j] ?? "")), options: { color: t.text, fill: { color: k % 2 ? t.bg : t.surface }, align: numeric(r[j]) ? "right" : "left" } }))),
        ];
        const sum = widest.reduce((a, b) => a + Math.max(4, b), 0);
        slide.addTable(rows as any, { x: box.x, y: box.y, w: box.w, colW: widest.map((c) => (box.w * Math.max(4, c)) / sum), rowH, fontFace: t.body, fontSize: size, border: { type: "solid", pt: 0.5, color: t.dark ? t.bg : "FFFFFF" }, valign: "middle", margin: 0.08, autoPage: false });
        if (s.takeaway) text(slide, runs(s.takeaway), { x: box.x, y: box.y + rowH * (tb.rows.length + 1) + 0.35, w: box.w, h: 0.8, fontFace: t.head, fontSize: fitSize([strip(s.takeaway)], box.w, 0.8, 24, 12, { width: headW }), valign: "middle" });
        number(slide, n);
        break;
      }
      case "figure": {
        const top = s.title ? content() : (decorate(slide, "content"), 0.6), box = area(top);
        const svg = figures.get(i)!;
        const shot = await memo(`figure:${i}:${svg.length}`, () => raster.svg(svg, { maxWidth: 1400 }));
        const side = s.bullets?.length ? box.w * 0.34 : 0;
        // The figure fills its area (white card included); the caption sits under the card.
        const room = { w: box.w - side - (side ? 0.45 : 0) - 0.3, h: box.h - (s.caption ? 0.55 : 0) - 0.3 };
        const scale = Math.min(room.w / (shot.width / 96), room.h / (shot.height / 96)), w = (shot.width / 96) * scale, h = (shot.height / 96) * scale;
        const x = box.x + 0.15 + (room.w - w) / 2, y = box.y + 0.15;
        // Kinetra draws for white paper, so anything but a white slide frames the figure on a white card.
        if (luminance(t.bg) < 0.9) panel(slide, { x: x - 0.15, y: y - 0.15, w: w + 0.3, h: h + 0.3 }, "FFFFFF");
        image(slide, shot, { x, y, w, h }, s.caption || s.title || "Figure");
        if (s.caption) text(slide, runs(s.caption, { color: t.muted }), { x: x - 0.15, y: y + h + 0.25, w: w + 0.3, h: 0.4, fontSize: 14, align: "center", italic: true });
        if (side) bulletList(slide, s.bullets!, { x: box.x + box.w - side, y: box.y + 0.15, w: side, h: box.h - 0.3 }, 24);
        number(slide, n);
        break;
      }
      case "image": {
        // Picture-led: the picture takes half the slide edge to edge (or all of it), the words the other half.
        decorate(slide, "content");
        const where = s.side || (i % 2 ? "left" : "right");
        if (where === "full") {
          await pictureIn(slide, s, i, { x: 0, y: 0, w: W, h: H });
          const pw = W * 0.5, ph = 2.6;
          slide.addShape(shape("rect"), { x: M, y: H - ph - 0.6, w: pw, h: ph, fill: fill(t.bg, 6), line: { color: t.bg } });
          if (s.kicker) text(slide, s.kicker.toUpperCase(), { x: M + 0.35, y: H - ph - 0.35, w: pw - 0.7, h: 0.3, fontSize: 12, color: t.accent, bold: true, charSpacing: 2 });
          text(slide, strip(s.title || ""), { x: M + 0.35, y: H - ph - 0.05, w: pw - 0.7, h: 1.2, ...head, fontSize: fitSize([strip(s.title || "")], pw - 0.7, 1.2, Math.round(34 * t.scale), 18, { width: headW, line: 1.1 }), color: t.text, valign: "middle" });
          const body = s.text || (s.bullets || []).map((b) => (typeof b === "string" ? b : b.text)).join(" · ");
          if (body) text(slide, runs(body), { x: M + 0.35, y: H - ph + 1.2, w: pw - 0.7, h: ph - 1.45, fontSize: fitSize([strip(body)], pw - 0.7, ph - 1.45, 18, 11, { width: bodyW }), color: t.muted });
        } else {
          const half = W * 0.46, px = where === "left" ? 0 : W - half;
          await pictureIn(slide, s, i, { x: px, y: 0, w: half, h: H });
          const x = where === "left" ? half + M * 0.9 : M, w = W - half - M * 1.9;
          let y = 1.0;
          if (s.kicker) { text(slide, s.kicker.toUpperCase(), { x, y, w, h: 0.32, fontSize: 12, color: t.accent, bold: true, charSpacing: 2 }); y += 0.42; }
          const ts = fitSize([strip(s.title || "")], w, 1.7, Math.round(36 * t.scale), 20, { width: headW, line: 1.1 });
          const th = Math.min(1.7, textHeight([strip(s.title || "")], w, ts, { width: headW, line: 1.1 }) + 0.1);
          if (s.title) { text(slide, strip(s.title), { x, y, w, h: th, ...head, fontSize: ts, color: t.text }); y += th + 0.3; }
          if (s.bullets?.length) bulletList(slide, s.bullets, { x, y, w, h: H - y - 0.9 }, 24);
          else if (s.text) text(slide, runs(s.text), { x, y, w, h: H - y - 0.9, fontSize: fitSize([strip(s.text)], w, H - y - 0.9, 22, 12, { line: 1.3, width: bodyW }), lineSpacingMultiple: 1.15 });
          if (s.caption) text(slide, runs(s.caption, { color: t.muted }), { x, y: H - 0.85, w, h: 0.35, fontSize: 12, italic: true });
        }
        number(slide, n);
        break;
      }
      case "diagram": {
        const top = content(), box = area(top), d = s.diagram!;
        const items = d.items.map((x) => (typeof x === "string" ? { title: x, text: "" } : { title: x.title, text: x.text || "" }));
        const described = items.some((x) => x.text);
        // Shapes on the left, what each part means on the right (when the parts have descriptions).
        const gw = described ? box.w * 0.52 : box.w, g = { x: box.x, y: box.y, w: gw, h: box.h };
        const legend = { x: box.x + gw + 0.4, y: box.y, w: box.w - gw - 0.4, h: box.h };
        const labelIn = (x: number, y: number, w: number, h: number, words: string, fillColor: string, max = 20) => text(slide, strip(words), { x: x + 0.08, y, w: w - 0.16, h, ...head, fontSize: fitSize([strip(words)], w - 0.16, h, max, 10, { width: headW, line: 1.05 }), color: on(fillColor), align: "center", valign: "middle" });
        const k3 = (k: number) => accents[k % 3];
        if (d.type === "cycle" || d.type === "hub") {
          const cx = g.x + g.w / 2, cy = g.y + g.h / 2, R = Math.min(g.w, g.h) / 2 - (described ? 0.65 : 0.85), r = Math.min(described ? 0.75 : 0.95, (Math.PI * R) / items.length * 0.55);
          if (d.type === "cycle") slide.addShape(shape("ellipse"), { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R, fill: { color: t.bg, transparency: 100 }, line: { color: t.muted, width: 1.5, dashType: "dash" } });
          if (d.type === "hub") {
            const hr = Math.min(1.0, R * 0.42);
            items.forEach((_, k) => { const a = -Math.PI / 2 + (k / items.length) * Math.PI * 2; slide.addShape(shape("line"), { x: Math.min(cx, cx + Math.cos(a) * R), y: Math.min(cy, cy + Math.sin(a) * R), w: Math.abs(Math.cos(a) * R), h: Math.abs(Math.sin(a) * R), line: { color: t.muted, width: 1.5 }, flipH: Math.cos(a) < 0 !== Math.sin(a) < 0 }); });
            slide.addShape(shape("ellipse"), { x: cx - hr, y: cy - hr, w: 2 * hr, h: 2 * hr, fill: fill(t.text), line: { color: t.bg, width: 2 } });
            labelIn(cx - hr, cy - hr, 2 * hr, 2 * hr, d.center || s.title || "", t.text, 18);
          } else if (d.center) text(slide, strip(d.center), { x: cx - R * 0.6, y: cy - 0.5, w: R * 1.2, h: 1.0, ...head, fontSize: fitSize([strip(d.center)], R * 1.2, 1.0, 22, 12, { width: headW }), color: t.text, align: "center", valign: "middle" });
          items.forEach((item, k) => {
            const a = -Math.PI / 2 + (k / items.length) * Math.PI * 2, x = cx + Math.cos(a) * R - r, y = cy + Math.sin(a) * R - r;
            slide.addShape(shape("ellipse"), { x, y, w: 2 * r, h: 2 * r, fill: fill(k3(k)), line: { color: t.bg, width: 2.5 } });
            labelIn(x, y, 2 * r, 2 * r, described ? String(k + 1) : item.title, k3(k), described ? 24 : 16);
          });
        } else if (d.type === "pyramid" || d.type === "funnel") {
          const rowH = Math.min(1.05, (g.h - 0.1 * (items.length - 1)) / items.length), top0 = g.y + (g.h - (rowH + 0.1) * items.length) / 2;
          items.forEach((item, k) => {
            // A pyramid widens downwards; a funnel narrows.
            const step = d.type === "pyramid" ? k : items.length - 1 - k, w = g.w * (0.25 + (0.75 * (step + 1)) / items.length);
            const x = g.x + (g.w - w) / 2, y = top0 + k * (rowH + 0.1);
            slide.addShape(shape("trapezoid"), { x, y, w, h: rowH, fill: fill(k3(k)), line: { color: t.bg, width: 1 }, flipV: d.type === "funnel" });
            labelIn(x + w * 0.15, y, w * 0.7, rowH, described ? String(k + 1) + "  " + item.title : item.title, k3(k), 18);
          });
        } else if (d.type === "venn") {
          const n3 = items.length === 3, rr = Math.min(g.h * (n3 ? 0.33 : 0.42), g.w * (n3 ? 0.3 : 0.32));
          const centres = n3 ? [[-0.55, -0.35], [0.55, -0.35], [0, 0.55]] : [[-0.55, 0], [0.55, 0]];
          items.forEach((item, k) => {
            const cx = g.x + g.w / 2 + centres[k][0] * rr, cy = g.y + g.h / 2 + centres[k][1] * rr;
            slide.addShape(shape("ellipse"), { x: cx - rr, y: cy - rr, w: 2 * rr, h: 2 * rr, fill: fill(k3(k), 45), line: { color: k3(k), width: 1.5 } });
            const lx = cx + centres[k][0] * rr * 0.55 - rr * 0.6, ly = cy + centres[k][1] * rr * 0.55 - 0.4;
            text(slide, strip(item.title), { x: lx, y: ly, w: rr * 1.2, h: 0.8, ...head, fontSize: fitSize([strip(item.title)], rr * 1.2, 0.8, 20, 11, { width: headW }), color: t.text, align: "center", valign: "middle" });
          });
          if (d.center) text(slide, strip(d.center), { x: g.x + g.w / 2 - rr * 0.45, y: g.y + g.h / 2 - (n3 ? 0.1 : 0.35), w: rr * 0.9, h: 0.7, ...head, fontSize: fitSize([strip(d.center)], rr * 0.9, 0.7, 16, 10, { width: headW }), color: t.text, align: "center", valign: "middle", bold: true });
        } else {
          // layers: a stack, foundation at the bottom.
          const rowH = Math.min(1.0, (g.h - 0.12 * (items.length - 1)) / items.length), top0 = g.y + (g.h - (rowH + 0.12) * items.length) / 2;
          items.forEach((item, k) => {
            const y = top0 + k * (rowH + 0.12), c = k3(items.length - 1 - k);
            slide.addShape(shape("roundRect"), { x: g.x, y, w: g.w, h: rowH, fill: fill(c), line: { color: c }, rectRadius: 0.1 });
            labelIn(g.x, y, g.w, rowH, described ? String(k + 1) + "  " + item.title : item.title, c, 20);
          });
        }
        if (described) {
          const rowH = legend.h / items.length;
          const size = fitEach(items.map((x) => strip(x.text)), legend.w - 0.7, rowH - 0.55, 18, 11, { width: bodyW });
          items.forEach((item, k) => {
            const y = legend.y + k * rowH;
            slide.addShape(shape("ellipse"), { x: legend.x, y: y + 0.05, w: 0.42, h: 0.42, fill: fill(k3(k)), line: { color: k3(k) } });
            text(slide, String(k + 1), { x: legend.x, y: y + 0.05, w: 0.42, h: 0.42, fontSize: 13, bold: true, color: on(k3(k)), align: "center", valign: "middle" });
            text(slide, strip(item.title), { x: legend.x + 0.6, y, w: legend.w - 0.6, h: 0.45, ...head, fontSize: fitSize([strip(item.title)], legend.w - 0.6, 0.45, 20, 12, { width: headW }), valign: "middle" });
            if (item.text) text(slide, runs(item.text, { color: t.muted }), { x: legend.x + 0.6, y: y + 0.48, w: legend.w - 0.6, h: rowH - 0.55, fontSize: size });
          });
        }
        number(slide, n);
        break;
      }
      case "equation": {
        const top = s.title ? content() : (decorate(slide, "content"), 0.6), box = area(top);
        const shot = await memo(`math:${s.math}:${t.text}`, () => raster.math(latexMathml(s.math!, true), { color: "#" + t.text, size: 40 }));
        const below = s.bullets?.length || s.text ? 2.2 : 0;
        const scale = Math.min((box.w * 0.9) / (shot.width / 96), (box.h - below) / (shot.height / 96), 1.6);
        const w = (shot.width / 96) * scale, h = (shot.height / 96) * scale;
        panel(slide, { x: box.x, y: box.y, w: box.w, h: box.h - below - 0.2 }, t.surface);
        image(slide, shot, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - below - 0.2 - h) / 2, w, h }, s.math!);
        if (s.bullets?.length) bulletList(slide, s.bullets, { x: box.x, y: box.y + box.h - below, w: box.w, h: below }, 24);
        else if (s.text) text(slide, runs(s.text), { x: box.x, y: box.y + box.h - below, w: box.w, h: below, fontSize: fitSize([strip(s.text)], box.w, below, 24, 13, { line: 1.3, width: bodyW }) });
        number(slide, n);
        break;
      }
      case "timeline": {
        const top = content(), box = area(top), steps = s.steps!, gap = box.w / steps.length;
        const textSize = fitEach(steps.map((x) => strip(x.text || "")), gap - 0.25, box.h - 2.4, 18, 11, { line: 1.25, width: bodyW });
        const titleSize = fitEach(steps.map((x) => strip(x.title || "")), gap - 0.2, 0.7, 20, 12, { width: bodyW });
        // The axis sits a third of the way down when the steps have little text, so the slide does not look top-heavy.
        const below = 0.45 + (steps.some((x) => x.title) ? 0.8 : 0) + Math.max(0, ...steps.map((x) => (x.text ? textHeight([strip(x.text)], gap - 0.25, textSize, { line: 1.25, width: bodyW }) : 0)));
        const axis = Math.max(box.y + 1.25, box.y + (box.h - below) * 0.42);
        slide.addShape(shape("line"), { x: box.x, y: axis, w: box.w, h: 0, line: { color: t.muted, width: 1.5 } });
        steps.forEach((step, k) => {
          const cx = box.x + gap * k + gap / 2, color = readable(accents[k % 3], t.bg, 4.5);
          text(slide, strip(step.label || ""), { x: cx - gap / 2 + 0.05, y: axis - 0.95, w: gap - 0.1, h: 0.7, fontFace: t.head, fontSize: oneLine(steps.map((x) => x.label || ""), gap - 0.2, 30, 13, headW + 0.1), bold: true, color, align: "center", valign: "bottom" });
          slide.addShape(shape("ellipse"), { x: cx - 0.19, y: axis - 0.19, w: 0.38, h: 0.38, fill: fill(color), line: { color: t.bg, width: 2 } });
          if (step.title) text(slide, strip(step.title), { x: cx - gap / 2 + 0.1, y: axis + 0.4, w: gap - 0.2, h: 0.7, fontSize: titleSize, bold: true, align: "center" });
          if (step.text) text(slide, runs(step.text, { color: t.muted }), { x: cx - gap / 2 + 0.1, y: axis + (step.title ? 1.15 : 0.45), w: gap - 0.2, h: Math.max(0.4, box.y + box.h - axis - 1.2), fontSize: textSize, align: "center" });
        });
        number(slide, n);
        break;
      }
      case "process": {
        const top = content(), box = area(top), steps = s.steps!, gap = 0.12, w = (box.w - gap * (steps.length - 1)) / steps.length;
        const textSize = fitEach(steps.map((x) => strip(x.text || "")), w - 0.3, box.h - 1.9, 20, 11, { line: 1.25, width: bodyW });
        const headSize = fitEach(steps.map((x) => strip(x.title || x.label || "")), w - 0.95, 1.0, 20, 11, { width: headW });
        // Steps sit a little below the title, with their notes under each arrow.
        const need = 1.25 + 0.3 + Math.max(0, ...steps.map((x) => (x.text ? textHeight([strip(x.text)], w - 0.3, textSize, { line: 1.25, width: bodyW }) : 0)));
        const y0 = box.y + Math.max(0, (box.h - need) * 0.3);
        steps.forEach((step, k) => {
          const x = box.x + k * (w + gap), color = k === steps.length - 1 ? t.accent2 : t.accent, tint = k === steps.length - 1 ? color : mix(color, t.bg, Math.min(0.45, k * 0.12));
          slide.addShape(k === 0 ? shape("homePlate") : shape("chevron"), { x, y: y0, w, h: 1.25, fill: fill(tint), line: { color: t.bg, width: 1 } });
          // Text starts after a chevron's notch (about a third of its height) and stops before its point.
          text(slide, strip(step.title || step.label || ""), { x: x + (k ? 0.55 : 0.25), y: y0, w: w - (k ? 0.95 : 0.7), h: 1.25, ...head, fontSize: headSize, color: on(tint), valign: "middle" });
          if (step.text) text(slide, runs(step.text), { x: x + 0.15, y: y0 + 1.5, w: w - 0.3, h: Math.max(0.4, box.y + box.h - y0 - 1.55), fontSize: textSize, color: t.text });
        });
        number(slide, n);
        break;
      }
      case "roadmap": {
        // Phases across the slide; what is done is solid, what is ahead is lighter, and "now" is marked.
        const top = content(), box = area(top), phases = s.phases!, gap = 0.1, w = (box.w - gap * (phases.length - 1)) / phases.length;
        const now = typeof s.now === "number" ? s.now : -1;
        const itemsOf = (p: (typeof phases)[number]) => (p.items?.length ? p.items : p.text ? [p.text] : []);
        const size = Math.min(...phases.map((p) => fitSize(itemsOf(p).map(strip), w - 0.45, box.h - 2.0, 18, 11, { line: 1.25, gap: 0.5, width: bodyW })));
        phases.forEach((p, k) => {
          const x = box.x + k * (w + gap), past = now >= 0 && k < now, current = k === now, base = current ? t.accent2 : t.accent;
          const tint = now < 0 ? mix(base, t.bg, Math.min(0.45, k * 0.1)) : current || past ? base : mix(t.accent, t.bg, 0.6);
          slide.addShape(k === 0 ? shape("homePlate") : shape("chevron"), { x, y: box.y, w, h: 0.75, fill: fill(tint), line: { color: t.bg, width: 1 } });
          text(slide, strip(p.label), { x: x + (k ? 0.4 : 0.2), y: box.y, w: w - (k ? 0.7 : 0.5), h: 0.75, ...head, fontSize: fitSize([strip(p.label)], w - 0.7, 0.6, 18, 10, { width: headW }), color: on(tint), valign: "middle" });
          // "We are here", under the current phase's arrow; the other phases leave the same room so their rows line up.
          if (current) {
            slide.addShape(shape("roundRect"), { x: x + 0.1, y: box.y + 0.88, w: 0.75, h: 0.3, fill: fill(t.accent2), line: { color: t.accent2 }, rectRadius: 0.15 });
            text(slide, "NOW", { x: x + 0.1, y: box.y + 0.88, w: 0.75, h: 0.3, fontSize: 11, bold: true, color: on(t.accent2), align: "center", valign: "middle", charSpacing: 1.5 });
          }
          let y = box.y + (now >= 0 ? 1.35 : 0.95);
          if (p.title) { text(slide, strip(p.title), { x: x + 0.1, y, w: w - 0.2, h: 0.6, ...head, fontSize: fitSize([strip(p.title)], w - 0.2, 0.6, 20, 12, { width: headW }), color: t.text }); y += 0.65; }
          slide.addShape(shape("line"), { x: x + 0.1, y: y + 0.02, w: w - 0.3, h: 0, line: { color: past || current ? base : mix(t.bg, t.text, 0.2), width: 1.25 } });
          const items = itemsOf(p);
          if (items.length) bulletList(slide, items, { x: x + 0.1, y: y + 0.15, w: w - 0.2, h: box.y + box.h - y - 0.15 }, size, past ? t.muted : t.text);
        });
        number(slide, n);
        break;
      }
      case "matrix": {
        // A 2×2: axis labels outside, four quadrants, one highlighted; optional points placed in it.
        const top = content(), box = area(top), axis = 0.45, g = { x: box.x + axis + 0.1, y: box.y, w: box.w - axis - 0.1, h: box.h - axis - 0.1 };
        const hw = (g.w - 0.12) / 2, hh = (g.h - 0.12) / 2, q = s.quadrants!, points = s.points || [];
        // With points placed on it (a competitor map), each quadrant keeps its title in its outer corner and its
        // description goes to the speaker notes, so labels and descriptions never sit on top of each other.
        const plotted = points.length > 0;
        const qSize = fitEach(q.map((x) => strip(x.text || (x.items || []).join(" "))), hw - 0.5, hh - 0.95, 18, 11, { width: bodyW });
        const quadrantAt = (px: number, py: number) => (py > 0.5 ? 0 : 2) + (px > 0.5 ? 1 : 0);
        q.forEach((quad, k) => {
          const x = g.x + (k % 2) * (hw + 0.12), y = g.y + Math.floor(k / 2) * (hh + 0.12), lit = s.highlight === k;
          const ground = lit ? t.accent : t.surface, ink = lit ? on(t.accent) : t.text;
          panel(slide, { x, y, w: hw, h: hh }, ground);
          const titleColor = lit ? ink : contrast(accents[k % 3], ground) >= 4.5 ? accents[k % 3] : t.text;
          if (plotted) {
            const right = k % 2 === 1, bottom = k >= 2;
            text(slide, strip(quad.title).toUpperCase(), { x: x + 0.2, y: bottom ? y + hh - 0.5 : y + 0.15, w: hw - 0.4, h: 0.35, fontSize: 12, bold: true, charSpacing: 1.5, color: titleColor, align: right ? "right" : "left", valign: bottom ? "bottom" : "top" });
            return;
          }
          text(slide, strip(quad.title), { x: x + 0.25, y: y + 0.2, w: hw - 0.5, h: 0.55, ...head, fontSize: fitSize([strip(quad.title)], hw - 0.5, 0.55, 22, 12, { width: headW }), color: titleColor });
          if (quad.items?.length) bulletList(slide, quad.items, { x: x + 0.25, y: y + 0.8, w: hw - 0.5, h: hh - 0.95 }, qSize, ink);
          else if (quad.text) text(slide, runs(quad.text), { x: x + 0.25, y: y + 0.8, w: hw - 0.5, h: hh - 0.95, fontSize: qSize, color: lit ? ink : t.muted });
        });
        for (const p of points) {
          const fx = Math.max(0, Math.min(1, p.x)), fy = Math.max(0, Math.min(1, p.y)), px = g.x + fx * g.w, py = g.y + (1 - fy) * g.h, own = /^(us|we|our|mowr)$/i.test(p.label.trim());
          const ground = s.highlight === quadrantAt(fx, fy) ? t.accent : t.surface, dot = own ? (ground === t.accent ? on(t.accent) : t.accent2) : ground === t.accent ? on(t.accent) : t.text;
          // The label goes on the side of the dot with more room.
          const left = fx > 0.75;
          slide.addShape(shape("ellipse"), { x: px - 0.13, y: py - 0.13, w: 0.26, h: 0.26, fill: fill(dot), line: { color: ground, width: 1.5 } });
          text(slide, strip(p.label), { x: left ? px - 1.98 : px + 0.18, y: py - 0.17, w: 1.8, h: 0.34, fontSize: 13, bold: true, color: dot, valign: "middle", align: left ? "right" : "left" });
        }
        const [xl, xn, xh] = [s.x?.low, s.x?.label, s.x?.high], [yl, yn, yh] = [s.y?.low, s.y?.label, s.y?.high];
        if (xn || xl || xh) {
          slide.addShape(shape("line"), { x: g.x, y: g.y + g.h + 0.12, w: g.w, h: 0, line: { color: t.muted, width: 1, endArrowType: "triangle" } });
          if (xl) text(slide, strip(xl), { x: g.x, y: g.y + g.h + 0.18, w: g.w / 3, h: 0.3, fontSize: 11, color: t.muted });
          if (xn) text(slide, strip(xn).toUpperCase(), { x: g.x + g.w / 3, y: g.y + g.h + 0.18, w: g.w / 3, h: 0.3, fontSize: 11, bold: true, color: t.muted, align: "center", charSpacing: 1.5 });
          if (xh) text(slide, strip(xh), { x: g.x + (2 * g.w) / 3, y: g.y + g.h + 0.18, w: g.w / 3, h: 0.3, fontSize: 11, color: t.muted, align: "right" });
        }
        if (yn || yl || yh) {
          // The vertical axis reads bottom to top, its labels turned with it.
          const cx = box.x + axis / 2 - 0.05, up = (y: number, w: number, words: string, o: Record<string, unknown>) => text(slide, words, { x: cx - w / 2, y: y - 0.15, w, h: 0.3, fontSize: 11, color: t.muted, rotate: 270, valign: "middle", ...o });
          slide.addShape(shape("line"), { x: g.x - 0.12, y: g.y, w: 0, h: g.h, line: { color: t.muted, width: 1, beginArrowType: "triangle" } });
          const third = Math.min(1.6, g.h / 3);
          if (yh) up(g.y + third / 2, third, strip(yh), { align: "right" });
          if (yn) up(g.y + g.h / 2, third, strip(yn).toUpperCase(), { bold: true, align: "center", charSpacing: 1.5 });
          if (yl) up(g.y + g.h - third / 2, third, strip(yl), { align: "left" });
        }
        if (plotted) {
          const described = q.filter((quad) => quad.text || quad.items?.length);
          if (described.length) {
            slide.addNotes([s.notes ? strip(s.notes) : "", ...described.map((quad) => `${strip(quad.title)}: ${strip(quad.text || (quad.items || []).join("; "))}`)].filter(Boolean).join("\n"));
            noted = true;
          }
        }
        number(slide, n);
        break;
      }
      case "team": {
        const top = content(), box = area(top), people = s.people!;
        const cols = people.length <= 4 ? people.length : Math.ceil(people.length / 2), rows = Math.ceil(people.length / cols), gap = 0.35;
        const w = (box.w - gap * (cols - 1)) / cols, h = (box.h - 0.25 * (rows - 1)) / rows, d = Math.min(1.5, h * 0.42, w * 0.55);
        const textSize = fitEach(people.map((p) => strip(p.text || "")), w - 0.2, h - d - 1.15, 15, 10, { width: bodyW });
        // The people sit in the middle of the slide, not at the top of an empty one.
        const need = d + 1.0 + Math.max(0, ...people.map((p) => (p.text ? textHeight([strip(p.text)], w - 0.2, textSize, { width: bodyW }) : 0)));
        const offset = Math.max(0, (box.h - rows * Math.min(h, need) - 0.25 * (rows - 1)) * 0.4), rowH = Math.min(h, need);
        people.forEach((p, k) => {
          const x = box.x + (k % cols) * (w + gap), y = box.y + offset + Math.floor(k / cols) * (rowH + 0.25), color = accents[k % 3];
          slide.addShape(shape("ellipse"), { x: x + (w - d) / 2, y, w: d, h: d, fill: fill(color), line: { color: t.bg, width: 2 } });
          if (p.icon) icon(slide, p.icon, k, { x: x + (w - d * 0.55) / 2, y: y + d * 0.225, w: d * 0.55, h: d * 0.55 });
          else text(slide, initials(p.name), { x: x + (w - d) / 2, y, w: d, h: d, fontFace: t.head, fontSize: Math.round(d * 26), bold: true, color: on(color), align: "center", valign: "middle" });
          text(slide, strip(p.name), { x, y: y + d + 0.12, w, h: 0.45, ...head, fontSize: fitSize([strip(p.name)], w, 0.45, 20, 12, { width: headW }), align: "center", color: t.text });
          if (p.role) text(slide, strip(p.role), { x, y: y + d + 0.55, w, h: 0.35, fontSize: fitSize([strip(p.role)], w, 0.35, 14, 10, { width: bodyW }), align: "center", color: t.accent, bold: true });
          if (p.text) text(slide, runs(p.text, { color: t.muted }), { x: x + 0.1, y: y + d + 0.95, w: w - 0.2, h: Math.max(0.3, rowH - d - 0.95), fontSize: textSize, align: "center" });
        });
        number(slide, n);
        break;
      }
      case "quote": {
        decorate(slide, "content");
        const q = strip(s.quote!);
        text(slide, "“", { x: M, y: 0.6, w: 2, h: 2, fontFace: t.head, fontSize: 160, color: t.accent, bold: true });
        text(slide, q, { x: M + 1.0, y: 1.7, w: W - 2 * M - 2, h: 3.6, fontFace: t.head, fontSize: fitSize([q], W - 2 * M - 2, 3.6, 40, 20, { line: 1.25, width: headW }), italic: !/black/i.test(t.head), valign: "middle" });
        if (s.by) text(slide, "— " + strip(s.by), { x: M + 1.0, y: 5.5, w: W - 2 * M - 2, h: 0.5, fontSize: 18, color: t.muted });
        number(slide, n);
        break;
      }
    }
    if (!noted) notes(slide, s);
  }
  if (collect) {
    // Icons and art for the whole deck, drawn together; the real pass finds them in the cache.
    const keys = [...pending.keys()], shots = keys.length ? await raster.many([...pending.values()], 1) : [];
    keys.forEach((key, k) => { const p = pending.get(key)!; cache.set(key, { png: shots[k], width: p.width, height: p.height }); });
    return { bytes: new Uint8Array(), records };
  }
  const out = await pptx.write({ outputType: "nodebuffer" });
  return { bytes: new Uint8Array(out as Buffer), records };
}
const hashSlot = (slot: string) => [...slot].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export { ARCHETYPES };
