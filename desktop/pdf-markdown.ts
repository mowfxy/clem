import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/contrib/mhchem";
import { mathMacros, normalizeMath } from "../core/math-markdown.ts";
import { uprightChemistry } from "./math-draw.ts";

/** Block types written as `> [!DEFINITION] Optional title`, typeset like LaTeX theorem environments. */
export const environments: Record<string, { label: string; style: "plain" | "definition" | "remark" | "proof" | "box" }> = {
  definition: { label: "Definition", style: "definition" },
  theorem: { label: "Theorem", style: "plain" },
  lemma: { label: "Lemma", style: "plain" },
  proposition: { label: "Proposition", style: "plain" },
  corollary: { label: "Corollary", style: "plain" },
  law: { label: "Law", style: "plain" },
  principle: { label: "Principle", style: "plain" },
  rule: { label: "Rule", style: "definition" },
  formula: { label: "Formula", style: "definition" },
  example: { label: "Example", style: "definition" },
  exercise: { label: "Exercise", style: "definition" },
  problem: { label: "Problem", style: "definition" },
  question: { label: "Question", style: "definition" },
  solution: { label: "Solution", style: "proof" },
  answer: { label: "Answer", style: "proof" },
  proof: { label: "Proof", style: "proof" },
  remark: { label: "Remark", style: "remark" },
  note: { label: "Note", style: "box" },
  tip: { label: "Tip", style: "box" },
  important: { label: "Key point", style: "box" },
  key: { label: "Key point", style: "box" },
  summary: { label: "Summary", style: "box" },
  warning: { label: "Caution", style: "box" },
  caution: { label: "Caution", style: "box" },
  mistake: { label: "Common mistake", style: "box" },
};
/** Proofs and solutions are not numbered; everything else counts within its section (Definition 2.1, Example 2.2). */
export const unnumbered = new Set(["proof", "solution", "answer", "note", "tip", "important", "key", "summary", "warning", "caution", "mistake", "remark"]);

/**
 * Section text for generated PDFs: GitHub Markdown and LaTeX math ($…$, $$…$$, \(…\), \[…\], bare environments,
 * the physics/siunitx shortcuts and mhchem \ce, exactly as the chat renders them). KaTeX lays the maths out as HTML,
 * exactly as in the chat; the print page inlines KaTeX's stylesheet and fonts (desktop/katex-print.ts). Raw HTML is escaped,
 * links become plain text and images are dropped: a document can only show Kinetra-computed figures.
 */
/** Chemical formulas in $…$ and $$…$$ set upright before KaTeX reads them (desktop/math-draw.ts). */
function remarkChemistry() {
  const visit = (node: any) => {
    if ((node.type === "math" || node.type === "inlineMath") && typeof node.value === "string") {
      const upright = uprightChemistry(node.value);
      if (upright !== node.value) {
        // remark-math also keeps the text for rehype in data.hChildren; both must change.
        const rewrite = (n: any) => { if (n.type === "text" && n.value === node.value) n.value = upright; (n.children || []).forEach(rewrite); };
        (node.data?.hChildren || []).forEach(rewrite);
        node.value = upright;
      }
    }
    (node.children || []).forEach(visit);
  };
  return (tree: any) => visit(tree);
}
export function markdownHtml(text: string, { top = 0, inline = false }: { top?: number; inline?: boolean } = {}) {
  // Models usually write display math on one line ("$$E = mc^2$$"); give it its own block.
  text = normalizeMath(text).replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, "$$$$\n$1\n$$$$");
  const html = renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [remarkGfm, remarkMath, remarkChemistry],
        // Footnotes get a small label, not the default hidden <h2>: the page styles every h2 as a numbered
        // section, so "Footnotes" would print as a section of its own and shift the numbers after it.
        remarkRehypeOptions: { footnoteLabelTagName: "p", footnoteLabelProperties: { className: ["footnote-label"] }, footnoteBackContent: () => [] },
        rehypePlugins: [[rehypeKatex, { output: "html", throwOnError: false, strict: "ignore", macros: { ...mathMacros } }]],
        components: {
          a: ({ children }: { children?: unknown }) => createElement("span", null, children as never),
          img: () => null,
        },
      },
      text,
    ),
  );
  // Headings inside a section sit below it: the highest heading used becomes level `top`, the rest follow.
  const levels = [...html.matchAll(/<h([1-6])>/g)].map((m) => Number(m[1]));
  const shift = top && levels.length ? top - Math.min(...levels) : 0;
  const shifted = fencedMath(shift ? html.replace(/<(\/?)h([1-6])>/g, (_, close, level) => `<${close}h${Math.max(1, Math.min(6, Number(level) + shift))}>`) : html);
  return inline ? shifted.replace(/^<p>([\s\S]*)<\/p>\s*$/, "$1") : typeset(shifted);
}

/**
 * Each formula KaTeX laid out, in an <x-math> element: the page turns "Figure 2" and "[3]" in running text into
 * links, and this marks where maths starts and ends so nothing inside a formula is touched. Display maths keeps
 * KaTeX's block (span.katex-display), which the page centres and, in reports, numbers.
 */
function fencedMath(html: string) {
  let out = "", at = 0;
  const open = /<span class="katex(?:-display|-error)?"/g;
  for (let m; (m = open.exec(html)); ) {
    const tags = /<span\b[^>]*>|<\/span>/g;
    tags.lastIndex = m.index;
    let depth = 0, end = -1;
    for (let t; (t = tags.exec(html)); ) {
      depth += t[0][1] === "/" ? -1 : 1;
      if (depth === 0) { end = tags.lastIndex; break; }
    }
    if (end < 0) break;
    out += html.slice(at, m.index) + "<x-math>" + html.slice(m.index, end) + "</x-math>";
    at = open.lastIndex = end;
  }
  return out + html.slice(at);
}

/**
 * Typesetting that Markdown has no syntax for: `> [!DEFINITION] Title` blocks become numbered environments,
 * and a "Table: caption" paragraph beside a table becomes its caption.
 * Environment numbers are filled in later by the document (they depend on the section), from data-env markers.
 */
function typeset(html: string) {
  html = html.replace(/<blockquote>\s*<p>\[!([A-Za-z]+)\][ \t]*([^\n]*?)(?:\n|(?=<\/p>))/g, (whole, type: string, title: string) => {
    const kind = type.toLowerCase();
    const env = environments[kind];
    if (!env) return whole;
    const name = title.replace(/^[(\s]+|[)\s.:]+$/g, "").trim();
    const classes = env.style === kind ? `env env-${kind}` : `env env-${env.style} env-${kind}`;
    return `<blockquote class="${classes}"><p><span class="env-head">${env.label}${unnumbered.has(kind) ? "" : "<!--env-n-->"}</span>${name ? ` <span class="env-title">(${name})</span>` : ""}<span class="env-dot">.</span> `;
  });
  // An environment whose title line was its only line leaves an empty first paragraph: let the head run into the next one.
  html = html.replace(/(<span class="env-dot">\.<\/span> )<\/p>\s*<p>/g, "$1");
  // Tables: "Table: caption" just before (or after) a table is its caption, as in Pandoc.
  html = html.replace(/<p>Table:\s*([\s\S]*?)<\/p>\s*<table>/g, (_, caption) => `<table><caption>${caption.trim()}</caption>`);
  html = html.replace(/<table>((?:(?!<\/table>)[\s\S])*)<\/table>\s*<p>Table:\s*([\s\S]*?)<\/p>/g, (_, inner, caption) => `<table><caption>${caption.trim()}</caption>${inner}</table>`);
  return html;
}
