import { PDFDocument, degrees } from "pdf-lib";
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
    list.push(asset);
    for (const old of list.splice(0, Math.max(0, list.length - MAX_ASSETS))) await Promise.all([this.io.remove(old.id + "-png"), this.io.remove(old.id + "-pdf")]).catch(() => {});
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
  const [x0, y0, x1, y1] = box;
  const embedded = await out.embedPage(from, { left: x0, bottom: y0, right: x1, top: y1 });
  const sheet = out.addPage([x1 - x0, y1 - y0]);
  sheet.drawPage(embedded, { x: 0, y: 0, width: x1 - x0, height: y1 - y0 });
  // A page shown turned keeps the same turn, so the crop looks as it did on the page.
  const turn = from.getRotation().angle % 360;
  if (turn) sheet.setRotation(degrees(turn));
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
        note: `Kept in this chat as "${asset.id}"${asset.vector ? " (vector: sharp at any size)" : ""}.`,
      },
      pictures: images,
    };
  };
}
