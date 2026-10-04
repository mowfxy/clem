import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, LevelFormat, BorderStyle,
  ShadingType, Header, Footer, PageNumber, AlignmentType, ImageRun, ExternalHyperlink, InternalHyperlink, Bookmark,
  FootnoteReferenceRun, Math as WordMath, TabStopType, SectionType, PageOrientation, VerticalAlign, TableLayoutType,
} from "docx";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import { normalizeMath } from "../core/math-markdown.ts";
import { renderFigures, documentFonts, layoutFor, cleanHeading, type DocumentSpec, type Layout } from "./pdf-document.ts";
import { environments, unnumbered } from "./pdf-markdown.ts";
import { rasterizer } from "./rasterize.ts";
import { latexMathml, wordMath, wordUpright } from "./docx-math.ts";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

/**
 * Word documents from the same specification as Mowr's PDFs, built as a real Word file rather than a picture of
 * one: Title and Heading styles (so the navigation pane and Word's own contents work), numbered sections, native
 * editable equations, Word tables, captioned figures, framed definitions and theorems, footnotes, running heads
 * and page numbers. The four page designs follow the PDF ones (technical, notes, business, letter).
 */
type Raster = Awaited<ReturnType<typeof rasterizer>>;
type Run = TextRun | ExternalHyperlink | FootnoteReferenceRun | WordMath | ImageRun;
type Block = Paragraph | Table;
type Marks = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean; superScript?: boolean };

const kindLabel: Record<string, string> = { report: "Technical Report", paper: "Preprint", brief: "Briefing", notes: "Lecture Notes", proposal: "Proposal", manual: "Guide", handout: "Handout", worksheet: "Worksheet", letter: "", memo: "Memorandum", document: "" };
const summaryLabel = (kind: string) => (kind === "paper" || kind === "report" ? "Abstract" : kind === "brief" || kind === "proposal" ? "Executive summary" : kind === "memo" ? "Summary" : "Overview");
const pages: Record<string, { width: number; height: number }> = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 }, Legal: { width: 12240, height: 20160 }, A5: { width: 8391, height: 11906 } };
/** The first family of a CSS font stack: the name Word looks up. */
const family = (stack: string) => stack.split(",")[0].replace(/['"]/g, "").trim();
const hex = (color: string | undefined, fallback: string) => (color && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? color.replace("#", "").replace(/^(.)(.)(.)$/, "$1$1$2$2$3$3").toUpperCase() : fallback);
/** A pale tint of the accent, for boxes and table headers. */
const tint = (color: string, amount = 0.9) => [0, 2, 4].map((i) => Math.round(parseInt(color.slice(i, i + 2), 16) + (255 - parseInt(color.slice(i, i + 2), 16)) * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
const parse = (text: string) => fromMarkdown(normalizeMath(text).replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, "$$$$\n$1\n$$$$"), { extensions: [gfm(), math()], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] });
const plainText = (node: any): string => node.value ?? (node.children || []).map(plainText).join("");

const designs: Record<Layout, { accent: string; size: number; line: number; justify: boolean; headSize: [number, number, number]; titleSize: number; titleAlign: "left" | "center" }> = {
  technical: { accent: "1A1A1A", size: 22, line: 264, justify: true, headSize: [26, 23, 22], titleSize: 36, titleAlign: "center" },
  notes: { accent: "1F3A5F", size: 22, line: 288, justify: true, headSize: [30, 25, 22], titleSize: 44, titleAlign: "left" },
  business: { accent: "1F4E79", size: 21, line: 276, justify: false, headSize: [30, 24, 22], titleSize: 48, titleAlign: "left" },
  letter: { accent: "1A1A1A", size: 22, line: 264, justify: false, headSize: [24, 22, 22], titleSize: 28, titleAlign: "left" },
};

/** `drawn` receives the figures as placed in the document. */
export async function wordDocument(spec: DocumentSpec, { checkVoice = true, drawn }: { checkVoice?: boolean; drawn?: (figures: (string | undefined)[]) => void } = {}) {
  // The checks are the PDF's; the message names this file type.
  const figures = await renderFigures(spec, { checkVoice }).catch((error: Error) => {
    throw Error(error.message.replace("No PDF was created. Fix these problems and send the pdf action again.", "No Word document was created. Fix these problems and send the docx action again.").replace("Invalid PDF specification", "Invalid document specification"));
  });
  drawn?.(figures);
  const raster = await rasterizer();
  try {
    return await build(spec, figures, raster);
  } finally {
    raster.close();
  }
}

async function build(spec: DocumentSpec, figures: (string | undefined)[], raster: Raster) {
  const layout = layoutFor(spec);
  const base = designs[layout];
  const design = spec.design || {};
  const kind = String(spec.kind || (layout === "technical" ? "report" : layout === "business" ? "brief" : layout === "letter" ? "letter" : "notes"));
  const type = documentFonts(spec);
  const bodyFont = family(type.body), headFont = family(type.head);
  const accent = hex(design.accent, base.accent);
  const size = design.fontSize ? Math.round(design.fontSize * 2) : base.size;
  const line = design.lineHeight ? Math.round(design.lineHeight * 240) : base.line;
  const numbered = design.numbered ?? !(layout === "letter" || kind === "memo");
  const page = pages[design.pageSize || "A4"] || pages.A4;
  const margin = Math.round((design.margin ?? 25) * 56.7);
  const columns = design.columns === 2 ? 2 : 1;
  const textWidthPx = Math.round(((page.width - 2 * margin) / 1440) * 96 / columns) - (columns === 2 ? 12 : 0);
  const equationsNumbered = layout === "technical";
  // Tables have fixed column widths across the text block; Word would otherwise shrink a box to its contents.
  const textTwips = Math.round((page.width - 2 * margin) / columns) - (columns === 2 ? 220 : 0);
  const span = (fractions: number[]) => ({ width: { size: textTwips, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: fractions.map((f) => Math.round(f * textTwips)) });
  const cellWidth = (fraction: number) => ({ size: Math.round(fraction * textTwips), type: WidthType.DXA });
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  let footnoteNo = 0, figureNo = 0, tableNo = 0, equationNo = 0, orderedInstance = 0;

  /** Inline Markdown as Word runs: emphasis, code, links, inline equations and footnote marks. */
  const inline = async (nodes: any[], marks: Marks = {}, notes?: Map<string, number>): Promise<Run[]> => {
    const out: Run[] = [];
    for (const node of nodes) {
      switch (node.type) {
        case "text": {
          // A line break inside a paragraph stays a space, as in print.
          out.push(new TextRun({ text: node.value.replace(/\s*\n\s*/g, " "), bold: marks.bold, italics: marks.italics, strike: marks.strike, superScript: marks.superScript }));
          break;
        }
        case "strong": out.push(...(await inline(node.children, { ...marks, bold: true }, notes))); break;
        case "emphasis": out.push(...(await inline(node.children, { ...marks, italics: true }, notes))); break;
        case "delete": out.push(...(await inline(node.children, { ...marks, strike: true }, notes))); break;
        case "inlineCode": out.push(new TextRun({ text: node.value, font: "Consolas", size: size - 2, shading: { type: ShadingType.CLEAR, fill: "F1F2F4", color: "auto" } })); break;
        case "break": out.push(new TextRun({ text: "", break: 1 })); break;
        case "inlineMath": out.push(...(await equation(node.value, false))); break;
        case "link": {
          const children = (await inline(node.children, marks, notes)).filter((r): r is TextRun => r instanceof TextRun);
          if (/^(https?:|mailto:)/i.test(node.url)) out.push(new ExternalHyperlink({ link: node.url, children: children.length ? children.map((r) => r) : [new TextRun({ text: node.url })] }));
          else out.push(...children);
          break;
        }
        case "footnoteReference": {
          const n = notes?.get(node.identifier);
          if (n) out.push(new FootnoteReferenceRun(n));
          break;
        }
        case "image": break;
        case "html": out.push(new TextRun({ text: node.value.replace(/<[^>]+>/g, "") })); break;
        default: if (node.children) out.push(...(await inline(node.children, marks, notes))); else if (node.value) out.push(new TextRun({ text: node.value }));
      }
    }
    return out;
  };

  /** An equation as Word maths; LaTeX Word cannot hold (a matrix, aligned rows) becomes a picture of the typeset maths. */
  const equation = async (latex: string, display: boolean): Promise<Run[]> => {
    const parts = wordMath(latex, display);
    if (parts) return [new WordMath({ children: parts })];
    try {
      const shot = await raster.math(latexMathml(latex, display), { size: display ? 22 : 17, display });
      const scale = display ? 0.78 : 0.66;
      return [new ImageRun({ type: "png", data: shot.png, transformation: { width: Math.round(shot.width * scale * 1.33), height: Math.round(shot.height * scale * 1.33) }, altText: { name: "Equation", description: latex, title: latex } })];
    } catch {
      return [new TextRun({ text: latex, font: "Cambria Math", italics: true })];
    }
  };

  const bodyParagraph = (children: Run[], extra: Record<string, unknown> = {}) =>
    new Paragraph({ children, alignment: base.justify && columns === 1 ? AlignmentType.JUSTIFIED : AlignmentType.LEFT, spacing: { after: 120, line }, ...extra });

  const caption = (label: string, text: Run[], above = false) =>
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: above, spacing: { before: above ? 160 : 60, after: above ? 60 : 200 }, children: [new TextRun({ text: label + (text.length ? ". " : ""), bold: true, size: size - 2, font: headFont }), ...text.map((r) => r)], style: "Caption" });

  /** Section-level blocks from Markdown. `top` is the Word heading level the section's own ### headings start at. */
  const blocks = async (markdown: string, section: { number: string; counters: number[]; env: number }): Promise<Block[]> => {
    const tree: any = parse(markdown);
    const notes = new Map<string, number>();
    for (const node of tree.children) if (node.type === "footnoteDefinition") notes.set(node.identifier, ++footnoteNo);
    for (const node of tree.children) if (node.type === "footnoteDefinition") {
      const paragraphs: Paragraph[] = [];
      for (const child of node.children) paragraphs.push(new Paragraph({ children: await inline(child.children || [], {}, notes) }));
      footnotes[notes.get(node.identifier)!] = { children: paragraphs.length ? paragraphs : [new Paragraph("")] };
    }
    const depths = tree.children.filter((n: any) => n.type === "heading").map((n: any) => n.depth);
    const shallowest = depths.length ? Math.min(...depths) : 3;
    let pendingTableCaption: Run[] | null = null;
    const out: Block[] = [];
    const walk = async (nodes: any[], into: Block[], level = 0, quote = false) => {
      for (const node of nodes) {
        switch (node.type) {
          case "heading": {
            const depth = node.depth - shallowest; // 0 → subsection, 1 → sub-subsection, deeper → run-in
            const text = cleanHeading(plainText(node));
            if (depth <= 1) {
              section.counters[depth]++;
              section.counters.fill(0, depth + 1);
              const label = numbered && section.number ? [section.number, ...section.counters.slice(0, depth + 1)].join(".") + "  " : "";
              into.push(new Paragraph({ heading: depth === 0 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, keepNext: true, children: [new TextRun({ text: label + text })] }));
            } else into.push(new Paragraph({ keepNext: true, spacing: { before: 120, after: 60 }, children: [new TextRun({ text, bold: true, font: headFont })] }));
            break;
          }
          case "paragraph": {
            const text = plainText(node);
            // "Table: caption" just before a table is that table's caption.
            const tableCaption = /^Table:\s*/.exec(text);
            if (tableCaption) { pendingTableCaption = await inline(node.children.map((c: any, i: number) => (i === 0 && c.type === "text" ? { ...c, value: c.value.replace(/^Table:\s*/, "") } : c)), {}, notes); break; }
            into.push(bodyParagraph(await inline(node.children, quote ? { italics: true } : {}, notes), quote ? { indent: { left: 567, right: 567 } } : {}));
            break;
          }
          case "math": {
            const runs = await equation(node.value, true);
            if (equationsNumbered) {
              // Alone in its paragraph the equation stays in display style; its number sits in a cell to the right.
              const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
              into.push(new Table({
                ...span([0.1, 0.8, 0.1]),
                borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
                rows: [new TableRow({ cantSplit: true, children: [
                  new TableCell({ width: cellWidth(0.1), children: [new Paragraph("")] }),
                  new TableCell({ width: cellWidth(0.8), verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 }, children: runs })] }),
                  new TableCell({ width: cellWidth(0.1), verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `(${++equationNo})` })] })] }),
                ] })],
              }));
            } else into.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 }, children: runs }));
            break;
          }
          case "list": {
            const ordered = !!node.ordered, instance = ordered ? ++orderedInstance : 0;
            for (const item of node.children) {
              let first = true;
              for (const child of item.children) {
                if (child.type === "list") { await walk([child], into, level + 1, quote); continue; }
                if (child.type !== "paragraph") { await walk([child], into, level + 1, quote); continue; }
                const check = item.checked === true ? "☑ " : item.checked === false ? "☐ " : "";
                const runs = await inline(child.children, quote ? { italics: true } : {}, notes);
                into.push(first
                  ? new Paragraph({ children: check ? [new TextRun({ text: check }), ...runs] : runs, numbering: { reference: ordered ? "ordered" : "bullets", level: Math.min(level, 4), ...(ordered ? { instance } : {}) }, spacing: { after: 60, line } })
                  : new Paragraph({ children: runs, indent: { left: 720 * (level + 1) }, spacing: { after: 60, line } }));
                first = false;
              }
            }
            break;
          }
          case "code": {
            const lines = String(node.value).split("\n");
            lines.forEach((text, i) => into.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: "F4F5F7", color: "auto" }, spacing: { after: i === lines.length - 1 ? 160 : 0, line: 240 }, keepLines: true, children: [new TextRun({ text: text || " ", font: "Consolas", size: Math.max(16, size - 4) })] })));
            break;
          }
          case "blockquote": {
            const env = environment(node);
            if (env) into.push(await environmentBox(env, node, section, notes), new Paragraph({ spacing: { after: 60 }, children: [] }));
            else await walk(node.children, into, level, true);
            break;
          }
          case "table": {
            into.push(...(await table(node, pendingTableCaption, notes)));
            pendingTableCaption = null;
            break;
          }
          case "thematicBreak": into.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF", space: 1 } }, spacing: { after: 160 } })); break;
          case "html": if (node.value.replace(/<[^>]+>/g, "").trim()) into.push(bodyParagraph([new TextRun({ text: node.value.replace(/<[^>]+>/g, "") })])); break;
          case "footnoteDefinition": case "definition": case "yaml": break;
          default: if (node.children) await walk(node.children, into, level, quote);
        }
      }
    };

    /** `> [!DEFINITION] Title` blocks. */
    function environment(node: any) {
      const first = node.children[0];
      const lead = first?.type === "paragraph" && first.children[0]?.type === "text" ? /^\[!([A-Za-z]+)\][ \t]*([^\n]*)\n?/.exec(first.children[0].value) : null;
      if (!lead || !environments[lead[1].toLowerCase()]) return null;
      return { kind: lead[1].toLowerCase(), title: lead[2].replace(/^[(\s]+|[)\s.:]+$/g, "").trim(), cut: lead[0].length };
    }
    async function environmentBox(env: { kind: string; title: string; cut: number }, node: any, sec: { number: string; env: number }, notes: Map<string, number>) {
      const meta = environments[env.kind];
      const number = unnumbered.has(env.kind) ? "" : " " + (sec.number ? sec.number + "." : "") + ++sec.env;
      const [first, ...rest] = node.children;
      const lead = { ...first, children: [{ ...first.children[0], value: first.children[0].value.slice(env.cut) }, ...first.children.slice(1)] };
      const inner: Block[] = [];
      const head = [new TextRun({ text: meta.label + number, bold: true, font: headFont, color: meta.style === "definition" || meta.style === "box" ? accent : undefined }), ...(env.title ? [new TextRun({ text: ` (${env.title})`, bold: meta.style !== "remark", font: headFont })] : []), new TextRun({ text: ". " })];
      const leadRuns = await inline(lead.children, meta.style === "plain" ? { italics: true } : {}, notes);
      inner.push(new Paragraph({ children: [...head, ...leadRuns], spacing: { after: 80, line } }));
      const rest_: Block[] = [];
      await walk(rest, rest_, 0, false);
      inner.push(...rest_);
      if (env.kind === "proof") inner.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("∎")] }));
      const framed = meta.style === "definition" || meta.style === "box";
      const fill = framed ? tint(accent === "1A1A1A" ? "1F3A5F" : accent, 0.93) : "FFFFFF";
      const edge = framed ? { style: BorderStyle.SINGLE, size: 18, color: accent === "1A1A1A" ? "1F3A5F" : accent } : { style: BorderStyle.SINGLE, size: 6, color: "C8CCD2" };
      const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
      return new Table({
        ...span([1]),
        borders: { top: none, bottom: none, right: none, left: edge, insideHorizontal: none, insideVertical: none },
        rows: [new TableRow({ cantSplit: false, children: [new TableCell({ width: cellWidth(1), shading: { type: ShadingType.CLEAR, fill, color: "auto" }, margins: { top: 100, bottom: 60, left: 180, right: 140 }, children: inner.length ? (inner as any) : [new Paragraph("")] })] })],
      });
    }
    async function table(node: any, captionRuns: Run[] | null, notes: Map<string, number>): Promise<Block[]> {
      const rows = node.children as any[];
      const count = Math.max(...rows.map((r) => r.children.length));
      const business = layout === "business";
      const rule = (weight: number) => ({ style: BorderStyle.SINGLE, size: weight, color: business ? accent : "1A1A1A" });
      const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
      const align = (i: number) => (node.align?.[i] === "right" ? AlignmentType.RIGHT : node.align?.[i] === "center" ? AlignmentType.CENTER : AlignmentType.LEFT);
      // Columns share the width by how much text they hold (a long description column gets more than a number column).
      const weights = Array.from({ length: count }, (_, c) => Math.min(40, Math.max(6, ...rows.map((row) => plainText(row.children[c] || {}).length))));
      const sum = weights.reduce((a, b) => a + b, 0);
      const fractions = weights.map((w) => w / sum);
      const built = new Table({
        ...span(fractions),
        borders: business
          ? { top: rule(4), bottom: rule(4), left: none, right: none, insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "D9DCE0" }, insideVertical: none }
          : { top: rule(12), bottom: rule(12), left: none, right: none, insideHorizontal: none, insideVertical: none },
        rows: await Promise.all(rows.map(async (row, r) => new TableRow({
          tableHeader: r === 0,
          cantSplit: true,
          children: await Promise.all(Array.from({ length: count }, async (_, c) => {
            const cell = row.children[c];
            const runs = cell ? await inline(cell.children, r === 0 ? { bold: true } : {}, notes) : [];
            return new TableCell({
              width: cellWidth(fractions[c]),
              shading: r === 0 && business ? { type: ShadingType.CLEAR, fill: accent, color: "auto" } : r % 2 === 0 && business && r > 0 ? { type: ShadingType.CLEAR, fill: "F5F7FA", color: "auto" } : undefined,
              borders: r === 0 && !business ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1A1A1A" } } : undefined,
              margins: { top: 50, bottom: 50, left: 90, right: 90 },
              children: [new Paragraph({ alignment: align(c), children: business && r === 0 ? runs.map((x) => (x instanceof TextRun ? new TextRun({ text: plainText(cell || {}), bold: true, color: "FFFFFF", font: headFont }) : x)).slice(0, 1) : runs })],
            });
          })),
        }))),
      });
      const out: Block[] = [];
      tableNo++;
      if (captionRuns) out.push(caption(`Table ${tableNo}`, captionRuns, true));
      out.push(built, new Paragraph({ spacing: { after: 120 } }));
      return out;
    }
    await walk(tree.children, out);
    return out;
  };

  // ——— Title block ———
  const front: Block[] = [];
  const label = kindLabel[kind] ?? "";
  const center = (design.titleAlign || base.titleAlign) === "center";
  if (label && layout !== "letter")
    front.push(new Paragraph({ alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 120 }, children: [new TextRun({ text: label.toUpperCase(), font: headFont, size: 18, color: accent === "1A1A1A" ? "555555" : accent, characterSpacing: 40, bold: true })] }));
  front.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    border: layout === "technical" ? { top: { style: BorderStyle.SINGLE, size: 12, color: "1A1A1A", space: 8 }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "1A1A1A", space: 8 } } : layout === "business" ? { left: { style: BorderStyle.SINGLE, size: 36, color: accent, space: 12 } } : undefined,
    spacing: { after: spec.subtitle ? 80 : 200 },
    children: [new TextRun({ text: spec.title })],
  }));
  if (spec.subtitle) front.push(new Paragraph({ alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 160 }, children: [new TextRun({ text: spec.subtitle, italics: layout !== "business", size: size + 4, color: "444444", font: layout === "business" ? headFont : bodyFont })] }));
  const date = spec.date && Number.isFinite(Date.parse(spec.date)) ? new Date(spec.date) : spec.date ? null : new Date();
  const dateText = date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : String(spec.date || "");
  if (kind === "memo") {
    for (const [k, v] of [["Subject", spec.title], ["From", spec.author || ""], ["Date", dateText]] as const)
      if (v) front.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: k + ":\t", bold: true, font: headFont }), new TextRun({ text: v })], tabStops: [{ type: TabStopType.LEFT, position: 1200 }] }));
    front.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 1 } }, spacing: { after: 200 } }));
  } else if (kind === "worksheet") {
    front.push(new Paragraph({ spacing: { before: 120, after: 240 }, children: [new TextRun({ text: "Name: ______________________________      Date: ________________", font: headFont })] }));
  } else if (spec.author || dateText) {
    front.push(new Paragraph({ alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 240 }, children: [new TextRun({ text: [spec.author, dateText].filter(Boolean).join("  ·  "), size: size - 2, color: "555555", font: headFont })] }));
  }
  if (spec.summary) {
    const summaryBlocks = await blocks(spec.summary, { number: "", counters: [0, 0], env: 0 });
    const heading = new Paragraph({ alignment: layout === "technical" ? AlignmentType.CENTER : AlignmentType.LEFT, keepNext: true, spacing: { before: 120, after: 80 }, children: [new TextRun({ text: summaryLabel(kind), bold: true, font: headFont, size: size, color: layout === "technical" ? undefined : accent })] });
    if (layout === "business") {
      front.push(new Table({
        ...span([1]),
        borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.SINGLE, size: 24, color: accent }, insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
        rows: [new TableRow({ children: [new TableCell({ width: cellWidth(1), shading: { type: ShadingType.CLEAR, fill: tint(accent, 0.92), color: "auto" }, margins: { top: 120, bottom: 120, left: 200, right: 200 }, children: [heading, ...(summaryBlocks as Paragraph[])] })] })],
      }), new Paragraph({ spacing: { after: 160 } }));
    } else {
      front.push(heading);
      for (const b of summaryBlocks) front.push(b instanceof Paragraph && layout === "technical" ? b : b);
      if (layout === "technical") front.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "1A1A1A", space: 1 } }, spacing: { after: 200 } }));
    }
  }

  // ——— Sections ———
  const body: Block[] = [];
  const contents: { anchor: string; text: string }[] = [];
  let sectionNo = 0;
  let current = { number: "", counters: [0, 0], env: 0 };
  for (const [i, section] of spec.sections.entries()) {
    if (section.heading) {
      const text = cleanHeading(section.heading);
      current = { number: numbered ? String(++sectionNo) : "", counters: [0, 0], env: 0 };
      const anchor = "sec" + (i + 1);
      contents.push({ anchor, text: (current.number ? current.number + "  " : "") + text });
      body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, children: [new Bookmark({ id: anchor, children: [new TextRun({ text: (current.number ? current.number + "  " : "") + text })] })] }));
    }
    if (section.text?.trim()) body.push(...(await blocks(section.text, current)));
    const svg = figures[i];
    if (svg) {
      const shot = await raster.svg(svg);
      // Wide enough to read, but never so tall that a figure fills the page and strands the text before it.
      const maxHeight = Math.round(((page.height - 2 * margin) / 1440) * 96 * 0.5);
      const fit = Math.min(textWidthPx / shot.width, maxHeight / shot.height, 1.25);
      const width = Math.round(shot.width * fit), height = Math.round(shot.height * fit);
      figureNo++;
      body.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 60 }, children: [new ImageRun({ type: "png", data: shot.png, transformation: { width, height }, altText: { name: "Figure " + figureNo, description: section.caption || "Figure " + figureNo, title: section.caption || "Figure " + figureNo } })] }));
      body.push(caption(`Figure ${figureNo}`, section.caption ? await inline((parse(section.caption).children[0] as any)?.children || []) : []));
    }
  }
  if (spec.references?.length) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, children: [new TextRun({ text: "References" })] }));
    for (const [i, ref] of spec.references.entries())
      body.push(new Paragraph({ indent: { left: 567, hanging: 567 }, spacing: { after: 80 }, children: [new TextRun({ text: `[${i + 1}]\t` }), ...(await inline((parse(ref).children[0] as any)?.children || [{ type: "text", value: ref }]))], tabStops: [{ type: TabStopType.LEFT, position: 567 }] }));
  }
  const wantsContents = design.contents ?? (layout !== "letter" && kind !== "memo" && contents.length >= 6);
  if (wantsContents && contents.length) {
    front.push(new Paragraph({ keepNext: true, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: "Contents", bold: true, font: headFont, size: base.headSize[0], color: layout === "technical" ? undefined : accent })] }));
    for (const entry of contents) front.push(new Paragraph({ spacing: { after: 40 }, children: [new InternalHyperlink({ anchor: entry.anchor, children: [new TextRun({ text: entry.text, font: bodyFont })] })] }));
    front.push(new Paragraph({ spacing: { after: 200 } }));
  }

  const running = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: layout === "technical" ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: "1A1A1A", space: 2 } } : undefined, children: [new TextRun({ text: spec.title.length > 90 ? spec.title.slice(0, 87) + "…" : spec.title, size: 17, color: "666666", font: headFont, smallCaps: layout === "technical" })] })] });
  const numberFooter = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "666666", font: headFont })] })] });
  const properties = { page: { size: { width: page.width, height: page.height, orientation: PageOrientation.PORTRAIT }, margin: { top: margin, bottom: margin, left: margin, right: margin, header: Math.round(margin / 2), footer: Math.round(margin / 2) } }, titlePage: true };
  const headers = design.runningHead === false || layout === "letter" ? undefined : { default: running, first: new Header({ children: [new Paragraph("")] }) };
  const footers = { default: numberFooter, first: layout === "letter" ? new Footer({ children: [new Paragraph("")] }) : numberFooter };

  const document = new Document({
    creator: spec.author || "Mowr",
    title: spec.title,
    description: spec.subtitle || "",
    footnotes,
    styles: {
      default: {
        document: { run: { font: bodyFont, size }, paragraph: { spacing: { line } } },
        title: { run: { font: headFont, size: base.titleSize, bold: layout !== "notes", color: layout === "technical" ? "111111" : accent === "1A1A1A" ? "111111" : accent } },
        heading1: { run: { font: headFont, size: base.headSize[0], bold: true, color: layout === "technical" ? "111111" : accent }, paragraph: { spacing: { before: 320, after: 120 } } },
        heading2: { run: { font: headFont, size: base.headSize[1], bold: true, color: layout === "technical" ? "111111" : accent }, paragraph: { spacing: { before: 240, after: 100 } } },
        heading3: { run: { font: headFont, size: base.headSize[2], bold: true, italics: layout === "technical", color: "222222" }, paragraph: { spacing: { before: 200, after: 80 } } },
        hyperlink: { run: { color: layout === "technical" ? "1F3A8A" : accent, underline: {} } },
      },
      paragraphStyles: [{ id: "Caption", name: "Caption", basedOn: "Normal", next: "Normal", run: { size: size - 2, color: "333333" }, paragraph: { spacing: { after: 160 } } }],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [0, 1, 2, 3, 4].map((level) => ({ level, format: LevelFormat.BULLET, text: ["•", "–", "◦", "▪", "·"][level], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + 360 * level, hanging: 260 } } } })) },
        { reference: "ordered", levels: [0, 1, 2, 3, 4].map((level) => ({ level, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER][level], text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + 360 * level, hanging: 300 } } } })) },
      ],
    },
    sections: columns === 2
      ? [
          { properties, headers, footers, children: front as any },
          { properties: { ...properties, titlePage: false, type: SectionType.CONTINUOUS, column: { count: 2, space: 425 } }, headers: headers && { default: running }, footers: { default: numberFooter }, children: body as any },
        ]
      : [{ properties, headers, footers, children: [...front, ...body] as any }],
  });
  // Upright maths (units, function names, text) is marked while building and set in the finished XML.
  const files = unzipSync(new Uint8Array(await Packer.toBuffer(document)));
  for (const part of ["word/document.xml", "word/footnotes.xml"]) if (files[part]) files[part] = strToU8(wordUpright(strFromU8(files[part])));
  return zipSync(files, { level: 6 });
}
