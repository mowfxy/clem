/**
 * Fonts for files that leave Mowr (PDFs, SVG, PNG and Word exports). Mowafy Serif and Mowafy Sans are the app's
 * interface fonts and never appear in a file: a reader without them would see a substitute, and a document should
 * read like print, not like the app. Files use standard faces every PC has, with metric-compatible fallbacks.
 */
export const printSerif = "Times New Roman, Times, Liberation Serif, Nimbus Roman, serif";
export const printSans = "Arial, Helvetica, Liberation Sans, Nimbus Sans, sans-serif";
export const printMono = "Consolas, Courier New, monospace";

const kind = (family: string) => (/mono|consolas|courier|cascadia/i.test(family) ? printMono : /sans|arial|helvetica|segoe|calibri|inter|system-ui|verdana/i.test(family) ? printSans : printSerif);

/**
 * Rewrites every font family in an SVG to a standard face: serif stays serif, sans stays sans, code stays
 * monospaced, or everything takes `only` (a document's own face). Stacks are written without quotes, so they are
 * valid both as SVG attributes and in style declarations.
 */
export function standardFonts(svg: string, only?: string) {
  const to = (family: string) => (only && !/mono|consolas|courier|cascadia/i.test(family) ? only.replace(/['"]/g, "") : kind(family));
  return svg
    .replace(/font-family\s*=\s*("[^"]*"|'[^']*')/g, (_, value: string) => `font-family="${to(value)}"`)
    .replace(/font-family\s*:\s*((?:'[^']*'|[^;"'}<>])*)/g, (_, value: string) => `font-family: ${to(value)}`);
}

/** The same faces for a canvas drawing saved as an image. */
export const exportFonts = { sans: printSans, serif: printSerif };

/** Mowr's own typefaces (Mowafy Serif and Sans and their earlier names) belong to the app, not to documents. */
export const brandFont = /mowafy|\bmowr\b|kindred|soft ink/i;
