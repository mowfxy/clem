import { getBlob } from "../store";
import type { StoredFile } from "../../core/types";
import { pdfjs } from "./page-images";
import { analysePage, analysePicture, pictureWithRegions, regionsPicture, settlePdfCrop, settlePictureCrop, type CanvasKit, type PageAnalysis } from "../../core/pdf-page";
import type { Box, Region } from "../../core/pdf-regions";

/**
 * The window's half of "regions" and "crop" (desktop/main.ts asks, this answers): the person's files and pdf.js are
 * here, and so is a canvas. Only the files of the conversation are reachable, by name, exactly as for "look".
 */
export type TaskResult = { data?: unknown; images?: { name: string; data: string }[]; files?: Uint8Array[] };

/** The largest file read, and the largest picture decoded. */
const MAX_FILE = 200_000_000, MAX_PICTURE_PIXELS = 50_000_000;

const kit: CanvasKit = {
  create: (width, height) => Object.assign(document.createElement("canvas"), { width, height }),
  encode: (canvas, type, quality) => new Promise((done, fail) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? b.arrayBuffer().then((a) => done(new Uint8Array(a)), fail) : fail(Error("The picture could not be made."))), type, quality)),
  picture: async (bytes) => {
    const { looksHeic, heicToJpeg } = await import("./heic");
    let blob = new Blob([bytes as BlobPart]);
    if (await looksHeic(blob)) blob = (await heicToJpeg(blob)).jpeg;
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width * bitmap.height > MAX_PICTURE_PIXELS) throw Error("That picture is too large to work on.");
      const canvas = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      return canvas;
    } finally {
      bitmap.close();
    }
  },
};
const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const isPdf = (f: StoredFile) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isPicture = (f: StoredFile) => f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(f.name);

/** The conversation's file a request names: exact name first, then a unique partial match. */
function pick(files: StoredFile[], name: unknown) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) throw Error('Give "file": a PDF or picture from this conversation, by name.');
  const exact = files.filter((f) => f.name.toLowerCase() === wanted);
  const near = exact.length ? exact : files.filter((f) => f.name.toLowerCase().includes(wanted) || wanted.includes(f.name.toLowerCase()));
  if (near.length !== 1) throw Error(near.length ? `"${name}" matches ${near.length} files; use the exact name.` : `No file named "${name}" in this conversation.`);
  if (!isPdf(near[0]) && !isPicture(near[0])) throw Error(`${near[0].name} is not a PDF or a picture.`);
  return near[0];
}
async function bytesOf(file: StoredFile) {
  if (file.remote) throw Error(`${file.name} is not on this PC.`);
  const blob = await getBlob(file.id);
  if (!blob) throw Error(`${file.name} is missing from this PC.`);
  if (blob.size > MAX_FILE) throw Error(`${file.name} is larger than 200 MB.`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Page analyses are kept for the session: "regions" then "crop" of the same page should not read it twice. */
const analyses = new Map<string, PageAnalysis>();
const version = (f: StoredFile) => `${f.id}:${f.size}:${f.updated || f.created}`;
async function analysed(file: StoredFile, pdf: any, lib: any, page: number) {
  const key = `${version(file)}:${page}`;
  let a = analyses.get(key);
  if (!a) {
    a = await analysePage(lib, pdf, page, kit);
    analyses.set(key, a);
    if (analyses.size > 60) analyses.delete(analyses.keys().next().value!);
  }
  return a;
}
const brief = (r: Region) => ({ id: r.id, kind: r.kind, box: r.box, ...(r.caption ? { caption: r.caption } : {}) });

async function withPdf<T>(file: StoredFile, run: (pdf: any, lib: any, bytes: Uint8Array) => Promise<T>) {
  const bytes = await bytesOf(file), lib = await pdfjs();
  const loading = lib.getDocument({ data: bytes.slice(), useSystemFonts: false });
  try { return await run(await loading.promise, lib, bytes); } finally { await loading.destroy(); }
}

/** Candidates on up to four pages of a PDF (or in a picture), each with a picture of the page with its boxes drawn. */
async function regions(files: StoredFile[], args: any): Promise<TaskResult> {
  const file = pick(files, args.file);
  if (!isPdf(file)) {
    const canvas = await kit.picture!(await bytesOf(file));
    const found = analysePicture(canvas);
    const picture = await pictureWithRegions(canvas, found, kit);
    return { data: { file: file.name, type: "picture", units: "px", width: canvas.width, height: canvas.height, regions: found.map(brief) }, images: [{ name: `${file.name} — candidate regions`, data: base64(picture) }] };
  }
  return withPdf(file, async (pdf, lib) => {
    const pages = [...new Set<number>((Array.isArray(args.pages) ? args.pages : [args.page]).map(Number))].filter((p) => Number.isInteger(p) && p >= 1 && p <= pdf.numPages).slice(0, 4);
    if (!pages.length) throw Error(`${file.name} has ${pdf.numPages} pages; give "page" (1–${pdf.numPages}).`);
    const results = [], images = [];
    for (const p of pages) {
      const a = await analysed(file, pdf, lib, p);
      results.push({ page: p, kind: a.kind, view: a.view, ...(a.rotate ? { rotate: a.rotate } : {}), regions: a.regions.map(brief) });
      images.push({ name: `${file.name} — page ${p} of ${pdf.numPages}, candidate regions`, data: base64(await regionsPicture(pdf, a, kit)) });
    }
    // A form's fields, so "fill" can name them.
    const objects = await pdf.getFieldObjects().catch(() => null);
    const fields = objects ? Object.entries(objects).slice(0, 200).map(([name, list]: [string, any]) => ({ name, type: list[0]?.type, ...(list[0]?.value !== undefined && list[0]?.value !== "" ? { value: list[0].value } : {}), ...(list[0]?.items?.length ? { options: list[0].items.map((i: any) => i.displayValue ?? i.exportValue).slice(0, 40) } : {}), ...(list[0]?.page !== undefined ? { page: list[0].page + 1 } : {}) })) : [];
    return { data: { file: file.name, type: "pdf", pages: pdf.numPages, units: "pt", results, ...(fields.length ? { fields } : {}) }, images };
  });
}

const boxOf = (v: unknown): Box | undefined => Array.isArray(v) && v.length === 4 && v.every((n) => Number.isFinite(Number(n))) ? [Math.min(+v[0], +v[2]), Math.min(+v[1], +v[3]), Math.max(+v[0], +v[2]), Math.max(+v[1], +v[3])] : undefined;

/**
 * One crop, settled on the pixels (core/pdf-page.ts): the PNG, a picture of it for the model, and for a page drawn as
 * vectors the PDF's own bytes so the main process can cut the vector version (desktop/pdf-assets.ts).
 */
async function crop(files: StoredFile[], args: any): Promise<TaskResult> {
  const file = pick(files, args.file);
  const options = { pad: Math.min(36, Math.max(0, Number(args.padding ?? 4) || 0)), dpi: Math.min(600, Math.max(72, Number(args.dpi) || 300)), trim: args.trim !== false };
  if (!isPdf(file)) {
    const canvas = await kit.picture!(await bytesOf(file));
    const region = args.region ? analysePicture(canvas).find((r) => r.id === args.region) : undefined;
    if (args.region && !region) throw Error(`${file.name} has no region "${args.region}"; ask for its regions first.`);
    const box = region?.box ?? boxOf(args.bbox);
    if (!box) throw Error('Give "region" (an id from regions) or "bbox": [x0, y0, x1, y1] in pixels, from the top left.');
    const s = await settlePictureCrop(canvas, box, options, kit);
    return { data: { file: file.name, units: "px", box: s.box, hit: s.hit, width: s.width, height: s.height, vector: false, ...(region ? { region: brief(region) } : {}) }, images: [{ name: `crop of ${file.name}`, data: base64(s.preview) }], files: [s.png] };
  }
  return withPdf(file, async (pdf, lib, bytes) => {
    const page = Math.floor(Number(args.page));
    if (!(page >= 1 && page <= pdf.numPages)) throw Error(`${file.name} has ${pdf.numPages} pages; give "page".`);
    const a = await analysed(file, pdf, lib, page);
    const region = args.region ? a.regions.find((r) => r.id === args.region) : undefined;
    if (args.region && !region) throw Error(`Page ${page} of ${file.name} has no region "${args.region}". Its regions: ${a.regions.map((r) => r.id).join(", ") || "none"}.`);
    let box = region?.box ?? boxOf(args.bbox);
    if (!box) throw Error('Give "region" (an id from regions) or "bbox": [x0, y0, x1, y1] in PDF points from the bottom left of the page.');
    if (region && args.withCaption && region.captionBox) box = [Math.min(box[0], region.captionBox[0]), Math.min(box[1], region.captionBox[1]), Math.max(box[2], region.captionBox[2]), Math.max(box[3], region.captionBox[3])];
    const s = await settlePdfCrop(pdf, page, box, options, kit);
    return {
      data: { file: file.name, page, pages: pdf.numPages, units: "pt", box: s.box, hit: s.hit, width: s.width, height: s.height, dpi: options.dpi, vector: a.kind === "vector", ...(region ? { region: brief(region) } : {}) },
      images: [{ name: `crop of ${file.name}, page ${page}`, data: base64(s.preview) }],
      files: a.kind === "vector" ? [s.png, bytes] : [s.png],
    };
  });
}

/** A PDF of the conversation as it is, for an edit (desktop/pdf-edit-tools.ts works on its bytes). */
async function bytes(files: StoredFile[], args: any): Promise<TaskResult> {
  const file = pick(files, args.file);
  if (!isPdf(file)) throw Error(`${file.name} is not a PDF.`);
  return { data: { file: file.name }, files: [await bytesOf(file)] };
}

/** Bytes the main process sent (a document being edited), opened with pdf.js. */
async function withBytes<T>(data: unknown, run: (pdf: any, lib: any) => Promise<T>) {
  if (!(data instanceof Uint8Array) || data.length > MAX_FILE) throw Error("No document to read.");
  const lib = await pdfjs(), loading = lib.getDocument({ data: data.slice(), useSystemFonts: false });
  try { return await run(await loading.promise, lib); } finally { await loading.destroy(); }
}

/** The text runs of one page, as core/pdf-edit.ts finds text in them. */
function words(args: any): Promise<TaskResult> {
  return withBytes(args.bytes, async (pdf) => {
    const page = await pdf.getPage(Math.floor(Number(args.page)));
    try {
      const content = await page.getTextContent();
      const items = content.items.flatMap((item: any) => {
        if (!("str" in item) || !item.str) return [];
        const [a, b, c, d, e, f] = item.transform as number[];
        // The font's family (serif, sans-serif, monospace) says whose letter widths to place characters by.
        return [{ str: item.str, x: e, y: f, width: item.width, size: Math.hypot(c, d) || Math.hypot(a, b), font: content.styles[item.fontName]?.fontFamily }];
      });
      return { data: { items } };
    } finally {
      page.cleanup();
    }
  });
}

/** Pictures of pages of a document the main process made (an edited PDF), with its annotations, for the model to check. */
function render(args: any): Promise<TaskResult> {
  return withBytes(args.bytes, async (pdf, lib) => {
    const pages = (Array.isArray(args.pages) ? args.pages : []).map(Number).filter((p: number) => Number.isInteger(p) && p >= 1 && p <= pdf.numPages).slice(0, 8);
    const images = [];
    for (const n of pages) {
      const page = await pdf.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(2.5, 1600 / Math.max(base.width, base.height)) });
        const canvas = kit.create(Math.round(viewport.width), Math.round(viewport.height)), ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Print intent never waits for animation frames (a hidden window has none) and draws printable annotations.
        await page.render({ canvasContext: ctx, canvas, viewport, intent: "print", annotationMode: lib.AnnotationMode.ENABLE }).promise;
        images.push({ name: `${String(args.name || "edited PDF").slice(0, 200)} — page ${n} of ${pdf.numPages}`, data: base64(await kit.encode(canvas, "image/jpeg", 0.85)) });
        canvas.width = canvas.height = 0;
      } finally {
        page.cleanup();
      }
    }
    return { data: { pages: pdf.numPages }, images };
  });
}

/**
 * A page of a document the main process sent, drawn as a picture as it stands in page space (its turn left off, as the
 * page that replaces it keeps the same turn), with `boxes` (PDF points) filled: the redaction that always works.
 */
function raster(args: any): Promise<TaskResult> {
  return withBytes(args.bytes, async (pdf) => {
    const page = await pdf.getPage(Math.floor(Number(args.page)));
    try {
      const base = page.getViewport({ scale: 1, rotation: 0 });
      const scale = Math.min(Math.max(72, Number(args.dpi) || 200) / 72, Math.sqrt(16_000_000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale, rotation: 0 });
      const canvas = kit.create(Math.round(viewport.width), Math.round(viewport.height)), ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport, intent: "print", annotationMode: 0 }).promise;
      const [r, g, b] = (Array.isArray(args.fill) ? args.fill : [0, 0, 0]).map((c: number) => Math.round(Math.min(1, Math.max(0, Number(c) || 0)) * 255));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      for (const box of Array.isArray(args.boxes) ? args.boxes : []) {
        const [ax, ay] = viewport.convertToViewportPoint(box[0], box[1]), [bx, by] = viewport.convertToViewportPoint(box[2], box[3]);
        // Whole pixels outward, so no sliver of what was there survives at the edge.
        ctx.fillRect(Math.floor(Math.min(ax, bx)), Math.floor(Math.min(ay, by)), Math.ceil(Math.abs(bx - ax)) + 1, Math.ceil(Math.abs(by - ay)) + 1);
      }
      const jpeg = await kit.encode(canvas, "image/jpeg", 0.92);
      canvas.width = canvas.height = 0;
      return { data: { page: args.page }, files: [jpeg] };
    } finally {
      page.cleanup();
    }
  });
}

/** Runs one task the main process sent. */
export function pdfTask(files: StoredFile[], op: string, args: any): Promise<TaskResult> {
  if (op === "regions") return regions(files, args || {});
  if (op === "crop") return crop(files, args || {});
  if (op === "bytes") return bytes(files, args || {});
  if (op === "words") return words(args || {});
  if (op === "render") return render(args || {});
  if (op === "raster") return raster(args || {});
  return Promise.reject(Error(`Unknown task "${op}".`));
}
