import { PDFDocument, PDFPage, PDFName, PDFHexString, PDFArray, PDFDict, StandardFonts, rgb, degrees, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, type PDFFont } from "pdf-lib";
import { textBoxes, type TextItem } from "../core/pdf-edit.ts";
import { assetCaption, type CropAsset } from "./pdf-assets.ts";
import { redactPage, collectGarbage, Unclean } from "./pdf-redact.ts";

/**
 * Changes to a PDF the person sent, as a new PDF: pages taken, reordered, turned, removed or merged in; highlights,
 * notes, text boxes, stamps and page numbers; form fields filled; crops laid out as pages. The edits run in order, each
 * on the document as the ones before left it, with pdf-lib, so everything not edited stays exactly as it was. The
 * original is never touched: the result is a new file in the chat (desktop/main.ts), kept with the list of edits so a
 * revision replays them on the same original.
 */
export type EditHelpers = {
  /** A file to edit or merge in, by name (a PDF in this chat), by id (a file Mowr made) or by the "src-…" copy an earlier
   *  edit kept: its bytes and the copy's id, which is what the stored edit list names from then on. */
  load(ref: string): Promise<{ bytes: Uint8Array; source: string; name?: string }>;
  /** The text runs of one page of a document (pdf.js, in the window), for edits that find text. */
  words(bytes: Uint8Array, page: number): Promise<TextItem[]>;
  crop(id: string): Promise<{ meta: CropAsset; png: Uint8Array; pdf?: Uint8Array } | undefined>;
  /** A page drawn as a picture (JPEG) with `boxes` filled: the redaction that always works, for pages whose content
   *  cannot be taken out exactly. */
  raster(bytes: Uint8Array, page: number, boxes: Box[], fill: [number, number, number]): Promise<Uint8Array>;
  /** A block of text in any script, typeset by Chromium as a one-page PDF of `width` × `height` points. */
  typeset?(text: string, options: { width: number; height: number; size: number; font: string; bold: boolean; color: [number, number, number]; align: string }): Promise<Uint8Array>;
};
export type EditResult = { bytes: Uint8Array; spec: any; changed: number[]; pages: number; done: string[] };

export const MAX_OPS = 300, MAX_PAGES = 5000;
const COLOURS: Record<string, [number, number, number]> = { yellow: [1, 0.92, 0.23], green: [0.56, 0.93, 0.56], blue: [0.53, 0.81, 0.98], pink: [1, 0.6, 0.8], orange: [1, 0.76, 0.3], red: [0.85, 0.15, 0.15], black: [0, 0, 0], white: [1, 1, 1], grey: [0.5, 0.5, 0.5], gray: [0.5, 0.5, 0.5] };
export type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box) => Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);

/** A colour by name or #hex, as 0–1 channels. */
export function colour(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (typeof value !== "string") return fallback;
  const named = COLOURS[value.trim().toLowerCase()];
  if (named) return named;
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) throw Error(`"${value}" is not a colour: use a name (yellow, green, blue, pink, orange, red, black, white, grey) or #hex.`);
  const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Pages a request names, 1-based, in the order named: 3, [1, 4], "1-3,7", "5-" (to the end), "last", "all". */
export function pageList(value: unknown, count: number, fallback?: "all"): number[] {
  if (value === undefined || value === null || value === "") {
    if (fallback === "all") return Array.from({ length: count }, (_, i) => i + 1);
    throw Error("Say which pages: a number, a list, or ranges such as \"1-3,7\".");
  }
  const out: number[] = [];
  const add = (n: number) => { if (!Number.isInteger(n) || n < 1 || n > count) throw Error(`There is no page ${n}: the document has ${count} page${count === 1 ? "" : "s"} at this point.`); out.push(n); };
  if (typeof value === "number") add(value);
  else if (Array.isArray(value)) value.forEach((v) => add(Number(v)));
  else for (const part of String(value).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part === "all") for (let p = 1; p <= count; p++) add(p);
    else if (part === "last") add(count);
    else {
      const m = /^(\d+|last)\s*(?:-|–|to)\s*(\d+|last)?$/.exec(part);
      if (m) {
        const a = m[1] === "last" ? count : Number(m[1]), b = m[2] === undefined ? count : m[2] === "last" ? count : Number(m[2]);
        if (b < a) throw Error(`"${part}" runs backwards.`);
        for (let p = a; p <= b; p++) add(p);
      } else if (/^\d+$/.test(part)) add(Number(part));
      else throw Error(`"${part}" is not a page or a range.`);
    }
  }
  if (out.length > MAX_PAGES) throw Error(`That is more than ${MAX_PAGES} pages.`);
  return out;
}

const boxOf = (v: unknown, what = "bbox"): Box => {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => Number.isFinite(Number(n)))) throw Error(`"${what}" must be [x0, y0, x1, y1] in PDF points from the bottom left of the page.`);
  const [a, b, c, d] = v.map(Number);
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
};

/**
 * A page as it is shown: its rotation and visible box. Text the person should read upright is laid out in shown
 * coordinates (origin at the shown bottom left) and placed with toUser, turned by the page's rotation.
 */
function shown(page: PDFPage) {
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const { x: X0, y: Y0, width: W, height: H } = page.getCropBox();
  const turned = r === 90 || r === 270;
  const toUser = (vx: number, vy: number): [number, number] =>
    r === 90 ? [X0 + W - vy, Y0 + vx] : r === 180 ? [X0 + W - vx, Y0 + H - vy] : r === 270 ? [X0 + vy, Y0 + H - vx] : [X0 + vx, Y0 + vy];
  const toShown = (ux: number, uy: number): [number, number] =>
    r === 90 ? [uy - Y0, X0 + W - ux] : r === 180 ? [X0 + W - ux, Y0 + H - uy] : r === 270 ? [Y0 + H - uy, ux - X0] : [ux - X0, uy - Y0];
  return { r, width: turned ? H : W, height: turned ? W : H, toUser, toShown };
}

/** Lines of `text` that fit `width` at `size` (a word longer than the line is broken). */
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else { out.push(line); line = word; }
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

const FACES: Record<string, StandardFonts[]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold],
};

/** Applies the edits; `spec` is {source|file?, name?, ops}. With no file, the edits build a new document (crops, merges). */
export async function editPdf(spec: any, helpers: EditHelpers): Promise<EditResult> {
  const ops: any[] = Array.isArray(spec?.ops) ? spec.ops : [];
  if (!ops.length) throw Error('"ops" must list the edits, for example [{"op":"rotate","pages":"2","degrees":90}].');
  if (ops.length > MAX_OPS) throw Error(`${ops.length} edits is more than ${MAX_OPS}; split them across two requests.`);
  const resolved: any = { ...spec, ops: [] };
  delete resolved.file;
  let doc: PDFDocument;
  const ref = spec.source ?? spec.file;
  if (ref !== undefined && ref !== null && ref !== "") {
    const src = await helpers.load(String(ref));
    doc = await openPdf(src.bytes, src.name || String(ref));
    resolved.source = src.source;
    if (!resolved.name && src.name) resolved.name = src.name;
  } else doc = await PDFDocument.create();
  doc.setModificationDate(new Date());
  const touched = new Set<PDFPage>();
  const done: string[] = [];
  const fonts = new Map<string, PDFFont>();
  const font = async (name: StandardFonts) => { if (!fonts.has(name)) fonts.set(name, await doc.embedFont(name)); return fonts.get(name)!; };
  // Letters are placed along their run by the widths of a standard face of the same family (core/pdf-edit.ts textBoxes).
  const ruler = await PDFDocument.create();
  const faces = { serif: await ruler.embedFont(StandardFonts.TimesRoman), sans: await ruler.embedFont(StandardFonts.Helvetica), mono: await ruler.embedFont(StandardFonts.Courier) };
  const advance = (ch: string, item: TextItem) => {
    const face = /mono/i.test(item.font || "") ? faces.mono : /sans/i.test(item.font || "") ? faces.sans : faces.serif;
    try { return face.widthOfTextAtSize(ch, 1); } catch { return 0.5; }
  };
  // Finding text needs pdf.js on the document as it is now: one copy, saved again only after a change.
  let snapshot: Uint8Array | null = null;
  const current = async () => {
    if (snapshot) return snapshot;
    snapshot = await doc.save();
    // Saving freezes what each page stream holds (pdf-lib caches the encoded bytes), so the next drawing on any page
    // must start a new stream or it would be lost.
    for (const p of doc.getPages()) { (p as any).contentStream = undefined; (p as any).contentStreamRef = undefined; }
    return snapshot;
  };
  const page = (n: unknown) => {
    const p = Number(n), count = doc.getPageCount();
    if (!Number.isInteger(p) || p < 1 || p > count) throw Error(`"page" must be 1–${count} (the document as it is at this edit).`);
    return doc.getPage(p - 1);
  };
  const encodable = (f: PDFFont, text: string) => {
    try { f.encodeText(text); } catch { throw Error(`“${text.slice(0, 40)}” has characters the standard PDF fonts cannot set (they cover Latin text). Write it in Latin characters.`); }
  };
  /**
   * Removes what is under each region (desktop/pdf-redact.ts) and fills it. A page whose content cannot be taken out
   * exactly, or where pdf.js still finds text under a region afterwards, is replaced by a picture of itself with the
   * regions filled. Returns the pages that became pictures.
   */
  const redact = async (regions: { page: number; box: Box }[], fill: [number, number, number]) => {
    const byPage = new Map<number, Box[]>();
    for (const r of regions) byPage.set(r.page, [...(byPage.get(r.page) || []), r.box]);
    const pictures: number[] = [];
    for (const [n, boxes] of byPage) {
      const p = doc.getPage(n - 1);
      try {
        redactPage(doc, p, boxes);
        for (const b of boxes) p.drawRectangle({ x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1], color: rgb(...fill) });
        snapshot = null;
        // Checked the way anyone would try to read it back: no text pdf.js can extract may remain under a region.
        const left = (await helpers.words(await current(), n)).filter((i) => i.str.trim() && boxes.some((b) => overlaps(b, [i.x, i.y - i.size * 0.2, i.x + i.width, i.y + i.size * 0.75])));
        if (left.length) throw new Unclean("text still under the box");
      } catch (error) {
        if (!(error instanceof Unclean)) throw error;
        await rasterize(n, boxes, fill);
        pictures.push(n);
      }
      touched.add(doc.getPage(n - 1));
    }
    return pictures;
  };
  /** Page `n` replaced by a picture of itself (as it is now) with `boxes` filled, the same size and turn. */
  const rasterize = async (n: number, boxes: Box[], fill: [number, number, number]) => {
    snapshot = null;
    const jpeg = await helpers.raster(await current(), n, boxes, fill);
    const old = doc.getPage(n - 1), crop = old.getCropBox(), turn = old.getRotation().angle;
    const fresh = doc.insertPage(n - 1, [crop.width, crop.height]);
    fresh.setMediaBox(crop.x, crop.y, crop.width, crop.height);
    fresh.drawImage(await doc.embedJpg(jpeg), { x: crop.x, y: crop.y, width: crop.width, height: crop.height });
    fresh.setRotation(degrees(turn));
    doc.removePage(n);
    snapshot = null;
  };
  /** Text written in a box, upright as the page is shown, shrunk to fit; any script, through Chromium, when the standard fonts cannot set it. */
  const textIn = async (p: PDFPage, box: Box, op: any) => {
    const view = shown(p);
    const [a, b] = [view.toShown(box[0], box[1]), view.toShown(box[2], box[3])];
    const sx0 = Math.min(a[0], b[0]), sx1 = Math.max(a[0], b[0]), sy0 = Math.min(a[1], b[1]), sy1 = Math.max(a[1], b[1]);
    const face = FACES[op.font] ? op.font : "sans";
    const f = await font(FACES[face][op.bold ? 1 : 0]);
    const ink = colour(op.color, COLOURS.black);
    if (op.background !== "none" && op.background !== undefined) {
      const bg = colour(op.background, COLOURS.white), [ux, uy] = view.toUser(sx0, sy0);
      p.drawRectangle({ x: ux, y: uy, width: sx1 - sx0, height: sy1 - sy0, color: rgb(...bg), rotate: degrees(view.r) });
    }
    let latin = true;
    try { f.encodeText(op.text); } catch { latin = false; }
    if (!latin) {
      if (!helpers.typeset) encodable(f, op.text);
      const block = await helpers.typeset!(op.text, { width: sx1 - sx0, height: sy1 - sy0, size: Math.min(72, Math.max(4, Number(op.size) || 11)), font: face, bold: !!op.bold, color: ink, align: String(op.align || "") });
      const [placed] = await doc.embedPdf(block, [0]);
      const [ux, uy] = view.toUser(sx0, sy0);
      p.drawPage(placed, { x: ux, y: uy, width: sx1 - sx0, height: sy1 - sy0, rotate: degrees(view.r) });
      return;
    }
    // The size asked for (11 pt by default), smaller until the text fits the box.
    let size = Math.min(72, Math.max(4, Number(op.size) || 11)), lines = wrap(op.text, f, size, sx1 - sx0 - 4);
    while (size > 4 && lines.length * size * 1.2 > sy1 - sy0 - 2) { size -= 0.5; lines = wrap(op.text, f, size, sx1 - sx0 - 4); }
    if (lines.length * size * 1.2 > sy1 - sy0 - 2) throw Error("That text does not fit the box even at 4 pt: give a larger \"bbox\" or less text.");
    lines.forEach((line, k) => {
      const w = f.widthOfTextAtSize(line, size);
      const vx = op.align === "center" ? sx0 + (sx1 - sx0 - w) / 2 : op.align === "right" ? sx1 - 2 - w : sx0 + 2;
      const [ux, uy] = view.toUser(vx, sy1 - 1 - size * (k + 0.92) - k * size * 0.2);
      p.drawText(line, { x: ux, y: uy, size, font: f, color: rgb(...ink), rotate: degrees(view.r) });
    });
  };
  /** Rebuilds the page list as `order` (1-based, repeats allowed). */
  const arrange = async (order: number[]) => {
    const all = doc.getPages(), seen = new Set<number>(), repeats: number[] = [];
    order.forEach((n) => { if (seen.has(n)) repeats.push(n - 1); seen.add(n); });
    const copies = repeats.length ? await doc.copyPages(doc, repeats) : [];
    for (let k = all.length - 1; k >= 0; k--) doc.removePage(k);
    const used = new Set<number>();
    let c = 0;
    for (const n of order) {
      if (used.has(n)) doc.addPage(copies[c++]);
      else { doc.addPage(all[n - 1]); used.add(n); }
    }
  };
  for (const [index, raw] of ops.entries()) {
    const op = raw && typeof raw === "object" ? { ...raw } : {};
    const count = doc.getPageCount();
    try {
      switch (op.op) {
        case "pages": {
          const keep = pageList(op.keep ?? op.pages, count);
          if (!keep.length) throw Error("No pages would be left.");
          await arrange(keep);
          done.push(`kept ${keep.length} page${keep.length === 1 ? "" : "s"} (${String(op.keep ?? op.pages)})`);
          break;
        }
        case "delete": {
          const gone = new Set(pageList(op.pages, count));
          if (gone.size >= count) throw Error("That would delete every page.");
          for (let k = count; k >= 1; k--) if (gone.has(k)) doc.removePage(k - 1);
          done.push(`deleted ${gone.size} page${gone.size === 1 ? "" : "s"}`);
          break;
        }
        case "reorder": {
          const order = pageList(op.order, count);
          if (order.length !== count || new Set(order).size !== count) throw Error(`"order" must name every page once (1–${count}); to keep only some pages, use {"op":"pages","keep":…}.`);
          await arrange(order);
          done.push("reordered the pages");
          break;
        }
        case "rotate": {
          const turn = Number(op.degrees ?? 90);
          if (![90, 180, 270, -90, -180, -270].includes(turn)) throw Error('"degrees" must be 90, 180, 270 or -90.');
          const pages = pageList(op.pages, count, "all");
          for (const n of pages) { const p = doc.getPage(n - 1); p.setRotation(degrees((((p.getRotation().angle + turn) % 360) + 360) % 360)); touched.add(p); }
          done.push(`turned ${pages.length} page${pages.length === 1 ? "" : "s"} ${turn}°`);
          break;
        }
        case "merge": {
          const from = op.source ?? op.file;
          if (typeof from !== "string" || !from.trim()) throw Error('"file": the PDF to merge in (a name from this chat, or a Mowr file id).');
          const src = await helpers.load(from);
          const other = await openPdf(src.bytes, src.name || from);
          const pages = pageList(op.pages, other.getPageCount(), "all");
          if (count + pages.length > MAX_PAGES) throw Error(`The document would have more than ${MAX_PAGES} pages.`);
          const copies = await doc.copyPages(other, pages.map((n) => n - 1));
          const at = op.at === undefined ? count : Number(op.at);
          if (!Number.isInteger(at) || at < 0 || at > count) throw Error(`"at" is the page to insert after: 0 (the start) to ${count}.`);
          copies.forEach((p, k) => { doc.insertPage(at + k, p); touched.add(p); });
          delete op.file;
          op.source = src.source;
          done.push(`merged ${pages.length} page${pages.length === 1 ? "" : "s"} of ${src.name || from} after page ${at}`);
          break;
        }
        case "crops": {
          const ids: unknown[] = Array.isArray(op.assets) ? op.assets : [];
          if (!ids.length) throw Error('"assets": the crop ids to lay out, one per page.');
          const caption = await font(StandardFonts.TimesRoman);
          for (const id of ids) {
            const asset = await helpers.crop(String(id));
            if (!asset) throw Error(`There is no crop "${id}". Use an id a crop result gave, or crop it again.`);
            const [x0, y0, x1, y1] = asset.meta.box;
            // Points for a PDF crop; a picture's pixels at 150 dpi.
            const scale = asset.meta.units === "pt" ? 1 : 72 / 150, w = (x1 - x0) * scale, h = (y1 - y0) * scale;
            // Under each, its caption and where it was cut from; a caption the standard fonts cannot set is left off.
            let text = op.captions === false ? undefined : assetCaption({ source: true }, undefined, asset.meta);
            try { if (text) caption.encodeText(text); } catch { text = undefined; }
            const lines = text ? wrap(text, caption, 9, Math.max(160, w)) : [];
            const margin = 24, under = lines.length ? lines.length * 11 + 8 : 0;
            const p = doc.addPage([Math.max(w, 160) + 2 * margin, h + 2 * margin + under]);
            const x = (p.getWidth() - w) / 2, y = margin + under;
            if (asset.pdf) { const [placed] = await doc.embedPdf(asset.pdf, [0]); p.drawPage(placed, { x, y, width: w, height: h }); }
            else p.drawImage(await doc.embedPng(asset.png), { x, y, width: w, height: h });
            lines.forEach((line, k) => p.drawText(line, { x: margin, y: margin + under - 8 - (k + 1) * 11 + 2, size: 9, font: caption }));
            touched.add(p);
          }
          done.push(`laid out ${ids.length} crop${ids.length === 1 ? "" : "s"}, one per page`);
          break;
        }
        case "highlight": {
          const p = page(op.page);
          let boxes: Box[];
          if (Array.isArray(op.boxes)) boxes = op.boxes.map((b: unknown) => boxOf(b, "boxes"));
          else if (op.bbox) boxes = [boxOf(op.bbox)];
          else if (typeof op.find === "string" && op.find.trim()) {
            const found = textBoxes(await helpers.words(await current(), Number(op.page)), op.find, advance);
            if (!found.length) throw Error(`“${op.find.slice(0, 60)}” is not on page ${op.page}. Quote the text exactly as it is printed (one line at a time), or give "bbox".`);
            boxes = (op.all === false ? found.slice(0, 1) : found).map((b) => [b.x0, b.y0, b.x1, b.y1]);
            // Kept with the edit, so a revision does not have to search again.
            op.boxes = boxes.map((b) => b.map((v) => Math.round(v * 100) / 100));
          } else throw Error('Give "find" (the text to highlight, as printed) or "bbox".');
          const c = colour(op.color, COLOURS.yellow);
          for (const b of boxes) markup(doc, p, "Highlight", b, c, op.note);
          touched.add(p);
          done.push(`highlighted ${boxes.length} place${boxes.length === 1 ? "" : "s"} on page ${op.page}`);
          break;
        }
        case "note": {
          const p = page(op.page);
          if (typeof op.text !== "string" || !op.text.trim()) throw Error('"text": what the note says.');
          const view = shown(p);
          const at = Array.isArray(op.at) && op.at.length === 2 ? op.at.map(Number) : view.toUser(view.width - 36, view.height - 36);
          stickyNote(doc, p, at[0], at[1], op.text.slice(0, 5000), colour(op.color, COLOURS.yellow));
          touched.add(p);
          done.push(`added a note on page ${op.page}`);
          break;
        }
        case "text": {
          const p = page(op.page);
          if (typeof op.text !== "string" || !op.text.trim()) throw Error('"text": the words to write.');
          await textIn(p, boxOf(op.bbox), op);
          touched.add(p);
          done.push(`wrote a text box on page ${op.page}`);
          break;
        }
        case "redact": {
          // Each place: a box, or every place some text is printed (on one page, or on "pages" with find).
          let regions: { page: number; box: Box }[];
          if (Array.isArray(op.regions)) regions = op.regions.map((r: any) => ({ page: Number(r.page), box: boxOf(r.box, "regions") }));
          else if (op.bbox) regions = [{ page: Number(op.page), box: boxOf(op.bbox) }];
          else if (typeof op.find === "string" && op.find.trim()) {
            const pages = op.pages !== undefined ? pageList(op.pages, count, "all") : [Number(op.page)];
            regions = [];
            for (const n of pages) {
              page(n);
              for (const b of textBoxes(await helpers.words(await current(), n), op.find, advance)) regions.push({ page: n, box: [b.x0 - 1, b.y0 - 0.5, b.x1 + 1, b.y1 + 0.5] });
            }
            if (!regions.length) throw Error(`“${op.find.slice(0, 60)}” is not printed on ${pages.length === 1 ? "page " + pages[0] : "those pages"}. Quote it exactly as printed (one line at a time), or give "bbox".`);
            op.regions = regions.map((r) => ({ page: r.page, box: r.box.map((v) => Math.round(v * 100) / 100) }));
          } else throw Error('Give "bbox" (with "page") or "find" (the text to remove, with "page" or "pages").');
          for (const r of regions) page(r.page);
          const fill = colour(op.color, COLOURS.black);
          const pictures = await redact(regions, fill);
          done.push(`redacted ${regions.length} place${regions.length === 1 ? "" : "s"}: the content under ${regions.length === 1 ? "it is" : "them is"} removed, not covered${pictures.length ? `; page${pictures.length === 1 ? "" : "s"} ${pictures.join(", ")} could not be cleaned exactly and ${pictures.length === 1 ? "was" : "were"} turned into a picture (${pictures.length === 1 ? "its" : "their"} text can no longer be selected or searched)` : ""}`);
          break;
        }
        case "replace": {
          const p = page(op.page), box = boxOf(op.bbox);
          if (!op.asset && !(typeof op.text === "string" && op.text.trim())) throw Error('Give the new content: "asset" (a crop id) or "text".');
          const pictures = await redact([{ page: Number(op.page), box }], colour(op.background, COLOURS.white));
          const target = doc.getPage(Number(op.page) - 1);
          if (op.asset) {
            const asset = await helpers.crop(String(op.asset));
            if (!asset) throw Error(`There is no crop "${op.asset}". Use an id a crop result gave, or crop it again.`);
            // Fitted inside the box, centred, its proportions kept.
            const [x0, y0, x1, y1] = asset.meta.box, w = x1 - x0, h = y1 - y0, scale = Math.min((box[2] - box[0]) / w, (box[3] - box[1]) / h);
            const at = { x: box[0] + (box[2] - box[0] - w * scale) / 2, y: box[1] + (box[3] - box[1] - h * scale) / 2, width: w * scale, height: h * scale };
            if (asset.pdf) target.drawPage((await doc.embedPdf(asset.pdf, [0]))[0], at);
            else target.drawImage(await doc.embedPng(asset.png), at);
          } else await textIn(target, box, op);
          touched.add(target);
          void p;
          done.push(`replaced a box on page ${op.page}${pictures.length ? " (that page could not be cleaned exactly and was turned into a picture first)" : ""}`);
          break;
        }
        case "stamp": {
          const text = String(op.text ?? "").trim().slice(0, 60);
          if (!text) throw Error('"text": the stamp, for example "DRAFT" or "CONFIDENTIAL".');
          const f = await font(StandardFonts.HelveticaBold);
          encodable(f, text);
          const pages = pageList(op.pages, count, "all");
          const ink = rgb(...colour(op.color, [0.78, 0.16, 0.16])), opacity = Math.min(1, Math.max(0.05, Number(op.opacity) || 0.18));
          for (const n of pages) {
            const p = doc.getPage(n - 1), view = shown(p);
            // Across the page's diagonal, upright as the page is shown, centred.
            const angle = Math.atan2(view.height, view.width), room = Math.hypot(view.width, view.height) * 0.7;
            const size = Math.min(160, room / Math.max(1, f.widthOfTextAtSize(text, 1))), w = f.widthOfTextAtSize(text, size);
            const cx = view.width / 2 - (w / 2) * Math.cos(angle) + size * 0.35 * Math.sin(angle), cy = view.height / 2 - (w / 2) * Math.sin(angle) - size * 0.35 * Math.cos(angle);
            const [ux, uy] = view.toUser(cx, cy);
            p.drawText(text, { x: ux, y: uy, size, font: f, color: ink, opacity, rotate: degrees((angle * 180) / Math.PI + view.r) });
            touched.add(p);
          }
          done.push(`stamped “${text}” on ${pages.length} page${pages.length === 1 ? "" : "s"}`);
          break;
        }
        case "pageNumbers": {
          const pages = pageList(op.pages, count, "all");
          const f = await font(op.font === "serif" ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
          const format = typeof op.format === "string" && op.format.includes("{n}") ? op.format.slice(0, 60) : "{n}";
          const size = Math.min(24, Math.max(6, Number(op.size) || 9)), start = Number.isInteger(Number(op.start)) ? Number(op.start) : 1;
          const where = String(op.position || "bottom-center").toLowerCase();
          if (!/^(top|bottom)-(left|center|right)$/.test(where)) throw Error('"position" is top- or bottom- and -left, -center or -right.');
          pages.forEach((n, k) => {
            const p = doc.getPage(n - 1), view = shown(p);
            const label = format.replace(/\{n\}/g, String(start + k)).replace(/\{total\}/g, String(start + pages.length - 1));
            encodable(f, label);
            const w = f.widthOfTextAtSize(label, size), m = Math.min(28, view.height * 0.04 + 6);
            const vx = where.endsWith("left") ? m : where.endsWith("right") ? view.width - m - w : (view.width - w) / 2;
            const vy = where.startsWith("top") ? view.height - m - size : m;
            const [ux, uy] = view.toUser(vx, vy);
            p.drawText(label, { x: ux, y: uy, size, font: f, color: rgb(...colour(op.color, [0.15, 0.15, 0.15])), rotate: degrees(view.r) });
            touched.add(p);
          });
          done.push(`numbered ${pages.length} page${pages.length === 1 ? "" : "s"}`);
          break;
        }
        case "fill": {
          if (!op.fields || typeof op.fields !== "object" || Array.isArray(op.fields)) throw Error('"fields": {"field name": value, …} (text, true/false for a checkbox, or the option to pick).');
          const form = doc.getForm(), all = form.getFields(), names = all.map((f) => f.getName());
          const unknown = Object.keys(op.fields).filter((k) => !names.includes(k));
          if (unknown.length) throw Error(`No field named ${unknown.map((u) => `"${u}"`).join(", ")}. ${names.length ? `The fields are: ${names.slice(0, 60).map((n) => `"${n}"`).join(", ")}.` : "This PDF has no form fields."}`);
          const helv = await font(StandardFonts.Helvetica);
          for (const [name, value] of Object.entries(op.fields)) {
            const field = form.getField(name);
            if (field instanceof PDFTextField) { const text = String(value ?? ""); encodable(helv, text); field.setText(text); }
            else if (field instanceof PDFCheckBox) value === true || value === "true" || value === "yes" ? field.check() : field.uncheck();
            else if (field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) {
              const options = field.getOptions(), pick = String(value);
              if (!options.includes(pick)) throw Error(`"${name}" takes one of: ${options.map((o) => `"${o}"`).join(", ")}.`);
              field.select(pick);
            } else throw Error(`"${name}" is a kind of field Mowr cannot fill.`);
            for (const w of field.acroField.getWidgets()) { const ref = w.P(); const host = doc.getPages().find((p) => p.ref === ref); if (host) touched.add(host); }
          }
          form.updateFieldAppearances(helv);
          if (op.flatten) form.flatten();
          done.push(`filled ${Object.keys(op.fields).length} field${Object.keys(op.fields).length === 1 ? "" : "s"}${op.flatten ? " and flattened the form" : ""}`);
          break;
        }
        default:
          throw Error(`Unknown edit "${op.op}". The edits are: pages, delete, reorder, rotate, merge, crops, highlight, note, text, stamp, pageNumbers, fill, redact, replace.`);
      }
    } catch (error) {
      throw Error(`Edit ${index + 1} (${String(op.op || "?")}): ${(error as Error).message}`);
    }
    snapshot = null;
    resolved.ops.push(op);
  }
  // Nothing removed may stay in the file: objects no page or catalogue points to any more are dropped before saving.
  // Placed pages and fonts are written into the document only when it is saved: that happens first, or the sweep would
  // take away the parts they are made from.
  if (resolved.ops.some((o: any) => o.op === "redact" || o.op === "replace")) { await (doc as any).flush(); collectGarbage(doc); }
  const pages = doc.getPages();
  const bytes = await doc.save();
  return { bytes, spec: resolved, changed: pages.flatMap((p, i) => (touched.has(p) ? [i + 1] : [])), pages: pages.length, done };
}

/** A PDF pdf-lib can change. A protected one is refused rather than saved broken. */
async function openPdf(bytes: Uint8Array, name: string) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    if (doc.isEncrypted) throw Error("encrypted");
    return doc;
  } catch (error) {
    if (/encrypt/i.test(String((error as Error).message))) throw Error(`${name} is protected (a password or permissions), so Mowr cannot change it.`);
    throw Error(`${name} could not be read as a PDF.`);
  }
}

/** A highlight with its own appearance (a multiply-blended fill), so every viewer shows it the same way. */
function markup(doc: PDFDocument, page: PDFPage, kind: "Highlight", [x0, y0, x1, y1]: Box, [r, g, b]: [number, number, number], note?: unknown) {
  const ap = doc.context.register(doc.context.stream(`/G0 gs ${r} ${g} ${b} rg ${x0} ${y0} ${x1 - x0} ${y1 - y0} re f`, {
    Type: "XObject", Subtype: "Form", BBox: [x0, y0, x1, y1],
    Resources: { ExtGState: { G0: { Type: "ExtGState", BM: "Multiply", ca: 0.85 } } },
  }));
  const annot = doc.context.obj({
    Type: "Annot", Subtype: kind, Rect: [x0, y0, x1, y1], QuadPoints: [x0, y1, x1, y1, x0, y0, x1, y0], C: [r, g, b], F: 4, CA: 0.85,
    T: PDFHexString.fromText("Mowr"), AP: { N: ap },
    ...(typeof note === "string" && note.trim() ? { Contents: PDFHexString.fromText(note.slice(0, 5000)) } : {}),
  });
  attach(doc, page, annot);
}

/** A sticky note (a Text annotation) with a small drawn icon. */
function stickyNote(doc: PDFDocument, page: PDFPage, x: number, y: number, text: string, [r, g, b]: [number, number, number]) {
  const ap = doc.context.register(doc.context.stream(`${r} ${g} ${b} rg 0.45 0.35 0 RG 1 w 0.5 0.5 17 17 re B 0.45 0.35 0 RG 0.8 w 4 12 m 14 12 l 4 9 m 14 9 l 4 6 m 11 6 l S`, { Type: "XObject", Subtype: "Form", BBox: [0, 0, 18, 18] }));
  const annot = doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [x, y - 18, x + 18, y], Contents: PDFHexString.fromText(text), Name: "Comment", C: [r, g, b], F: 4 + 8 + 16, T: PDFHexString.fromText("Mowr"), AP: { N: ap } });
  attach(doc, page, annot);
}

function attach(doc: PDFDocument, page: PDFPage, annot: PDFDict) {
  const ref = doc.context.register(annot);
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (annots instanceof PDFArray) annots.push(ref);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
}
