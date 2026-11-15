import { BrowserWindow } from "electron";
import { markContent } from "../core/provenance";
import { renderFigures, documentHtml, specSize, type DocumentSpec } from "./pdf-document";
import { destinationPages, addOutline, outlineEntries } from "./pdf-structure";
import { stampVectors, type CropSpot } from "./pdf-assets";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Prints a document specification to a tagged A4 PDF with an outline (bookmarks) and a contents with page numbers.
 *  `checkVoice` is off only for exports of text the person already has. `drawn` receives the figures as printed.
 *  `vectors`: the vector crops of the spec's crop figures, by id (desktop/pdf-assets.ts resolveAssets). `placed`
 *  receives where each crop printed, so its pages can be shown to the model. */
export async function illustratedPdf(spec: any, { checkVoice = true, drawn, vectors = new Map(), placed }: { checkVoice?: boolean; drawn?: (figures: (string | undefined)[]) => void; vectors?: Map<string, Uint8Array>; placed?: (spots: CropSpot[]) => void } = {}) {
  const figures = await renderFigures(spec, { checkVoice });
  drawn?.(figures);
  const page = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      javascript: false,
    },
  });
  // Loaded from a temporary file: a data: URL is limited to 2 MB, which a long document or one with many figures exceeds.
  const file = join(tmpdir(), "clem-print-" + randomUUID() + ".html");
  // Accessibility tags are written for documents up to about a hundred pages. Chromium stores each tag as a separate
  // uncompressed object, which for a few hundred pages of text and maths is most of a 20 MB file.
  const tagged = specSize(spec) < 400_000;
  // Running heads and page numbers come from the page's own @page rules, so the template is off.
  const print = async (html: string) => {
    await writeFile(file, html, "utf8");
    await page.loadFile(file);
    return new Uint8Array(await page.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, generateTaggedPDF: tagged, generateDocumentOutline: true }));
  };
  try {
    const html = documentHtml(spec as DocumentSpec, figures);
    let bytes: Uint8Array = await print(html);
    // A contents page needs the page each section starts on: the first printing says where they landed, and the
    // numbers go into fixed-width slots, so the second printing has the same pages.
    let pages: Map<string, number> | undefined;
    if (html.includes('class="doc-toc')) {
      pages = await destinationPages(bytes).catch(() => undefined);
      if (pages?.size) bytes = await print(documentHtml(spec as DocumentSpec, figures, pages));
    }
    // Vector crops go where their placeholders printed; if one cannot be placed, every crop prints as its PNG instead
    // (and, should even those places not read back, without the links that mark them).
    const slots = (html.match(/class="(?:asset|figure)-slot"/g) || []).length;
    if (slots) {
      const spots: CropSpot[] = [];
      const known = pages?.size ? pages : undefined;
      bytes = await stampVectors(bytes, vectors, slots, spots).catch(async () => {
        spots.length = 0;
        const pictures = await print(documentHtml(spec as DocumentSpec, figures, known, { pictures: true }));
        return stampVectors(pictures, new Map(), slots, spots).catch(async () => { spots.length = 0; return print(documentHtml(spec as DocumentSpec, figures, known, { pictures: true, bare: true })); });
      });
      placed?.(spots);
    }
    if (!tagged) bytes = await addOutline(bytes, outlineEntries(html)).catch(() => bytes);
    return new Uint8Array(await (await markContent(new Blob([new Uint8Array(bytes)]), "document.pdf")).arrayBuffer());
  } finally {
    page.destroy();
    await rm(file, { force: true }).catch(() => {});
  }
}
