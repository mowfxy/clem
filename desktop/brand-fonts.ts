import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Mowafy Serif's Greek, maths and science glyphs live in separate files, used only for those characters
const TEXT = "U+20-7E,U+A0-17E,U+192,U+1C4-1CC,U+1EA-1EB,U+1FA-1FF,U+218-21B,U+237,U+259,U+2BC,U+2C6-2C7,U+2D8-2DD,U+326,U+1E80-1E85,U+1EB8-1EB9,U+1EBC-1EBD,U+1ECA-1ECD,U+1EE4-1EE5,U+1EF2-1EF3,U+1EF8-1EF9,U+2000-2006,U+200C-200F,U+2011,U+2013-2014,U+2018-201A,U+201C-201E,U+2020-2022,U+2026,U+2030,U+2039-203A,U+2044,U+2070,U+2074-2079,U+2080-2089,U+20AC,U+2122,U+2190,U+2192,U+2212,U+2215,U+2219,U+FB01-FB02,U+FEFF";
const SCIENCE = "U+2B0-2B8,U+2E0-2E4,U+384-38A,U+38C,U+38E-3A1,U+3A3-3CE,U+3D0-3D2,U+3D5-3D6,U+3DC-3DD,U+3F0-3F1,U+3F4-3F6,U+1D2C-1D6A,U+1D9C-1DBF,U+2016,U+2031-2037,U+203C,U+2047-2049,U+2052,U+2057,U+2071,U+207A-207F,U+208A-208E,U+2090-209C,U+20D0-20F0,U+2100-2121,U+2123-218B,U+2191,U+2193-2211,U+2213-2214,U+2216-2218,U+221A-23FF,U+25A0-25FF,U+2609,U+2620,U+2622-2624,U+263D-2647,U+2695,U+2697,U+269B,U+26A0,U+26A2-26A9,U+26B2,U+27C0-27FF,U+2900-2AFF";
const faces: [family: string, file: string, weight: string, range?: string][] = [
  ["Mowafy Sans", "MowafySans-Regular", "400"],
  ["Mowafy Sans", "MowafySans-Bold", "700"],
  ["Mowafy Serif", "MowafySerif-Regular", "400", TEXT],
  ["Mowafy Serif", "MowafySerif-Bold", "700", TEXT],
  ["Mowafy Serif", "MowafySerif-Regular-Science", "400", SCIENCE],
  ["Mowafy Serif", "MowafySerif-Bold-Science", "700", SCIENCE],
];
let css: string | undefined;

/** @font-face rules with the fonts inlined, for pages that live outside the app origin
 *  (the capture overlay, the browser sign-in page). Needs `font-src data:` under a CSP. */
export function brandFontFaces() {
  if (css !== undefined) return css;
  let dir: string;
  try { dir = resolve(__dirname, "../dist/fonts"); } catch { return (css = ""); } // no __dirname when run unbundled (tests)
  css = faces
    .map(([family, file, weight, range]) => {
      try {
        const data = readFileSync(join(dir, file + ".woff2")).toString("base64");
        return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:${weight};font-display:block${range ? ";unicode-range:" + range : ""}}`;
      } catch {
        return "";
      }
    })
    .join("");
  return css;
}
