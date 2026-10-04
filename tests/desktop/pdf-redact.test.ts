import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { kit, lib, fixture, open } from "./pdf-kit.ts";
import { editPdf, type EditHelpers, type Box } from "../../desktop/pdf-edit-tools.ts";
import { parseContent, redactPage, collectGarbage, Unclean } from "../../desktop/pdf-redact.ts";
import { vectorCrop, type CropAsset } from "../../desktop/pdf-assets.ts";
import { greyOf } from "../../core/pdf-page.ts";

/** The window's part with pdf.js and a canvas in Node (src/desktop/pdf-tasks.ts in the app). */
const helpers = (files: Record<string, Uint8Array>, crops: Record<string, any> = {}): EditHelpers => ({
  load: async (ref) => ({ bytes: files[ref], source: "src-00000000-0000-0000-0000-000000000001", name: ref }),
  words: async (bytes, page) => {
    const pdf = await open(bytes);
    try {
      const content = await (await pdf.getPage(page)).getTextContent();
      return (content.items as any[]).filter((i) => i.str).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, size: Math.hypot(i.transform[2], i.transform[3]), font: (content.styles as any)[i.fontName]?.fontFamily }));
    } finally {
      await pdf.loadingTask.destroy();
    }
  },
  crop: async (id) => crops[id],
  raster: async (bytes, page, boxes, fill) => {
    const pdf = await open(bytes);
    try {
      const p = await pdf.getPage(page), vp = p.getViewport({ scale: 2, rotation: 0 });
      const c = kit.create(Math.round(vp.width), Math.round(vp.height)), ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await p.render({ canvasContext: ctx, canvas: c, viewport: vp, intent: "print" }).promise;
      ctx.fillStyle = `rgb(${fill.map((v) => v * 255).join(",")})`;
      for (const b of boxes) { const [ax, ay] = vp.convertToViewportPoint(b[0], b[1]), [bx, by] = vp.convertToViewportPoint(b[2], b[3]); ctx.fillRect(Math.floor(Math.min(ax, bx)), Math.floor(Math.min(ay, by)), Math.ceil(Math.abs(bx - ax)) + 1, Math.ceil(Math.abs(by - ay)) + 1); }
      return kit.encode(c, "image/jpeg", 0.92);
    } finally {
      await pdf.loadingTask.destroy();
    }
  },
});

async function textOf(bytes: Uint8Array) {
  const pdf = await open(bytes);
  try {
    let all = "";
    // One text run per line, so a phrase is only found where it is printed on one line.
    for (let p = 1; p <= pdf.numPages; p++) all += ((await (await pdf.getPage(p)).getTextContent()).items as any[]).map((i) => i.str).join("\n") + "\n";
    return all;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
/** Every stream in the file decoded, as text, to search the raw bytes the way a forensic tool would. */
function rawText(bytes: Uint8Array) {
  const s = Buffer.from(bytes).toString("latin1");
  let out = s;
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length, end = s.indexOf("endstream", start);
    try { out += "\n" + inflateSync(Buffer.from(s.slice(start, end), "latin1")).toString("latin1"); } catch { /* not flate */ }
  }
  return out;
}
const hexOf = (text: string) => [...Buffer.from(text, "latin1")].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
async function drawn(bytes: Uint8Array, scale = 2) {
  const pdf = await open(bytes);
  try {
    const p = await pdf.getPage(1), vp = p.getViewport({ scale });
    const c = kit.create(Math.round(vp.width), Math.round(vp.height)), ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, canvas: c, viewport: vp, intent: "print" }).promise;
    return { grey: greyOf(c), w: c.width, h: c.height, vp };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
/** Pixels that differ between two drawings outside `boxes` (grown by `margin` points), and the darkest-pixel share inside them. */
async function compare(before: Uint8Array, after: Uint8Array, boxes: Box[], margin = 1.5) {
  const a = await drawn(before), b = await drawn(after);
  const px = boxes.map((box) => { const [x0, y0] = a.vp.convertToViewportPoint(box[0] - margin, box[3] + margin), [x1, y1] = a.vp.convertToViewportPoint(box[2] + margin, box[1] - margin); return [x0, y0, x1, y1]; });
  const inner = boxes.map((box) => { const [x0, y0] = a.vp.convertToViewportPoint(box[0] + 1, box[3] - 1), [x1, y1] = a.vp.convertToViewportPoint(box[2] - 1, box[1] + 1); return [x0, y0, x1, y1]; });
  let outside = 0, dark = 0, inside = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const i = y * a.w + x;
    if (inner.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) { inside++; if (b.grey[i] < 40) dark++; }
    else if (!px.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1) && Math.abs(a.grey[i] - b.grey[i]) > 24) outside++;
  }
  return { outside, black: inside ? dark / inside : 1 };
}

test("text under a box is removed, glyph by glyph: gone from extraction and from the file's bytes, the rest of every line in place", async () => {
  const src = new Uint8Array(await fixture("two-column.pdf"));
  const r = await editPdf({ file: "paper.pdf", ops: [{ op: "redact", find: "Kirchhoff's laws", pages: "all" }] }, helpers({ "paper.pdf": src }));
  assert.match(r.done[0], /removed, not covered/);
  assert.doesNotMatch(r.done[0], /picture/, "nothing had to become a picture");
  // Every place it was printed on one line is gone (where it wraps across two lines, it is not that phrase).
  assert.ok(!(await textOf(r.bytes)).split("\n").some((line) => line.includes("Kirchhoff's laws")), "pdf.js cannot read it");
  assert.equal(r.spec.ops[0].regions.length, 3);
  assert.match(await textOf(r.bytes), /relate these quantities/, "the rest of those lines is still text");
  const raw = rawText(r.bytes);
  assert.ok(!raw.includes(hexOf("Kirchhoff's laws")) && !raw.includes("Kirchhoff's laws"), "no copy of it is left anywhere in the file");
  const boxes = r.spec.ops[0].regions.map((x: any) => x.box);
  const { outside, black } = await compare(src, r.bytes, boxes);
  assert.ok(outside < 20, `${outside} pixels changed outside the boxes`);
  assert.ok(black > 0.97, `the boxes are ${(black * 100).toFixed(0)}% black`);
});

test("a Chromium PDF (composite fonts) and text inside a placed form are redacted the same way, as vectors", async () => {
  const src = new Uint8Array(await fixture("chromium-report.pdf"));
  const r = await editPdf({ file: "report.pdf", ops: [{ op: "redact", page: 1, find: "series resistor" }, { op: "redact", page: 1, find: "R2 = 6" }] }, helpers({ "report.pdf": src }));
  const text = await textOf(r.bytes);
  assert.ok(!text.includes("series resistor") && !text.includes("R2 = 6"), text);
  assert.match(text, /R3 = 12/, "the circuit's other labels stay text");
  assert.match(text, /combine/, "and so does the rest of the sentence");
  for (const d of r.done) assert.doesNotMatch(d, /picture/);
  const boxes = r.spec.ops.flatMap((o: any) => o.regions.map((x: any) => x.box));
  const { outside, black } = await compare(src, r.bytes, boxes);
  assert.ok(outside < 30, `${outside} pixels changed outside the boxes`);
  assert.ok(black > 0.97, `the boxes are ${(black * 100).toFixed(0)}% black`);
});

test("a scanned page cannot be cleaned exactly: it becomes a picture with the box filled, and says so", async () => {
  const src = new Uint8Array(await fixture("scanned-page.pdf"));
  const box: Box = [72, 650, 400, 700];
  const r = await editPdf({ file: "scan.pdf", ops: [{ op: "redact", page: 1, bbox: box }] }, helpers({ "scan.pdf": src }));
  assert.match(r.done[0], /page 1 could not be cleaned exactly and was turned into a picture/);
  const { black } = await compare(src, r.bytes, [box]);
  assert.ok(black > 0.97);
  // The original scan is not left in the file under the new picture.
  const doc = await PDFDocument.load(r.bytes);
  assert.equal(doc.getPageCount(), 1);
  const images = [...Buffer.from(r.bytes).toString("latin1").matchAll(/\/Subtype\s*\/Image/g)].length;
  assert.equal(images, 1);
});

test("a picture wholly under the box is taken out; one only partly under it turns the page into a picture", async () => {
  const src = new Uint8Array(await fixture("raster-figure.pdf"));
  const whole = await editPdf({ file: "a.pdf", ops: [{ op: "redact", page: 1, bbox: [150, 290, 470, 505] }] }, helpers({ "a.pdf": src }));
  assert.doesNotMatch(whole.done[0], /picture/);
  assert.equal([...Buffer.from(whole.bytes).toString("latin1").matchAll(/\/Subtype\s*\/Image/g)].length, 0, "the chart is gone from the file");
  assert.match(await textOf(whole.bytes), /Results/);
  const part = await editPdf({ file: "a.pdf", ops: [{ op: "redact", page: 1, bbox: [150, 290, 300, 400] }] }, helpers({ "a.pdf": src }));
  assert.match(part.done[0], /turned into a picture/);
});

test("form fields under the box lose their values; annotations there go", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]), form = doc.getForm();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Name:", { x: 40, y: 226, size: 12, font: f });
  const name = form.createTextField("name");
  name.setText("Amira Hassan");
  name.addToPage(page, { x: 90, y: 220, width: 200, height: 20 });
  form.createTextField("city").addToPage(page, { x: 90, y: 100, width: 200, height: 20 });
  form.getTextField("city").setText("Cairo");
  const r = await editPdf({ file: "f.pdf", ops: [{ op: "redact", page: 1, bbox: [85, 215, 295, 245] }] }, helpers({ "f.pdf": await doc.save() }));
  const raw = rawText(r.bytes);
  assert.ok(!raw.includes("Amira Hassan") && !raw.includes(hexOf("Amira")), "the value is gone from the file");
  assert.ok(raw.includes(hexOf("Cairo")), "a field outside the box keeps its value");
});

test("replace: what was there is removed and the new content placed, a crop fitted or text set (any script through the typesetter)", async () => {
  const src = new Uint8Array(await fixture("textbook-circuit.pdf"));
  const box: [number, number, number, number] = [126, 383, 477, 541];
  const meta: CropAsset = { id: "crop-0000aaaa", file: "t.pdf", page: 1, box, units: "pt", width: 1, height: 1, vector: true, created: 0 };
  const h = helpers({ "t.pdf": src }, { "crop-0000aaaa": { meta, png: new Uint8Array(), pdf: await vectorCrop(src, 1, box) } });
  // The paragraph under the heading is replaced by a corrected one.
  const r = await editPdf({ file: "t.pdf", ops: [{ op: "replace", page: 1, bbox: [70, 580, 542, 700], text: "This paragraph was corrected by the author.", size: 11 }] }, h);
  assert.match(await textOf(r.bytes), /This paragraph was corrected by the author\./);
  // Inside the box only the new text is left (the same words printed elsewhere on the page stay).
  const inBox = (await h.words(r.bytes, 1)).filter((i) => i.y > 582 && i.y < 698 && i.x < 540).map((i) => i.str.trim()).filter(Boolean);
  assert.deepEqual(inBox, ["This paragraph was corrected by the author."]);
  // A translation in another script goes through the typesetter, placed as a page.
  let asked: any;
  const typeset = async (t: string, o: any) => { asked = { t, o }; const d = await PDFDocument.create(); const p = d.addPage([o.width, o.height]); p.drawRectangle({ x: 0, y: 0, width: o.width, height: o.height, color: rgb(0.9, 0.9, 1) }); return d.save(); };
  const ar = await editPdf({ file: "t.pdf", ops: [{ op: "replace", page: 1, bbox: [70, 580, 542, 700], text: "تحليل الشبكة يبدأ بالعناصر" }] }, { ...h, typeset });
  assert.equal(asked.t, "تحليل الشبكة يبدأ بالعناصر");
  assert.ok(Math.abs(asked.o.width - 472) < 0.01 && Math.abs(asked.o.height - 120) < 0.01);
  assert.deepEqual((await h.words(ar.bytes, 1)).filter((i) => i.y > 582 && i.y < 698 && i.str.trim()), []);
  // A corrected figure: the old drawing out, the crop fitted in its place.
  const fig = await editPdf({ file: "t.pdf", ops: [{ op: "replace", page: 1, bbox: [126, 383, 477, 541], asset: "crop-0000aaaa" }] }, h);
  const ops = await (await (await open(fig.bytes)).getPage(1)).getOperatorList();
  assert.ok(ops.fnArray.includes(lib.OPS.paintFormXObjectBegin));
  await assert.rejects(editPdf({ file: "t.pdf", ops: [{ op: "replace", page: 1, bbox: [1, 1, 2, 2] }] }, h), /"asset" \(a crop id\) or "text"/);
});

test("vector crops carry only what is inside them: the rest of the page is gone from the crop's file", async () => {
  const src = new Uint8Array(await fixture("textbook-circuit.pdf"));
  const crop = (await vectorCrop(src, 1, [126, 383, 477, 541]))!;
  const text = await textOf(crop);
  assert.match(text, /R1 = 4/);
  assert.ok(!text.includes("network") && !rawText(crop).includes(hexOf("network")), "body text is not hidden in it");
  const raster = (await vectorCrop(new Uint8Array(await fixture("raster-figure.pdf")), 1, [72, 600, 540, 740]))!;
  assert.equal([...Buffer.from(raster).toString("latin1").matchAll(/\/Subtype\s*\/Image/g)].length, 0, "a picture outside the crop is not carried");
});

test("the content reader keeps inline images whole and the marked-content alternative text of removed glyphs is scrubbed", async () => {
  const ops = parseContent("q 10 0 0 10 50 50 cm BI /W 2 /H 1 /BPC 8 /CS /G ID \x00EI\xff EI Q (a\\)b) Tj [<00ff> -20 (c)] TJ");
  assert.deepEqual(ops.map((o) => o.op), ["q", "cm", "BI", "Q", "Tj", "TJ"]);
  assert.deepEqual((ops[4].args[0] as any).bytes, [97, 41, 98]);
  // ActualText around a glyph that goes would still say what it was.
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("x", { x: 10, y: 10, size: 1, font: f });
  const fontName = Buffer.from(rawText(await doc.save())).toString("latin1").match(/\/(Helvetica-\d+) /)![1];
  const stream = doc.context.register(doc.context.stream(`/Span <</ActualText (Secret name)>> BDC BT /${fontName} 12 Tf 40 100 Td (Secret name) Tj ET EMC BT /${fontName} 12 Tf 40 50 Td (Kept) Tj ET`));
  page.node.set(lib && (await import("pdf-lib")).PDFName.of("Contents"), stream);
  redactPage(doc, page, [[30, 90, 200, 120]]);
  collectGarbage(doc);
  const raw = rawText(await doc.save());
  assert.ok(!raw.includes("Secret"), "neither the glyphs nor the ActualText remain");
  assert.match(raw, /Kept/);
  assert.ok(new Unclean("x") instanceof Error);
});
