import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/**
 * Section text for generated PDFs: GitHub Markdown and LaTeX math ($…$, $$…$$).
 * Math renders to MathML, which Chromium typesets natively, so no fonts or scripts
 * are needed in the locked-down print page. Raw HTML is escaped, links become plain
 * text and images are dropped: a document can only show Kinetra-computed figures.
 */
export function markdownHtml(text: string, { top = 0, inline = false }: { top?: number; inline?: boolean } = {}) {
  // Models usually write display math on one line ("$$E = mc^2$$"); give it its own block.
  text = text.replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, "$$$$\n$1\n$$$$");
  const html = renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [[rehypeKatex, { output: "mathml", throwOnError: false, strict: "ignore" }]],
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
  const shifted = shift ? html.replace(/<(\/?)h([1-6])>/g, (_, close, level) => `<${close}h${Math.max(1, Math.min(6, Number(level) + shift))}>`) : html;
  return inline ? shifted.replace(/^<p>([\s\S]*)<\/p>\s*$/, "$1") : shifted;
}
