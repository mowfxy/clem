import { getBlob } from "../store";
import type { StoredFile } from "../../core/types";
import { namedPages, pageScores, relevantPages } from "../../core/file-tools";

/**
 * What the model sees, not only reads. Text extraction loses circuit diagrams, graphs, figures, handwriting and
 * scanned pages, so the files in a conversation also go to the model as pictures: every image the person attached,
 * the pages of PDFs that hold drawings (or every page of a short or scanned PDF), and the pictures inside Word and
 * PowerPoint files. A page the budget left out can be looked at on demand ({"action":"look"}, see pageImages).
 */
export type Picture = { name: string; data: string };
const MAX_SIDE = 1600;

export async function pdfjs() {
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
const surveys = new Map<string, Survey>();
/** `surveyed`: how many pages were looked at (long PDFs are surveyed up to page 150, within SURVEY_MS). `formulas`: pages
 *  set as mathematics, whose extracted text loses fractions, sub- and superscripts. */
type Survey = { pages: number; surveyed: number; visual: { page: number; weight: number }[]; textless: number[]; formulas: number[] };

/** How long one PDF's survey may take before the message goes without the rest of it (the model can still "look"). */
const SURVEY_MS = 8000;
/** The pages that carry pictures or drawings (many path operations: circuits, graphs, diagrams), those with no text, and those set as formulas. */
async function survey(file: StoredFile, pdf: any, lib: any, signal?: AbortSignal): Promise<Survey> {
  const key = `${file.id}:${file.size}:${file.updated || file.created}`;
  const known = surveys.get(key), last = Math.min(pdf.numPages, 150);
  if (known?.surveyed === last) return known;
  // A survey cut short is kept as far as it went, and the next message goes on from the next page.
  const visual = [...(known?.visual || [])], textless = [...(known?.textless || [])], formulas = [...(known?.formulas || [])];
  const until = Date.now() + SURVEY_MS;
  let surveyed = known?.surveyed || 0;
  for (let p = surveyed + 1; p <= last; p++) {
    signal?.throwIfAborted();
    if (Date.now() > until) break;
    surveyed = p;
    const page = await pdf.getPage(p);
    try {
      const [ops, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
      let images = 0, paths = 0;
      // A picture counts when it covers a real part of the page: a slide template's logo or background on every page is not a figure.
      const [x0, y0, x1, y1] = page.view, area = Math.abs((x1 - x0) * (y1 - y0)) || 1;
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      ops.fnArray.forEach((fn: number, i: number) => {
        if (fn === lib.OPS.save) stack.push(ctm);
        else if (fn === lib.OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === lib.OPS.transform) {
          const [a, b, c, d, e, f] = ops.argsArray[i];
          ctm = [ctm[0] * a + ctm[2] * b, ctm[1] * a + ctm[3] * b, ctm[0] * c + ctm[2] * d, ctm[1] * c + ctm[3] * d, ctm[0] * e + ctm[2] * f + ctm[4], ctm[1] * e + ctm[3] * f + ctm[5]];
        } else if (fn === lib.OPS.paintImageXObject || fn === lib.OPS.paintInlineImageXObject || fn === lib.OPS.paintImageMaskXObject) {
          // A picture over nearly the whole page is a background (a scan has no text, so it is a textless page anyway).
          const share = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) / area;
          if (share >= 0.04 && share <= 0.9) images++;
        } else if (fn === lib.OPS.constructPath) paths++;
      });
      const words = text.items.filter((item: any) => "str" in item && item.str.trim());
      if (!words.length) textless.push(p);
      // Typeset mathematics comes out as many one- or two-character pieces (x, ², =, a fraction's parts); prose does not.
      else if (words.length >= 30 && words.filter((item: any) => item.str.trim().length <= 2).length / words.length > 0.35) formulas.push(p);
      // A page of plain text has a few rules at most; a diagram has dozens of strokes or an embedded picture.
      const weight = images * 6 + (paths >= 12 ? paths : 0);
      if (weight >= 6) visual.push({ page: p, weight });
    } finally {
      page.cleanup();
    }
  }
  const result = { pages: pdf.numPages, surveyed, visual, textless, formulas };
  surveys.set(key, result);
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
    // Print intent: the display intent waits for animation frames, which never come while the window is hidden.
    await page.render({ canvasContext: context, viewport, canvas, intent: "print" } as any).promise;
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
  const pdf = await loading.promise.catch(async (e) => { await loading.destroy(); throw e; });
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
export async function conversationPictures({ files, attached, open, earlier, prompt, limit = 16, skip = [], signal }: { files: StoredFile[]; attached: string[]; open?: string; earlier: string[]; prompt: string; limit?: number; skip?: string[]; signal?: AbortSignal }) {
  const want = namedPages(prompt);
  // PDFs pdfView already gave the model need no more pictures of their pages.
  const ordered = [...new Set([...attached, ...(open ? [open] : []), ...earlier])].filter((id) => !skip.includes(id)).map((id) => files.find((f) => f.id === id)).filter((f): f is StoredFile => !!f);
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

export type PdfProvider = "claude" | "grok" | "antigravity" | "codex";
/** A PDF handed to the model as a file: Claude reads it as claude.ai reads an upload, Grok opens its pages itself. */
export type PdfFile = { name: string; data: Uint8Array<ArrayBuffer> };
/**
 * How the conversation's PDFs reach the model, the way each AI reads a PDF on its own:
 * - Claude takes PDF files (each page as drawn, plus its text), and so does Antigravity (attached to its message).
 * - Grok's own read_file opens PDF pages as pictures, any range, so it gets the files themselves.
 * - ChatGPT (Codex) cannot be given a file, so it sees pages as pictures beside the page text, as ChatGPT does.
 * Text first, as Claude's Cowork reads files: every PDF's text goes with the request (the sources), and only the pages
 * whose text says too little are seen as drawn: pages with diagrams, pictures or tables drawn as figures, scanned pages
 * and pages set as formulas, plus any page the person names. A page drawn costs two to three times its text, and every
 * step of a tool loop reads the request again: a 10-page PDF sent whole cost about 24k tokens a step, its text about 9k.
 * Any other page is a look away. A PDF whose every page needs seeing goes whole.
 * None of this applies to an AI working in its own folder (`listOnly`, every chat answer with tools): it opens each PDF
 * itself and reads its pages as drawn, as a PDF sent to its CLI is read.
 * `handled`: PDFs dealt with here, which conversationPictures leaves out. `whole`: PDFs Claude has whole, whose text
 * excerpts would only repeat them.
 */
export type PdfView = { files: PdfFile[]; pictures: Picture[]; notes: string[]; handled: string[]; whole: string[]; spent: { bytes: number; whole: number; focus: number } };
export const NO_PDF_VIEW = (): PdfView => ({ files: [], pictures: [], notes: [], handled: [], whole: [], spent: { bytes: 0, whole: 0, focus: 0 } });

/** Pages of the PDFs this message is about seen as drawn (about 2.4k tokens a page for Claude, its text alone about 1k). */
export const wholePageBudget = (model: string) => (/\[1m\]$/i.test(model) ? 40 : 20);
/** Pages of other PDFs (earlier in the chat, the subject's, Drive's) seen as drawn in one message; any other page is a search, read or look away. */
const FOCUS_PAGES = 6;
/** Page pictures for ChatGPT in one message. */
const PICTURE_PAGES = 24;
/** Files not attached (the subject's or project's, Drive's) shown by their best pages: so many files, so many pages each. */
const RELATED_FILES = 2, RELATED_PAGES = 2;
/** Claude's request is capped at 32 MB; Grok's and Antigravity's files are copied on this PC, so they may be larger. */
const FILE_BYTES: Record<PdfProvider, number> = { claude: 18_000_000, grok: 150_000_000, antigravity: 150_000_000, codex: 200_000_000 };
/** The most PDF files and notes one chat request takes (desktop/contracts.ts "chat"). */
const MAX_FILES = 20, MAX_NOTES = 40;
const isPdfFile = (f: StoredFile) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
/** "1–3, 7, 9–12": runs of pages as ranges. */
const pageList = (pages: number[]) => {
  const runs: string[] = [];
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return runs.join(", ");
};
const pagesNamed = (pages: number[]) => (pages.length === 1 ? "page " : "pages ") + pageList(pages);
const plural = (n: number) => `${n} page${n === 1 ? "" : "s"}`;

/** A few pages of a PDF, as a PDF: what Claude reads of a long one. Null for an encrypted PDF: pdf-lib cannot decrypt,
 *  so its copied pages would still be encrypted and unreadable. */
async function excerptPdf(bytes: Uint8Array, pages: number[]) {
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (source.isEncrypted) return null;
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(source, pages.map((p) => p - 1))) out.addPage(page);
  return new Uint8Array(await out.save());
}

export async function pdfView({ files, current, earlier, related = [], prompt, provider, model, text, given, wholePages = wholePageBudget(model), after, signal, listOnly = false }: {
  files: StoredFile[];
  /** PDFs of this message (attached, open beside the chat, Drive files added to it), first. */
  current: string[];
  /** PDFs from earlier in the conversation, newest first. */
  earlier: string[];
  /** PDFs the person did not attach but that are theirs to draw on (saved in the subject or project, found in Google Drive),
   *  with where they are. Never sent whole: the few that match the question best show the pages that match it. */
  related?: { id: string; where: string }[];
  prompt: string;
  provider: PdfProvider;
  model: string;
  /** A PDF's extracted text with its page markers (src/source-context.ts cachedFileText), to find the pages a question is about. */
  text: (file: StoredFile) => Promise<string>;
  /** PDFs not stored in Clem (one being edited from disk), by id. */
  given?: Map<string, Blob>;
  /** Pages seen whole in this request (less for each step of a plan); longer PDFs are seen by their relevant pages. */
  wholePages?: number;
  /** What an earlier view of this same request already sent: its room is used up, and its files are not shown again. */
  after?: PdfView;
  signal?: AbortSignal;
  /** An AI working in a folder of the person's files: no pages go with the request, only each PDF's name and length;
   *  it reads the PDF itself, as drawn. */
  listOnly?: boolean;
}): Promise<PdfView> {
  const view = NO_PDF_VIEW();
  const named = namedPages(prompt);
  const spent = after?.spent || { bytes: 0, whole: 0, focus: 0 };
  let wholeRoom = wholePages - spent.whole, focusRoom = FOCUS_PAGES - spent.focus, bytes = spent.bytes;
  const pictureRoom = () => PICTURE_PAGES - view.pictures.length - (after?.pictures.length || 0);
  const done = new Set(after?.handled || []);

  /** One PDF to the model, as this AI reads PDFs: whole, or the given pages (none: its text says it all, so only a
   *  note). `where`: for a file the person did not attach. `unsurveyed`: pages at the end not checked for drawings. */
  const show = async (file: StoredFile, data: Uint8Array<ArrayBuffer>, pdf: any, count: number, pages: number[], whole: boolean, where?: string, unsurveyed = 0) => {
    const rest = `Its whole text is with the sources and in the file tools (search it, read any page); the pages not shown are plain text, but look at one before relying on its layout.${unsurveyed ? ` Pages after ${count - unsurveyed} were not checked for drawings: look at any you need.` : ""}`;
    const from = where ? `, ${where}, not attached: only its pages that match the question are shown` : "";
    // Within what one request may carry; a PDF past it is read from its text as before.
    if (view.notes.length + (after?.notes.length || 0) >= MAX_NOTES || (provider !== "codex" && view.files.length + (after?.files.length || 0) >= MAX_FILES)) return false;
    // An encrypted PDF cannot be cut into pages: Claude gets it whole when it fits, otherwise its pages as pictures.
    let sent: Uint8Array<ArrayBuffer> | null = null;
    const asFile = provider === "claude" || provider === "antigravity";
    if (asFile && pages.length) {
      sent = whole ? data : await excerptPdf(data, pages);
      if (!sent && !where && bytes + data.length <= FILE_BYTES[provider]) sent = data;
    }
    if (!pages.length) {
      if (where) return false;
      view.notes.push(`"${file.name}" (${plural(count)}): text only (no drawings, scans or formulas found), so its text with the sources is all of it. ${rest}`);
    } else if (sent) {
      if (bytes + sent.length > FILE_BYTES[provider]) return false;
      bytes += sent.length;
      const all = sent === data;
      view.files.push({ name: all ? file.name : `${file.name} — ${pagesNamed(pages)} of ${count}`, data: sent });
      view.notes.push(all
        ? `"${file.name}" (${plural(count)}): attached whole as a PDF file.`
        : `"${file.name}" (${plural(count)}${from}): a PDF of ${pagesNamed(pages)}${where ? "" : ", the pages with drawings, scans or formulas,"} is attached (its pages are those pages of the original, in that order). ${rest}`);
      if (all) view.whole.push(file.id);
    } else if (provider === "grok") {
      if (bytes + data.length > FILE_BYTES.grok) return false;
      bytes += data.length;
      view.files.push({ name: file.name, data });
      view.notes.push(whole
        ? `"${file.name}" (${plural(count)}): read every page with read_file${count > 10 ? ` ("pages": "1-20", then "21-40" and so on, sent together)` : ""} before answering.`
        : `"${file.name}" (${plural(count)}${from}): open ${pagesNamed(pages)}${where ? "" : " (drawings, scans or formulas the text cannot show)"} with read_file ("pages": "12-15", at most 20 a call, ranges sent together) before relying on them. ${rest}`);
    } else {
      const shown = pages.slice(0, Math.max(0, pictureRoom()));
      if (!shown.length) return false;
      for (const p of shown) { signal?.throwIfAborted(); view.pictures.push({ name: `${file.name} — page ${p} of ${count}`, data: await renderPage(file, pdf, p) }); }
      view.notes.push(shown.length === count
        ? `"${file.name}" (${plural(count)}): every page is attached as a picture; read each page from its picture and its text together.`
        : `"${file.name}" (${plural(count)}${from}): ${pagesNamed(shown)} ${shown.length === 1 ? "is" : "are"} attached as pictures${where ? "" : " (the pages with drawings, scans or formulas)"}. ${rest}`);
    }
    view.handled.push(file.id);
    return true;
  };
  /** Opens a PDF for `use`; an encrypted, damaged or unreachable one is skipped (it is read from its text as before). */
  const open = async (file: StoredFile, use: (data: Uint8Array<ArrayBuffer>, pdf: any, count: number) => Promise<unknown>) => {
    try {
      const blob = given?.get(file.id) ?? (await getBlob(file.id));
      // Only a PDF whose bytes go with the request must fit what this AI takes in one.
      if (!blob || !listOnly && blob.size > FILE_BYTES[provider]) return;
      const data = new Uint8Array(await blob.arrayBuffer());
      const lib = await pdfjs();
      // A copy: pdf.js takes ownership of the bytes it is given.
      const loading = lib.getDocument({ data: data.slice(), useSystemFonts: false });
      try {
        const pdf = await loading.promise;
        await use(data, pdf, pdf.numPages);
      } finally {
        await loading.destroy();
      }
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  };

  for (const id of [...new Set([...current, ...earlier])]) {
    signal?.throwIfAborted();
    const file = files.find((f) => f.id === id);
    if (!file || !isPdfFile(file) || done.has(id)) continue;
    const isCurrent = current.includes(id);
    await open(file, async (data, pdf, count) => {
      // Every AI with its own folder reads a PDF there as drawn (Claude Code and Grok open it natively; Codex looks at its
      // pages), as when a PDF is sent to the CLI: it is only told the PDF is there, never which pages to trust its text for.
      if (listOnly) {
        view.notes.push(`"${file.name}" (${plural(count)})`);
        view.handled.push(file.id);
        return;
      }
      const info = await survey(file, pdf, await pdfjs(), signal).catch((e) => { if (signal?.aborted) throw e; return null; });
      const body = await text(file).catch(() => "");
      // The pages whose text cannot stand in for them. A PDF without usable text (a scan not read yet) is all such pages.
      const words = body.replace(/\[[^\]\n]*page \d+\]/gi, "").replace(/\s+/g, " ").trim().length;
      const drawn = !info || words < 40 * count
        ? Array.from({ length: count }, (_, i) => i + 1)
        : [...new Set([...info.textless, ...info.formulas, ...info.visual.map((v) => v.page)])].sort((a, b) => a - b);
      const room = Math.max(0, isCurrent ? wholeRoom : Math.min(focusRoom, 4));
      let pages: number[];
      if (isCurrent) {
        // The pages the person names, then scans, then those matching the question, then the most drawn; in page order.
        const matched = relevantPages(body, prompt, count).filter((p) => drawn.includes(p));
        const heavy = [...(info?.visual || [])].sort((a, b) => b.weight - a.weight).map((v) => v.page);
        pages = [...new Set([...named, ...(info?.textless || []), ...matched, ...heavy, ...drawn])].filter((p) => p >= 1 && p <= count).slice(0, room).sort((a, b) => a - b);
      } else {
        // An earlier file: only its drawn pages this question is about; the rest is with the sources and the file tools.
        pages = relevantPages(body, prompt, 8).filter((p) => drawn.includes(p)).slice(0, room).sort((a, b) => a - b);
        if (!pages.length) return;
      }
      const whole = pages.length === count;
      if (await show(file, data, pdf, count, pages, whole, undefined, info ? count - info.surveyed : 0)) { if (isCurrent) wholeRoom -= pages.length; else focusRoom -= pages.length; }
    });
  }

  if (listOnly) return view;
  // The person's other PDFs: scored by their text first (cheap, and kept), so only the best few are opened.
  const seen = new Set([...current, ...earlier, ...done]);
  const scored: { file: StoredFile; where: string; pages: { page: number; score: number }[] }[] = [];
  for (const { id, where } of related) {
    signal?.throwIfAborted();
    const file = files.find((f) => f.id === id);
    if (!file || !isPdfFile(file) || seen.has(id)) continue;
    seen.add(id);
    const pages = pageScores(await text(file).catch(() => ""), prompt);
    if (pages.length) scored.push({ file, where, pages });
  }
  scored.sort((a, b) => b.pages[0].score - a.pages[0].score);
  // A file whose best page matches far less than the best file's is not about this question.
  const best = scored[0]?.pages[0].score || 0;
  for (const { file, where, pages } of scored.filter((s) => s.pages[0].score >= best * 0.35).slice(0, RELATED_FILES)) {
    if (focusRoom <= 0) break;
    await open(file, async (data, pdf, count) => {
      const chosen = pages.map((p) => p.page).filter((p) => p <= count).slice(0, Math.min(RELATED_PAGES, focusRoom));
      if (await show(file, data, pdf, count, chosen, false, where)) focusRoom -= chosen.length;
    });
  }
  view.spent = { bytes, whole: wholePages - wholeRoom, focus: FOCUS_PAGES - focusRoom };
  return view;
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
  const pdf = await loading.promise.catch(async (e) => { await loading.destroy(); throw e; });
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
