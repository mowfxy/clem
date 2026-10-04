import { getBlob } from "../store";
import type { StoredFile } from "../../core/types";
import { namedPages } from "../../core/file-tools";

/**
 * What the model sees, not only reads. Text extraction loses circuit diagrams, graphs, figures, handwriting and
 * scanned pages, so the files in a conversation also go to the model as pictures: every image the person attached,
 * the pages of PDFs that hold drawings (or every page of a short or scanned PDF), and the pictures inside Word and
 * PowerPoint files. A page the budget left out can be looked at on demand ({"action":"look"}, see pageImages).
 */
export type Picture = { name: string; data: string };
const MAX_SIDE = 1600;

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
  return lib;
}
const base64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const jpeg = (canvas: HTMLCanvasElement) => new Promise<Blob>((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(Error("The page could not be drawn."))), "image/jpeg", 0.85));

/** Rendered pages are kept for the session: the same lecture is usually asked about many times. */
const rendered = new Map<string, string>();
const remember = (key: string, data: string) => { rendered.set(key, data); if (rendered.size > 120) rendered.delete(rendered.keys().next().value!); };
/** Which pages of each PDF draw something (figure pages), by file and version. */
const surveys = new Map<string, { pages: number; visual: { page: number; weight: number }[]; textless: number[] }>();

/** How long one PDF's survey may take before the message goes without the rest of it (the model can still "look"). */
const SURVEY_MS = 8000;
/** The pages that carry pictures or drawings (many path operations: circuits, graphs, diagrams), and those with no text. */
async function survey(file: StoredFile, pdf: any, lib: any, signal?: AbortSignal) {
  const key = `${file.id}:${file.size}:${file.updated || file.created}`;
  const known = surveys.get(key);
  if (known) return known;
  const visual: { page: number; weight: number }[] = [], textless: number[] = [];
  const last = Math.min(pdf.numPages, 150), until = Date.now() + SURVEY_MS;
  let surveyed = 0;
  for (let p = 1; p <= last; p++) {
    signal?.throwIfAborted();
    if (Date.now() > until) break;
    surveyed = p;
    const page = await pdf.getPage(p);
    try {
      const [ops, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
      let images = 0, paths = 0;
      for (const fn of ops.fnArray) {
        if (fn === lib.OPS.paintImageXObject || fn === lib.OPS.paintInlineImageXObject || fn === lib.OPS.paintImageMaskXObject) images++;
        else if (fn === lib.OPS.constructPath) paths++;
      }
      const words = text.items.reduce((n: number, item: any) => n + (("str" in item && item.str.trim()) ? 1 : 0), 0);
      if (!words) textless.push(p);
      // A page of plain text has a few rules at most; a diagram has dozens of strokes or an embedded picture.
      const weight = images * 6 + (paths >= 12 ? paths : 0);
      if (weight >= 6) visual.push({ page: p, weight });
    } finally {
      page.cleanup();
    }
  }
  const result = { pages: pdf.numPages, visual, textless };
  // A survey cut short is not kept, so the next message can look further.
  if (surveyed === last) surveys.set(key, result);
  return result;
}

async function renderPage(file: StoredFile, pdf: any, n: number) {
  const key = `${file.id}:${file.size}:${file.updated || file.created}:${n}`;
  const cached = rendered.get(key);
  if (cached) return cached;
  const page = await pdf.getPage(n);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, MAX_SIDE / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, canvas } as any).promise;
    const data = await base64(await jpeg(canvas));
    remember(key, data);
    return data;
  } finally {
    page.cleanup();
  }
}

/** Pictures of a PDF for a request: named pages first, then short or scanned documents whole, then the pages with drawings. */
async function pdfPictures(file: StoredFile, blob: Blob, want: number[], limit: number, signal?: AbortSignal): Promise<Picture[]> {
  const lib = await pdfjs();
  const loading = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const info = await survey(file, pdf, lib, signal);
    const order: number[] = [];
    const add = (p: number) => { if (p >= 1 && p <= info.pages && !order.includes(p)) order.push(p); };
    want.forEach(add);
    if (info.pages <= Math.min(limit, 8)) for (let p = 1; p <= info.pages; p++) add(p);
    info.textless.forEach(add);
    [...info.visual].sort((a, b) => b.weight - a.weight).forEach((v) => add(v.page));
    const chosen = order.slice(0, limit);
    // In reading order, after any page the person named.
    const named = chosen.filter((p) => want.includes(p)), rest = chosen.filter((p) => !want.includes(p)).sort((a, b) => a - b);
    const out: Picture[] = [];
    for (const p of [...named, ...rest]) { signal?.throwIfAborted(); out.push({ name: `${file.name} — page ${p} of ${info.pages}`, data: await renderPage(file, pdf, p) }); }
    return out;
  } finally {
    await loading.destroy();
  }
}

/** Downscaled to at most MAX_SIDE pixels and re-encoded, so a large photo stays within the provider's limits. */
async function fitImage(blob: Blob): Promise<string | null> {
  try {
    // A HEIC photo stored before conversion existed is converted now.
    const { looksHeic, heicToJpeg } = await import("./heic");
    const bitmap = await createImageBitmap((await looksHeic(blob)) ? (await heicToJpeg(blob)).jpeg : blob);
    // Icons, bullets and spacer images say nothing.
    if (bitmap.width < 80 || bitmap.height < 80) { bitmap.close(); return null; }
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return base64(await jpeg(canvas));
  } catch {
    return null;
  }
}

/** The pictures inside a Word, PowerPoint or Excel file (diagrams, photos, charts saved as images), in document order. */
async function officePictures(file: StoredFile, blob: Blob, limit: number): Promise<Picture[]> {
  const { unzipSync } = await import("fflate");
  if (blob.size > 60_000_000) return [];
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: (f) => /^(word|ppt|xl)\/media\/[^/]+\.(png|jpe?g|gif|bmp|webp)$/i.test(f.name) && f.originalSize > 6000 && f.originalSize < 25_000_000 });
  const names = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out: Picture[] = [];
  for (const name of names) {
    if (out.length >= limit) break;
    const type = /\.png$/i.test(name) ? "image/png" : /\.gif$/i.test(name) ? "image/gif" : /\.bmp$/i.test(name) ? "image/bmp" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg";
    const data = await fitImage(new Blob([files[name] as BlobPart], { type }));
    if (data) out.push({ name: `${file.name} — picture ${out.length + 1} (${name.split("/").pop()})`, data });
  }
  return out;
}

async function filePictures(file: StoredFile, want: number[], limit: number, signal?: AbortSignal): Promise<Picture[]> {
  if (limit <= 0 || file.remote) return [];
  const blob = await getBlob(file.id);
  if (!blob) return [];
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) {
    const key = `${file.id}:${file.size}:${file.updated || file.created}:image`;
    const data = rendered.get(key) ?? (await fitImage(blob));
    if (!data) return [];
    remember(key, data);
    return [{ name: file.name, data }];
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return pdfPictures(file, blob, want, limit, signal);
  if (/\.(docx|pptx|xlsx)$/i.test(file.name)) return officePictures(file, blob, Math.min(limit, 8));
  return [];
}

/**
 * The pictures for one request, within `limit`: the files attached to this message first (with any page the message
 * names), then the file open beside the chat, then files from earlier in the conversation, newest first. A file that
 * cannot be drawn is skipped; it never stops the message.
 */
export async function conversationPictures({ files, attached, open, earlier, prompt, limit = 16, signal }: { files: StoredFile[]; attached: string[]; open?: string; earlier: string[]; prompt: string; limit?: number; signal?: AbortSignal }) {
  const want = namedPages(prompt);
  const ordered = [...new Set([...attached, ...(open ? [open] : []), ...earlier])].map((id) => files.find((f) => f.id === id)).filter((f): f is StoredFile => !!f);
  const out: Picture[] = [];
  for (const [i, file] of ordered.entries()) {
    signal?.throwIfAborted();
    const room = limit - out.length;
    if (room <= 0) break;
    // Files the person just attached share most of the room; earlier files get what is left, a few pages each.
    const current = i < attached.length + (open ? 1 : 0);
    const share = current ? Math.max(4, Math.ceil(room / Math.max(1, attached.length + (open ? 1 : 0) - i))) : Math.min(4, room);
    try {
      out.push(...(await filePictures(file, current ? want : [], Math.min(room, share), signal)));
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  return out.slice(0, limit);
}

/** Specific pages of a file, for the model's {"action":"look"} request. */
export async function pageImages(files: StoredFile[], name: string, pages: number[]): Promise<Picture[]> {
  const wanted = name.trim().toLowerCase();
  const file = files.find((f) => f.name.toLowerCase() === wanted) || files.find((f) => f.name.toLowerCase().includes(wanted) || wanted.includes(f.name.toLowerCase()));
  if (!file) throw Error(`No file named "${name}" in this conversation.`);
  if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) return filePictures(file, [], 8);
  const blob = await getBlob(file.id);
  if (!blob) throw Error(`${file.name} is missing from this PC.`);
  const lib = await pdfjs();
  const loading = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const valid = pages.filter((p) => p >= 1 && p <= pdf.numPages).slice(0, 8);
    if (!valid.length) throw Error(`${file.name} has ${pdf.numPages} pages.`);
    const out: Picture[] = [];
    for (const p of valid) out.push({ name: `${file.name} — page ${p} of ${pdf.numPages}`, data: await renderPage(file, pdf, p) });
    return out;
  } finally {
    await loading.destroy();
  }
}
