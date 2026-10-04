import { illustratedPdf } from "./illustrated-pdf.ts";
import { wordDocument } from "./docx-document.ts";
import { powerpointDeck } from "./pptx-deck.ts";
import { excelWorkbook } from "./xlsx-workbook.ts";
import { kinetraCall } from "./kinetra-runtime.ts";
import { rasterizer } from "./rasterize.ts";
import { unsafeSvg } from "./svg-safety.ts";
import { documentFigures, figureCheck, figurePictures, FIGURES_PER_RESULT, type DrawnFigure } from "./figure-review.ts";

/** The tool actions that make a file (desktop/file-guides.ts). Each one also revises a file it made earlier ("revise": id). */
import { textFormats } from "./file-guides.ts";
export { FILE_ACTIONS, partsKey, sameFormat } from "./file-guides.ts";
export const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png", svg: "image/svg+xml",
  csv: "text/csv", tsv: "text/tab-separated-values", md: "text/markdown", txt: "text/plain", html: "text/html", htm: "text/html", css: "text/css",
  json: "application/json", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml", tex: "application/x-tex", bib: "text/x-bibtex",
  ics: "text/calendar", vcf: "text/vcard", srt: "text/plain", vtt: "text/vtt", sql: "application/sql", ipynb: "application/x-ipynb+json",
};
const BOM = String.fromCharCode(0xfeff);
const safeName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/[. ]+$/, "").trim().slice(0, 120);

/** `previews`: pictures of the file (a deck's slides, the figures drawn in it) for the model to check before it answers (PNG or JPEG). */
export type Made = { bytes: Uint8Array; name: string; type: string; info?: Record<string, unknown>; previews?: { name: string; image: Uint8Array }[] };

/** Pictures of the figures the model has not seen yet in this answer, and the note asking it to check them against their source. */
async function withFigures(made: Made, figures: DrawnFigure[], seen: Set<string>, limit: number): Promise<Made> {
  if (!figures.length || limit <= 0) return made;
  const raster = await rasterizer();
  try {
    const { pictures, more } = await figurePictures(figures, seen, raster, limit);
    const check = figureCheck(pictures.map((p) => p.name), more);
    return { ...made, previews: [...(made.previews || []), ...pictures], ...(check ? { info: { ...made.info, figureCheck: check } } : {}) };
  } finally {
    raster.close();
  }
}

/** The file name for a request: its own name or title, with the extension of what it is. */
export function fileName(action: string, spec: any, fallback = "Mowr file") {
  if (action === "file" || action === "image") {
    const name = safeName(String(spec?.name || ""));
    if (action === "image") return (name.replace(/\.(png|svg)$/i, "") || "Figure") + (String(spec?.format || (/\.svg$/i.test(name) ? "svg" : "png")) === "svg" ? ".svg" : ".png");
    return name;
  }
  return (safeName(String(spec?.title || "")) || fallback) + "." + action;
}

/** Makes the file a tool request describes. Throws with every problem at once when the request cannot be made.
 *  `preview`: also return pictures of the result for the model to look at (decks: contact sheets of the slides; pdf,
 *  docx and pptx: the figures drawn in it that are not in `seen`, the figures already shown in this answer). */
export async function makeFile(action: string, spec: any, { preview = false, seen = new Set<string>() }: { preview?: boolean; seen?: Set<string> } = {}): Promise<Made> {
  switch (action) {
    case "pdf":
    case "docx": {
      let drawn: (string | undefined)[] = [];
      const keep = (figures: (string | undefined)[]) => { drawn = figures; };
      const made = action === "pdf"
        ? { bytes: await illustratedPdf(spec, { drawn: keep }), name: fileName("pdf", spec), type: MIME.pdf }
        : { bytes: await wordDocument(spec, { drawn: keep }), name: fileName("docx", spec), type: MIME.docx };
      return preview ? withFigures(made, documentFigures(spec, drawn), seen, FIGURES_PER_RESULT) : made;
    }
    case "pptx": {
      const deck = await powerpointDeck(spec, { preview });
      const made: Made = {
        bytes: deck.bytes, name: fileName("pptx", spec), type: MIME.pptx,
        info: { slides: deck.slides, design: deck.design, ...(deck.review.length ? { review: deck.review, next: "Fix what matters in the review with a revise before answering." } : { review: "The slides were drawn, measured and checked: nothing to fix." }) },
        previews: deck.sheets.map((s) => ({ name: `${fileName("pptx", spec)} — ${s.name}`, image: s.jpeg })),
      };
      // The contact sheets show every slide small; the figures come close up as well, within the same picture budget.
      return preview ? withFigures(made, deck.figures, seen, Math.max(2, FIGURES_PER_RESULT + 2 - deck.sheets.length)) : made;
    }
    case "xlsx": return { bytes: excelWorkbook(spec), name: fileName("xlsx", { title: spec?.title || spec?.sheets?.[0]?.name }), type: MIME.xlsx, info: { sheets: spec.sheets.map((s: any) => ({ name: s.name, rows: s.rows.length, headerRow: s.title ? 3 : 1, firstDataRow: s.title ? 4 : 2 })) } };
    case "file": {
      const name = fileName("file", spec);
      if (!name || !textFormats.test(name)) throw Error('"name" must be a file name with a text extension such as .csv, .md, .html, .json, .txt, .tex, .ics, .py or .svg. Use docx, pptx, xlsx or pdf for those formats.');
      if (typeof spec.content !== "string") throw Error('"content" must be the complete file text.');
      if (spec.content.length > 20_000_000) throw Error("The file is too large (20 MB of text at most).");
      if (/\.svg$/i.test(name) && unsafeSvg.test(spec.content)) throw Error("SVG files cannot contain scripts, embedded documents, event handlers, or links and url() references outside the drawing (embed pictures as data: URLs).");
      const ext = name.split(".").pop()!.toLowerCase();
      // Excel reads a CSV as UTF-8 only when it starts with a byte-order mark.
      const text = (ext === "csv" || ext === "tsv") && !spec.content.startsWith(BOM) ? BOM + spec.content : spec.content;
      return { bytes: new TextEncoder().encode(text), name, type: MIME[ext] || "text/plain" };
    }
    case "image": {
      let svg: string;
      if (spec?.figure) {
        const drawn = await kinetraCall(spec.figure);
        if (typeof drawn !== "string" || !drawn.includes("<svg")) throw Error(`${spec.figure.module}.${spec.figure.fn} returned data, not a drawing. Use a render function (see the figure recipes).`);
        svg = drawn;
      } else if (typeof spec?.svg === "string" && spec.svg.includes("<svg")) svg = spec.svg;
      else throw Error('An image needs "figure" (a Kinetra figure spec) or "svg" (a complete SVG drawing).');
      if (unsafeSvg.test(svg)) throw Error("The drawing contains scripts, embedded documents, event handlers, or links and url() references outside the drawing, which are not allowed (embed pictures as data: URLs).");
      const name = fileName("image", spec);
      if (name.endsWith(".svg")) return { bytes: new TextEncoder().encode(svg), name, type: MIME.svg };
      const raster = await rasterizer();
      try {
        const shot = await raster.svg(svg, { maxWidth: Math.min(2400, Math.max(200, Number(spec.width) || 1200)), background: spec.transparent ? "transparent" : "#ffffff" });
        return { bytes: shot.png, name, type: MIME.png, info: { width: shot.width, height: shot.height } };
      } finally {
        raster.close();
      }
    }
  }
  throw Error(`Unknown file action "${action}".`);
}
