import { kinetraCall } from "./kinetra-runtime.ts";
import { markdownHtml } from "./pdf-markdown.ts";
import { brandFontFaces } from "./brand-fonts.ts";
import { voiceProblems, type DocumentKind } from "../core/document-standard.ts";
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
  author?: string;
  date?: string;
  summary?: string;
  sections: Section[];
  references?: string[];
  /** The typeface the person asked for: a preset (see `fonts`) or the name of a font installed on this PC. */
  font?: string;
  /** A different typeface for headings, tables and captions; defaults to one that suits `font`. */
  headingFont?: string;
};

/** Standard document typefaces, so a PDF reads like a document rather than like the app. Mowr's own fonts only on request. */
const sansStack = "Calibri,'Segoe UI',Carlito,Arial,sans-serif";
export const fonts: Record<string, { body: string; head: string }> = {
  classic: { body: "Cambria,Georgia,'Times New Roman',serif", head: sansStack },
  serif: { body: "Georgia,Cambria,'Times New Roman',serif", head: "Georgia,Cambria,'Times New Roman',serif" },
  sans: { body: sansStack, head: sansStack },
  times: { body: "'Times New Roman',Times,serif", head: "'Times New Roman',Times,serif" },
  georgia: { body: "Georgia,serif", head: "Georgia,serif" },
  garamond: { body: "Garamond,'EB Garamond','Times New Roman',serif", head: "Garamond,'EB Garamond','Times New Roman',serif" },
  cambria: { body: "Cambria,Georgia,serif", head: "Cambria,Georgia,serif" },
  calibri: { body: sansStack, head: sansStack },
  arial: { body: "Arial,Helvetica,sans-serif", head: "Arial,Helvetica,sans-serif" },
  helvetica: { body: "Helvetica,Arial,sans-serif", head: "Helvetica,Arial,sans-serif" },
  "segoe ui": { body: "'Segoe UI',Arial,sans-serif", head: "'Segoe UI Semibold','Segoe UI',Arial,sans-serif" },
  verdana: { body: "Verdana,Arial,sans-serif", head: "Verdana,Arial,sans-serif" },
  mowafy: { body: "'Mowafy Serif',serif", head: "'Mowafy Sans','Segoe UI',Arial,sans-serif" },
};
// Letters, digits, spaces and hyphens only: the name goes into the page's CSS.
const fontName = /^[\p{L}\p{N} -]{2,48}$/u;
const isSerif = (name: string) => /serif|times|georgia|garamond|cambria|book|roman|baskerville|palatino|caslon|minion|charter|lora|merriweather/i.test(name) && !/sans/i.test(name);
/** The CSS font stacks for a specification; unknown names are used as installed fonts with a sensible fallback. */
export function documentFonts(spec: Pick<DocumentSpec, "font" | "headingFont">) {
  const pick = (name: unknown) => {
    const key = typeof name === "string" ? name.trim().toLowerCase().replace(/^mowafy.*/, "mowafy").replace(/\s+new roman$/, "") : "";
    if (!key) return undefined;
    if (fonts[key]) return fonts[key];
    if (!fontName.test(String(name).trim())) return undefined;
    const stack = `'${String(name).trim()}',` + (isSerif(String(name)) ? fonts.classic.body : sansStack);
    return { body: stack, head: stack };
  };
  const body = pick(spec.font) || fonts.classic;
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
const MAX_SECTIONS = 3000;
const unsafeSvg = /<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|file:|javascript:)/i;
const kinds = new Set(["report", "paper", "brief", "notes", "proposal", "manual", "handout", "worksheet", "letter", "memo", "document"]);
const kindLabel: Record<string, string> = { report: "Technical report", paper: "Paper", brief: "Briefing", notes: "Notes", proposal: "Proposal", manual: "Guide", handout: "Handout", worksheet: "Worksheet", letter: "Letter", memo: "Memorandum", document: "" };
const summaryLabel = (kind: string) => (kind === "paper" ? "Abstract" : kind === "report" || kind === "brief" || kind === "proposal" ? "Executive summary" : "Summary");
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
  if (spec.references !== undefined && (!Array.isArray(spec.references) || spec.references.some((r: unknown) => typeof r !== "string") || spec.references.length > 200))
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

export const documentCss = `
@page{size:A4;margin:24mm 21mm 22mm 21mm}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:10.4pt/1.55 var(--body);color:#1b1d21;font-variant-numeric:lining-nums proportional-nums;hyphens:auto;text-rendering:optimizeLegibility;font-kerning:normal}
.doc-head{padding-bottom:14pt;margin-bottom:18pt;border-bottom:.9pt solid #1b1d21}
.doc-kind{margin:0 0 9pt;font:700 7.6pt/1 var(--head);letter-spacing:.16em;text-transform:uppercase;color:#1f4e79}
h1{margin:0;font:700 22.5pt/1.16 var(--head);letter-spacing:-.25pt;color:#101114;hyphens:none}
.doc-subtitle{margin:7pt 0 0;font:400 12pt/1.35 var(--head);color:#4a4f57;hyphens:none}
.doc-meta{display:flex;gap:18pt;margin-top:12pt;font:8.6pt var(--head);color:#5c6169}
.doc-meta span+span::before{content:"";display:inline-block;width:3pt;height:3pt;border-radius:50%;background:#9aa0a8;margin:0 18pt 1.5pt -11pt;vertical-align:middle}
.doc-summary{margin:0 0 18pt;padding:10pt 13pt 4pt;border-left:2.2pt solid #1f4e79;background:#f3f6f9;break-inside:avoid}
.doc-summary h2{margin:0 0 5pt;font:700 8pt var(--head);letter-spacing:.12em;text-transform:uppercase;color:#1f4e79}
.doc-summary h2::before{content:none}
.doc-summary p{text-align:left}
.doc-toc{margin:0 0 20pt;break-inside:avoid;font:9.4pt/1.7 var(--head)}
.doc-toc h2{margin:0 0 4pt;font:700 8pt var(--head);letter-spacing:.12em;text-transform:uppercase;color:#5c6169}
.doc-toc h2::before{content:none}
.doc-toc ol{margin:0;padding:0;list-style:none;counter-reset:toc}
.doc-toc li{counter-increment:toc;display:flex;gap:10pt;border-bottom:.4pt dotted #c4c8cd}
.doc-toc li::before{content:counter(toc);min-width:16pt;color:#1f4e79;font-weight:700}
main{counter-reset:h2 figure table}
section{counter-reset:h3}
h2,h3,h4{font-family:var(--head);color:#101114;break-after:avoid;hyphens:none;text-align:left}
h2{margin:20pt 0 7pt;font-size:13.6pt;font-weight:700;line-height:1.25;counter-increment:h2}
h2::before{content:counter(h2);display:inline-block;min-width:22pt;color:#1f4e79}
h3{margin:14pt 0 5pt;font-size:11.2pt;font-weight:700;line-height:1.3;counter-increment:h3}
section h3::before{content:counter(h2) "." counter(h3);display:inline-block;min-width:30pt;color:#1f4e79;font-weight:700}
body.plain h2::before,body.plain h3::before,section.unnumbered h3::before{content:none}
h4{margin:11pt 0 4pt;font-size:10.4pt;font-weight:700}
p{margin:0 0 7.5pt;text-align:justify;orphans:3;widows:3}
ul,ol{margin:0 0 8pt;padding-left:17pt}
li{margin:2.5pt 0;text-align:left}
li>p{margin:0}
strong{font-weight:700;color:#101114}
table{counter-increment:table;border-collapse:collapse;width:100%;margin:10pt 0 13pt;font:9pt/1.4 var(--head);font-variant-numeric:lining-nums tabular-nums;border-top:1pt solid #1b1d21;border-bottom:1pt solid #1b1d21;break-inside:avoid}
th{padding:5pt 8pt;text-align:left;font-weight:700;border-bottom:.6pt solid #1b1d21;vertical-align:bottom}
td{padding:4pt 8pt;text-align:left;vertical-align:top;border-bottom:.3pt solid #d9dce0}
tr:last-child td{border-bottom:0}
td[align=right],th[align=right]{text-align:right}td[align=center],th[align=center]{text-align:center}
code{font:8.8pt Consolas,'Cascadia Mono',monospace;background:#f2f3f5;padding:.5pt 2.5pt;border-radius:2pt}
pre{margin:8pt 0 11pt;padding:8pt 10pt;background:#f6f7f8;border:.5pt solid #dfe2e6;border-radius:2pt;white-space:pre-wrap;font-size:8.6pt;line-height:1.45;break-inside:avoid}
pre code{background:none;padding:0}
blockquote{margin:9pt 0 11pt;padding:6pt 11pt;border-left:2pt solid #9aa0a8;background:#f6f7f8;color:#30343a;break-inside:avoid}
blockquote p{margin:3pt 0;text-align:left}
hr{border:0;border-top:.5pt solid #c4c8cd;margin:14pt 0}
math{font-size:1.06em}
.katex-display{display:block;margin:9pt 0 11pt;text-align:center;break-inside:avoid}
.katex-display math{display:block;font-size:1.22em}
.katex-error{color:#b00020}
figure{counter-increment:figure;margin:13pt 0 15pt;break-inside:avoid;text-align:center}
figure img{display:block;margin:0 auto;max-width:100%;max-height:118mm;object-fit:contain}
figcaption{margin:7pt auto 0;max-width:92%;font:8.6pt/1.45 var(--head);color:#30343a;text-align:left}
figcaption::before{content:"Figure " counter(figure) ". ";font-weight:700;color:#101114}
.source{color:#80868e}
.footnotes{margin:12pt 0 8pt;padding-top:5pt;border-top:.5pt solid #c4c8cd;font-size:8.8pt;line-height:1.45}
.footnote-label{margin:0 0 3pt;font:700 7.6pt var(--head);letter-spacing:.12em;text-transform:uppercase;color:#5c6169}
.footnotes ol{padding-left:15pt}
.doc-references{margin-top:22pt}
.doc-references h2::before{content:none}
.doc-references ol{padding-left:22pt;font-size:9.2pt;line-height:1.45}
.doc-references li{padding-left:3pt;margin:3pt 0}
.doc-end{margin-top:22pt;padding-top:6pt;border-top:.5pt solid #c4c8cd;font:7.6pt var(--head);color:#80868e}
`;

export function documentHtml(spec: DocumentSpec, figures: (string | undefined)[]) {
  const kind = String(spec.kind || "report");
  const type = documentFonts(spec);
  const sections = spec.sections;
  const headed = sections.filter((s) => s.heading);
  const numbered = headed.length >= 2;
  let body = '<header class="doc-head">' +
    (kindLabel[kind] ? '<p class="doc-kind">' + escape(kindLabel[kind]) + "</p>" : "") +
    "<h1>" + escape(spec.title) + "</h1>" +
    (spec.subtitle ? '<p class="doc-subtitle">' + escape(spec.subtitle) + "</p>" : "") +
    '<div class="doc-meta">' + (spec.author ? "<span>" + escape(spec.author) + "</span>" : "") + "<span>" + escape(longDate(spec.date)) + "</span></div></header>";
  if (spec.summary) body += '<aside class="doc-summary"><h2>' + summaryLabel(kind) + "</h2>" + markdownHtml(String(spec.summary), { top: 4 }) + "</aside>";
  if (headed.length >= 4) body += '<nav class="doc-toc"><h2>Contents</h2><ol>' + headed.map((s) => "<li>" + escape(cleanHeading(s.heading!)) + "</li>").join("") + (spec.references?.length ? "<li>References</li>" : "") + "</ol></nav>";
  body += "<main>";
  sections.forEach((section, i) => {
    body += '<section class="' + (numbered && section.heading ? "" : "unnumbered") + '">';
    if (section.heading) body += "<h2>" + escape(cleanHeading(section.heading)) + "</h2>";
    if (section.text) body += markdownHtml(String(section.text), { top: 3 });
    const svg = figures[i];
    if (svg && section.figure)
      body +=
        '<figure><img alt="' + escape(section.caption || section.heading || "Figure") + '" src="data:image/svg+xml;base64,' +
        Buffer.from(svg).toString("base64") +
        '"><figcaption>' +
        (section.caption ? escape(section.caption) + " " : "") +
        '<span class="source">Computed with Kinetra (' + escape(section.figure.module + "." + section.figure.fn) + ").</span></figcaption></figure>";
    body += "</section>";
  });
  body += "</main>";
  if (spec.references?.length) body += '<section class="doc-references"><h2>References</h2><ol>' + spec.references.map((r) => "<li>" + markdownHtml(r, { inline: true }) + "</li>").join("") + "</ol></section>";
  return (
    '<!doctype html><html lang="en-GB"><meta charset="utf-8"><title>' + escape(spec.title) + '</title><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; font-src data:; style-src \'unsafe-inline\'"><style>' +
    (/mowafy/i.test(type.body + type.head) ? brandFontFaces() : "") + ":root{--body:" + type.body + ";--head:" + type.head + "}" + documentCss + '</style><body class="' + (numbered ? "numbered" : "plain") + '">' + body + "</body></html>"
  );
}

/** A Markdown answer as a document: the first heading is the title and "##" headings start sections.
 *  Mowr's interactive blocks (visual, check, edit) are left out of the printed copy. */
export function markdownDocument(markdown: string, fallbackTitle = "Document"): DocumentSpec {
  const text = markdown.replace(/```(?:visual|check|edit)[\s\S]*?(?:```|$)/g, "").replace(/\[\[([^\]|,]+)(?:,\s*p\.\s*(\d+))?\]\]/g, (_, file, page) => `(${file.trim()}${page ? ", p. " + page : ""})`).trim();
  const lines = text.split("\n");
  let title = fallbackTitle;
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && /^#\s+/.test(lines[first])) { title = lines[first].replace(/^#\s+/, "").trim(); lines.splice(first, 1); }
  else if (first >= 0 && lines[first].trim().length <= 90 && /^\*\*[^*]+\*\*$|^[^.!?]+$/.test(lines[first].trim()) && lines.length > 3) { title = lines[first].replace(/\*\*/g, "").replace(/^#+\s*/, "").trim(); lines.splice(first, 1); }
  const sections: Section[] = [];
  let current: Section = {};
  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) { if (current.heading || current.text?.trim()) sections.push(current); current = { heading: heading[1].trim(), text: "" }; }
    else current.text = (current.text || "") + line + "\n";
  }
  if (current.heading || current.text?.trim()) sections.push(current);
  // A document holds at most 300 sections: a longer answer keeps every part, with neighbouring "##" parts sharing one section.
  const per = Math.ceil(sections.length / 300), merged: Section[] = [];
  for (let i = 0; i < sections.length; i += per) {
    const group = sections.slice(i, i + per);
    merged.push({ ...group[0], text: [group[0].text, ...group.slice(1).map((s) => (s.heading ? "## " + s.heading + "\n\n" : "") + (s.text || ""))].join("\n\n") });
  }
  return { title: title.slice(0, 160), kind: "document", sections: merged.length ? merged.map((s) => ({ ...s, text: s.text?.trim() })) : [{ text: text || " " }] };
}
