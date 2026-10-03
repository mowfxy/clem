import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { serifFaces } from "../core/serif-fonts.ts";

const faces: [family: string, file: string, weight: string, range?: string, style?: string][] = [
  ["Mowafy Sans", "MowafySans-Regular", "400"],
  ["Mowafy Sans", "MowafySans-Bold", "700"],
  // Latin, Greek and Arabic are inlined (under 100 kB each); the math and science companions run to a megabyte and stay out.
  ...serifFaces.filter(face => /Serif|Greek|Arabic/.test(face.file)).map(face => ["Mowafy Serif", face.file, String(face.weight), face.range, face.style] as [string, string, string, string, string]),
];
let css: string | undefined;

/** @font-face rules with the fonts inlined, for pages that live outside the app origin
 *  (the capture overlay, the browser sign-in page). Needs `font-src data:` under a CSP. */
export function brandFontFaces() {
  if (css !== undefined) return css;
  let dir: string;
  try { dir = resolve(__dirname, "../dist/fonts"); } catch { return (css = ""); } // no __dirname when run unbundled (tests)
  css = faces
    .map(([family, file, weight, range, style]) => {
      try {
        const data = readFileSync(join(dir, file + ".woff2")).toString("base64");
        return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:${weight};font-style:${style ?? "normal"};font-display:block${range ? ";unicode-range:" + range : ""}}`;
      } catch {
        return "";
      }
    })
    .join("");
  return css;
}
