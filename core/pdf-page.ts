/**
 * The page work behind "regions" and "crop": reading a page's structure with pdf.js, drawing it, and settling a crop
 * on its pixels. pdf.js and the canvas are passed in (the window's own, or Node's in tests), so this is the same code
 * everywhere. Geometry lives in core/pdf-regions.ts.
 */
import { inkBounds, findRegions, marksFromOps, wordsFromText, scannedPage, segmentBitmap, segments, settleCrop, type Box, type Region, type Word } from "./pdf-regions.ts";

export type Canvas = { width: number; height: number; getContext(type: "2d", options?: any): any };
export type CanvasKit = {
  create(width: number, height: number): Canvas;
  encode(canvas: Canvas, type: "image/png" | "image/jpeg", quality?: number): Promise<Uint8Array>;
  /** A picture file drawn onto a new canvas at its own size. */
  picture?(bytes: Uint8Array): Promise<Canvas>;
};
export type PageAnalysis = { page: number; pages: number; view: Box; rotate: number; kind: "vector" | "scanned"; regions: Region[]; words: Word[] };

/** The most pixels drawn for one picture: a 16-megapixel crop is 300 dpi over 13 × 13 inches. */
export const MAX_PIXELS = 16_000_000;
/** The page picture the model sees: as `look` draws pages, at most this many pixels on the long side. */
const SIGHT = 1600;
/** Around a crop, how far (in points) the drawing may extend before the crop stops following it. */
const REACH = 36;

/** Grey levels of a canvas, one byte per pixel. */
export function greyOf(canvas: Canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data as Uint8ClampedArray;
  const grey = new Uint8Array(canvas.width * canvas.height);
  // Transparent pixels are paper.
  for (let i = 0, j = 0; j < grey.length; i += 4, j++) grey[j] = px[i + 3] < 128 ? 255 : (px[i] * 54 + px[i + 1] * 183 + px[i + 2] * 19) >> 8;
  return grey;
}

/** A PDF box as a rectangle on a viewport (pdf.js 6 has no convertToViewportRectangle). */
const onViewport = (viewport: any, b: Box) => [...viewport.convertToViewportPoint(b[0], b[1]), ...viewport.convertToViewportPoint(b[2], b[3])] as number[];

/** A white canvas with the area `box` (PDF points) of the page drawn at `scale` pixels per point. */
async function draw(page: any, box: Box, scale: number, kit: CanvasKit) {
  const viewport = page.getViewport({ scale });
  const [ax, ay, bx, by] = onViewport(viewport, box);
  const x = Math.floor(Math.min(ax, bx)), y = Math.floor(Math.min(ay, by));
  const width = Math.max(1, Math.ceil(Math.max(ax, bx)) - x), height = Math.max(1, Math.ceil(Math.max(ay, by)) - y);
  const canvas = kit.create(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  // The print intent draws in one go: the display intent waits for animation frames, which a hidden or minimised
  // window never gives, so the drawing would never finish while Mowr works in the background.
  await page.render({ canvasContext: ctx, canvas, viewport, transform: [1, 0, 0, 1, -x, -y], annotationMode: 0, intent: "print" }).promise;
  return { canvas, x, y, viewport };
}

/** A pixel box on a canvas drawn by `draw` back in PDF points. */
function toPoints(viewport: any, origin: { x: number; y: number }, b: Box): Box {
  const [ax, ay] = viewport.convertToPdfPoint(b[0] + origin.x, b[1] + origin.y), [bx, by] = viewport.convertToPdfPoint(b[2] + origin.x, b[3] + origin.y);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)].map((v) => Math.round(v * 100) / 100) as Box;
}

/** The nearest "Figure N" line under (or, for tables, over) a box, from a scan's text layer when it has one. */
function captionNear(box: Box, words: Word[]) {
  const lines = segments(words).filter((s) => /^\s*(fig(?:ure)?|table|tab|scheme|plate)\.?\s*(\d+|[IVXLC]+\b)/i.test(s.text));
  const best = lines.map((s) => ({ s, d: Math.min(Math.abs(box[1] - s.box[3]), Math.abs(s.box[1] - box[3])) })).filter(({ s, d }) => d <= s.size * 4 + 12 && Math.min(box[2], s.box[2]) > Math.max(box[0], s.box[0])).sort((a, b) => a.d - b.d)[0];
  return best?.s;
}

/** The figure, table and equation candidates of one page, from its structure; a scanned page from its pixels. */
export async function analysePage(lib: any, pdf: any, n: number, kit: CanvasKit): Promise<PageAnalysis> {
  const page = await pdf.getPage(n);
  try {
    const view = page.view as Box;
    const ops = await page.getOperatorList({ annotationMode: 0 });
    const text = await page.getTextContent();
    // pdf.js names fonts g_d0_f1…; the real names (CMMI10, Symbol) say which text is maths.
    const fonts: Record<string, string> = {};
    for (const item of text.items) if (item.fontName && !(item.fontName in fonts)) { try { fonts[item.fontName] = String(page.commonObjs.get(item.fontName)?.name || item.fontName); } catch { fonts[item.fontName] = item.fontName; } }
    const words = wordsFromText(text.items, fonts);
    const marks = marksFromOps(ops.fnArray, ops.argsArray, lib.OPS, view);
    if (!scannedPage(view, marks)) {
      const regions = findRegions(n, view, marks, words);
      // An embedded picture's box is where it is placed, white margin and all: its ink says where the figure is.
      for (const r of regions.filter((r) => r.kind === "image")) {
        const drawn = await draw(page, r.box, 2, kit);
        const ink = inkBounds(greyOf(drawn.canvas), drawn.canvas.width, drawn.canvas.height);
        if (ink) { const b = toPoints(drawn.viewport, drawn, [ink[0] - 1, ink[1] - 1, ink[2] + 1, ink[3] + 1]); r.box = [Math.max(r.box[0], b[0]), Math.max(r.box[1], b[1]), Math.min(r.box[2], b[2]), Math.min(r.box[3], b[3])]; }
        drawn.canvas.width = drawn.canvas.height = 0;
      }
      return { page: n, pages: pdf.numPages, view, rotate: page.rotate || 0, kind: "vector", regions, words };
    }
    // A scan: its picture at 150 dpi is enough to find the blocks (crops are drawn again at full resolution).
    const scale = Math.min(150 / 72, Math.sqrt(8_000_000 / ((view[2] - view[0]) * (view[3] - view[1]))));
    const drawn = await draw(page, view, scale, kit);
    const blocks = segmentBitmap(greyOf(drawn.canvas), drawn.canvas.width, drawn.canvas.height).filter((b) => b.kind === "figure");
    const regions: Region[] = blocks.map((b, i) => {
      const box = toPoints(drawn.viewport, drawn, b.box);
      const cap = captionNear(box, words);
      return { id: `p${n}-${i + 1}`, kind: "region" as const, box, ...(cap ? { caption: cap.text.slice(0, 300), captionBox: cap.box } : {}) };
    });
    drawn.canvas.width = drawn.canvas.height = 0;
    return { page: n, pages: pdf.numPages, view, rotate: page.rotate || 0, kind: "scanned", regions, words };
  } finally {
    page.cleanup();
  }
}

/** Candidates of a picture file (PNG, JPEG…) from its pixels, in pixels. */
export function analysePicture(canvas: Canvas): Region[] {
  return segmentBitmap(greyOf(canvas), canvas.width, canvas.height).filter((b) => b.kind === "figure").map((b, i) => ({ id: `r${i + 1}`, kind: "region" as const, box: b.box }));
}

/** Coloured boxes and ids drawn over a picture of the page, so the model can tell candidates apart. */
const COLOURS = ["#d0021b", "#0057d9", "#00875a", "#b45f00", "#7b2cbf", "#c2185b"];
function mark(canvas: Canvas, boxes: { id: string; rect: Box }[]) {
  const ctx = canvas.getContext("2d");
  const font = Math.max(12, Math.round(Math.max(canvas.width, canvas.height) / 75));
  boxes.forEach(({ id, rect }, i) => {
    const colour = COLOURS[i % COLOURS.length];
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(2, font / 7);
    ctx.strokeRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
    ctx.font = `bold ${font}px sans-serif`;
    const w = ctx.measureText(id).width + font * 0.6;
    const y = rect[1] >= font * 1.4 ? rect[1] - font * 1.35 : rect[1];
    ctx.fillStyle = colour;
    ctx.fillRect(rect[0], y, w, font * 1.35);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(id, rect[0] + font * 0.3, y + font * 1.05);
  });
}

/** The page drawn for the model with its candidates outlined. */
export async function regionsPicture(pdf: any, analysis: PageAnalysis, kit: CanvasKit) {
  const page = await pdf.getPage(analysis.page);
  try {
    const base = page.getViewport({ scale: 1 });
    const drawn = await draw(page, analysis.view, Math.min(2.5, SIGHT / Math.max(base.width, base.height)), kit);
    mark(drawn.canvas, analysis.regions.map((r) => {
      const [ax, ay, bx, by] = onViewport(drawn.viewport, r.box);
      return { id: r.id, rect: [Math.min(ax, bx) - drawn.x, Math.min(ay, by) - drawn.y, Math.max(ax, bx) - drawn.x, Math.max(ay, by) - drawn.y] as Box };
    }));
    const jpeg = await kit.encode(drawn.canvas, "image/jpeg", 0.85);
    drawn.canvas.width = drawn.canvas.height = 0;
    return jpeg;
  } finally {
    page.cleanup();
  }
}

/** A picture file drawn for the model with its candidates outlined. */
export async function pictureWithRegions(canvas: Canvas, regions: Region[], kit: CanvasKit) {
  const scale = Math.min(1, SIGHT / Math.max(canvas.width, canvas.height));
  const out = kit.create(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  mark(out, regions.map((r) => ({ id: r.id, rect: r.box.map((v) => v * scale) as Box })));
  return kit.encode(out, "image/jpeg", 0.85);
}

export type CropOptions = { pad?: number; dpi?: number; trim?: boolean };
export type Settled = { box: Box; hit: string[]; png: Uint8Array; width: number; height: number; preview: Uint8Array };

/** The crop as a picture the model can check: the PNG itself, or a smaller JPEG of it when it is large. */
async function previewOf(canvas: Canvas, kit: CanvasKit) {
  const scale = Math.min(1, SIGHT / Math.max(canvas.width, canvas.height));
  const out = kit.create(Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)));
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  const jpeg = await kit.encode(out, "image/jpeg", 0.9);
  out.width = out.height = 0;
  return jpeg;
}

/**
 * A crop of a PDF page, settled on its pixels: drawn with a margin of REACH points at about 4 pixels per point, every
 * edge crossing ink grows to paper and every edge then shrinks to the ink (core/pdf-regions.ts settleCrop), and
 * `pad` points of paper go around it. Then the final box is drawn at `dpi` as the PNG.
 */
export async function settlePdfCrop(pdf: any, n: number, box: Box, { pad = 4, dpi = 300, trim = true }: CropOptions, kit: CanvasKit): Promise<Settled> {
  const page = await pdf.getPage(n);
  try {
    const view = page.view as Box;
    const clamp = (b: Box): Box => [Math.max(view[0], b[0]), Math.max(view[1], b[1]), Math.min(view[2], b[2]), Math.min(view[3], b[3])];
    let final = clamp(box);
    if (final[2] - final[0] < 1 || final[3] - final[1] < 1) throw Error("That box is outside the page.");
    let hit: string[] = [];
    if (trim) {
      const around = clamp([box[0] - REACH, box[1] - REACH, box[2] + REACH, box[3] + REACH]);
      const scale = Math.min(4, Math.sqrt(MAX_PIXELS / ((around[2] - around[0]) * (around[3] - around[1]))));
      const drawn = await draw(page, around, scale, kit);
      const [ax, ay, bx, by] = onViewport(drawn.viewport, final);
      const target: Box = [Math.min(ax, bx) - drawn.x, Math.min(ay, by) - drawn.y, Math.max(ax, bx) - drawn.x, Math.max(ay, by) - drawn.y];
      const settled = settleCrop(greyOf(drawn.canvas), drawn.canvas.width, drawn.canvas.height, target, { pad: Math.round(pad * scale), limit: Math.round(REACH * scale * 0.9), reach: 1.5 * scale });
      if (!settled.box) throw Error("There is nothing drawn inside that box.");
      final = clamp(toPoints(drawn.viewport, drawn, settled.box));
      hit = settled.hit;
      drawn.canvas.width = drawn.canvas.height = 0;
    } else final = clamp([final[0] - pad, final[1] - pad, final[2] + pad, final[3] + pad]);
    const scale = Math.min(dpi / 72, Math.sqrt(MAX_PIXELS / ((final[2] - final[0]) * (final[3] - final[1]))));
    const out = await draw(page, final, scale, kit);
    const png = await kit.encode(out.canvas, "image/png");
    const preview = await previewOf(out.canvas, kit);
    const result = { box: final, hit, png, width: out.canvas.width, height: out.canvas.height, preview };
    out.canvas.width = out.canvas.height = 0;
    return result;
  } finally {
    page.cleanup();
  }
}

/** A crop of a picture file, in its pixels, settled the same way. */
export async function settlePictureCrop(canvas: Canvas, box: Box, { pad = 4, trim = true }: CropOptions, kit: CanvasKit): Promise<Settled> {
  const clamp = (b: Box): Box => [Math.max(0, Math.round(b[0])), Math.max(0, Math.round(b[1])), Math.min(canvas.width, Math.round(b[2])), Math.min(canvas.height, Math.round(b[3]))];
  let final = clamp(box), hit: string[] = [];
  if (final[2] - final[0] < 1 || final[3] - final[1] < 1) throw Error("That box is outside the picture.");
  // Pixels of a picture are what they are: padding is in pixels too, scaled to the picture's size.
  const px = Math.round(pad * Math.max(1, Math.max(canvas.width, canvas.height) / 1000));
  if (trim) {
    const settled = settleCrop(greyOf(canvas), canvas.width, canvas.height, final, { pad: px, limit: Math.round(Math.max(canvas.width, canvas.height) * 0.25), reach: Math.max(2, Math.round(Math.max(canvas.width, canvas.height) * 0.004)) });
    if (!settled.box) throw Error("There is nothing drawn inside that box.");
    final = settled.box;
    hit = settled.hit;
  } else final = clamp([final[0] - px, final[1] - px, final[2] + px, final[3] + px]);
  const out = kit.create(final[2] - final[0], final[3] - final[1]);
  out.getContext("2d").drawImage(canvas, final[0], final[1], out.width, out.height, 0, 0, out.width, out.height);
  const result = { box: final, hit, png: await kit.encode(out, "image/png"), width: out.width, height: out.height, preview: await previewOf(out, kit) };
  out.width = out.height = 0;
  return result;
}
