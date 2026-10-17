// Draws Mowr's Windows icons straight from the vector mark, one image per size, so none is a scaled-down copy:
//   desktop/icon.ico               the app, window, taskbar and shortcut icon (16–256 px, PNG entries)
//   public/logo.png                a large copy for drag previews
// Like Claude's, the icon is a solid rounded tile with the mark on it, not a bare mark on transparency, so it reads
// on any taskbar, light or dark. The tile is lit from the top left with a soft rim, the way Windows 11 icons are, and
// the seed head on it is the same 61 seeds at every size (SEEDS in core/mark.ts, repeated here).
// Run: node scripts/render-icons.mjs  (needs Playwright's Chromium).
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const INK = process.env.MOWR_ICON_INK || "#f5f2e8";
const head = (n, R, a, b, c) => { const st = R / Math.sqrt(n + .5); return Array.from({ length: n }, (_, k) => { const g = k * 2.39996323, r = st * Math.sqrt(k + .5), u = (k + 1) / n; return [r * Math.cos(g), r * Math.sin(g), st * (a + (b - a) * u ** c)]; }); };
const SEEDS = head(61, 39, .3, .78, 1.3);
const markSvg = (px) => `<svg width="${px}" height="${px}" viewBox="-45 -45 90 90" fill="${INK}" style="filter:drop-shadow(0 ${Math.max(.5, px / 90).toFixed(2)}px ${Math.max(.4, px / 120).toFixed(2)}px rgba(70,30,15,.35))">${SEEDS.map(([x, y, r]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}"/>`).join("")}</svg>`;
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// Small icons fill their square (every pixel counts at 16 px); larger ones leave the margin Windows icons usually have.
const tileShare = (size) => (size <= 24 ? 1 : size <= 48 ? 0.94 : 0.9);
// The mark's share of the tile: a little larger when tiny so the seeds stay apart.
const markShare = (size) => (size <= 24 ? 0.8 : size <= 48 ? 0.74 : 0.7);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(size, out = size) {
  const tile = size * tileShare(size), mark = tile * markShare(size), radius = tile * 0.225;
  const art = markSvg(mark);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:transparent"><div style="width:${tile}px;height:${tile}px;border-radius:${radius}px;background:radial-gradient(120% 120% at 28% 12%,#d48d6b 0%,#b56c4b 48%,#93502f 100%);box-shadow:inset 0 ${size >= 32 ? 1 : 0}px 0 rgba(255,255,255,.28),inset 0 -1px ${Math.max(1, size / 40)}px rgba(0,0,0,.2);display:grid;place-items:center">${art}</div></body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

// ICO: a directory of PNG images; each entry keeps its own exact size.
const images = [];
for (const size of icoSizes) images.push({ size, png: await render(size) });
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach(({ size, png }, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(size >= 256 ? 0 : size, at); header.writeUInt8(size >= 256 ? 0 : size, at + 1);
  header.writeUInt8(0, at + 2); header.writeUInt8(0, at + 3);
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
await writeFile(process.env.MOWR_ICON_OUT || "desktop/icon.ico", Buffer.concat([header, ...images.map((x) => x.png)]));
if (!process.env.MOWR_ICON_OUT) await writeFile("public/logo.png", await render(1024));
await browser.close();
console.log(`Wrote desktop/icon.ico (${icoSizes.join(", ")} px) and public/logo.png.`);
