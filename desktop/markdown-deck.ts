import { documentBlocks, type DocumentBlock } from "../core/document-blocks.ts";
import { visualCaption } from "../core/visual-print.ts";
import { themes, type DeckSpec } from "./pptx-deck.ts";

/**
 * A Markdown answer as a PowerPoint deck spec, for Export → PowerPoint: the first "#" heading is the title, each "##" heading is
 * a section and "###" headings inside one become slides of their own. The content decides the layout (a table becomes a table
 * slide, "**Term**: meaning" bullets become cards, leading figures become stats, a short numbered list becomes a process, a
 * ```visual block becomes a figure slide), the subject decides the design (one of the ten presets), and prose that does not fit
 * on a slide goes to the speaker notes instead of onto the slide.
 */
type Slide = DeckSpec["slides"][number];
type Unit = { title: string; kicker?: string; blocks: DocumentBlock[] };
const WORDS = (text: string) => text.split(/\s+/).filter(Boolean).length;
/** Inline Markdown a slide cannot show: links, code ticks and single-star italics go; **bold** and $maths$ stay (the deck draws them). */
const clean = (text: string) => text
  .replace(/\[\[([^\]|,]+)(?:,\s*p\.\s*(\d+))?\]\]/g, (_, file: string, page?: string) => `(${file.trim()}${page ? ", p. " + page : ""})`)
  .replace(/\[([^\]]+)\]\((?:https?:|drive:)[^)]*\)/g, "$1")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, "$1")
  .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
  .trim();
const plain = (text: string) => clean(text).replace(/\*\*/g, "");
/** The first sentence of a paragraph, for a bullet. */
const lead = (text: string) => (clean(text).match(/^.{20,}?[.!?](?=\s|$)/)?.[0] || clean(text)).slice(0, 170);

/** Words that point to a design: each preset's own "use" line plus the subjects it suits. */
const SUBJECTS: Record<string, string> = {
  editorial: "essay history culture literature journalism humanities philosophy society art novel poetry",
  midnight: "software code api technology product developer cloud algorithm database programming machine learning neural",
  boardroom: "business strategy market revenue finance investor growth company customers sales quarterly budget profit stakeholders",
  academic: "lecture research study thesis seminar theory hypothesis paper university course literature review methodology",
  studio: "brand design marketing campaign creative pitch startup advertising logo audience",
  classroom: "lesson students children school workshop training onboarding activity beginners kids exercise teaching",
  minimal: "keynote portfolio principles",
  earth: "sustainability environment health climate food community wellbeing nature ecology nutrition",
  noir: "luxury fashion architecture awards premium event gala",
  lab: "physics chemistry biology science experiment equation measurement medicine engineering circuit force energy voltage calculus",
};
/** The design that suits what the answer is about; a neutral one when nothing stands out. */
export function pickTheme(text: string) {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z]{3,}/g) || []) counts.set(word, (counts.get(word) || 0) + 1);
  let best = "minimal", top = 0;
  for (const [name, preset] of Object.entries(themes)) {
    const keys = new Set(`${preset.use} ${SUBJECTS[name] || ""}`.toLowerCase().match(/[a-z]{4,}/g) || []);
    let score = 0;
    for (const key of keys) score += Math.min(3, counts.get(key) || 0);
    // Equations and drawn figures are science and lecture material.
    if (name === "lab") score += Math.min(4, (text.match(/\$[^$]+\$/g) || []).length + (text.match(/```visual/g) || []).length);
    if (score > top) { top = score; best = name; }
  }
  return top >= 2 ? best : "minimal";
}

/** The sections of an answer, each a list of slide-sized units. */
function units(blocks: DocumentBlock[]) {
  const sections: { title: string; units: Unit[] }[] = [];
  let intro: DocumentBlock[] = [], section: { title: string; units: Unit[] } | undefined, unit: Unit | undefined;
  for (const block of blocks) {
    if (block.kind === "heading" && block.level <= 2) { section = { title: plain(block.text), units: [{ title: plain(block.text), blocks: [] }] }; sections.push(section); unit = section.units[0]; }
    else if (block.kind === "heading" && section) { unit = { title: plain(block.text), kicker: section.title, blocks: [] }; section.units.push(unit); }
    else if (block.kind === "heading") (unit ? unit.blocks : intro).push({ kind: "paragraph", text: `**${block.text}**` });
    else (unit ? unit.blocks : intro).push(block);
  }
  return { intro, sections };
}

/** One slide spec per kind of content in a unit, in the order a reader meets it. */
function slidesFor(unit: Unit, deckTitle: string): Slide[] {
  const out: Slide[] = [];
  const paragraphs = unit.blocks.filter((b) => b.kind === "paragraph").map((b) => (b as { text: string }).text);
  const bullets = unit.blocks.filter((b) => b.kind === "bullet").map((b) => (b as { text: string }).text);
  const numbers = unit.blocks.filter((b) => b.kind === "number").map((b) => (b as { text: string }).text);
  const items = bullets.length ? bullets : numbers;
  const title = unit.title || deckTitle;
  const base = { title: title.slice(0, 120), ...(unit.kicker ? { kicker: unit.kicker.slice(0, 60) } : {}) };
  const spoken: string[] = [];
  const equations = paragraphs.filter((p) => /^\$\$[^$]+\$\$$/.test(p.trim()));
  const prose = paragraphs.filter((p) => !equations.includes(p));
  const text: Slide[] = [];
  if (items.length) {
    const flat = items.map(clean);
    const pairs = flat.map((t) => /^\*\*(.{2,40}?)\*\*\s*[:—–-]?\s*(.+)$/.exec(t) || /^([^:*]{2,32}):\s+(.{10,})$/.exec(t));
    // A leading figure is the bold span ("**8 V** across R2") or a bare number with its unit sign ("42% of users…").
    const figures = flat.map((t) => /^\*\*(?=[^*]*\d)([^*]{1,12})\*\*\s*[—–:-]?\s*(.{3,})$/.exec(t) || /^([$€£]?\d[\d.,]*\s?(?:%|[kKmMbB]\b|x|×)?)\s*[—–:-]?\s+(.{3,})$/.exec(t));
    if (!bullets.length && flat.length >= 3 && flat.length <= 6 && flat.every((t) => WORDS(t) <= 18)) {
      text.push({ layout: "process", ...base, steps: pairs.map((p, i) => (p ? { title: plain(p[1]), text: plain(p[2]) } : { title: plain(flat[i]) })) });
    } else if (flat.length >= 2 && flat.length <= 4 && figures.every((m) => m && m[1].replace(/\D/g, "").length <= 7)) {
      text.push({ layout: "stats", ...base, stats: figures.map((m) => ({ value: m![1].trim(), label: plain(m![2]).slice(0, 90) })) });
    } else if (flat.length >= 2 && flat.length <= 6 && pairs.every(Boolean)) {
      text.push({ layout: "cards", ...base, items: pairs.map((p) => ({ title: plain(p![1]), text: plain(p![2]) })) });
    } else if (equations.length === 1 && flat.length <= 4 && bullets.length) {
      // One equation with a few points about it is a single slide: the equation, then what to notice.
      out.push({ layout: "equation", ...base, math: equations[0].trim().slice(2, -2).trim(), bullets: flat });
      equations.length = 0;
    } else text.push({ layout: "bullets", ...base, bullets: flat });
    // Prose around a list is what the speaker says, not what the slide shows.
    spoken.push(...prose.map(clean));
  } else if (prose.length) {
    const words = prose.reduce((n, p) => n + WORDS(p), 0);
    if (words <= 80) text.push({ layout: "text", ...base, text: prose.map(clean).join("\n\n") });
    else { text.push({ layout: "bullets", ...base, bullets: prose.slice(0, 6).map(lead) }); spoken.push(...prose.map(clean)); }
  }
  for (const code of unit.blocks.filter((b) => b.kind === "code")) text.push({ layout: "text", ...base, text: (code as { text: string }).text.split("\n").slice(0, 16).join("\n") });
  for (const math of equations) out.push({ layout: "equation", ...base, math: math.trim().slice(2, -2).trim() });
  if (text[0] && spoken.length) text[0].notes = spoken.join("\n\n").slice(0, 3000);
  out.unshift(...text);
  for (const block of unit.blocks) {
    if (block.kind === "table" && block.rows.length > 1) {
      const header = block.rows[0].map(plain), rows = block.rows.slice(1).map((r) => header.map((_, i) => plain(r[i] ?? "")));
      for (let i = 0; i < rows.length; i += 12) out.push({ layout: "table", title: base.title + (i ? " (continued)" : ""), table: { header, rows: rows.slice(i, i + 12) } });
    } else if (block.kind === "visual") {
      const caption = visualCaption(block.spec);
      out.push({ layout: "figure", title: (caption && caption.length <= 70 ? caption : base.title).slice(0, 120), figure: { module: "mowr", fn: "visual", args: [block.spec] }, ...(caption && caption.length > 70 ? { caption } : {}) });
    }
  }
  return out;
}

export function markdownDeck(markdown: string, fallbackTitle = "Presentation"): DeckSpec {
  const text = markdown.replace(/```(?:check|edit|automation)[\s\S]*?(?:```|$)/g, "");
  const blocks = documentBlocks(text);
  let title = fallbackTitle;
  if (blocks[0]?.kind === "heading" && blocks[0].level === 1) title = plain((blocks.shift() as { text: string }).text);
  const { intro, sections } = units(blocks);
  const slides: Slide[] = [];
  // The opening line of the answer is the subtitle when it is short; longer introductions become an overview slide.
  const first = intro.find((b) => b.kind === "paragraph") as { text: string } | undefined;
  const subtitle = first && plain(first.text).length <= 160 ? plain(first.text) : undefined;
  const opening = subtitle ? intro.filter((b) => b !== first) : intro;
  slides.push({ layout: "title", title: title.slice(0, 160), ...(subtitle ? { subtitle } : {}) });
  if (sections.length >= 4) slides.push({ layout: "agenda", title: "Agenda", items: sections.slice(0, 8).map((s) => s.title.slice(0, 80)) });
  if (opening.some((b) => b.kind !== "paragraph" || WORDS(b.text) > 0)) slides.push(...slidesFor({ title: "Overview", blocks: opening }, title));
  for (const section of sections) {
    const subs = section.units.slice(1);
    // A section made of several "###" parts opens with a divider; a plain one is a slide of its own.
    if (subs.length >= 2 && sections.length >= 3) slides.push({ layout: "section", title: section.title.slice(0, 120) });
    for (const part of section.units) slides.push(...slidesFor(part, title));
  }
  return { title: title.slice(0, 160), theme: { preset: pickTheme(`${title}\n${markdown.slice(0, 20000)}`) }, slides: slides.slice(0, 150) };
}
