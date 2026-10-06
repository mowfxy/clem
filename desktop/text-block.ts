import { BrowserWindow } from "electron";
import { PDFDocument } from "pdf-lib";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Nothing but the text and its style: no scripts, no network, no files. */
const CSP = "default-src 'none'; style-src 'unsafe-inline'";
const FAMILIES: Record<string, string> = {
  sans: "'Segoe UI','Noto Sans','Noto Sans Arabic','Noto Sans CJK SC','Microsoft YaHei','Yu Gothic',Arial,sans-serif",
  serif: "'Times New Roman','Noto Serif','Noto Naskh Arabic','SimSun','Yu Mincho',serif",
  mono: "Consolas,'Cascadia Mono','Courier New',monospace",
};
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * A block of text in any script (Arabic, Chinese, Greek…) as a one-page PDF of exactly `width` × `height` points,
 * typeset by Chromium with the fonts Windows has, so a translated passage can replace the original in a PDF
 * (desktop/pdf-edit-tools.ts "replace"). Starts at `size` and gets smaller until it fits one page.
 */
export async function typesetBlock(text: string, { width, height, size, font, bold, color, align }: { width: number; height: number; size: number; font: string; bold: boolean; color: [number, number, number]; align: string }) {
  const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, javascript: false } });
  const file = join(tmpdir(), "mowr-block-" + randomUUID() + ".html");
  const ink = `rgb(${color.map((c) => Math.round(c * 255)).join(",")})`;
  try {
    // Enough tries to get from the largest size (72 pt) below 4 pt.
    for (let s = size, tries = 0; tries < 24; tries++, s *= 0.88) {
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>@page{size:${width}pt ${height}pt;margin:0}html,body{margin:0;padding:0;background:transparent}body{width:${width}pt;padding:1pt 2pt;box-sizing:border-box;font:${bold ? 700 : 400} ${s.toFixed(2)}pt/1.2 ${FAMILIES[font] || FAMILIES.sans};color:${ink};text-align:${align === "center" || align === "right" ? align : "start"};overflow-wrap:anywhere;white-space:pre-wrap}</style></head><body dir="auto">${escape(text)}</body></html>`;
      await writeFile(file, html, "utf8");
      await page.loadFile(file);
      const pdf = new Uint8Array(await page.webContents.printToPDF({ printBackground: false, preferCSSPageSize: true, displayHeaderFooter: false, margins: { top: 0, bottom: 0, left: 0, right: 0 } }));
      const doc = await PDFDocument.load(pdf);
      if (doc.getPageCount() === 1 || s < 4) {
        // Only the first page: what fits when even the smallest size overflows.
        if (doc.getPageCount() > 1) for (let k = doc.getPageCount() - 1; k > 0; k--) doc.removePage(k);
        return doc.save();
      }
    }
    throw Error("The text could not be fitted into the box.");
  } finally {
    page.destroy();
    await rm(file, { force: true }).catch(() => {});
  }
}
