// Draws Clem's icons straight from the vector mark (core/mark.ts), one image per size, so none is a scaled-down copy:
//   desktop/icon.ico               the app, window, taskbar and shortcut icon (16–256 px, PNG entries)
//   public/logo.png, logo.svg      a large copy for drag previews and the plain mark
//   public/favicon.ico, favicon.svg  the browser tab icon (same tile as Windows), apple-touch-icon.png for iOS
// The icon is the identity's black app tile: the paper-coloured mark at 72% on a near-black rounded tile with a hairline
// edge, so it reads on any taskbar, light or dark. Run: node scripts/render-icons.mjs  (needs Playwright's Chromium).
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { CLEM_PAPER, CLEM_TILE, markInner, markSvg, tileSvg } from "../core/mark.ts";

await writeFile("public/logo.svg", markSvg({ color: CLEM_PAPER }) + "\n");
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// Small icons fill their square (every pixel counts at 16 px); larger ones leave the margin Windows icons usually have.
const tileShare = (size) => (size <= 24 ? 1 : size <= 48 ? 0.94 : 0.9);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(size) {
  const tile = size * tileShare(size);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:transparent">${tileSvg({ attrs: ` width="${tile}" height="${tile}"` })}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

// ICO: a directory of PNG images; each entry keeps its own exact size.
function ico(images) {
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
return Buffer.concat([header, ...images.map((x) => x.png)]);
}
const images = [];
for (const size of icoSizes) images.push({ size, png: await render(size) });
await writeFile("desktop/icon.ico", ico(images));
await writeFile("public/logo.png", await render(1024));
await writeFile("public/favicon.ico", ico(images.filter((x) => [16, 32, 48].includes(x.size))));
await writeFile("public/favicon.svg", tileSvg() + "\n");
// iOS rounds the corners itself, so the touch icon is a full square tile.
await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(`<html><body style="margin:0;width:180px;height:180px;background:${CLEM_TILE}"><svg viewBox="0 0 100 100" width="180" height="180"><g transform="translate(50 50) scale(0.72) translate(-50 -50)">${markInner(CLEM_PAPER)}</g></svg></body></html>`);
await writeFile("public/apple-touch-icon.png", await page.screenshot({ clip: { x: 0, y: 0, width: 180, height: 180 } }));
await browser.close();
console.log(`Wrote public/logo.svg, desktop/icon.ico (${icoSizes.join(", ")} px), public/logo.png, favicon.ico, favicon.svg and apple-touch-icon.png.`);
