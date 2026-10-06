import { createHash } from "node:crypto";
import { illustratedPdf } from "./illustrated-pdf.ts";
import { wordDocument } from "./docx-document.ts";
import { powerpointDeck } from "./pptx-deck.ts";
import { excelWorkbook } from "./xlsx-workbook.ts";
import { kinetraCall } from "./kinetra-runtime.ts";
import { rasterizer } from "./rasterize.ts";
import { unsafeSvg } from "./svg-safety.ts";
import { documentFigures, figureCheck, figurePictures, FIGURES_PER_RESULT, type DrawnFigure } from "./figure-review.ts";
import { resolveAssets, figurePages, placementKey, type ReadAsset, type CropSpot } from "./pdf-assets.ts";
import { withDesign } from "./pdf-document.ts";
import { editPdf, type EditHelpers } from "./pdf-edit-tools.ts";

/** The tool actions that make a file (desktop/file-guides.ts). Each one also revises a file it made earlier ("revise": id). */
import { textFormats } from "./file-guides.ts";
export { FILE_ACTIONS, partsKey, patchParts, sameFormat } from "./file-guides.ts";
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
/** `spec`: what to keep as the file's source when it differs from the request (an edit list with its files resolved). */
export type Made = { bytes: Uint8Array; name: string; type: string; info?: Record<string, unknown>; previews?: { name: string; image: Uint8Array }[]; spec?: any };
/** How large a page picture for the placement check is, in pixels on its long side. */
const PAGE_PREVIEW_SIZE = 1280;
/** Pictures of the changed pages of an edited PDF, at most this many per result. */
const EDIT_PREVIEWS = 6;

/** Where a figure sits across its page, in words. */
function across(s: CropSpot) {
  const mid = (s.rect[0] + s.rect[2]) / 2 / s.sheet[0], share = (s.rect[2] - s.rect[0]) / s.sheet[0];
  return share > 0.62 ? "across the column" : mid < 0.42 ? "at the left" : mid > 0.58 ? "at the right" : "centred";
}
/** What the model is asked to judge on the pages its figures printed on, with where each one landed. */
function placementCheck(spots: CropSpot[], shown: number[]) {
  const where = spots.slice(0, 12).map((s) => `Figure ${s.figure}${s.id === "figure" ? "" : ` (${s.id})`} on page ${s.page}, ${Math.round(s.rect[2] - s.rect[0])} × ${Math.round(s.rect[3] - s.rect[1])} pt, ${across(s)}`).join("; ");
  return `Pictures of page${shown.length === 1 ? "" : "s"} ${shown.join(", ")}, where the figures printed, are attached (${where}). Judge each figure's place as a book designer would, on the page as a whole, and change what does not look right: does it sit well with the text around it (a small figure beside its paragraph with the text wrapping round it, "align":"wrap-right" or "wrap-left"; a large or detailed one across the column; flush "left" or "right" where that suits the page better; "center" centres the drawing as the eye sees it, "box" its picture box); is it the right size next to the text, its labels about the size of the body text ("width": 0.2–1 of the column); is it on the same page as, or right after, the paragraph that discusses it (a figure is placed after its section's text, or before it when beside the text: give it to a section without a heading that splits the text where it belongs); has it been pushed to the next page, leaving an empty gap (make it smaller, put it beside the text, or move it); is its crop clean (nothing from around the original, no old caption or number). Fix what does not look right with "revise" and "patch" on just the sections concerned (their figure's "align" or "width", or where the text splits), until every page looks designed; a page that already looks right needs no change.`;
}

/** Pictures of the figures the model has not seen yet in this answer, and the note asking it to check them against their source. */
async function withFigures(made: Made, figures: DrawnFigure[], seen: Set<string>, limit: number): Promise<Made> {
  // Crops were shown to the model when it cut them.
  figures = figures.filter((f) => typeof (f.figure as any)?.asset !== "string");
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

/** Whether this picture is new to the model in this answer (and marks it seen): the same picture is never sent twice. */
function fresh(seen: Set<string>, kind: string, image: Uint8Array) {
  const key = kind + ":" + createHash("sha256").update(image).digest("hex");
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
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
 *  docx and pptx: the figures drawn in it that are not in `seen`, the figures already shown in this answer).
 *  `assets` reads the crops that pdf, docx and pptx figures may name ({"asset":"crop-…"}, desktop/pdf-assets.ts). */
export async function makeFile(action: string, spec: any, { preview = false, seen = new Set<string>(), assets, edit, render }: { preview?: boolean; seen?: Set<string>; assets?: ReadAsset; edit?: EditHelpers; render?: (bytes: Uint8Array, pages: number[], name?: string, size?: number) => Promise<{ name: string; image: Uint8Array }[]> } = {}): Promise<Made> {
  // A document's design is worked out from what it is about when nobody described one (desktop/pdf-design.ts) and
  // kept with the file, so every revision and every appended part looks the same. A malformed design is left for the
  // document maker to report.
  const designed = (action === "pdf" || action === "docx") && typeof spec?.title === "string" && Array.isArray(spec.sections) && (spec.design === undefined || (spec.design && typeof spec.design === "object" && !Array.isArray(spec.design))) ? withDesign(spec) : undefined;
  if (designed) spec = designed;
  // Crop figures get their drawing and caption here; the spec as sent (and stored) keeps only their ids.
  let vectors = new Map<string, Uint8Array>();
  if ((action === "pdf" || action === "docx" || action === "pptx") && JSON.stringify(spec?.sections || spec?.slides || []).includes('"asset"')) {
    const resolved = await resolveAssets(spec, assets || (async () => undefined));
    spec = resolved.spec;
    vectors = resolved.vectors;
  }
  switch (action) {
    case "pdf":
    case "docx": {
      let drawn: (string | undefined)[] = [], spots: CropSpot[] = [];
      const keep = (figures: (string | undefined)[]) => { drawn = figures; };
      const made: Made = action === "pdf"
        ? { bytes: await illustratedPdf(spec, { drawn: keep, vectors, placed: (s) => { spots = s; } }), name: fileName("pdf", spec), type: MIME.pdf }
        : { bytes: await wordDocument(spec, { drawn: keep }), name: fileName("docx", spec), type: MIME.docx };
      if (designed) {
        const { css: _css, ...design } = designed.design;
        made.spec = designed;
        made.info = { design: { font: designed.font, headingFont: designed.headingFont, ...design }, designNote: 'Worked out for this document from its subject, kind and length where not given, and kept with the file. Change any part with "font", "headingFont" or "design" only when the person asks for a different look.' };
      }
      // The pages the figures printed on, so the model sees how each sits in the document, not only the figure itself.
      // Pictures of a figure's page go to the model when the figure is new in this answer or has moved (another page,
      // size or side), not again on every append: a long document's parts used to resend the same pages, and every
      // later step read them all again. Text reflowing by a line above a figure does not count as a move.
      if (preview && render && spots.length) {
        const moved = spots.filter((s) => !seen.has(placementKey(s)));
        if (moved.length) {
          const shown = figurePages(moved);
          // 1280 px on the long side: what the models see of a page anyway (Claude scales pictures to about 1.15 megapixels).
          const pages = await render(made.bytes, shown, made.name, PAGE_PREVIEW_SIZE).catch(() => []);
          if (pages.length) {
            for (const s of moved) seen.add(placementKey(s));
            made.previews = [...(made.previews || []), ...pages];
            made.info = { ...made.info, placementCheck: placementCheck(moved, shown) };
          }
        } else made.info = { ...made.info, placementCheck: "Every figure sits where the page pictures already attached in this answer showed it (same page, size and side), so they are not attached again." };
      }
      return preview ? withFigures(made, documentFigures(spec, drawn), seen, FIGURES_PER_RESULT) : made;
    }
    case "pptx": {
      const deck = await powerpointDeck(spec, { preview });
      const made: Made = {
        bytes: deck.bytes, name: fileName("pptx", spec), type: MIME.pptx,
        info: { slides: deck.slides, design: deck.design, ...(deck.review.length ? { review: deck.review, next: "Fix what matters in the review with a revise (\"patch\" for the slides concerned) before answering." } : { review: "The slides were drawn, measured and checked: nothing to fix." }) },
        // A contact sheet the model already saw in this answer, unchanged, is not sent again.
        previews: deck.sheets.filter((s) => !preview || fresh(seen, "sheet", s.jpeg)).map((s) => ({ name: `${fileName("pptx", spec)} — ${s.name}`, image: s.jpeg })),
      };
      if (preview && deck.sheets.length && !made.previews!.length) made.info = { ...made.info, sheets: "Every slide looks exactly as in the contact sheets already attached in this answer." };
      // The contact sheets show every slide small; the figures come close up as well, within the same picture budget.
      return preview ? withFigures(made, deck.figures, seen, Math.max(2, FIGURES_PER_RESULT + 2 - deck.sheets.length)) : made;
    }
    case "editpdf": {
      // An edit of a PDF the person sent (desktop/pdf-edit-tools.ts); the result is a new PDF, the original untouched.
      if (!edit) throw Error("PDFs can only be edited in a chat.");
      const result = await editPdf(spec, edit);
      const base = safeName(String(result.spec.name || spec?.title || "Edited").replace(/\.pdf$/i, "")).replace(/ \(edited\)$/i, "") || "Edited";
      const show = (result.changed.length ? result.changed : Array.from({ length: Math.min(4, result.pages) }, (_, i) => i + 1)).slice(0, EDIT_PREVIEWS);
      const previews = preview && render ? await render(result.bytes, show).catch(() => []) : [];
      const more = result.changed.length - show.length;
      return {
        bytes: result.bytes, name: base + " (edited).pdf", type: MIME.pdf, spec: result.spec, previews,
        info: { pages: result.pages, edits: result.done, ...(result.changed.length ? { changedPages: result.changed.slice(0, 200) } : {}), ...(previews.length ? { check: `Pictures of ${result.changed.length ? "the changed" : "the first"} pages are attached${more > 0 ? ` (${more} more changed page${more === 1 ? "" : "s"} not shown)` : ""}. Look at them: every edit where it should be and nothing else changed; if not, send the edits again with "revise".` } : {}) },
      };
    }
    case "xlsx": return { bytes: excelWorkbook(spec), name: fileName("xlsx", { title: spec?.title || spec?.sheets?.[0]?.name }), type: MIME.xlsx, info: { sheets: spec.sheets.map((s: any) => ({ name: s.name, rows: s.rows.length, headerRow: s.title ? 3 : 1, firstDataRow: s.title ? 4 : 2 })) } };
    case "file": {
      const name = fileName("file", spec);
      if (/\.jse?$/i.test(name)) throw Error('Windows runs a .js file as a program when it is opened, so Mowr does not make them: name JavaScript .mjs (a module) or .cjs, which open as text.');
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
