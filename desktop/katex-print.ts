import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * KaTeX's stylesheet with its fonts inlined, for the print page of Clem's PDFs. PDFs typeset maths with KaTeX's own
 * HTML layout, exactly as the chat shows it: Chromium's native MathML drew bars over the wrong width, broke tall
 * radicals and ignored the column alignment of aligned equations. The print page allows nothing but inline styles
 * and data: URLs, so the woff2 faces go in as data. The build copies the stylesheet and fonts to desktop-dist/katex
 * (scripts/build-desktop.mjs); unbundled (tests) they are read from node_modules.
 */
let css: string | undefined;

function katexDir() {
  const candidates: string[] = [];
  try { candidates.push(resolve(__dirname, "katex")); } catch {} // no __dirname when run unbundled
  candidates.push(resolve(process.cwd(), "node_modules/katex/dist"));
  for (const dir of candidates) {
    try { readFileSync(join(dir, "katex.min.css")); return dir; } catch {}
  }
  return undefined;
}

export function katexPrintCss() {
  if (css !== undefined) return css;
  const dir = katexDir();
  if (!dir) return (css = "");
  // Each face lists woff2, woff and ttf; the page needs only the woff2, inlined.
  css = readFileSync(join(dir, "katex.min.css"), "utf8").replace(/src:url\(fonts\/([\w-]+)\.woff2\)[^;}]*/g, (whole, file: string) => {
    try {
      return `src:url(data:font/woff2;base64,${readFileSync(join(dir, "fonts", file + ".woff2")).toString("base64")}) format("woff2")`;
    } catch {
      return whole;
    }
  });
  return css;
}
