import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString, rgb } from "pdf-lib";
import { lib, open } from "./pdf-kit.ts";
import { assetCaption, assetOf, assetSvg, resolveAssets, SLOT, stampVectors, type CropAsset } from "../../desktop/pdf-assets.ts";
import { documentHtml, specSize } from "../../desktop/pdf-document.ts";
import { documentFigures } from "../../desktop/figure-review.ts";

const meta = (over: Partial<CropAsset> = {}): CropAsset => ({ id: "crop-0000aaaa", file: "notes/lecture 3.pdf", page: 12, box: [100, 200, 280, 335], units: "pt", width: 750, height: 562, dpi: 300, vector: true, caption: "Figure 2.4: A series–parallel circuit.", created: 0, ...over });
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

test("a crop's drawing carries its id, size and PNG, and only crops are read back as crops", () => {
  const svg = assetSvg(meta(), png);
  const back = assetOf(svg)!;
  assert.equal(back.id, "crop-0000aaaa");
  // 180 × 135 pt is 240 × 180 CSS pixels.
  assert.deepEqual([back.width, back.height], [240, 180]);
  assert.deepEqual([...back.png], [...png]);
  assert.equal(back.vector, true);
  assert.equal(assetOf(assetSvg(meta({ vector: false, units: "px", box: [0, 0, 640, 480] }), png))!.vector, false);
  assert.equal(assetOf('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>'), undefined);
});

test("captions: the one given, else the source's own without its number, and a source line when asked", () => {
  assert.equal(assetCaption({}, undefined, meta()), "A series–parallel circuit.");
  assert.equal(assetCaption({ caption: "The test network" }, undefined, meta()), "The test network");
  assert.equal(assetCaption({}, "Given by the section", meta()), "Given by the section");
  assert.equal(assetCaption({ source: true }, undefined, meta()), "A series–parallel circuit. Source: lecture 3.pdf, p. 12.");
  assert.equal(assetCaption({ source: "Hayt, Engineering Circuit Analysis, Fig. 3.1" }, "The network", meta()), "The network. Source: Hayt, Engineering Circuit Analysis, Fig. 3.1.");
  assert.equal(assetCaption({ source: true }, undefined, meta({ caption: undefined, page: undefined, file: "photo.jpg" })), "Source: photo.jpg.");
});

test("resolveAssets: pdf/docx sections and pptx slides get their drawing and caption; unknown ids are listed; the spec sent is untouched", async () => {
  const read = async (id: string) => (id === "crop-0000aaaa" ? { meta: meta(), png, pdf: new Uint8Array([37, 80, 68, 70]) } : undefined);
  const spec = { title: "T", sections: [{ text: "x", figure: { asset: "crop-0000aaaa", source: true } }, { text: "y", figure: { asset: "crop-0000ffff" } }] };
  const r = await resolveAssets(spec, read);
  assert.ok(assetOf(r.spec.sections[0].figure.svg));
  assert.match(r.spec.sections[0].caption, /Source: lecture 3\.pdf, p\. 12\.$/);
  assert.deepEqual(r.missing, ["crop-0000ffff"]);
  assert.deepEqual([...r.vectors.keys()], ["crop-0000aaaa"]);
  assert.equal((spec.sections[0].figure as any).svg, undefined, "the stored spec keeps only the id");
  // The crop's picture does not count towards the document's size.
  assert.ok(specSize(r.spec) < 400);
  const deck = await resolveAssets({ title: "D", slides: [{ layout: "figure", figure: { asset: "crop-0000aaaa" } }, { layout: "image", title: "Photo", image: { figure: { asset: "crop-0000aaaa", source: "Lab notebook" } } }] }, read);
  assert.ok(assetOf(deck.spec.slides[0].figure.svg));
  assert.equal(deck.spec.slides[0].caption, "A series–parallel circuit.");
  assert.ok(assetOf(deck.spec.slides[1].image.figure.svg));
  assert.match(deck.spec.slides[1].caption, /Source: Lab notebook\./);
  // Figure review leaves crops out: the model looked at each one when it cut it.
  assert.deepEqual(documentFigures(r.spec, [r.spec.sections[0].figure.svg, undefined]), []);
});

test("the PDF page gets a placeholder link for a vector crop, and the crop's PNG when vectors are off", () => {
  const svg = assetSvg(meta(), png);
  const spec: any = { title: "T", sections: [{ heading: "A", text: "x", figure: { asset: "crop-0000aaaa", svg }, caption: "C" }] };
  const html = documentHtml(spec, [svg]);
  assert.match(html, new RegExp(`<a class="asset-slot" style="[^"]*" href="${SLOT}crop-0000aaaa/1"><img`));
  assert.doesNotMatch(html, /data:image\/png/, "the PNG is not printed under the vectors");
  // Printed as its PNG, the crop still marks where it landed ("/p": the link is only removed).
  const pictures = documentHtml(spec, [svg], undefined, { pictures: true });
  assert.match(pictures, new RegExp(`<a class="asset-slot" style="[^"]*" href="${SLOT}crop-0000aaaa/1/p">`));
  assert.ok(pictures.includes(Buffer.from(svg).toString("base64")));
  const bare = documentHtml(spec, [svg], undefined, { pictures: true, bare: true });
  assert.doesNotMatch(bare, /<a class="asset-slot"/);
  assert.ok(bare.includes(Buffer.from(svg).toString("base64")));
});

test("stampVectors draws the crop into each placeholder's rectangle and removes the link; a missing place throws", async () => {
  // The crop: a 100 × 50 pt page with a filled box and a word.
  const crop = await PDFDocument.create();
  const cp = crop.addPage([100, 50]);
  cp.drawRectangle({ x: 10, y: 10, width: 80, height: 30, color: rgb(0, 0, 0) });
  const cropBytes = await crop.save();
  // A printed page with a link where the placeholder was, as Chromium writes it.
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const link = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [100, 200, 300, 300], Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of(SLOT + "crop-0000aaaa/1") } });
  page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(link)]));
  const stamped = await stampVectors(await doc.save(), new Map([["crop-0000aaaa", cropBytes]]), 1);
  const pdf = await open(stamped);
  const p = await pdf.getPage(1);
  assert.deepEqual(await p.getAnnotations(), []);
  const ops = await p.getOperatorList();
  assert.ok(ops.fnArray.includes(lib.OPS.paintFormXObjectBegin));
  // The crop's box (10..90 × 10..40 of 100 × 50) scaled ×2 into the rectangle at (100, 200).
  // pdf-lib places it with several cm operators (translate, rotate, scale, skew): their product is the placement.
  const i = ops.fnArray.indexOf(lib.OPS.paintFormXObjectBegin), start = ops.fnArray.lastIndexOf(lib.OPS.save, i);
  let m = [1, 0, 0, 1, 0, 0];
  for (let k = start; k < i; k++) if (ops.fnArray[k] === lib.OPS.transform) { const [a, b, c, d, e, f] = ops.argsArray[k]; m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]]; }
  assert.deepEqual(m.map((v) => Math.round(v * 100) / 100), [2, 0, 0, 2, 100, 200]);
  await pdf.loadingTask.destroy();
  await assert.rejects(stampVectors(await doc.save(), new Map(), 1), /place/);
  // A crop printed as its picture: the link only goes, and where it landed is reported.
  const pic = await PDFDocument.create();
  const pp = pic.addPage([400, 400]);
  pp.node.set(PDFName.of("Annots"), pic.context.obj([pic.context.register(pic.context.obj({ Type: "Annot", Subtype: "Link", Rect: [50, 60, 250, 160], Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of(SLOT + "crop-0000aaaa/2/p") } }))]));
  const spots: any[] = [];
  const kept = await stampVectors(await pic.save(), new Map(), 1, spots);
  assert.deepEqual(spots, [{ id: "crop-0000aaaa", figure: 2, page: 1, rect: [50, 60, 250, 160], sheet: [400, 400] }]);
  const keptPdf = await open(kept);
  assert.deepEqual(await (await keptPdf.getPage(1)).getAnnotations(), []);
  await keptPdf.loadingTask.destroy();
  await assert.rejects(stampVectors(await doc.save(), new Map([["crop-0000aaaa", cropBytes]]), 2), /could not be found/);
});
