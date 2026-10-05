import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { kit, lib, fixture, open } from "./pdf-kit.ts";
import { analysePage, greyOf, settlePdfCrop } from "../../core/pdf-page.ts";
import { inkBounds } from "../../core/pdf-regions.ts";
import { CropAssets, MAX_ASSETS, memoryIo, vectorCrop } from "../../desktop/pdf-assets.ts";

/** A page drawn at `scale` pixels per point, as grey levels. */
async function drawn(bytes: Uint8Array, scale: number) {
  const pdf = await open(bytes);
  const page = await pdf.getPage(1), vp = page.getViewport({ scale });
  const c = kit.create(Math.round(vp.width), Math.round(vp.height)), ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
  await pdf.loadingTask.destroy();
  return { grey: greyOf(c), w: c.width, h: c.height };
}

test("a vector crop is the same picture as the page area, as one page of exactly that size, still vectors", async () => {
  const source = new Uint8Array(await fixture("textbook-circuit.pdf"));
  const pdf = await open(source);
  const region = (await analysePage(lib, pdf, 1, kit)).regions.find((r) => r.kind === "figure")!;
  const settled = await settlePdfCrop(pdf, 1, region.box, { pad: 3, dpi: 144 }, kit);
  await pdf.loadingTask.destroy();
  const crop = (await vectorCrop(source, 1, settled.box))!;
  const doc = await PDFDocument.load(crop);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - (settled.box[2] - settled.box[0])) < 0.01 && Math.abs(height - (settled.box[3] - settled.box[1])) < 0.01);
  // Drawn at 2 px/pt, the crop's ink sits 3 pt (6 px) in from every side: nothing shifted, nothing clipped.
  const v = await drawn(crop, 2);
  const ink = inkBounds(v.grey, v.w, v.h)!;
  for (const [got, want] of [[ink[0], 6], [ink[1], 6], [v.w - ink[2], 6], [v.h - ink[3], 6]]) assert.ok(Math.abs(got - want) <= 2, `edge ${got} px from the side`);
  // Pixel for pixel like the window's PNG of the same area.
  const png = await kit.picture!(settled.png);
  const scaled = kit.create(v.w, v.h);
  scaled.getContext("2d").drawImage(png, 0, 0, v.w, v.h);
  const p = greyOf(scaled);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff += Math.abs(p[i] - v.grey[i]);
  assert.ok(diff / p.length < 6, `mean difference ${(diff / p.length).toFixed(2)}`);
  // Vectors: the crop has no image, only the page's drawing.
  const ops = await (await (await open(crop)).getPage(1)).getOperatorList();
  assert.ok(!ops.fnArray.includes(lib.OPS.paintImageXObject));
  assert.ok(ops.fnArray.includes(lib.OPS.constructPath));
});

test("a file pdf-lib cannot read gives no vector crop (the PNG stands alone)", async () => {
  assert.equal(await vectorCrop(new TextEncoder().encode("not a pdf"), 1, [0, 0, 10, 10]), undefined);
  assert.equal(await vectorCrop(new Uint8Array(await fixture("textbook-circuit.pdf")), 9, [0, 0, 10, 10]), undefined);
});

test("crop assets keep stable ids per chat, survive a fresh store, refuse made-up ids and drop the oldest past the limit", async () => {
  const io = memoryIo();
  const store = new CropAssets(io, "chat-1");
  const png = new Uint8Array([137, 80, 78, 71]), pdf = new Uint8Array([37, 80, 68, 70]);
  const a = await store.add({ file: "lecture.pdf", page: 3, box: [1, 2, 3, 4], units: "pt", width: 10, height: 10, dpi: 300, vector: true, caption: "Figure 1" }, png, pdf);
  assert.match(a.id, /^crop-[a-f0-9]{16}$/);
  const again = await new CropAssets(io, "chat-1").get(a.id);
  assert.deepEqual([...again!.png], [...png]);
  assert.deepEqual([...again!.pdf!], [...pdf]);
  assert.equal(again!.meta.caption, "Figure 1");
  assert.equal(await new CropAssets(io, "chat-2").get(a.id), undefined, "another chat's crops are not reachable");
  assert.equal(await store.get("../spec-x"), undefined);
  const raster = await store.add({ file: "photo.jpg", box: [0, 0, 5, 5], units: "px", width: 5, height: 5, vector: false }, png);
  assert.equal((await store.get(raster.id))!.pdf, undefined);
  for (let i = 0; i < MAX_ASSETS; i++) await store.add({ file: "x.pdf", page: 1, box: [0, 0, 1, 1], units: "pt", width: 1, height: 1, vector: false }, png);
  assert.equal(await store.get(a.id), undefined);
  assert.equal(await io.read(a.id + "-png"), null, "the oldest crop's files are removed");
  assert.equal((await store.all()).length, MAX_ASSETS);
});
