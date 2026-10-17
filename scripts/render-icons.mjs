// Draws Mowr's Windows icons straight from the vector mark, one image per size, so none is a scaled-down copy:
//   desktop/icon.ico               the app, window, taskbar and shortcut icon (16–256 px, PNG entries)
//   public/logo.png                a large copy for drag previews
// Like Claude's, the icon is a solid rounded tile with the mark on it, not a bare mark on transparency, so it reads
// on any taskbar, light or dark. Run: node scripts/render-icons.mjs  (needs Playwright's Chromium).
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const TILE = process.env.MOWR_ICON_TILE || "#b56c4b", INK = process.env.MOWR_ICON_INK || "#f5f2e8";
const svg = await readFile("public/logo.svg", "utf8");
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// Small icons fill their square (every pixel counts at 16 px); larger ones leave the margin Windows icons usually have.
const tileShare = (size) => (size <= 24 ? 1 : size <= 48 ? 0.94 : 0.9);
// The mark's share of the tile: a little larger when tiny so the arms stay apart.
const markShare = (size) => (size <= 24 ? 0.74 : size <= 48 ? 0.68 : 0.62);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(size, out = size) {
  const tile = size * tileShare(size), mark = tile * markShare(size), radius = tile * 0.225;
  const art = svg.replace('stroke="#b56c4b"', `stroke="${INK}"`).replace("<svg ", `<svg width="${mark}" height="${mark}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:transparent"><div style="width:${tile}px;height:${tile}px;border-radius:${radius}px;background:${TILE};display:grid;place-items:center">${art}</div></body></html>`);
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
