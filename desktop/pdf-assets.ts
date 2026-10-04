import { PDFDocument, PDFArray, PDFDict, PDFName, PDFString, PDFHexString } from "pdf-lib";
import { randomBytes } from "node:crypto";
import type { Box } from "../core/pdf-regions.ts";

/**
 * Crops the model cut from the person's PDFs and pictures, kept as assets of the chat under stable ids ("crop-1a2b3c4d")
 * so a later answer in the same chat can still put them in a document. Each has a PNG at the resolution it was cut at
 * and, when the page was drawn as vectors, a one-page PDF of exactly that area, which stays sharp at any size.
 */
export type CropAsset = {
  id: string;
  /** The file it was cut from, its page (PDFs) and the box: PDF points from the bottom left, or picture pixels. */
  file: string; page?: number; box: Box; units: "pt" | "px";
  width: number; height: number; dpi?: number;
  vector: boolean;
  caption?: string;
  created: number;
};
/** Where assets are kept: the workspace disk for normal chats, memory for temporary ones (never written anywhere). */
export type AssetIo = { read(key: string): Promise<Uint8Array | null>; write(key: string, bytes: Uint8Array): Promise<void>; remove(key: string): Promise<void> };

/** The most crops one chat keeps; the oldest go first. */
export const MAX_ASSETS = 200;
/** The largest PDF read for a vector crop. */
export const MAX_SOURCE = 200_000_000;
const ID = /^crop-[a-f0-9]{8}$/;

export function memoryIo(store = new Map<string, Uint8Array>()): AssetIo {
  return { read: async (k) => store.get(k) ?? null, write: async (k, b) => void store.set(k, b), remove: async (k) => void store.delete(k) };
}

export class CropAssets {
  private io: AssetIo;
  private key: string;
  private list: CropAsset[] | null = null;
  constructor(io: AssetIo, chat: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(chat)) throw Error("Invalid chat");
    this.io = io;
    this.key = "assets-" + chat;
  }
  async all() {
    if (!this.list) {
      const raw = await this.io.read(this.key).catch(() => null);
      try { this.list = raw ? JSON.parse(Buffer.from(raw).toString("utf8")) : []; } catch { this.list = []; }
      if (!Array.isArray(this.list)) this.list = [];
    }
    return this.list!;
  }
  async add(meta: Omit<CropAsset, "id" | "created">, png: Uint8Array, pdf?: Uint8Array): Promise<CropAsset> {
    const list = await this.all();
    let id: string;
    do id = "crop-" + randomBytes(4).toString("hex"); while (list.some((a) => a.id === id));
    await this.io.write(id + "-png", png);
    if (pdf) await this.io.write(id + "-pdf", pdf);
    const asset: CropAsset = { ...meta, vector: !!pdf, id, created: Date.now() };
    // Its own record too, so a document that uses it can be typeset again outside this chat (the file panel's edits).
    await this.io.write(id + "-meta", new TextEncoder().encode(JSON.stringify(asset)));
    list.push(asset);
    for (const old of list.splice(0, Math.max(0, list.length - MAX_ASSETS))) await Promise.all(["-png", "-pdf", "-meta"].map((k) => this.io.remove(old.id + k))).catch(() => {});
    await this.io.write(this.key, new TextEncoder().encode(JSON.stringify(list)));
    return asset;
  }
  async get(id: unknown) {
    if (typeof id !== "string" || !ID.test(id)) return undefined;
    const meta = (await this.all()).find((a) => a.id === id);
    if (!meta) return undefined;
    const png = await this.io.read(id + "-png");
    if (!png) return undefined;
    return { meta, png, pdf: meta.vector ? (await this.io.read(id + "-pdf")) ?? undefined : undefined };
  }
}

/**
 * A one-page PDF of `box` on `page` (1-based) of `source`: the page is placed as a form XObject clipped to the box, so
 * its drawings and text stay vectors. Undefined when pdf-lib cannot read the file (encrypted or damaged): the PNG then
 * stands alone.
 */
export async function vectorCrop(source: Uint8Array, page: number, box: Box): Promise<Uint8Array | undefined> {
  if (source.byteLength > MAX_SOURCE) return undefined;
  let src: PDFDocument;
  try { src = await PDFDocument.load(source, { updateMetadata: false }); } catch { return undefined; }
  if (src.isEncrypted || page < 1 || page > src.getPageCount()) return undefined;
  const out = await PDFDocument.create();
  out.setProducer("Mowr");
  const from = src.getPage(page - 1);
  // A page shown turned is cut as a picture: a placed page ignores its turn, so the vector copy would lie on its side.
  if (from.getRotation().angle % 360) return undefined;
  const [x0, y0, x1, y1] = box;
  const embedded = await out.embedPage(from, { left: x0, bottom: y0, right: x1, top: y1 });
  const sheet = out.addPage([x1 - x0, y1 - y0]);
  sheet.drawPage(embedded, { x: 0, y: 0, width: x1 - x0, height: y1 - y0 });
  return out.save();
}

/** Asks the window to run a task on the conversation's files (src/desktop/pdf-tasks.ts). */
export type WindowTask = (op: string, args: Record<string, unknown>) => Promise<{ data: any; images: { name: string; data: string }[]; files: Uint8Array[] }>;
export type ToolOutcome = { result: Record<string, unknown>; pictures: { name: string; data: string }[] };

const SIDES: Record<string, string> = { top: "top", bottom: "bottom", left: "left", right: "right" };

/**
 * "regions" and "crop" for the model. The window finds candidates and settles the crop on the pixels; this side cuts
 * the vector version, keeps the crop as an asset of the chat and says what to check. Undefined for other actions.
 */
export function cropTools(ask: WindowTask, assets: CropAssets) {
  return async (tool: any): Promise<ToolOutcome | undefined> => {
    if (tool?.action === "regions") {
      if (typeof tool.file !== "string" || !tool.file.trim()) return { result: { error: '"regions" needs "file" (a PDF or picture from this chat) and, for a PDF, "page" (or "pages", up to 4).' }, pictures: [] };
      const { data, images } = await ask("regions", { file: tool.file, page: tool.page, pages: tool.pages });
      const scanned = data.results?.some((r: any) => r.kind === "scanned");
      return {
        result: {
          ...data,
          pictures: images.map((i) => i.name),
          note: `Each candidate is outlined on the attached picture with its id. Boxes are [x0, y0, x1, y1] ${data.units === "pt" ? "in PDF points from the bottom left of the page" : "in pixels from the top left of the picture"}. Crop one with {"action":"crop","file":"${data.file}",${data.type === "pdf" ? '"page":N,' : ""}"region":"id"}, or give "bbox" for any other area (a part of a figure, something not listed).${scanned ? " A scanned page has no structure: its candidates come from the pixels and its crops are pictures." : ""}`,
        },
        pictures: images,
      };
    }
    if (tool?.action !== "crop") return undefined;
    if (typeof tool.file !== "string" || !tool.file.trim() || (!tool.region && !tool.bbox)) return { result: { error: '"crop" needs "file", "page" (PDFs), and "region" (an id from regions) or "bbox": [x0, y0, x1, y1].' }, pictures: [] };
    const { data, images, files } = await ask("crop", { file: tool.file, page: tool.page, region: tool.region, bbox: tool.bbox, padding: tool.padding, dpi: tool.dpi, trim: tool.trim, withCaption: tool.withCaption });
    const [png, source] = files;
    if (!png) throw Error("The crop could not be made.");
    const box = data.box as Box;
    // Pages drawn as vectors are cut as vectors too; the PNG is the fallback (and what Word and PowerPoint get).
    const pdf = data.vector && source ? await vectorCrop(source, data.page, box) : undefined;
    const caption = typeof tool.caption === "string" ? tool.caption.slice(0, 300) : data.region?.caption;
    const asset = await assets.add({ file: data.file, ...(data.page ? { page: data.page } : {}), box, units: data.units, width: data.width, height: data.height, ...(data.dpi ? { dpi: data.dpi } : {}), vector: !!pdf, ...(caption ? { caption } : {}) }, png, pdf);
    const hit = (data.hit as string[]).map((s) => SIDES[s]).filter(Boolean);
    return {
      result: {
        crop: { id: asset.id, file: asset.file, ...(asset.page ? { page: asset.page } : {}), box: asset.box, units: asset.units, pixels: `${asset.width}×${asset.height}`, ...(asset.dpi ? { dpi: asset.dpi } : {}), vector: asset.vector, ...(asset.caption ? { caption: asset.caption } : {}) },
        pictures: images.map((i) => i.name),
        check: hit.length
          ? `The drawing seems to run on past the ${hit.join(" and ")} edge${hit.length > 1 ? "s" : ""}. Look at the attached picture; if anything is cut, crop again with a larger "bbox".`
          : `Trimmed to the drawing's own edges with ${tool.trim === false ? "no trimming (as asked)" : "every edge on paper"}. Look at the attached picture: every label whole, nothing from around it. If it is wrong, crop again with an adjusted "bbox" (same units).`,
        note: `Kept in this chat as "${asset.id}"${asset.vector ? " (vector: sharp at any size)" : ""}. To put it in a pdf, docx or pptx, use "figure":{"asset":"${asset.id}","source"?:"…" or true}.`,
      },
      pictures: images,
    };
  };
}

/** One crop by id, from its own record: what documents use, in or outside the chat that cut it. */
export async function readAsset(io: AssetIo, id: unknown) {
  if (typeof id !== "string" || !ID.test(id)) return undefined;
  const raw = await io.read(id + "-meta").catch(() => null);
  if (!raw) return undefined;
  let meta: CropAsset;
  try { meta = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { return undefined; }
  const png = await io.read(id + "-png");
  if (!png) return undefined;
  return { meta, png, pdf: meta.vector ? (await io.read(id + "-pdf")) ?? undefined : undefined };
}
export type ReadAsset = (id: string) => Promise<Awaited<ReturnType<typeof readAsset>>>;

/**
 * A crop as a drawing the document makers already know how to place: an SVG of the crop's size holding its PNG,
 * marked with the crop's id. Word and PowerPoint take the PNG out whole (desktop/rasterize.ts), and the PDF maker
 * puts the vector crop where it lands (stampVectors). Sizes are CSS pixels: points × 96/72 for a PDF crop.
 */
export function assetSvg(meta: CropAsset, png: Uint8Array) {
  const [x0, y0, x1, y1] = meta.box;
  const scale = meta.units === "pt" ? 96 / 72 : 1;
  const w = Math.max(1, Math.round((x1 - x0) * scale * 100) / 100), h = Math.max(1, Math.round((y1 - y0) * scale * 100) / 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" data-mowr-asset="${meta.id}"${meta.vector ? ' data-mowr-vector="1"' : ""}><image width="${w}" height="${h}" preserveAspectRatio="none" href="data:image/png;base64,${Buffer.from(png).toString("base64")}"/></svg>`;
}
const ASSET_SVG = /^<svg [^>]*\bwidth="([\d.]+)" height="([\d.]+)"[^>]*\bdata-mowr-asset="(crop-[a-f0-9]{8})"[^>]*><image [^>]*href="data:image\/png;base64,([A-Za-z0-9+/=]+)"\/><\/svg>$/;
/** The crop inside an assetSvg drawing: its id, its CSS size, its PNG; undefined for any other drawing. */
export function assetOf(svg: string) {
  const m = ASSET_SVG.exec(svg);
  return m ? { id: m[3], width: Number(m[1]), height: Number(m[2]), png: new Uint8Array(Buffer.from(m[4], "base64")), vector: /\bdata-mowr-vector="1"/.test(svg.slice(0, 400)) } : undefined;
}

const LABEL = /^\s*(?:fig(?:ure)?|table|tab|scheme|plate|chart)\.?\s*(?:\d+|[IVXLC]+\b)(?:[.\-–:]\d+)*[a-z]?[.:]?\s*/i;
/** The caption under a reused crop: the one given, else the source's own without its old number ("Figure 2.4"), and
 *  "Source: …" after it when the model gives a source (true: the file and page it was cut from). */
export function assetCaption(figure: any, own: unknown, meta: CropAsset) {
  let text = typeof own === "string" && own.trim() ? own.trim() : typeof figure?.caption === "string" && figure.caption.trim() ? figure.caption.trim() : meta.caption ? meta.caption.replace(LABEL, "").trim() : "";
  const source = figure?.source === true ? `${meta.file.split(/[\\/]/).pop()}${meta.page ? `, p. ${meta.page}` : ""}` : typeof figure?.source === "string" ? figure.source.trim().slice(0, 300) : "";
  if (source && !/\bsource:/i.test(text)) text = (text ? text + (/[.!?]$/.test(text) ? " " : ". ") : "") + "Source: " + source + (/[.!?]$/.test(source) ? "" : ".");
  return text || undefined;
}

/**
 * Crop figures ({"asset":"crop-…"}) in a pdf, docx or pptx specification, resolved for drawing: a copy of the spec whose
 * asset figures carry their drawing (figure.svg) and caption, the vector crops for the PDF maker, and the ids that are
 * not crops this person has. The spec as sent (and stored) keeps only the ids.
 */
export async function resolveAssets(spec: any, read: ReadAsset) {
  const vectors = new Map<string, Uint8Array>(), missing: string[] = [];
  if (!spec || typeof spec !== "object") return { spec, vectors, missing };
  const resolve = async (figure: any) => {
    if (!figure || typeof figure !== "object" || typeof figure.asset !== "string") return undefined;
    const asset = await read(figure.asset).catch(() => undefined);
    if (!asset) { missing.push(figure.asset); return undefined; }
    if (asset.pdf) vectors.set(asset.meta.id, asset.pdf);
    return { figure: { ...figure, svg: assetSvg(asset.meta, asset.png) }, meta: asset.meta };
  };
  const copy = { ...spec };
  if (Array.isArray(spec.sections)) copy.sections = await Promise.all(spec.sections.map(async (s: any) => {
    const r = await resolve(s?.figure);
    return r ? { ...s, figure: r.figure, caption: assetCaption(s.figure, s.caption, r.meta) } : s;
  }));
  if (Array.isArray(spec.slides)) copy.slides = await Promise.all(spec.slides.map(async (s: any) => {
    const r = await resolve(s?.figure);
    if (r) return { ...s, figure: r.figure, caption: assetCaption(s.figure, s.caption, r.meta) };
    const p = await resolve(s?.image?.figure);
    return p ? { ...s, image: { ...s.image, figure: p.figure }, ...(s.caption !== undefined || s.image.figure.source ? { caption: assetCaption(s.image.figure, s.caption, p.meta) } : {}) } : s;
  }));
  return { spec: copy, vectors, missing: [...new Set(missing)] };
}

/** Where a vector crop goes on the printed page: a link to this address, wrapped round a placeholder of its size. */
export const SLOT = "https://asset.mowr.invalid/";

/**
 * Puts each vector crop where its placeholder was printed: Chromium writes every link as an annotation with its exact
 * rectangle, so the crop's page is drawn into that rectangle and the link removed. Throws when a place is missing, so
 * the caller prints with the PNGs instead.
 */
export async function stampVectors(bytes: Uint8Array, vectors: Map<string, Uint8Array>, expected: number) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const embedded = new Map<string, Awaited<ReturnType<PDFDocument["embedPdf"]>>[number]>();
  let placed = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      const action = annot.lookup(PDFName.of("A"));
      const uri = action instanceof PDFDict ? action.lookup(PDFName.of("URI")) : undefined;
      const target = uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : "";
      if (!target.startsWith(SLOT)) continue;
      const id = target.slice(SLOT.length).split(/[/?#]/)[0];
      const crop = vectors.get(id);
      const rect = annot.lookup(PDFName.of("Rect"));
      if (!crop || !(rect instanceof PDFArray) || rect.size() !== 4) throw Error("A crop's place could not be found.");
      if (!embedded.has(id)) embedded.set(id, (await doc.embedPdf(crop, [0]))[0]);
      const [ax, ay, bx, by] = rect.asArray().map((n: any) => Number(n.asNumber?.()));
      if (![ax, ay, bx, by].every(Number.isFinite)) throw Error("A crop's place could not be read.");
      page.drawPage(embedded.get(id)!, { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) });
      annots.remove(i);
      placed++;
    }
  }
  if (placed !== expected) throw Error(`${expected - placed} crop place${expected - placed === 1 ? "" : "s"} could not be found.`);
  return doc.save({ useObjectStreams: false });
}
