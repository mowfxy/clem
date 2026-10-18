// Draws Mowr's Windows icons straight from the vector logo, one image per size, so none is a scaled-down copy:
//   desktop/icon.ico               the app, window, taskbar and shortcut icon (16–256 px, PNG entries)
//   public/logo.png                a large copy for drag previews
//   public/favicon.ico, favicon.svg  the browser tab icon (same tile as Windows), apple-touch-icon.png for iOS
// Like Claude's, the icon is a flat rounded tile in Mowr's red with the four-petal mark in white, so it reads on any
// taskbar, light or dark. Run: node scripts/render-icons.mjs  (needs Playwright's Chromium).
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const TILE = "#ef5340", INK = "#ffffff";
const svg = await readFile("public/logo.svg", "utf8");
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// Small icons fill their square (every pixel counts at 16 px); larger ones leave the margin Windows icons usually have.
const tileShare = (size) => (size <= 24 ? 1 : size <= 48 ? 0.94 : 0.9);
// The petals' share of the tile: a little larger when tiny so the gaps between petals stay open.
const markShare = (size) => (size <= 24 ? 0.72 : size <= 48 ? 0.68 : 0.64);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(size) {
  const tile = size * tileShare(size), mark = tile * markShare(size), radius = tile * 0.225;
  const art = svg.replace(`fill="${TILE}"`, `fill="${INK}"`).replace("<svg ", `<svg width="${mark}" height="${mark}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:transparent"><div style="width:${tile}px;height:${tile}px;border-radius:${radius}px;background:${TILE};display:grid;place-items:center">${art}</div></body></html>`);
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
// The tab icon as a vector: the same rounded red tile with white petals.
const petals = svg.match(/<defs>.*<\/svg>/s)[0].replace("</svg>", "");
await writeFile("public/favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect width="144" height="144" rx="32.4" fill="${TILE}"/><g fill="${INK}" transform="translate(72 72) scale(.64) translate(-72 -72)">${petals}</g></svg>
`);
// iOS rounds the corners itself, so the touch icon is a full square tile.
await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(`<html><body style="margin:0;width:180px;height:180px;display:grid;place-items:center;background:${TILE}">${svg.replace(`fill="${TILE}"`, `fill="${INK}"`).replace("<svg ", '<svg width="112" height="112" ')}</body></html>`);
await writeFile("public/apple-touch-icon.png", await page.screenshot({ clip: { x: 0, y: 0, width: 180, height: 180 } }));
await browser.close();
console.log(`Wrote desktop/icon.ico (${icoSizes.join(", ")} px), public/logo.png, favicon.ico, favicon.svg and apple-touch-icon.png.`);
