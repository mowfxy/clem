// The drawing page on the PC (desktop/draw-page.ts): a hidden, sandboxed Electron window.
import { BrowserWindow } from "electron";
import type { DrawPage, PageKind, Rect } from "./draw-page.ts";

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

export async function electronPage(kind: PageKind): Promise<DrawPage> {
  const page = new BrowserWindow({
    show: false,
    width: kind.width ?? 800,
    height: kind.height ?? 600,
    ...(kind.transparent ? { transparent: true, frame: false, backgroundColor: "#00000000" } : {}),
    webPreferences: { ...(kind.offscreen ? { offscreen: true } : {}), sandbox: true, nodeIntegration: false, contextIsolation: true, javascript: !!kind.script },
  });
  if (kind.script) {
    page.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    page.webContents.on("will-navigate", (event) => event.preventDefault());
  }
  const rect = (r: Rect) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) });
  return {
    async size(width, height) { page.setContentSize(Math.ceil(width), Math.ceil(height)); },
    async load(file) { await page.loadFile(file); },
    async png(r) { return new Uint8Array((await capturePage(page.webContents, rect(r))).toPNG()); },
    async jpeg(r, quality) { return new Uint8Array((await capturePage(page.webContents, rect(r))).toJPEG(quality)); },
    async pdf(o) {
      return new Uint8Array(await page.webContents.printToPDF({ printBackground: !!o.background, preferCSSPageSize: true, displayHeaderFooter: false, ...(o.tagged !== undefined ? { generateTaggedPDF: o.tagged } : {}), ...(o.outline ? { generateDocumentOutline: true } : {}), ...(o.noMargins ? { margins: { top: 0, bottom: 0, left: 0, right: 0 } } : {}) }));
    },
    run: (expression) => page.webContents.executeJavaScript(expression),
    close() { page.destroy(); },
  };
}
