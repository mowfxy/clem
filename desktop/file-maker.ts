import { illustratedPdf } from "./illustrated-pdf.ts";
import { wordDocument } from "./docx-document.ts";
import { powerpointDeck } from "./pptx-deck.ts";
import { excelWorkbook } from "./xlsx-workbook.ts";
import { kinetraCall } from "./kinetra-runtime.ts";
import { rasterizer } from "./rasterize.ts";

/** The tool actions that make a file (desktop/file-guides.ts). Each one also revises a file it made earlier ("revise": id). */
export { FILE_ACTIONS } from "./file-guides.ts";
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
/** Text formats the "file" action writes. Programs Windows would run on a double-click (.bat, .ps1, .vbs, .exe…) are never made. */
const textFormats = /\.(csv|tsv|md|markdown|txt|html?|css|json|jsonl|xml|ya?ml|toml|ini|tex|bib|ics|vcf|srt|vtt|sql|ipynb|py|r|m|jl|js|mjs|cjs|ts|tsx|jsx|java|kt|c|h|cpp|hpp|cs|go|rs|swift|php|rb|lua|dart|sh|svg|gv|dot|mmd|log|rst|adoc|org|tikz|sty|cls)$/i;
const safeName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/[. ]+$/, "").trim().slice(0, 120);
const unsafeSvg = /<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|file:|javascript:)/i;

export type Made = { bytes: Uint8Array; name: string; type: string; info?: Record<string, unknown> };

/** The file name for a request: its own name or title, with the extension of what it is. */
export function fileName(action: string, spec: any, fallback = "Mowr file") {
  if (action === "file" || action === "image") {
    const name = safeName(String(spec?.name || ""));
    if (action === "image") return (name.replace(/\.(png|svg)$/i, "") || "Figure") + (String(spec?.format || (/\.svg$/i.test(name) ? "svg" : "png")) === "svg" ? ".svg" : ".png");
    return name;
  }
  return (safeName(String(spec?.title || "")) || fallback) + "." + action;
}

/** Makes the file a tool request describes. Throws with every problem at once when the request cannot be made. */
export async function makeFile(action: string, spec: any): Promise<Made> {
  switch (action) {
    case "pdf": return { bytes: await illustratedPdf(spec), name: fileName("pdf", spec), type: MIME.pdf };
    case "docx": return { bytes: await wordDocument(spec), name: fileName("docx", spec), type: MIME.docx };
    case "pptx": {
      const deck = await powerpointDeck(spec);
      return { bytes: deck.bytes, name: fileName("pptx", spec), type: MIME.pptx, info: { slides: deck.slides, ...(deck.review.length ? { designNotes: deck.review } : {}) } };
    }
    case "xlsx": return { bytes: excelWorkbook(spec), name: fileName("xlsx", { title: spec?.title || spec?.sheets?.[0]?.name }), type: MIME.xlsx, info: { sheets: spec.sheets.map((s: any) => ({ name: s.name, rows: s.rows.length, headerRow: s.title ? 3 : 1, firstDataRow: s.title ? 4 : 2 })) } };
    case "file": {
      const name = fileName("file", spec);
      if (!name || !textFormats.test(name)) throw Error('"name" must be a file name with a text extension such as .csv, .md, .html, .json, .txt, .tex, .ics, .py or .svg. Use docx, pptx, xlsx or pdf for those formats.');
      if (typeof spec.content !== "string") throw Error('"content" must be the complete file text.');
      if (spec.content.length > 20_000_000) throw Error("The file is too large (20 MB of text at most).");
      if (/\.svg$/i.test(name) && unsafeSvg.test(spec.content)) throw Error("SVG files cannot contain scripts, foreignObject, event handlers or external links.");
      const ext = name.split(".").pop()!.toLowerCase();
      // Excel reads a CSV as UTF-8 only when it starts with a byte-order mark.
      const text = (ext === "csv" || ext === "tsv") && !spec.content.startsWith("﻿") ? "﻿" + spec.content : spec.content;
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
      if (unsafeSvg.test(svg)) throw Error("The drawing contains scripts, foreignObject, event handlers or external links, which are not allowed.");
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

/** Where an appended part goes for each kind of file: sections for documents, slides for decks, sheets for workbooks. */
export const partsKey: Record<string, string> = { pdf: "sections", docx: "sections", pptx: "slides", xlsx: "sheets" };
/** Whether `action` can revise the file called `name` (a revision keeps the file's format). */
export function sameFormat(action: string, name: string) {
  const ext = name.split(".").pop()!.toLowerCase();
  if (action === "image") return ext === "png" || ext === "svg";
  if (action === "file") return textFormats.test(name);
  return ext === action;
}
