import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const faces: [family: string, file: string, weight: string][] = [
  ["Mowafy Sans", "MowafySans-Regular", "300 500"],
  ["Mowafy Sans", "MowafySans-Bold", "600 800"],
  ["Mowafy Serif", "MowafySerif-Regular", "300 500"],
  ["Mowafy Serif", "MowafySerif-Bold", "600 800"],
];
let css: string | undefined;

/** @font-face rules with the fonts inlined, for pages that live outside the app origin
 *  (the capture overlay, the browser sign-in page). Needs `font-src data:` under a CSP. */
export function brandFontFaces() {
  if (css !== undefined) return css;
  let dir: string;
  try { dir = resolve(__dirname, "../dist/fonts"); } catch { return (css = ""); } // no __dirname when run unbundled (tests)
  css = faces
    .map(([family, file, weight]) => {
      try {
        const data = readFileSync(join(dir, file + ".woff2")).toString("base64");
        return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:${weight};font-display:block}`;
      } catch {
        return "";
      }
    })
    .join("");
  return css;
}
