import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { latexOmml } from "./omml.ts";

/**
 * Inline maths as native PowerPoint equations. pptxgenjs cannot write an equation inside a text run, so `runs()` writes
 * a marked run (private-use brackets around the LaTeX and its plain-text form) and `embedMath` swaps each marked run for
 * the `mc:AlternateContent` PowerPoint 2010+ reads (an `a14:m` equation, with the plain run as the fallback for older
 * readers) after the file is written. A review of the slide sees only the plain text (`unmark`).
 */
const OPEN = "", MID = "", END = "";
const MARKED = new RegExp(`${OPEN}([^${MID}]*)${MID}`, "g");
const supported = new Map<string, boolean>();

/** The text of a run that holds inline maths: the LaTeX travels with the plain form, and both are removed again by `unmark`. */
export function markMath(latex: string, plain: string) {
  if (!supported.has(latex)) supported.set(latex, latexOmml(latex) !== null);
  return supported.get(latex) ? OPEN + latex + MID + plain + END : plain;
}
export const unmark = (text: string) => String(text).replace(MARKED, "").split(END).join("");

const xmlUnescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const CAMBRIA = '<a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/>';

/** The DrawingML run properties of the surrounding text, for the runs inside an equation (same size and colour, Cambria Math). */
function mathProps(rPr: string, upright: boolean) {
  const open = /^<a:rPr([^>]*?)\/?>/.exec(rPr)?.[1] ?? "";
  const attrs = open.replace(/\s+i="[^"]*"/, "").replace(/\s+dirty="[^"]*"/, "");
  const inner = (/^<a:rPr[^>]*[^/]>([\s\S]*)<\/a:rPr>$/.exec(rPr)?.[1] ?? "").replace(/<a:(latin|ea|cs|sym)\b[^>]*\/>/g, "");
  return `<a:rPr${attrs}${upright ? "" : ' i="1"'}>${inner}${CAMBRIA}</a:rPr>`;
}

const RUN = new RegExp(`<a:r>(<a:rPr(?:[^>]*/>|[^>]*>(?:(?!</a:rPr>)[\\s\\S])*</a:rPr>))<a:t[^>]*>${OPEN}([^${MID}]*)${MID}([^${END}]*)${END}</a:t></a:r>`, "g");
const ROOT_NS = ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

/** The slide XML with every marked run replaced by an inline equation (and its plain-text fallback). */
export function embedMathXml(xml: string) {
  let any = false;
  let out = xml.replace(RUN, (whole, rPr: string, latex: string, plain: string) => {
    const omml = latexOmml(xmlUnescape(latex), (upright) => mathProps(rPr, upright));
    if (!omml) return `<a:r>${rPr}<a:t>${plain}</a:t></a:r>`;
    any = true;
    return `<mc:AlternateContent><mc:Choice Requires="a14"><a14:m>${omml}</a14:m></mc:Choice><mc:Fallback><a:r>${rPr}<a:t>${plain}</a:t></a:r></mc:Fallback></mc:AlternateContent>`;
  });
  // A marked run the pattern did not match must never leave its marks in the file.
  out = out.replace(MARKED, "").split(END).join("");
  return any ? out.replace(/<p:sld\b/, (m) => m + ROOT_NS) : out;
}

/** The .pptx with inline maths embedded as equations; bytes without marked runs come back unchanged. */
export function embedMath(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const files = unzipSync(bytes);
  let changed = false;
  for (const [name, data] of Object.entries(files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const xml = strFromU8(data);
    if (!xml.includes(OPEN)) continue;
    files[name] = strToU8(embedMathXml(xml));
    changed = true;
  }
  return changed ? zipSync(files) : bytes;
}
