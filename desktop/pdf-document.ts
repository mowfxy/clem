import { kinetraCall } from "./kinetra-runtime.ts";
import { markdownHtml } from "./pdf-markdown.ts";
import { voiceProblems, type DocumentKind } from "../core/document-standard.ts";
import { standardFonts, brandFont } from "../core/print-fonts.ts";
import { visualBlocks, visualCaption } from "../core/visual-print.ts";
const escape = (text: unknown) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
type Figure = { module: string; fn: string; args: unknown[] };
type Section = { heading?: string; text?: string; figure?: Figure; caption?: string };
export type DocumentSpec = {
  title: string;
  subtitle?: string;
  kind?: DocumentKind | string;
  /** The page design; by default it follows `kind` (see `layoutFor`). */
  style?: Layout | string;
  author?: string;
  date?: string;
  summary?: string;
  sections: Section[];
  references?: string[];
  /** The typeface the person asked for: a preset (see `fonts`) or the name of a font installed on this PC. */
  font?: string;
  /** A different typeface for headings, tables and captions; defaults to one that suits `font`. */
  headingFont?: string;
  /** The person's own design (or one a skill describes), on top of the layout; see `designCss`. */
  design?: Design;
  /** Every heading the finished document will have, sent with the first part. Mowr reports which are still
   *  unwritten, so a long document is completed over as many parts as it needs (desktop/main.ts). */
  plan?: string[];
};
export type Design = {
  /** Colour for headings, rules, links and tinted boxes (#rgb or #rrggbb). */
  accent?: string;
  /** Body text size in points (8–14) and line spacing (1–2.4). */
  fontSize?: number;
  lineHeight?: number;
  columns?: 1 | 2;
  pageSize?: "A4" | "Letter" | "Legal" | "A5";
  /** Page margins in millimetres (8–40). */
  margin?: number;
  titleAlign?: "left" | "center";
  /** false: no section numbers. */
  numbered?: boolean;
  /** true: a contents list even for short documents; false: none. */
  contents?: boolean;
  /** false: no running head on the pages after the first. */
  runningHead?: boolean;
  /** Any further CSS for the print page (classes .doc-head, h1, h2, h3, .doc-summary, .doc-toc, main, table, figure, figcaption, .env, .env-definition …). */
  css?: string;
};
const pageSizes = new Set(["A4", "Letter", "Legal", "A5"]);
/** Checks a design; returns the problems in words the model can act on. */
export function designProblems(design: unknown): string[] {
  if (design === undefined) return [];
  if (!design || typeof design !== "object" || Array.isArray(design)) return ['design must be an object such as {"accent":"#0b5394","columns":2}.'];
  const d = design as Record<string, unknown>, problems: string[] = [];
  const known = ["accent", "fontSize", "lineHeight", "columns", "pageSize", "margin", "titleAlign", "numbered", "contents", "runningHead", "css"];
  for (const key of Object.keys(d)) if (!known.includes(key)) problems.push(`design.${key} is not a design setting (use ${known.join(", ")}, or put it in design.css).`);
  if (d.accent !== undefined && !(typeof d.accent === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(d.accent))) problems.push('design.accent must be a hex colour like "#0b5394".');
  const range = (key: string, min: number, max: number) => { if (d[key] !== undefined && !(typeof d[key] === "number" && d[key]! >= min && d[key]! <= max)) problems.push(`design.${key} must be a number from ${min} to ${max}.`); };
  range("fontSize", 8, 14); range("lineHeight", 1, 2.4); range("margin", 8, 40);
  if (d.columns !== undefined && d.columns !== 1 && d.columns !== 2) problems.push("design.columns must be 1 or 2.");
  if (d.pageSize !== undefined && !pageSizes.has(d.pageSize as string)) problems.push("design.pageSize must be A4, Letter, Legal or A5.");
  if (d.titleAlign !== undefined && d.titleAlign !== "left" && d.titleAlign !== "center") problems.push('design.titleAlign must be "left" or "center".');
  for (const key of ["numbered", "contents", "runningHead"]) if (d[key] !== undefined && typeof d[key] !== "boolean") problems.push(`design.${key} must be true or false.`);
  if (d.css !== undefined && (typeof d.css !== "string" || d.css.length > 20000)) problems.push("design.css must be CSS text of at most 20,000 characters.");
  return problems;
}
/** The person's CSS, kept inside the style element and away from Mowr's own fonts and from anything outside the page. */
export const cleanCss = (css: string) =>
  css.replace(/<\/?style[^>]*>?|<!--|-->/gi, "").replace(/@import[^;]*;?/gi, "").replace(/url\s*\([^)]*\)/gi, "none").replace(/[^;{}]*mowafy[^;{}]*;?/gi, "");

/**
 * Page designs. Every document is typeset like professional print, never like the app:
 * - technical: reports and papers, in the manner of an arXiv technical report (ruled small-caps title, centred
 *   abstract, Times, running head, numbered sections, figures, tables and equations);
 * - notes: lecture notes, handouts, guides and worksheets, a book face with framed definitions and examples;
 * - business: briefs, proposals and memos, a serif text with sans headings and an executive summary;
 * - letter: letters, unnumbered, with the date and subject on top.
 */
export type Layout = "technical" | "notes" | "business" | "letter";
const layouts = new Set<Layout>(["technical", "notes", "business", "letter"]);
const kindLayout: Record<string, Layout> = { report: "technical", paper: "technical", notes: "notes", handout: "notes", manual: "notes", worksheet: "notes", document: "notes", brief: "business", proposal: "business", memo: "business", letter: "letter" };
export const layoutFor = (spec: Pick<DocumentSpec, "kind" | "style">): Layout =>
  layouts.has(spec.style as Layout) ? (spec.style as Layout) : kindLayout[String(spec.kind || "report")] || "technical";

/** Standard document typefaces installed with Windows (with metric-compatible fallbacks), so a PDF reads like
 *  print. Mowr's own interface fonts are never used in documents, even when asked for. */
const times = "'Times New Roman',Times,'Liberation Serif','Nimbus Roman','TeX Gyre Termes',serif";
const palatino = "'Palatino Linotype','Book Antiqua',Palatino,'TeX Gyre Pagella',serif";
const georgia = "Georgia,Cambria,'Times New Roman',serif";
const arial = "Arial,Helvetica,'Liberation Sans','Nimbus Sans',sans-serif";
const sansStack = "Calibri,'Segoe UI',Carlito,Arial,sans-serif";
const layoutFonts: Record<Layout, { body: string; head: string }> = {
  technical: { body: times, head: times },
  notes: { body: palatino, head: palatino },
  business: { body: georgia, head: arial },
  letter: { body: times, head: times },
};
export const fonts: Record<string, { body: string; head: string }> = {
  classic: { body: "Cambria,Georgia,'Times New Roman',serif", head: sansStack },
  serif: { body: times, head: times },
  sans: { body: arial, head: arial },
  times: { body: times, head: times },
  georgia: { body: georgia, head: georgia },
  garamond: { body: "Garamond,'EB Garamond','Times New Roman',serif", head: "Garamond,'EB Garamond','Times New Roman',serif" },
  palatino: { body: palatino, head: palatino },
  "book antiqua": { body: palatino, head: palatino },
  cambria: { body: "Cambria,Georgia,serif", head: "Cambria,Georgia,serif" },
  calibri: { body: sansStack, head: sansStack },
  arial: { body: arial, head: arial },
  helvetica: { body: "Helvetica,Arial,sans-serif", head: "Helvetica,Arial,sans-serif" },
  "segoe ui": { body: "'Segoe UI',Arial,sans-serif", head: "'Segoe UI Semibold','Segoe UI',Arial,sans-serif" },
  verdana: { body: "Verdana,Arial,sans-serif", head: "Verdana,Arial,sans-serif" },
};
export { brandFont };
// Letters, digits, spaces and hyphens only: the name goes into the page's CSS.
const fontName = /^[\p{L}\p{N} -]{2,48}$/u;
const isSerif = (name: string) => /serif|times|georgia|garamond|cambria|book|roman|baskerville|palatino|caslon|minion|charter|lora|merriweather/i.test(name) && !/sans/i.test(name);
/** The CSS font stacks for a specification; unknown names are used as installed fonts with a sensible fallback. */
export function documentFonts(spec: Pick<DocumentSpec, "font" | "headingFont" | "kind" | "style">) {
  const pick = (name: unknown) => {
    if (typeof name !== "string" || brandFont.test(name)) return undefined;
    const key = name.trim().toLowerCase().replace(/\s+new roman$/, "");
    if (!key) return undefined;
    if (fonts[key]) return fonts[key];
    if (!fontName.test(name.trim())) return undefined;
    const stack = `'${name.trim()}',` + (isSerif(name) ? times : arial);
    return { body: stack, head: stack };
  };
  const body = pick(spec.font) || layoutFonts[layoutFor(spec)];
  return { body: body.body, head: pick(spec.headingFont)?.body || body.head };
}
/** Figures already drawn, so adding a part to a long document does not draw (and risk timing out) every earlier figure again. */
const drawn = new Map<string, string>();
async function drawFigure(figure: any) {
  const key = JSON.stringify(figure);
  const cached = drawn.get(key);
  if (cached) return cached;
  const svg = await kinetraCall(figure);
  if (typeof svg === "string" && svg.length < 4_000_000) {
    drawn.set(key, svg);
    if (drawn.size > 300) drawn.delete(drawn.keys().next().value!);
  }
  return svg;
}
/** Runs `work` over `items` a few at a time: each figure has a 5 s limit, and dozens started at once would starve each other. */
async function inTurns<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await work(items[i], i); }
  }));
  return results;
}
export const MAX_SECTIONS = 3000;
const unsafeSvg = /<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|file:|javascript:)/i;
const kinds = new Set(["report", "paper", "brief", "notes", "proposal", "manual", "handout", "worksheet", "letter", "memo", "document"]);
const kindLabel: Record<string, string> = { report: "Technical Report", paper: "Preprint", brief: "Briefing", notes: "Notes", proposal: "Proposal", manual: "Guide", handout: "Handout", worksheet: "Worksheet", letter: "Letter", memo: "Memorandum", document: "" };
const summaryLabel = (kind: string) => (kind === "paper" || kind === "report" ? "Abstract" : kind === "brief" || kind === "proposal" ? "Executive summary" : kind === "memo" ? "Summary" : "Overview");
/** Mowr numbers sections itself, so manual numbers in headings are removed. */
export const cleanHeading = (heading: string) => heading.replace(/^\s*(?:(?:\d+(?:\.\d+)*|[IVXLC]+|[A-Z])[.)]|\d+(?:\.\d+)+)\s+/, "").trim();

/** Checks the whole specification and renders every figure before any page is laid out.
 *  All problems (structure, voice and figures) are reported together, so the model can correct them in one pass. */
export async function renderFigures(spec: any, { checkVoice = true }: { checkVoice?: boolean } = {}) {
  if (!spec || typeof spec.title !== "string" || !spec.title.trim() || !Array.isArray(spec.sections) || spec.sections.length < 1)
    throw Error('Invalid PDF specification: expected {"title":string,"sections":[at least one section]}.');
  if (spec.sections.length > MAX_SECTIONS)
    throw Error(`This document would have ${spec.sections.length} sections; the limit is ${MAX_SECTIONS}. Use ### subsections inside fewer sections, or start a second document for the rest.`);
  // An export of the person's own answer (no voice check) may be any answer the app accepts (300k characters of Markdown, larger once encoded).
  const size = JSON.stringify(spec).length, limit = checkVoice ? 12_000_000 : 16_000_000;
  if (size > limit)
    throw Error(`This document would be ${size} characters; the limit is ${limit} (roughly 3,000 pages). Start a second document for the rest.`);
  for (const field of ["font", "headingFont"] as const)
    if (spec[field] !== undefined && (typeof spec[field] !== "string" || !fontName.test(spec[field].trim())))
      throw Error(`${field} must be a font name such as "Times New Roman", "Arial" or "Georgia".`);
  if (spec.kind !== undefined && !kinds.has(spec.kind)) throw Error(`Unknown document kind "${spec.kind}". Use one of: ${[...kinds].join(", ")}.`);
  if (spec.style !== undefined && !layouts.has(spec.style)) throw Error(`Unknown style "${spec.style}". Use one of: ${[...layouts].join(", ")}, or leave it out to follow the kind.`);
  const design = designProblems(spec.design);
  if (design.length) throw Error(design.join(" "));
  if (spec.plan !== undefined && (!Array.isArray(spec.plan) || spec.plan.some((h: unknown) => typeof h !== "string") || spec.plan.length > MAX_SECTIONS))
    throw Error("plan must be the list of every heading the finished document will have.");
  if (spec.references !== undefined && (!Array.isArray(spec.references) || spec.references.some((r: unknown) => typeof r !== "string") || spec.references.length > 2000))
    throw Error("references must be a list of citation strings.");
  const sections = spec.sections as Section[];
  const problems: string[] = [];
  sections.forEach((s, i) => {
    if (!s || typeof s !== "object" || (!s.heading && !s.text && !s.figure)) problems.push(`Section ${i + 1} is empty.`);
    else if ([s.heading, s.text, s.caption].some((v) => v !== undefined && v !== null && typeof v !== "string"))
      problems.push(`Section ${i + 1} "heading", "text" and "caption" must be strings.`);
    else if (s.figure && (typeof s.figure.module !== "string" || typeof s.figure.fn !== "string" || !Array.isArray(s.figure.args)))
      problems.push(`Section ${i + 1} figure must be {"module":string,"fn":string,"args":[…]}.`);
  });
  if (problems.length) throw Error(problems.join(" "));
  if (checkVoice) {
    const voice = voiceProblems(
      [
        { where: "Title", text: spec.title + " " + (spec.subtitle || "") },
        { where: "Summary", text: spec.summary || "" },
        ...sections.map((s, i) => ({ where: `Section ${i + 1}${s.heading ? ` (${s.heading})` : ""}`, text: [s.heading, s.text, s.caption].filter(Boolean).join("\n") })),
      ],
      spec.kind || "report",
    );
    if (voice.length)
      problems.push(`The text does not meet the document standard (formal, impersonal, written as the document itself): ${voice.slice(0, 8).join("; ")}. Rewrite these passages impersonally (for example "This report…", "The results show…").`);
  }
  const figures = await inTurns(sections, 4, async (s, i) => {
      if (!s.figure) return undefined;
      try {
        const svg = await drawFigure(s.figure);
        if (typeof svg !== "string" || !svg.includes("<svg"))
          throw Error(`${s.figure.module}.${s.figure.fn} returned data, not a drawing. Use a render function (see the figure recipes).`);
        if (unsafeSvg.test(svg)) throw Error("the generated figure contained unsupported content");
        return svg;
      } catch (error) {
        // An export of an answer the person already has prints without a visual that cannot be drawn, rather than not at all.
        if (!checkVoice) return undefined;
        problems.push(`Section ${i + 1} figure (${s.figure.module}.${s.figure.fn}) failed: ${(error as Error).message}`);
        return undefined;
      }
    });
  if (problems.length) throw Error(problems.join(" ") + " No PDF was created. Fix these problems and send the pdf action again.");
  return figures;
}

const longDate = (value?: string) => {
  const date = value && Number.isFinite(Date.parse(value)) ? new Date(value) : value ? null : new Date();
  return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : String(value);
};
/** A CSS string literal (for the running head), safe inside a <style> element. */
const cssString = (text: string) => '"' + text.replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ").replace(/</g, "\\3C ").replace(/\{/g, "\\7B ").replace(/\}/g, "\\7D ") + '"';
const runningTitle = (title: string) => (title.length > 90 ? title.slice(0, 87).replace(/\s+\S*$/, "") + "…" : title);

/** Page frame per layout: margins, running head (from page 2) and page numbers. Written with literal font stacks,
 *  since page-margin boxes do not see the document's custom properties. */
function pageCss(layout: Layout, type: { body: string; head: string }, title: string, label: string, design: Design = {}) {
  let css = pageFrame(layout, type, title, label).replace(/size:A4/g, "size:" + (design.pageSize || "A4"));
  if (design.margin) css = css.replace(/(@page\{size:\w+;)margin:[^;]+;/, `$1margin:${design.margin}mm;`);
  // Without a running head only the page number stays. Braces in the title are escaped (cssString), so this is exact.
  if (design.runningHead === false) css = css.replace(/@top-(?:left|center|right)\{[^}]*\}/g, "");
  return css;
}
function pageFrame(layout: Layout, type: { body: string; head: string }, title: string, label: string) {
  const head = cssString(runningTitle(title)), tag = cssString(label);
  const off = "@top-left{content:none;border:0}@top-center{content:none;border:0}@top-right{content:none;border:0}";
  if (layout === "letter")
    return `@page{size:A4;margin:25mm 25mm 24mm;@bottom-center{content:counter(page);font:9.5pt ${type.body};color:#333}}@page:first{@bottom-center{content:none}}`;
  if (layout === "business") {
    const box = `font:7.8pt ${type.head};color:#5b6270;vertical-align:bottom;padding-bottom:3pt;margin-bottom:5mm;border-bottom:.5pt solid #b9bec7`;
    return `@page{size:A4;margin:24mm 22mm 22mm;@top-left{content:${head};${box};text-align:left}@top-right{content:${tag};${box};text-align:right;letter-spacing:.08em;text-transform:uppercase}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:7.8pt ${type.head};color:#5b6270}}@page:first{${off}}`;
  }
  // Technical and notes: the running head of a LaTeX report (title, a small-caps label, a hairline) and a centred folio.
  const box = `font:${layout === "notes" ? "italic " : ""}9.5pt ${type.body};color:#111;vertical-align:bottom;padding-bottom:2.5pt;margin-bottom:6mm;border-bottom:.5pt solid #111`;
  return `@page{size:A4;margin:25mm 22mm 23mm;@top-left{content:"";${box}}@top-center{content:${head};${box}}@top-right{content:${tag};${box};font-style:normal;font-size:8.2pt;text-transform:uppercase;letter-spacing:.06em}@bottom-center{content:counter(page);font:10pt ${type.body};color:#111}}@page:first{${off}}`;
}

export const documentCss = `
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:10.5pt/1.36 var(--body);color:#111;font-variant-numeric:lining-nums proportional-nums;hyphens:auto;text-rendering:optimizeLegibility;font-kerning:normal}
a{color:inherit;text-decoration:none}
a.ref,.cite a{color:var(--link)}
body{--link:#1f57c3;--accent:#1f57c3;--tint:color-mix(in srgb,var(--accent) 7%,#fff)}
.layout-notes{--accent:var(--accent)}
.layout-business{--accent:var(--accent)}
.accented{--link:var(--accent)}
.accented h1,.accented h2,.accented h3,.accented .num{color:var(--accent)}
.accented .title-rule,.accented .doc-head{border-color:var(--accent)}
.columns-2 main{column-count:2;column-gap:7mm;column-fill:auto}
.columns-2 main figure,.columns-2 main table{break-inside:avoid}
body.title-left .doc-head,body.title-left .doc-head h1,body.title-left .doc-subtitle,body.title-left .doc-author,body.title-left .doc-date{text-align:left}
body.title-center .doc-head,body.title-center .doc-head h1,body.title-center .doc-subtitle,body.title-center .doc-meta,body.title-center .doc-kind{text-align:center}
p{margin:0 0 6pt;text-align:justify;orphans:3;widows:3}
ul,ol{margin:0 0 7pt;padding-left:18pt}
li{margin:2pt 0;text-align:justify}
li>p{margin:0 0 3pt}
li::marker{color:#111}
strong{font-weight:700}
h1,h2,h3,h4{font-family:var(--head);color:#111;break-after:avoid;hyphens:none;text-align:left}
h2{margin:18pt 0 8pt;font-size:12.2pt;font-weight:700;line-height:1.25}
h3{margin:13pt 0 6pt;font-size:10.8pt;font-weight:700;line-height:1.3}
h4{margin:11pt 0 5pt;font-size:10.5pt;font-weight:700;line-height:1.3}
.num{display:inline-block;min-width:2.1em}
h3 .num{min-width:2.8em}h4 .num{min-width:3.4em}
.runin{font-weight:700;margin-right:.6em}
code{font:8.9pt Consolas,'Cascadia Mono','Courier New',monospace}
pre{margin:7pt 0 10pt;padding:6pt 9pt;background:#f6f6f4;border-left:1.5pt solid #b4b4ae;white-space:pre-wrap;font-size:8.7pt;line-height:1.4;break-inside:avoid;text-align:left}
pre code{font-size:inherit}
blockquote{margin:8pt 0 10pt;padding:0 0 0 11pt;border-left:.8pt solid #888;color:#222}
blockquote p{text-align:left}
hr{border:0;border-top:.5pt solid #999;margin:12pt 0}
math{font-family:'Cambria Math','STIX Two Math',math}
.katex-display{display:block;margin:7pt 0 9pt;text-align:center;break-inside:avoid;position:relative}
.katex-display math{display:block math;font-size:1.08em}
.katex-error{color:#b00020}
.eqnum{counter-reset:eq}
.eqnum .katex-display{counter-increment:eq;padding:0 3.2em}
.eqnum .katex-display::after{content:"(" counter(eq) ")";position:absolute;right:0;top:50%;transform:translateY(-50%);font-size:10.5pt}
figure{margin:12pt 0 14pt;break-inside:avoid;text-align:center}
figure img{display:block;margin:0 auto 7pt;max-width:100%;max-height:112mm;object-fit:contain}
figcaption,caption{display:table;margin:0 auto;font-size:9.6pt;line-height:1.35;text-align:justify;color:#111}
caption{display:table-caption;caption-side:top;margin-bottom:6pt;text-align:center}
.cap-label{font-weight:400}
table{border-collapse:collapse;margin:10pt auto 12pt;max-width:100%;font:9.5pt/1.32 var(--body);font-variant-numeric:lining-nums tabular-nums;border-top:1pt solid #111;border-bottom:1pt solid #111}
thead{display:table-header-group}
tr{break-inside:avoid}
th{padding:4pt 8pt 3pt;text-align:left;font-weight:700;border-bottom:.6pt solid #111;vertical-align:bottom}
td{padding:3pt 8pt;text-align:left;vertical-align:top}
td[align=right],th[align=right]{text-align:right}td[align=center],th[align=center]{text-align:center}
.footnotes{margin:10pt 0 8pt;padding-top:4pt;border-top:.5pt solid #999;font-size:8.8pt;line-height:1.4}
.footnote-label{display:none}
.footnotes ol{padding-left:14pt;margin:0}
sup{font-size:.7em;line-height:0}
/* Theorem-like environments (> [!DEFINITION] …), as amsthm sets them. */
.env{margin:9pt 0 10pt;padding:0;border:0;color:#111}
.env p{text-align:justify}
.env-head{font-weight:700}
.env-title{font-weight:400}
.env-dot{font-weight:700}
.env-plain>p{font-style:italic}.env-plain .env-head,.env-plain .env-title,.env-plain .env-dot{font-style:normal}
.env-remark .env-head,.env-remark .env-dot,.env-proof .env-head,.env-proof .env-dot{font-style:italic;font-weight:400}
.env-proof>:last-child::after{content:"\\25A1";float:right;margin-left:1em}
.env-box{padding:6pt 10pt 1pt;border:.5pt solid #9a9a96;background:#f6f6f3;break-inside:avoid}
.env-warning,.env-caution,.env-mistake{border-color:#b48a3c;background:#fbf6ea}
/* Title block, contents, summary and references. */
.doc-toc{margin:6pt 0 16pt}
.doc-toc.page{break-before:page;break-after:page}
.toc-head{margin:0 0 8pt;font-size:12.2pt}
.toc-row{display:flex;align-items:flex-end;gap:0;margin:0;line-height:1.5;color:#111}
.toc-l2{font-weight:700;margin-top:4pt}
.toc-l3{padding-left:2.1em;font-size:10pt}
.toc-num{flex:none;min-width:2.1em}
.toc-l3 .toc-num{min-width:2.8em}
.toc-text{flex:0 1 auto}
.toc-fill{flex:1 1 auto;min-width:1.5em;height:1em;margin:0 .5em .28em;background:radial-gradient(circle,#444 .55pt,transparent .7pt) right bottom/4.5pt 2pt repeat-x}
.toc-l2 .toc-fill{background:none}
.doc-toc.page .toc-l2 .toc-fill{background:radial-gradient(circle,#444 .55pt,transparent .7pt) right bottom/4.5pt 2pt repeat-x}
.toc-page{flex:none;min-width:2.4em;text-align:right}
.doc-references h2 .num{display:none}
ol.refs{list-style:none;padding:0;margin:0;counter-reset:ref;font-size:9.6pt;line-height:1.35}
ol.refs li{position:relative;padding-left:2.6em;margin:0 0 4pt;text-align:left;counter-increment:ref}
ol.refs li::before{content:"[" counter(ref) "]";position:absolute;left:0}
.doc-summary p:last-child{margin-bottom:0}

/* technical */
.layout-technical .doc-head{text-align:center;margin:2mm 0 8mm}
.layout-technical .title-rule{border-top:2.4pt solid #111;border-bottom:2.4pt solid #111;padding:10pt 6pt 11pt;margin:0 0 15pt}
.layout-technical h1{margin:0;font-size:17.5pt;font-weight:400;font-variant:small-caps;letter-spacing:.015em;line-height:1.22;text-align:center}
.layout-technical .doc-subtitle{margin:0 0 4pt;font-size:11pt;font-variant:small-caps;letter-spacing:.03em;text-align:center}
.layout-technical .doc-author{margin:14pt 0 0;font-weight:700;font-size:11pt;text-align:center}
.layout-technical .doc-date{margin:3pt 0 0;font-size:10pt;text-align:center}
.layout-technical .doc-summary{margin:0 0 14pt}
.layout-technical .doc-summary h2{margin:0 0 6pt;text-align:center;font-size:12.5pt;font-weight:700;font-variant:small-caps;letter-spacing:.06em}
.layout-technical .doc-summary .abstract{margin:0 12mm}

/* notes */
.layout-notes .doc-head{margin:0 0 9mm;padding-bottom:9pt;border-bottom:.8pt solid #111}
.layout-notes .doc-kind{margin:0 0 7pt;font-variant:small-caps;letter-spacing:.08em;font-size:10.5pt;color:#444}
.layout-notes h1{margin:0;font-size:22pt;font-weight:700;line-height:1.15;letter-spacing:-.01em}
.layout-notes .doc-subtitle{margin:6pt 0 0;font-size:12.5pt;font-style:italic;color:#222}
.layout-notes .doc-meta{margin:9pt 0 0;font-size:9.8pt;color:#444}
.layout-notes h2{font-size:14pt;margin:20pt 0 9pt;padding-bottom:3pt;border-bottom:.5pt solid #9a9a96}
.layout-notes h2 .num{min-width:1.7em}
.layout-notes .doc-summary{margin:0 0 14pt;padding:7pt 11pt 6pt;border-left:2pt solid var(--accent);background:var(--tint)}
.layout-notes .doc-summary h2{margin:0 0 3pt;padding:0;border:0;font-size:10.5pt;font-variant:small-caps;letter-spacing:.06em}
.layout-notes .env-definition{padding:6pt 10pt 1pt;border-left:2pt solid var(--accent);background:var(--tint);break-inside:avoid}
.layout-notes .env-plain{padding:6pt 10pt 1pt;border:.6pt solid var(--accent);break-inside:avoid}
.layout-notes .env-example,.layout-notes .env-exercise,.layout-notes .env-problem,.layout-notes .env-question{background:none;border-left:2pt solid #9a9a96}
.layout-notes .doc-toc .toc-l2 .toc-fill{background:radial-gradient(circle,#444 .55pt,transparent .7pt) right bottom/4.5pt 2pt repeat-x}
.answer-line{display:flex;gap:16pt;margin:12pt 0 0;font-size:10.5pt}
.answer-line span{flex:1;border-bottom:.5pt solid #111;padding-bottom:1pt}
.answer-line span:first-child{flex:2}
.layout-notes.worksheet main ol>li{margin-bottom:14pt}

/* business */
.layout-business{font-size:10.3pt;line-height:1.42}
.layout-business .doc-head{margin:0 0 8mm;padding-bottom:10pt;border-bottom:2pt solid var(--accent)}
.layout-business .doc-kind{margin:0 0 8pt;font:700 8.4pt var(--head);letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.layout-business h1{margin:0;font-size:22pt;line-height:1.15;letter-spacing:-.01em;color:#141a2b}
.layout-business .doc-subtitle{margin:6pt 0 0;font:400 12pt/1.35 var(--head);color:#3d4556}
.layout-business .doc-meta{margin:10pt 0 0;font:8.8pt var(--head);color:#4e5667}
.layout-business .memo-table{margin:0;border:0;font:10pt var(--head)}
.layout-business .memo-table td{padding:2pt 14pt 2pt 0;border:0}
.layout-business .memo-table td:first-child{font-weight:700;color:var(--accent);text-transform:uppercase;font-size:8.4pt;letter-spacing:.1em;vertical-align:baseline}
.layout-business h2{color:#141a2b;font-size:12.6pt}
.layout-business h2 .num,.layout-business h3 .num{color:var(--accent)}
.layout-business .doc-summary{margin:0 0 15pt;padding:9pt 13pt 7pt;border-left:3pt solid var(--accent);background:var(--tint);break-inside:avoid}
.layout-business .doc-summary h2{margin:0 0 5pt;font:700 8.4pt var(--head);letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.layout-business table,.layout-business .doc-toc{font-family:var(--head);font-size:9pt}
.layout-business .doc-toc{font-size:9.8pt}
.layout-business th{background:#eef0f4}
.layout-business figcaption,.layout-business caption{font-family:var(--head);font-size:8.8pt;color:#2c3242}

/* letter */
.layout-letter{font-size:11pt;line-height:1.45}
.layout-letter .doc-head{margin:0 0 10mm}
.layout-letter .doc-author{margin:0;font-weight:700;text-align:right}
.layout-letter .doc-date{margin:2pt 0 9mm;text-align:right}
.layout-letter h1{margin:0;font-size:11pt;font-weight:700}
.layout-letter .doc-subtitle{margin:2pt 0 0;font-size:11pt}
.layout-letter p{text-align:left;margin-bottom:9pt}
.layout-letter h2{font-size:11pt;margin:14pt 0 6pt}
`;

const sectionWords = /\b(Figure|Fig\.|Table|Section|§)\s?(\d+(?:\.\d+)*)\b/g;
/** Cross-references and citations become links, as in a LaTeX document: "Figure 2", "Table 1", "Section 3.2" and
 *  [4] or [2, 5–7] when those exist. Code, preformatted text and maths are left alone. */
function linkText(html: string, targets: Set<string>, references: number) {
  return html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>|<math[\s\S]*?<\/math>|<[^>]+>)/g).map((part, i) => {
    if (i % 2) return part;
    let out = part.replace(sectionWords, (whole, word: string, n: string) => {
      const id = (/^(?:Figure|Fig\.)$/.test(word) ? "fig-" : word === "Table" ? "tab-" : "sec-") + n.replace(/\./g, "-");
      return targets.has(id) ? `${word}${word === "§" ? "" : " "}<a class="ref" href="#${id}">${n}</a>` : whole;
    });
    if (references)
      out = out.replace(/\[(\d{1,4}(?:\s*[,–-]\s*\d{1,4})*)\](?!\()/g, (whole, list: string) => {
        const numbers = list.match(/\d+/g)!.map(Number);
        if (numbers.some((n) => n < 1 || n > references)) return whole;
        return '<span class="cite">[' + list.replace(/\d+/g, (n) => `<a href="#ref-${n}">${n}</a>`) + "]</span>";
      });
    return out;
  }).join("");
}

/**
 * The print page for a specification. `pages` (from a first printing) fills the contents with page numbers;
 * the numbers sit in fixed-width slots, so filling them never moves anything else.
 */
export function documentHtml(spec: DocumentSpec, figures: (string | undefined)[], pages?: Map<string, number>) {
  const kind = String(spec.kind || "report");
  const layout = layoutFor(spec);
  const type = documentFonts(spec);
  const sections = spec.sections;
  const headed = sections.filter((s) => s.heading);
  const design: Design = spec.design || {};
  const numbered = design.numbered !== false && headed.length >= 2 && layout !== "letter";
  const label = kindLabel[kind] ?? "";
  const author = spec.author ? escape(spec.author) : "";
  const date = escape(longDate(spec.date));
  let head = "";
  if (layout === "technical")
    head = '<header class="doc-head"><div class="title-rule"><h1>' + escape(spec.title) + "</h1></div>" +
      (spec.subtitle ? '<p class="doc-subtitle">' + escape(spec.subtitle) + "</p>" : label ? '<p class="doc-subtitle">' + escape(label) + "</p>" : "") +
      (author ? '<p class="doc-author">' + author + "</p>" : "") + '<p class="doc-date">' + date + "</p></header>";
  else if (layout === "letter")
    head = '<header class="doc-head">' + (author ? '<p class="doc-author">' + author + "</p>" : "") + '<p class="doc-date">' + date + "</p><h1>" + escape(spec.title) + "</h1>" + (spec.subtitle ? '<p class="doc-subtitle">' + escape(spec.subtitle) + "</p>" : "") + "</header>";
  else if (kind === "memo")
    head = '<header class="doc-head"><p class="doc-kind">Memorandum</p><table class="memo-table"><tbody><tr><td>Subject</td><td><strong>' + escape(spec.title) + "</strong>" + (spec.subtitle ? " — " + escape(spec.subtitle) : "") + "</td></tr>" + (author ? "<tr><td>From</td><td>" + author + "</td></tr>" : "") + "<tr><td>Date</td><td>" + date + "</td></tr></tbody></table></header>";
  else
    head = '<header class="doc-head">' + (label ? '<p class="doc-kind">' + escape(label) + "</p>" : "") + "<h1>" + escape(spec.title) + "</h1>" +
      (spec.subtitle ? '<p class="doc-subtitle">' + escape(spec.subtitle) + "</p>" : "") +
      '<p class="doc-meta">' + (author ? author + " · " : "") + date + "</p>" +
      (kind === "worksheet" ? '<div class="answer-line"><span>Name</span><span>Date</span></div>' : "") + "</header>";

  // Numbering is written into the text (not CSS counters), so the contents, the PDF outline and cross-references agree.
  type Entry = { id: string; num: string; text: string; level: 2 | 3 };
  const toc: Entry[] = [];
  const targets = new Set<string>();
  let n2 = 0, figureNo = 0, tableNo = 0, envNo = 0;
  const parts = sections.map((section, i) => {
    const heading = section.heading ? cleanHeading(section.heading) : "";
    const num = numbered && heading ? String(++n2) : "";
    let html = "";
    if (heading) {
      const id = num ? "sec-" + num : "sec-u" + i;
      if (num) { targets.add(id); toc.push({ id, num, text: heading, level: 2 }); }
      html += '<h2 id="' + id + '">' + (num ? '<span class="num">' + num + "</span>" : "") + escape(heading) + "</h2>";
    }
    if (section.text) {
      let n3 = 0, n4 = 0, local = 0;
      html += markdownHtml(String(section.text), { top: 3 })
        .replace(/<h([3-6])>([\s\S]*?)<\/h\1>(\s*<p>)?/g, (_, level: string, inner: string, para?: string) => {
          if (level === "5" || level === "6" || !numbered || !num) {
            if (level >= "5") return para ? '<p><span class="runin">' + inner + "</span>" : '<p><span class="runin">' + inner + "</span></p>";
            return `<h${level}>${inner}</h${level}>${para || ""}`;
          }
          const sub = level === "3" ? `${num}.${++n3}` : `${num}.${n3}.${++n4}`;
          if (level === "3") n4 = 0;
          const id = "sec-" + sub.replace(/\./g, "-");
          targets.add(id);
          if (level === "3") toc.push({ id, num: sub, text: inner, level: 3 });
          return `<h${level} id="${id}"><span class="num">${sub}</span>${inner}</h${level}>${para || ""}`;
        })
        .replace(/<!--env-n-->/g, () => " " + (num ? `${num}.${++local}` : String(++envNo)))
        .replace(/<table>(<caption>)?/g, (_, caption?: string) => {
          if (!caption) return "<table>";
          targets.add("tab-" + ++tableNo);
          return `<table id="tab-${tableNo}"><caption><span class="cap-label">Table&#160;${tableNo}:</span> `;
        });
    }
    const svg = figures[i];
    if (svg && section.figure) {
      const id = "fig-" + ++figureNo;
      targets.add(id);
      html += '<figure id="' + id + '"><img alt="' + escape(section.caption || heading || "Figure") + '" src="data:image/svg+xml;base64,' +
        Buffer.from(standardFonts(svg, type.body)).toString("base64") +
        '"><figcaption><span class="cap-label">Figure&#160;' + figureNo + ":</span> " + (section.caption ? markdownHtml(section.caption, { inline: true }) : escape(heading)) + "</figcaption></figure>";
    }
    return '<section class="' + (num ? "" : "unnumbered") + '">' + html + "</section>";
  });
  const references = spec.references?.length || 0;
  let body = head;
  if (spec.summary) body += '<aside class="doc-summary"><h2>' + summaryLabel(kind) + '</h2><div class="abstract">' + linkText(markdownHtml(String(spec.summary), { top: 4 }), targets, references) + "</div></aside>";
  if (design.contents !== false && headed.length >= (design.contents ? 2 : 4) && (numbered || design.contents)) {
    // A short contents for a short document; a long one (as in a book) gets its own page and only top-level entries
    // once it would run to several pages.
    const listed = numbered ? toc : headed.map((s, i) => ({ id: "sec-u" + sections.indexOf(s), num: "", text: cleanHeading(s.heading!), level: 2 as const }));
    const entries = listed.length > 120 ? listed.filter((e) => e.level === 2) : listed;
    const own = entries.length > 14;
    const slot = (id: string) => '<span class="toc-page">' + (pages?.get(id) ?? "") + "</span>";
    body += '<nav class="doc-toc' + (own ? " page" : "") + '"><h2 class="toc-head">Contents</h2>' +
      entries.map((e) => `<a class="toc-row toc-l${e.level}" href="#${e.id}"><span class="toc-num">${e.num}</span><span class="toc-text">${e.level === 2 ? escape(e.text) : e.text}</span><span class="toc-fill"></span>${slot(e.id)}</a>`).join("") +
      (references ? `<a class="toc-row toc-l2" href="#references"><span class="toc-num"></span><span class="toc-text">References</span><span class="toc-fill"></span>${slot("references")}</a>` : "") +
      "</nav>";
  }
  body += "<main>" + parts.map((part) => linkText(part, targets, references)).join("") + "</main>";
  if (references) body += '<section class="doc-references"><h2 id="references">References</h2><ol class="refs">' + spec.references!.map((r, i) => '<li id="ref-' + (i + 1) + '">' + markdownHtml(r.replace(/^\s*\[\d+\]\s*/, ""), { inline: true }) + "</li>").join("") + "</ol></section>";
  const classes = ["layout-" + layout, numbered ? "numbered" : "plain", kind === "worksheet" ? "worksheet" : "", layout === "technical" && numbered ? "eqnum" : "", design.accent ? "accented" : "", design.columns === 2 ? "columns-2" : "", design.titleAlign ? "title-" + design.titleAlign : ""].filter(Boolean).join(" ");
  const custom = (design.accent ? `body{--accent:${design.accent}}` : "") +
    (design.fontSize || design.lineHeight ? `body{${design.fontSize ? `font-size:${design.fontSize}pt;` : ""}${design.lineHeight ? `line-height:${design.lineHeight}` : ""}}` : "") +
    (design.css ? cleanCss(design.css) : "");
  return (
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>' + escape(spec.title) + '</title><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><style>' +
    pageCss(layout, type, spec.title, label, design) + ":root{--body:" + type.body + ";--head:" + type.head + "}" + documentCss + custom + '</style><body class="' + classes + '">' + body + "</body></html>"
  );
}

const headingKey = (heading: string) => cleanHeading(heading).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** The planned headings a specification does not have yet (each matched to a written heading or ### subheading). */
export function unwritten(spec: Pick<DocumentSpec, "plan" | "sections">) {
  if (!Array.isArray(spec.plan) || !spec.plan.length) return [];
  const written = spec.sections.flatMap((s) => [s.heading || "", ...[...String(s.text || "").matchAll(/^#{1,4}\s+(.+)$/gm)].map((m) => m[1])]).map(headingKey).filter(Boolean);
  return spec.plan.filter((planned) => {
    const key = headingKey(planned);
    return key && !written.some((w) => w === key || (w.length > 3 && key.length > 3 && (w.startsWith(key) || key.startsWith(w))));
  });
}

/** Each ```visual block becomes a marker line, and the visual itself a printed figure (Kinetra mowr.visual). */
const VISUAL_MARK = /^\u0000visual(\d+)\u0000$/;
/** A Markdown answer as a document: the first heading is the title and "##" headings start sections.
 *  Every ```visual is printed as a numbered figure where it stood; the other interactive blocks (check, edit,
 *  automation) are left out of the printed copy. */
export function markdownDocument(markdown: string, fallbackTitle = "Document"): DocumentSpec {
  const visuals = visualBlocks(markdown);
  let marked = markdown;
  for (let i = visuals.length - 1; i >= 0; i--) marked = marked.slice(0, visuals[i].start) + `\n\u0000visual${i}\u0000\n` + marked.slice(visuals[i].end);
  const text = marked.replace(/```(?:visual|check|edit|automation)[\s\S]*?(?:```|$)/g, "").replace(/\[\[([^\]|,]+)(?:,\s*p\.\s*(\d+))?\]\]/g, (_, file, page) => `(${file.trim()}${page ? ", p. " + page : ""})`).trim();
  const lines = text.split("\n");
  let title = fallbackTitle;
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && /^#\s+/.test(lines[first])) { title = lines[first].replace(/^#\s+/, "").trim(); lines.splice(first, 1); }
  else if (first >= 0 && !VISUAL_MARK.test(lines[first]) && lines[first].trim().length <= 90 && /^\*\*[^*]+\*\*$|^[^.!?]+$/.test(lines[first].trim()) && lines.length > 3) { title = lines[first].replace(/\*\*/g, "").replace(/^#+\s*/, "").trim(); lines.splice(first, 1); }
  const sections: Section[] = [];
  let current: Section = {};
  let fence = false;
  for (const line of lines) {
    // "## " inside a fenced code block is code, not a section.
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = fence ? null : /^##\s+(.+)$/.exec(line);
    const visual = fence ? null : VISUAL_MARK.exec(line);
    if (visual) {
      // A section holds one figure, after its text: the text that follows the visual continues in an unheaded section.
      const spec = visuals[Number(visual[1])].spec;
      sections.push({ ...current, figure: { module: "mowr", fn: "visual", args: [spec] }, caption: visualCaption(spec) || undefined });
      current = {};
    } else if (heading) { if (current.heading || current.text?.trim()) sections.push(current); current = { heading: heading[1].trim(), text: "" }; }
    else current.text = (current.text || "") + line + "\n";
  }
  if (current.heading || current.text?.trim()) sections.push(current);
  // A document holds at most MAX_SECTIONS sections: a longer answer keeps every part, with neighbouring "##" parts sharing one section.
  const per = Math.ceil(sections.length / MAX_SECTIONS), merged: Section[] = [];
  for (let i = 0; i < sections.length; i += per) {
    const group = sections.slice(i, i + per);
    merged.push({ ...group[0], text: [group[0].text, ...group.slice(1).map((s) => (s.heading ? "## " + s.heading + "\n\n" : "") + (s.text || ""))].join("\n\n") });
  }
  return { title: title.slice(0, 160), kind: "document", sections: merged.length ? merged.map((s) => ({ ...s, text: s.text?.trim() })) : [{ text: text || " " }] };
}
