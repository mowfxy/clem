import { SUBJECT_HUES, hash, random, hsl, readable } from "./deck-design.ts";
import { brandFont } from "../core/print-fonts.ts";
import type { Design, DocumentSpec, Layout } from "./pdf-document.ts";

/**
 * How a document looks when nobody described a look: worked out for that document by rules, not picked from a list of
 * finished templates. The page design (layout) keeps the form of its genre (a report stays a report); within it, the
 * typefaces, the accent colour, the title block, the section headings, the type size, the leading and the margins are
 * chosen from what the document is about, who reads it and how long it is, with a seed from its title, so two documents
 * on different subjects do not come out alike and the same document always comes out the same. Whatever the person
 * (or the model, for them) set wins, field by field.
 */

/** Title blocks: "ruled" (heavy rules above and below, centred), "center" (centred, a thin accent rule under it),
 *  "left" (flush left over a rule), "rule" (flush left, a hairline under the block), "bar" (an accent rule and an
 *  uppercase label over the title), "band" (a tinted panel with an accent edge), "plain" (large and flush left, no rule). */
export const TITLE_STYLES = ["ruled", "center", "left", "rule", "bar", "band", "plain"] as const;
/** Section headings: "plain" (bold), "rule" (a hairline under each), "accent" (heading and number in the accent colour),
 *  "smallcaps", "bar" (an accent bar at the left). */
export const HEADING_STYLES = ["plain", "rule", "accent", "smallcaps", "bar"] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number];
export type HeadingStyle = (typeof HEADING_STYLES)[number];

/** Which title blocks suit each page design; the first is the design's own. */
export const titleStyles: Record<Layout, TitleStyle[]> = {
  technical: ["ruled", "center", "left"],
  notes: ["rule", "band", "plain", "center", "bar"],
  business: ["bar", "band", "plain", "rule"],
  letter: ["plain"],
};
const headingStyles: Record<Layout, HeadingStyle[]> = {
  technical: ["plain", "smallcaps", "accent"],
  notes: ["rule", "accent", "bar", "plain"],
  business: ["accent", "bar", "rule", "plain"],
  letter: ["plain"],
};

/** Type pairings that suit each page design: body face and heading face, all installed with Windows or Office. A
 *  serif text face for reading at length; a sans for headings only where the genre allows it. */
const pairings: Record<Layout, [string, string][]> = {
  technical: [["Times New Roman", "Times New Roman"], ["Cambria", "Cambria"], ["Palatino Linotype", "Palatino Linotype"], ["Book Antiqua", "Book Antiqua"], ["Cambria", "Calibri"], ["Times New Roman", "Arial"], ["Georgia", "Georgia"]],
  notes: [["Palatino Linotype", "Palatino Linotype"], ["Georgia", "Segoe UI Semibold"], ["Constantia", "Corbel"], ["Cambria", "Calibri"], ["Sitka Text", "Segoe UI Semibold"], ["Book Antiqua", "Gill Sans MT"]],
  business: [["Georgia", "Arial"], ["Cambria", "Calibri"], ["Constantia", "Segoe UI Semibold"], ["Garamond", "Gill Sans MT"], ["Calibri", "Calibri"], ["Franklin Gothic Book", "Franklin Gothic Demi"]],
  letter: [["Times New Roman", "Times New Roman"], ["Garamond", "Garamond"], ["Georgia", "Georgia"], ["Cambria", "Cambria"], ["Palatino Linotype", "Palatino Linotype"], ["Constantia", "Constantia"]],
};
/** Readers who need a friendlier page: children and beginners get a humanist sans, larger and looser. */
const young = /\b(kids?|children|child|primary school|elementary|kindergarten|grade [1-6]\b|year [1-6]\b|ages? [4-9]\b|ages? 1[0-2]\b|young learners?)\b/i;
const youngPairings: [string, string][] = [["Segoe UI", "Segoe UI Semibold"], ["Trebuchet MS", "Trebuchet MS"], ["Verdana", "Verdana"], ["Candara", "Candara"]];
/** Hues for a page design when the subject suggests none: deep blues, teals, greens and wines, never loud. */
const layoutHues: Record<Layout, number[]> = { technical: [214, 200, 228, 352, 160], notes: [212, 168, 24, 268, 140], business: [210, 196, 222, 158, 8], letter: [215, 200] };

/** Average character width in ems, for the line-length rule. */
const charWidth = (font: string) => (/verdana/i.test(font) ? 0.58 : /segoe|trebuchet|calibri|candara|corbel|arial|franklin|gill/i.test(font) ? 0.5 : /times|garamond/i.test(font) ? 0.45 : 0.49);
const pageWidths: Record<string, number> = { A4: 210, Letter: 215.9, Legal: 215.9, A5: 148 };

/** Words in the document as written, for the density rule. */
function wordCount(spec: Pick<DocumentSpec, "summary" | "sections">) {
  const count = (t: unknown) => (typeof t === "string" ? t.split(/\s+/).filter(Boolean).length : 0);
  return count(spec.summary) + (Array.isArray(spec.sections) ? spec.sections.reduce((n, s) => n + count(s?.text), 0) : 0);
}

export type Resolved = { font: string; headingFont: string; design: Design & { accent: string; titleStyle: TitleStyle; headingStyle: HeadingStyle; textAlign: "justify" | "left" } };

/**
 * The design for a specification: the person's own choices kept, every other one worked out by the rules. `layout` is
 * the page design the kind or style picked. Returned as the fields a specification carries, so storing it keeps the
 * document's look through revisions.
 */
export function designDocument(spec: DocumentSpec, layout: Layout): Resolved {
  const own: Design = spec.design && typeof spec.design === "object" ? spec.design : {};
  const about = [spec.title, spec.subtitle, spec.summary, ...(Array.isArray(spec.plan) ? spec.plan : []), ...(Array.isArray(spec.sections) ? spec.sections.slice(0, 12).map((s) => s?.heading) : [])].filter((t) => typeof t === "string").join(" ");
  const rand = random(hash(`${spec.title}|${spec.kind || ""}|${layout}`));
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length) % list.length];
  const forYoung = young.test(about) || young.test(String(spec.subtitle || ""));
  // Type: a pairing for the genre (or a friendly sans for young readers); a face the person named replaces its part.
  const [body, head] = forYoung && layout !== "technical" ? pick(youngPairings) : pick(pairings[layout]);
  const named = (v: unknown) => typeof v === "string" && v.trim() && !brandFont.test(v) ? v.trim() : undefined;
  const font = named(spec.font) ?? body;
  const headingFont = named(spec.headingFont) ?? (named(spec.font) ? named(spec.font)! : head);
  // Colour: the subject's hue (else one that suits the genre), nudged by the seed, deep enough to read as text.
  const subject = SUBJECT_HUES.find(([words]) => words.test(about))?.[1];
  const hue = (subject ?? pick(layoutHues[layout])) + (rand() - 0.5) * 20;
  const [sat, light] = layout === "technical" ? [0.5, 0.3] : layout === "business" ? [0.58, 0.32] : [0.5, 0.33];
  const accent = own.accent ?? "#" + readable(hsl(hue, forYoung ? sat + 0.15 : sat, light), "FFFFFF", 5.5).toLowerCase();
  // Density: long documents and papers set tighter; short handouts and young readers looser and larger.
  const words = wordCount(spec);
  const dense = words > 6000 || spec.kind === "paper";
  const fontSize = own.fontSize ?? (forYoung ? 12.5 : layout === "letter" ? 11 : dense ? 10.3 : words < 1500 && /handout|worksheet|brief|memo/.test(String(spec.kind)) ? 11 : 10.6);
  const lineHeight = own.lineHeight ?? Math.round((forYoung ? 1.5 : layout === "business" ? 1.42 : dense ? 1.34 : 1.38) * 100) / 100;
  // Measure: side margins for a comfortable line in one column (about 90 characters in a report, 80 in notes and
  // business documents, 72 in a letter, 65 for children), never under 20 mm or over 28 mm.
  const columns = own.columns ?? 1;
  const width = pageWidths[own.pageSize || "A4"] ?? 210;
  const perChar = ((fontSize * 25.4) / 72) * charWidth(font);
  const target = forYoung ? 65 : layout === "technical" ? 90 : layout === "letter" ? 72 : 80;
  const margin = own.margin ?? (columns === 2 ? 18 : Math.round(Math.min(28, Math.max(20, (width - target * perChar) / 2))));
  // Justified text for reports and notes; ragged right for business documents, letters and young readers.
  const textAlign = own.textAlign ?? (forYoung || layout === "business" || layout === "letter" ? "left" : "justify");
  const titleStyle = (own as any).titleStyle ?? pick(titleStyles[layout]);
  // A colour the person chose for the document shows in its headings unless they said how headings look.
  const headingStyle = (own as any).headingStyle ?? (spec.design?.accent && layout !== "letter" ? "accent" : pick(headingStyles[layout]));
  return { font, headingFont, design: { ...own, accent, fontSize, lineHeight, margin, titleStyle, headingStyle, textAlign } };
}
