import { get, set } from "idb-keyval";
import { desktop } from "./bridge";

/**
 * The text of scanned pages: drawn here with pdf.js, read by Windows' own OCR in the desktop app (desktop/ocr.ts).
 * Each page's reading is kept by file version, so a long scan is read once, a part at a time, and never again.
 * `pending`: pages left for a later request when `until` came first.
 */
export async function scannedText(pdf: any, pages: number[], key: string, until: number, signal?: AbortSignal) {
  const texts = new Map<number, string>(), pending: number[] = [];
  if (!desktop) return { texts, pending: [] as number[] };
  // All scans share one allowance, so a subject full of them never holds a message up: the rest is read on later ones.
  bank = Math.min(BANK, bank + (Date.now() - filled) * REFILL);
  filled = Date.now();
  until = Math.min(until, Date.now() + bank);
  const started = Date.now();
  try { return await read(pdf, pages, key, until, texts, pending, signal); }
  finally { bank = Math.max(0, bank - (Date.now() - started)); filled = Date.now(); }
}
/** Seconds of OCR at hand (45), refilled at half a second each second. */
const BANK = 45_000, REFILL = 0.5;
let bank = BANK, filled = Date.now();

async function read(pdf: any, pages: number[], key: string, until: number, texts: Map<number, string>, pending: number[], signal?: AbortSignal) {
  const todo: number[] = [];
  for (const p of pages) {
    const known = await get<string>(`mowr-ocr:${key}:${p}`).catch(() => undefined);
    if (known !== undefined) texts.set(p, known);
    else todo.push(p);
  }
  for (let i = 0; i < todo.length; i += 6) {
    signal?.throwIfAborted();
    const batch = todo.slice(i, i + 6);
    if (Date.now() > until) { pending.push(...todo.slice(i)); break; }
    try {
      const pictures = [];
      for (const p of batch) pictures.push(await drawPage(pdf, p));
      const { texts: read } = await desktop!.invoke({ action: "ocr", pictures });
      batch.forEach((p, j) => { const text = String(read?.[j] || "").trim(); texts.set(p, text); void set(`mowr-ocr:${key}:${p}`, text).catch(() => {}); });
    } catch (e) {
      if (signal?.aborted) throw e;
      // Windows could not read them (no OCR language installed): they stay pages to look at.
      pending.push(...todo.slice(i));
      break;
    }
  }
  return { texts, pending };
}

/** A page drawn for OCR: about 2200 pixels on its long side, sharp enough for small print. */
async function drawPage(pdf: any, n: number) {
  const page = await pdf.getPage(n);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, 2200 / Math.max(base.width, base.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    // Print intent: the display intent waits for animation frames, which never come while the window is hidden.
    await page.render({ canvasContext: context, viewport, canvas, intent: "print" }).promise;
    const blob = await new Promise<Blob>((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(Error("The page could not be drawn."))), "image/jpeg", 0.92));
    canvas.width = canvas.height = 0;
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    page.cleanup();
  }
}

/** Marks a scanned page whose text is not read yet; a text holding it is not kept, so the next request reads further. */
export const OCR_PENDING = "(a scanned page whose text is not read yet: look at it to see what it says)";
