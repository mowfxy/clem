// Draws Mowr's Windows icons straight from the vector logo, one image per size, so none is a scaled-down copy:
//   desktop/icon.ico               the app, window, taskbar and shortcut icon (16–256 px, PNG entries)
//   public/logo.png                a large copy for drag previews
// Run: node scripts/render-icons.mjs  (needs Playwright's Chromium).
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const svg = await readFile("public/logo.svg", "utf8");
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// The petals' extent inside the 144-unit viewBox, so the mark can be sized by what is actually drawn.
const drawn = 124 / 144;
// Small icons get a larger mark: at 16 px every pixel of petal counts; large ones keep a little breathing room.
const share = (size) => (size <= 24 ? 0.96 : size <= 48 ? 0.9 : 0.84);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(size, ink) {
  const box = Math.round((size * share(size)) / drawn);
  const mark = svg.replace('fill="#d9473e"', `fill="${ink}"`).replace("<svg ", `<svg width="${box}" height="${box}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:transparent">${mark}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

// ICO: a directory of PNG images, largest last is fine for Windows; each entry keeps its own exact size.
const images = [];
for (const size of icoSizes) images.push({ size, png: await render(size, "#d9473e") });
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
await writeFile("desktop/icon.ico", Buffer.concat([header, ...images.map((x) => x.png)]));

// A large copy of the same mark for drag previews.
{
  const size = 1254, mark = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${mark}</body></html>`);
  await writeFile("public/logo.png", await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
await browser.close();
console.log(`Wrote desktop/icon.ico (${icoSizes.join(", ")} px) and public/logo.png.`);
