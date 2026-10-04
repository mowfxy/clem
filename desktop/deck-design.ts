import { brandFont } from "../core/print-fonts.ts";

/**
 * How a deck looks, worked out for that deck. A deck has an archetype (lecture, pitch, report, workshop, thesis defence,
 * kids' lesson…) that decides its structure and visual language (cover, decoration, art, icons, type scale, density), and
 * its colours and type are derived from what the deck is about: the person's brand colours and fonts when given,
 * otherwise a hue chosen from the subject, a harmony chosen by the archetype and a seed from the title, so two decks
 * on different subjects never come out alike. The ten named presets remain as starting points ("theme":{"preset":…}).
 */
export type Archetype = "lecture" | "defence" | "research" | "pitch" | "report" | "status" | "workshop" | "training" | "kids" | "keynote" | "story" | "sales" | "portfolio";
export type Art = "orbits" | "waves" | "blocks" | "contours" | "confetti" | "grid" | "rays" | "leaves" | "stripes" | "none";
export type Theme = {
  bg: string; surface: string; text: string; muted: string; accent: string; accent2: string; accent3: string;
  head: string; body: string;
  /** How the title and section slides are composed. */
  cover: "left" | "band" | "full" | "center" | "panel";
  /** The decoration that recurs on content slides, so decks in different themes do not look alike. */
  decor: "rule" | "bar" | "tracker" | "topband" | "block" | "dots" | "none" | "corner" | "frame" | "grid";
  rounded: boolean;
  dark: boolean;
  archetype: Archetype;
  /** Generated art for covers, section slides and image slides. */
  art: Art;
  /** Icons: outline, white on a filled disc, or outline on a tinted disc. */
  icons: "line" | "solid" | "badge";
  /** Title sizes relative to the default (keynotes larger, reports smaller). */
  scale: number;
  /** Airy decks keep fewer, larger words per slide; dense decks (reports, reading decks) allow more. */
  density: "airy" | "normal" | "dense";
  /** Average glyph width of the heading and body fonts, in ems, for fitting text to boxes. */
  headWidth: number; bodyWidth: number;
  /** Whether the heading font is set bold (display, light and serif faces are not). */
  headBold: boolean;
  seed: number;
};

/** Average character widths (ems) of the Windows/Office fonts decks may use; unknown fonts are measured as Segoe UI. */
const WIDTH: Record<string, number> = {
  "arial black": 0.66, "segoe ui black": 0.62, "segoe print": 0.6, "comic sans ms": 0.55, "century gothic": 0.58, impact: 0.48, verdana: 0.58,
  bahnschrift: 0.5, "bahnschrift semibold": 0.52, "franklin gothic demi": 0.52, "franklin gothic book": 0.48, "franklin gothic medium": 0.5,
  georgia: 0.53, cambria: 0.5, garamond: 0.45, "palatino linotype": 0.5, "book antiqua": 0.5, "bookman old style": 0.56, constantia: 0.5, "sitka heading": 0.5, "sitka text": 0.52,
  "segoe ui": 0.5, "segoe ui light": 0.48, "segoe ui semibold": 0.51, calibri: 0.46, "calibri light": 0.45, "trebuchet ms": 0.5, candara: 0.48, corbel: 0.47,
  "gill sans mt": 0.48, rockwell: 0.55, "tw cen mt": 0.44, arial: 0.52, consolas: 0.55, "lucida sans": 0.54,
};
export const fontWidth = (font: string) => WIDTH[font.toLowerCase()] ?? 0.52;
/** Faces that are already heavy, light or display serifs: never set bold on top. */
const notBold = /light|black|demi|semibold|garamond|georgia|cambria|constantia|palatino|antiqua|sitka|print|rockwell/i;

type Kind = {
  use: string;
  /** Hues (degrees) that suit this kind of deck, used when neither a brand colour nor the subject suggests one. */
  hues: number[];
  /** Words in a title or brief that point to this archetype. */
  words: RegExp;
  fonts: [string, string][];
  covers: Theme["cover"][]; decors: Theme["decor"][]; art: Art[]; icons: Theme["icons"];
  rounded: boolean; dark: number; harmony: "analogous" | "complement" | "triad" | "split" | "mono";
  scale: number; density: Theme["density"]; vivid: number;
  /** The storyline this kind of deck follows, for the skill. */
  structure: string;
};
export const ARCHETYPES: Record<Archetype, Kind> = {
  lecture: { hues: [212, 150, 22, 262], use: "a class, lecture, course unit or seminar", words: /\b(lecture|course|class|seminar|module|chapter|unit|lesson|tutorial|syllabus|revision|exam prep|teach)/i, fonts: [["Cambria", "Calibri"], ["Georgia", "Segoe UI"], ["Constantia", "Corbel"], ["Sitka Heading", "Segoe UI"]], covers: ["band", "left"], decors: ["topband", "rule", "tracker"], art: ["contours", "grid"], icons: "line", rounded: false, dark: 0, harmony: "analogous", scale: 1, density: "normal", vivid: 0.55, structure: "title → learning objectives (agenda) → one section per topic, each opening with a question or a picture, then concept → worked example (equation, figure, process) → check-your-understanding → summary of key ideas → what to read next" },
  defence: { hues: [215, 350, 160], use: "a thesis defence, viva or dissertation talk", words: /\b(defen[cs]e|viva|thesis|dissertation|phd|doctoral|master'?s project|capstone)/i, fonts: [["Cambria", "Calibri"], ["Palatino Linotype", "Segoe UI"], ["Book Antiqua", "Calibri"]], covers: ["band", "panel"], decors: ["topband", "tracker"], art: ["grid", "contours"], icons: "line", rounded: false, dark: 0, harmony: "analogous", scale: 0.95, density: "normal", vivid: 0.45, structure: "title → the problem and why it matters → research questions → related work (comparison) → method (process, figure) → results (charts, tables, one finding per slide) → contributions (big-number or cards) → limitations → future work → thank you and questions" },
  research: { hues: [200, 175, 262], use: "a research or conference talk, lab meeting or findings", words: /\b(research|study|findings|conference|paper|experiment|lab meeting|journal club|results of)/i, fonts: [["Bahnschrift SemiBold", "Segoe UI"], ["Cambria", "Calibri"], ["Franklin Gothic Demi", "Franklin Gothic Book"]], covers: ["left", "panel"], decors: ["grid", "rule"], art: ["grid", "contours"], icons: "line", rounded: true, dark: 0.15, harmony: "split", scale: 1, density: "normal", vivid: 0.6, structure: "title → the question in one sentence (statement) → background → method → key results (chart per finding, title says the finding) → what it means → next steps" },
  pitch: { hues: [8, 200, 265, 150], use: "an investor or startup pitch, fundraising or product pitch", words: /\b(pitch|investor|fundrais|seed|series [abc]|startup|venture|vc\b|angel|go-to-market)/i, fonts: [["Segoe UI Black", "Segoe UI"], ["Bahnschrift SemiBold", "Segoe UI"], ["Century Gothic", "Segoe UI"], ["Arial Black", "Arial"]], covers: ["full", "left"], decors: ["block", "bar", "none"], art: ["blocks", "orbits", "rays"], icons: "solid", rounded: true, dark: 0.45, harmony: "complement", scale: 1.1, density: "airy", vivid: 0.85, structure: "title (one-line promise) → problem (big-number or statement) → why now → solution (image-led) → how it works (process or diagram) → market (big-number, chart) → traction (chart, stats) → business model → competition (matrix 2×2) → team (team) → roadmap → the ask (big-number) → closing" },
  report: { hues: [212, 195, 160, 225], use: "a business review, quarterly results or board report", words: /\b(report|review|quarterly|q[1-4]\b|annual|results|board|kpi|performance|budget|forecast|audit)/i, fonts: [["Franklin Gothic Demi", "Franklin Gothic Book"], ["Segoe UI Semibold", "Segoe UI"], ["Arial", "Arial"], ["Calibri", "Calibri"]], covers: ["panel", "left"], decors: ["tracker", "topband"], art: ["stripes", "grid"], icons: "line", rounded: false, dark: 0, harmony: "analogous", scale: 0.9, density: "dense", vivid: 0.5, structure: "title → executive summary first (the answer: stats or big-number) → one section per area, each slide titled with its finding, evidence as chart or table → risks and issues (matrix or comparison) → decisions needed → next steps (roadmap)" },
  status: { hues: [205, 160, 25], use: "a project update, status or progress report", words: /\b(status|update|progress|sprint|weekly|monthly|retro|milestone|standup)/i, fonts: [["Segoe UI Semibold", "Segoe UI"], ["Calibri", "Calibri"], ["Bahnschrift SemiBold", "Segoe UI"]], covers: ["panel", "left"], decors: ["tracker", "topband"], art: ["stripes", "grid"], icons: "badge", rounded: true, dark: 0, harmony: "split", scale: 0.95, density: "normal", vivid: 0.6, structure: "title → status at a glance (stats) → done since last time (icons or cards) → in progress (roadmap) → risks and blockers → decisions needed → next steps" },
  workshop: { hues: [330, 30, 190], use: "a workshop, hands-on session or bootcamp", words: /\b(workshop|hands-on|bootcamp|hackathon|masterclass|clinic|exercise|activity)/i, fonts: [["Trebuchet MS", "Segoe UI"], ["Candara", "Candara"], ["Century Gothic", "Calibri"]], covers: ["center", "left"], decors: ["dots", "corner"], art: ["waves", "confetti"], icons: "badge", rounded: true, dark: 0, harmony: "triad", scale: 1, density: "normal", vivid: 0.75, structure: "title → what we will make today (big-number or image) → agenda with timings → for each block: idea → demo (process, figure) → exercise slide (statement with the task and the time) → share-back → recap (icons) → resources" },
  training: { hues: [195, 150, 30], use: "training, onboarding, a how-to or procedure", words: /\b(training|onboarding|induction|how to|procedure|guide|policy|compliance|safety|process for)/i, fonts: [["Segoe UI Semibold", "Segoe UI"], ["Tw Cen MT", "Calibri"], ["Trebuchet MS", "Trebuchet MS"]], covers: ["left", "band"], decors: ["bar", "topband"], art: ["waves", "stripes"], icons: "badge", rounded: true, dark: 0, harmony: "split", scale: 1, density: "normal", vivid: 0.65, structure: "title → why this matters → what you will be able to do (icons) → step-by-step (process, one step per slide where detail is needed) → do and don't (before-after or comparison) → common mistakes → quick check → where to get help" },
  kids: { hues: [200, 45, 120, 330], use: "a lesson for children or a primary/middle-school class", words: /\b(kids?|children|child|primary school|elementary|grade [1-6]\b|year [1-6]\b|ages? [4-9]\b|ages? 1[0-2]\b|kindergarten|young learners?|for students aged)/i, fonts: [["Segoe Print", "Segoe UI"], ["Comic Sans MS", "Segoe UI"], ["Trebuchet MS", "Trebuchet MS"]], covers: ["center", "full"], decors: ["dots", "corner"], art: ["confetti", "waves"], icons: "solid", rounded: true, dark: 0, harmony: "triad", scale: 1.1, density: "airy", vivid: 0.95, structure: "title with a picture → a question that sparks curiosity (statement) → what we will learn (icons, 3 at most) → one idea per slide with a big picture or figure and very few words → a fun fact (big-number) → an activity or game → quiz slide → what we learned (icons)" },
  keynote: { hues: [160, 250, 15, 200], use: "a keynote, vision talk or product launch", words: /\b(keynote|vision|launch|announcing|introducing|future of|manifesto|inspire|ted)/i, fonts: [["Segoe UI Light", "Segoe UI"], ["Century Gothic", "Segoe UI"], ["Garamond", "Segoe UI Light"], ["Segoe UI Black", "Segoe UI"]], covers: ["left", "center"], decors: ["none", "frame"], art: ["orbits", "rays"], icons: "line", rounded: false, dark: 0.6, harmony: "mono", scale: 1.15, density: "airy", vivid: 0.8, structure: "title → a story or a striking number (big-number) → the tension (statement) → the idea, one statement per slide → proof (image, chart, quote) → what changes (before-after) → the call to action → closing" },
  story: { hues: [20, 345, 40], use: "a talk on history, culture, literature, art or a person's life", words: /\b(history|historical|ancient|empire|war|revolution|culture|literature|novel|poet|poetry|art history|biography|life of|philosophy|religion|music|film)/i, fonts: [["Georgia", "Segoe UI"], ["Garamond", "Gill Sans MT"], ["Rockwell", "Segoe UI"], ["Palatino Linotype", "Calibri"]], covers: ["left", "center"], decors: ["rule", "frame"], art: ["leaves", "stripes", "contours"], icons: "line", rounded: false, dark: 0.25, harmony: "analogous", scale: 1.05, density: "normal", vivid: 0.5, structure: "title → the setting (image) → timeline of events → people (team layout for key figures) → turning points, one per slide → quote → legacy (before-after or cards) → closing" },
  sales: { hues: [150, 15, 210], use: "a sales deck, client proposal or service offer", words: /\b(sales|proposal|client|customer|offer|pricing|services|agency|tender|rfp|solution for)/i, fonts: [["Segoe UI Semibold", "Segoe UI"], ["Franklin Gothic Demi", "Segoe UI"], ["Century Gothic", "Calibri"]], covers: ["full", "panel"], decors: ["block", "tracker"], art: ["blocks", "rays"], icons: "solid", rounded: true, dark: 0.2, harmony: "complement", scale: 1.05, density: "normal", vivid: 0.75, structure: "title → their situation and goal → the cost of the problem (big-number) → our approach (process) → what they get (icons) → proof (stats, quote) → plan and timeline (roadmap) → pricing (table or comparison) → next step" },
  portfolio: { hues: [0, 220, 30], use: "a portfolio, case study or design review", words: /\b(portfolio|case stud|design review|showcase|my work|projects i|exhibition|gallery)/i, fonts: [["Segoe UI Light", "Segoe UI"], ["Gill Sans MT", "Gill Sans MT"], ["Garamond", "Segoe UI"]], covers: ["left", "center"], decors: ["none", "frame"], art: ["grid", "rays"], icons: "line", rounded: false, dark: 0.4, harmony: "mono", scale: 1.05, density: "airy", vivid: 0.7, structure: "title → who I am (statement) → each project: image-led slide → the brief → the process → the outcome (before-after, big-number) → what I learned → contact" },
};
export const archetypes = Object.keys(ARCHETYPES) as Archetype[];

/** Subjects and the hue (degrees) that suits them; the first match wins. */
const SUBJECT_HUES: [RegExp, number][] = [
  [/\b(space|astronom|universe|cosmo|galax|planet|star(s|light)\b|nasa|orbit)/i, 245],
  [/\b(ocean|marine|sea\b|water|river|coast|fish|aqua)/i, 198],
  [/\b(biolog|plant|ecolog|nature|forest|garden|sustainab|environment|climate|green|agricult|farm|leaf|tree)/i, 135],
  [/\b(medic|health|clinical|nurs|hospital|patient|disease|anatomy|pharma|dental|care\b)/i, 178],
  [/\b(financ|bank|invest|econom|market|revenue|profit|budget|account|tax|fund)/i, 212],
  [/\b(tech|software|\bai\b|artificial intelligence|machine learning|data|computer|code|cyber|digital|cloud|app\b|internet|robot)/i, 222],
  [/\b(chemi|molecul|reaction|atom|polymer|lab\b)/i, 285],
  [/\b(physic|energy|electric|solar|power|circuit|quantum|mechanic)/i, 38],
  [/\b(math|geometr|algebra|calculus|statistic|probabilit|equation)/i, 232],
  [/\b(history|ancient|empire|war\b|medieval|heritage|revolution|archae)/i, 18],
  [/\b(literat|poet|novel|writing|language|grammar|philosoph|religio)/i, 340],
  [/\b(art\b|arts\b|paint|music|film|theat|design|fashion|beauty|luxury)/i, 320],
  [/\b(food|cook|nutrition|recipe|restaurant|kitchen|coffee|wine)/i, 14],
  [/\b(law|legal|policy|government|politic|justice|court|rights)/i, 220],
  [/\b(sport|fitness|football|soccer|athlet|olymp|exercise)/i, 4],
  [/\b(travel|touris|geograph|countr|city|cities|map)/i, 168],
  [/\b(psycholog|mental|wellbeing|mindful|emotion|brain)/i, 268],
  [/\b(architect|engineer|construct|building|bridge|urban)/i, 26],
  [/\b(marketing|brand|startup|product|growth|social media|advertis)/i, 8],
  [/\b(educat|school|teach|learn|student|kids?|children)/i, 205],
];

/** FNV-1a: a stable number from text, so the same deck always gets the same design. */
export function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** A small seeded generator (mulberry32) for choices and generated art. */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function hsl(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
export function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
/** WCAG relative luminance and contrast ratio. */
export function luminance(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** `color` made lighter or darker, keeping its hue, until it reaches `ratio` against `bg`. */
export function readable(color: string, bg: string, ratio: number) {
  if (contrast(color, bg) >= ratio) return color;
  const [h, s, l] = toHsl(color), darker = luminance(bg) > 0.3;
  for (let step = 1; step <= 40; step++) {
    const next = hsl(h, s, darker ? l - step * 0.025 : l + step * 0.025);
    if (contrast(next, bg) >= ratio) return next;
  }
  return darker ? "141414" : "FFFFFF";
}
/** Text that reads on a fill: white on dark colours, near-black on light ones, whichever contrasts more. */
export const on = (fill: string) => (contrast("FFFFFF", fill) >= contrast("141414", fill) ? "FFFFFF" : "141414");
export function mix(a: string, b: string, amount: number) {
  return [0, 2, 4].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** The archetype a deck's title and brief point to; a keynote when nothing does. */
export function inferArchetype(text: string): Archetype {
  // The more specific kinds are tried first (a "thesis defence" is not a lecture, a "kids' lesson" is not a lecture).
  const order: Archetype[] = ["defence", "kids", "pitch", "workshop", "training", "status", "report", "research", "sales", "portfolio", "lecture", "story", "keynote"];
  return order.find((k) => ARCHETYPES[k].words.test(text)) || "keynote";
}
const isHex = (v: unknown) => typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v.trim());
const hex = (v: unknown) => String(v).trim().replace("#", "").toUpperCase();
export const fontOk = (v: unknown) => typeof v === "string" && /^[\p{L}\p{N} -]{2,48}$/u.test(v) && !brandFont.test(v);

export type DesignInput = {
  title?: string; subtitle?: string; archetype?: string;
  brief?: { audience?: string; purpose?: string; setting?: string; message?: string; tone?: string; minutes?: number };
  brand?: { name?: string; colors?: string[]; primary?: string; secondary?: string; headingFont?: string; bodyFont?: string };
  theme?: Record<string, unknown>;
};
type Preset = Pick<Theme, "bg" | "surface" | "text" | "muted" | "accent" | "accent2" | "accent3" | "head" | "body" | "cover" | "decor" | "rounded">;

/**
 * The deck's design. With a preset, the preset's colours and fonts are the base; otherwise the palette is derived (from
 * the brand colours, else from the subject), the fonts are chosen for the archetype, and the composition (cover,
 * decoration, art, icons) comes from the archetype. Any colour or font the person or model names is applied on top,
 * and every text colour is checked against what it sits on.
 */
export function designTheme(spec: DesignInput, presets: Record<string, Preset>): Theme {
  const t = (spec.theme || {}) as Record<string, any>, brief = spec.brief || {}, brand = spec.brand || {};
  const about = [spec.title, spec.subtitle, brief.purpose, brief.audience, brief.setting, brief.message].filter(Boolean).join(" ");
  const archetype: Archetype = (archetypes as string[]).includes(String(spec.archetype)) ? (spec.archetype as Archetype) : inferArchetype(about);
  const kind = ARCHETYPES[archetype];
  const seed = hash(`${spec.title || ""}|${archetype}|${brief.audience || ""}|${brand.name || ""}`);
  const rand = random(seed), pick = <T>(list: T[]) => list[Math.floor(rand() * list.length) % list.length];
  const tone = String(brief.tone || "");
  const preset = t.preset !== undefined ? presets[String(t.preset).toLowerCase()] : undefined;

  let base: Preset;
  if (preset) base = { ...preset };
  else {
    // The base hue: the brand's main colour, else the subject's hue, nudged by the seed so related decks still differ.
    const brandColors = [brand.primary, brand.secondary, ...(brand.colors || [])].filter(isHex).map(hex);
    const named = [t.accent, t.accent2, t.accent3].filter(isHex).map(hex);
    const anchor = brandColors[0] || named[0];
    const subject = SUBJECT_HUES.find(([words]) => words.test(about))?.[1];
    const hue = anchor ? toHsl(anchor)[0] : (subject ?? pick(kind.hues)) + (rand() - 0.5) * 24;
    // A brand colour is used exactly as given, so the page goes dark only for a colour light enough to read on it.
    const chance = rand() < kind.dark && (!anchor || luminance(anchor) > 0.3);
    const dark = typeof t.dark === "boolean" ? t.dark : /\b(dark|night|dramatic|moody|cinematic)\b/i.test(tone) ? true : /\b(light|bright|airy|clean)\b/i.test(tone) ? false : chance;
    const vivid = /\b(calm|muted|serious|formal|sober)\b/i.test(tone) ? kind.vivid * 0.7 : /\b(bold|vibrant|playful|fun|energetic)\b/i.test(tone) ? Math.min(1, kind.vivid * 1.2) : kind.vivid;
    const second = { analogous: 38, complement: 180, triad: 120, split: 150, mono: 0 }[kind.harmony] * (rand() < 0.5 ? 1 : -1);
    const third = { analogous: -34, complement: 30, triad: 240, split: 210, mono: 18 }[kind.harmony];
    const sat = 0.42 + 0.45 * vivid;
    const accent = anchor || hsl(hue, sat, dark ? 0.62 : 0.42);
    const ah = toHsl(accent)[0];
    const accent2 = brandColors[1] || named[1] || hsl(ah + second, kind.harmony === "mono" ? 0.12 : sat * 0.9, dark ? 0.66 : kind.harmony === "mono" ? 0.3 : 0.4);
    const accent3 = brandColors[2] || named[2] || hsl(ah + third, sat * 0.85, dark ? 0.7 : 0.5);
    // Paper tinted towards the accent (warm or cool), never pure white unless the archetype is a report.
    const bg = dark ? hsl(ah, 0.35, 0.075 + rand() * 0.03) : archetype === "report" || archetype === "status" ? "FFFFFF" : hsl(ah + (archetype === "story" ? 30 : 0), 0.3 + 0.3 * vivid, 0.975 - rand() * 0.012);
    const surface = dark ? hsl(ah, 0.3, 0.15) : hsl(ah, 0.25 + 0.2 * vivid, 0.94);
    const text = dark ? hsl(ah, 0.25, 0.95) : hsl(ah, 0.35, 0.12);
    const muted = dark ? hsl(ah, 0.15, 0.7) : hsl(ah, 0.12, 0.4);
    const [head, body] = pick(kind.fonts);
    base = { bg, surface, text, muted, accent, accent2, accent3, head, body, cover: pick(kind.covers), decor: pick(kind.decors), rounded: kind.rounded };
  }
  const color = (key: keyof Preset, ...values: unknown[]) => { const v = values.find(isHex); return v ? hex(v) : (base[key] as string); };
  const bg = color("bg", t.background, t.bg);
  const head = [t.headingFont, t.head, brand.headingFont].find(fontOk) as string | undefined ?? base.head;
  const body = [t.bodyFont, t.body, brand.bodyFont].find(fontOk) as string | undefined ?? base.body;
  const theme: Theme = {
    bg,
    surface: color("surface", t.surface),
    text: color("text", t.text),
    muted: color("muted", t.muted),
    accent: color("accent", t.accent, preset ? brand.primary : undefined),
    accent2: color("accent2", t.accent2, preset ? brand.secondary : undefined),
    accent3: color("accent3", t.accent3),
    head, body,
    cover: (["left", "band", "full", "center", "panel"] as const).includes(t.cover) ? t.cover : base.cover,
    decor: (["rule", "bar", "tracker", "topband", "block", "dots", "none", "corner", "frame", "grid"] as const).includes(t.decor) ? t.decor : base.decor,
    rounded: typeof t.rounded === "boolean" ? t.rounded : base.rounded,
    dark: luminance(bg) < 0.18,
    archetype,
    art: (["orbits", "waves", "blocks", "contours", "confetti", "grid", "rays", "leaves", "stripes", "none"] as const).includes(t.art) ? t.art : pick(kind.art),
    icons: (["line", "solid", "badge"] as const).includes(t.icons) ? t.icons : kind.icons,
    scale: kind.scale,
    density: kind.density,
    headWidth: fontWidth(head), bodyWidth: fontWidth(body),
    headBold: !notBold.test(head),
    seed,
  };
  // Whatever was asked for, text stays readable: body text at 7:1; muted text and the main accent (kickers, labels,
  // numbers) at 4.5:1; the other accents, used for shapes and large type, at 3:1.
  theme.text = readable(theme.text, theme.bg, 7);
  theme.muted = readable(theme.muted, theme.bg, 4.5);
  theme.surface = contrast(theme.text, theme.surface) >= 6 ? theme.surface : mix(theme.bg, theme.text, 0.06);
  theme.accent = readable(theme.accent, theme.bg, 4.5);
  for (const key of ["accent2", "accent3"] as const) theme[key] = readable(theme[key], theme.bg, 3);
  return theme;
}

/** The deck archetypes and their storylines, for the slides skill. */
export const archetypeGuide = archetypes.map((k) => `${k} (${ARCHETYPES[k].use}): ${ARCHETYPES[k].structure}`).join("\n");
