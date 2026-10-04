import { BrowserWindow, nativeImage } from "electron";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { drawnArrows } from "./math-draw.ts";

/** No network and no files: a drawing may use only what is inside it (desktop/svg-safety.ts names what is refused). */
const DRAWING_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";

/** The drawing set to exactly `width`×`height` CSS pixels (its viewBox scales the content). */
const sized = (svg: string, width: number, height: number) => svg.replace(/<svg\b([^>]*)>/, (_, attrs: string) => `<svg${attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/g, "")} width="${width}" height="${height}">`);

/**
 * A capture of an offscreen page. Chromium's compositor occasionally fails a capture once ("UnknownVizError", seen
 * on the first capture after a restart); one failure should not fail the whole file, so it is tried three times.
 */
export async function capturePage(contents: Electron.WebContents, rect: Electron.Rectangle, tries = 3): Promise<Electron.NativeImage> {
  for (let attempt = 1; ; attempt++) {
    try {
      const image = await contents.capturePage(rect);
      if (!image.isEmpty() || attempt >= tries) return image;
    } catch (error) {
      if (attempt >= tries) throw error;
    }
    contents.invalidate();
    await new Promise((done) => setTimeout(done, 150 * attempt));
  }
}

/** A drawing's size in CSS pixels, from its width/height or viewBox. */
export function svgSize(svg: string) {
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
  const w = /<svg[^>]*?\swidth\s*=\s*["']([\d.]+)(?:px)?["']/.exec(svg), h = /<svg[^>]*?\sheight\s*=\s*["']([\d.]+)(?:px)?["']/.exec(svg);
  const width = Number(w?.[1] || box?.[1]) || 800, height = Number(h?.[1] || box?.[2]) || 450;
  return { width, height };
}

/**
 * Pictures for Word and PowerPoint, which cannot show Kinetra's SVG or the MathML of an equation: one hidden,
 * script-free Chromium page draws each one and the pixels are captured. Open one per file being made and close it after.
 */
export async function rasterizer() {
  const page = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    transparent: true,
    frame: false,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true, sandbox: true, nodeIntegration: false, contextIsolation: true, javascript: false },
  });
  const file = join(tmpdir(), "mowr-raster-" + randomUUID() + ".html");
  /** `html` is laid out in a box of `width`×`height` CSS pixels and captured at `scale`. */
  async function capture(html: string, width: number, height: number, scale = 2) {
    width = Math.max(1, Math.ceil(width));
    height = Math.max(1, Math.ceil(height));
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${DRAWING_CSP}"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}body{width:${width}px;height:${height}px;zoom:${scale}}</style></head><body>${html}</body></html>`;
    page.setContentSize(Math.ceil(width * scale), Math.ceil(height * scale));
    await writeFile(file, doc, "utf8");
    await page.loadFile(file);
    // One frame after load, so the offscreen surface holds the finished drawing.
    await new Promise((done) => setTimeout(done, 60));
    const image = await capturePage(page.webContents, { x: 0, y: 0, width: Math.ceil(width * scale), height: Math.ceil(height * scale) });
    return { png: new Uint8Array(image.toPNG()), width, height };
  }
  return {
    /** An SVG drawing on white (or transparent) paper, at most `maxWidth` CSS pixels wide. */
    async svg(svg: string, { maxWidth = 1100, background = "#ffffff" }: { maxWidth?: number; background?: string } = {}) {
      const size = svgSize(svg);
      const scale = Math.min(1, maxWidth / size.width);
      const width = size.width * scale, height = size.height * scale;
      return capture(`<div style="background:${background};width:${width}px;height:${height}px">${sized(svg, width, height)}</div>`, width, height, Math.min(3, 2400 / width));
    },
    /**
     * Many drawings (a deck's icons and art) laid out on one page per batch and captured together, then cut apart:
     * one page load instead of one per picture. Each comes back as a PNG `scale` times its size in CSS pixels.
     */
    async many(items: { svg: string; width: number; height: number }[], scale = 1) {
      const out: Uint8Array[] = new Array(items.length);
      const SHEET = 2400 / scale, LIMIT = 6000 / scale;
      let start = 0;
      while (start < items.length) {
        // Shelf packing: rows left to right, a new batch when the page would get too tall.
        const placed: { i: number; x: number; y: number }[] = [];
        let x = 0, y = 0, row = 0, i = start;
        for (; i < items.length; i++) {
          const { width, height } = items[i];
          if (x + width > SHEET && x > 0) { x = 0; y += row + 2; row = 0; }
          if (y + height > LIMIT && placed.length) break;
          placed.push({ i, x, y });
          x += width + 2; row = Math.max(row, height);
        }
        const pageH = y + row, html = placed.map((p) => `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${items[p.i].width}px;height:${items[p.i].height}px">${sized(items[p.i].svg, items[p.i].width, items[p.i].height)}</div>`).join("");
        const shot = nativeImage.createFromBuffer(Buffer.from((await capture(html, SHEET, pageH, scale)).png));
        for (const p of placed) out[p.i] = new Uint8Array(shot.crop({ x: Math.round(p.x * scale), y: Math.round(p.y * scale), width: Math.round(items[p.i].width * scale), height: Math.round(items[p.i].height * scale) }).toPNG());
        start = i;
      }
      return out;
    },
    /** Equations (KaTeX MathML) measured first, then captured tightly around the ink. */
    async math(mathml: string, { color = "#111111", font = "Cambria Math", size = 22, display = true }: { color?: string; font?: string; size?: number; display?: boolean } = {}) {
      // Arrows with labels are drawn to full width: Chromium does not stretch them (desktop/math-draw.ts).
      const drawn = drawnArrows(display ? mathml.replace("<math", '<math display="block"') : mathml);
      const box = `<div id="m" style="display:inline-block;padding:2px 4px;color:${color};font-family:'${font}','Cambria Math','STIX Two Math',serif;font-size:${size}px;line-height:1.2">${drawn}</div>`;
      // A generous box for the first layout; the second capture is cropped to the measured size.
      const probe = await capture(box, 1600, 400, 1);
      const bounds = ink(probe.png);
      return bounds ? capture(box, bounds.right + 6, bounds.bottom + 6, 3) : capture(box, 200, size * 1.6, 3);
    },
    close() {
      page.destroy();
      void rm(file, { force: true }).catch(() => {});
    },
  };
}

/** Where a transparent capture has drawn pixels, from the PNG Electron produced (decoded with zlib). */
function ink(png: Uint8Array): { right: number; bottom: number } | null {
  try {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let at = 8, width = 0, height = 0, colorType = 0;
    const chunks: Uint8Array[] = [];
    while (at < png.length) {
      const length = view.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8));
      if (type === "IHDR") { width = view.getUint32(at + 8); height = view.getUint32(at + 12); colorType = png[at + 17]; }
      if (type === "IDAT") chunks.push(png.subarray(at + 8, at + 8 + length));
      at += 12 + length;
    }
    if (colorType !== 6) return null;
    const raw = inflateSync(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    const stride = width * 4;
    const rows: Uint8Array[] = [];
    let previous = new Uint8Array(stride);
    for (let y = 0, p = 0; y < height; y++) {
      const filter = raw[p++], line = new Uint8Array(raw.subarray(p, p + stride));
      p += stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? line[x - 4] : 0, b = previous[x], c = x >= 4 ? previous[x - 4] : 0;
        const add = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0;
        line[x] = (line[x] + add) & 255;
      }
      rows.push(line);
      previous = line;
    }
    let right = 0, bottom = 0;
    rows.forEach((line, y) => { for (let x = 0; x < width; x++) if (line[x * 4 + 3] > 8) { if (x > right) right = x; bottom = y; } });
    return right && bottom ? { right: right + 1, bottom: bottom + 1 } : null;
  } catch {
    return null;
  }
}
function paeth(a: number, b: number, c: number) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
