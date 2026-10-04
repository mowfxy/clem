import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, PDFName, PDFArray, PDFDict } from "pdf-lib";
import { kit, lib, fixture, open } from "./pdf-kit.ts";
import { editPdf, pageList, colour, type EditHelpers } from "../../desktop/pdf-edit-tools.ts";
import { vectorCrop, type CropAsset } from "../../desktop/pdf-assets.ts";
import { greyOf } from "../../core/pdf-page.ts";

/** A document of `n` pages, each saying which it is. */
async function numbered(n: number, size: [number, number] = [400, 300]) {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) doc.addPage(size).drawText(`Page ${i}`, { x: 40, y: 200, size: 20, font: f });
  return doc.save();
}
/** What each page of a PDF says, and its annotations. */
async function read(bytes: Uint8Array) {
  const pdf = await open(bytes);
  try {
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      out.push({ text: ((await page.getTextContent()).items as any[]).map((i) => i.str).join(" "), annots: await page.getAnnotations(), rotate: page.rotate, items: (await page.getTextContent()).items as any[], view: page.getViewport({ scale: 1 }) });
    }
    return out;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** The window's part, done here with pdf.js in Node (src/desktop/pdf-tasks.ts does it in Chromium). */
function helpers(files: Record<string, Uint8Array>, crops: Record<string, { meta: CropAsset; png: Uint8Array; pdf?: Uint8Array }> = {}): EditHelpers & { loaded: string[] } {
  const kept = new Map<string, Uint8Array>(), loaded: string[] = [];
  return {
    loaded,
    load: async (ref) => {
      loaded.push(ref);
      if (kept.has(ref)) return { bytes: kept.get(ref)!, source: ref };
      const bytes = files[ref];
      if (!bytes) throw Error(`No file named "${ref}" in this conversation.`);
      const source = "src-" + createHash("md5").update(ref).digest("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
      kept.set(source, bytes);
      return { bytes, source, name: ref };
    },
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
  };
}

test("pageList reads pages, lists, ranges, open ranges, last and all, and refuses pages that are not there", () => {
  assert.deepEqual(pageList("1-3,7", 9), [1, 2, 3, 7]);
  assert.deepEqual(pageList("8-", 9), [8, 9]);
  assert.deepEqual(pageList("last", 9), [9]);
  assert.deepEqual(pageList([3, 1], 9), [3, 1]);
  assert.deepEqual(pageList(undefined, 3, "all"), [1, 2, 3]);
  assert.throws(() => pageList("4", 3), /no page 4: the document has 3 pages/);
  assert.throws(() => pageList("5-2", 9), /backwards/);
  assert.throws(() => pageList(undefined, 3), /which pages/);
  assert.deepEqual(colour("#ff0000", [0, 0, 0]), [1, 0, 0]);
  assert.throws(() => colour("blurple", [0, 0, 0]), /not a colour/);
});

test("pages are merged, deleted, reordered, taken and turned, each edit on the document the one before left; the original is untouched", async () => {
  const original = await numbered(5), other = await numbered(2, [300, 300]);
  const before = createHash("sha256").update(original).digest("hex");
  const h = helpers({ "lecture.pdf": original, "appendix.pdf": other });
  const r = await editPdf({ file: "lecture.pdf", ops: [
    { op: "merge", file: "appendix.pdf", at: 5 },
    { op: "delete", pages: "1" },
    { op: "reorder", order: [6, 1, 2, 3, 4, 5] },
    { op: "pages", keep: "1-3,3" },
    { op: "rotate", pages: "2", degrees: 90 },
  ] }, h);
  const pages = await read(r.bytes);
  assert.deepEqual(pages.map((p) => p.text), ["Page 2", "Page 2", "Page 3", "Page 3"]);
  assert.equal(pages[0].view.width, 300, "the first page is the appendix's second page");
  assert.deepEqual(pages.map((p) => p.rotate), [0, 90, 0, 0]);
  assert.equal(createHash("sha256").update(original).digest("hex"), before);
  // The stored edits name the kept copies, not the files, so a revision replays them on the same originals.
  assert.match(r.spec.source, /^src-/);
  assert.match(r.spec.ops[0].source, /^src-/);
  assert.equal(r.spec.ops[0].file, undefined);
  assert.equal(r.spec.file, undefined);
  const again = await editPdf(r.spec, h);
  assert.deepEqual((await read(again.bytes)).map((p) => p.text), ["Page 2", "Page 2", "Page 3", "Page 3"]);
  assert.deepEqual(r.changed, [1, 2]);
});

test("highlight finds the text on the page, marks every place it is printed with a real highlight, and keeps the boxes for revisions", async () => {
  const page = new Uint8Array(await fixture("two-column.pdf"));
  const h = helpers({ "paper.pdf": page });
  const r = await editPdf({ file: "paper.pdf", ops: [{ op: "highlight", page: 1, find: "Kirchhoff's laws", note: "Key idea" }] }, h);
  const [p] = await read(r.bytes);
  const marks = p.annots.filter((a: any) => a.subtype === "Highlight");
  assert.ok(marks.length >= 2, `${marks.length} highlights`);
  assert.equal(marks[0].contentsObj.str, "Key idea");
  assert.equal(r.spec.ops[0].boxes.length, marks.length);
  // Each box covers exactly the printed words: the fixture sets 9 pt Times, so where they start and end is known.
  const times = await (await PDFDocument.create()).embedFont(StandardFonts.TimesRoman);
  const hits = p.items.filter((i: any) => i.str.includes("Kirchhoff's laws")).map((i: any) => {
    const at = i.str.indexOf("Kirchhoff's laws"), x = i.transform[4] + times.widthOfTextAtSize(i.str.slice(0, at), 9);
    return { x0: x, x1: x + times.widthOfTextAtSize("Kirchhoff's laws", 9), y: i.transform[5] };
  });
  for (const [x0, y0, x1] of r.spec.ops[0].boxes) assert.ok(hits.some((h: any) => Math.abs(h.y - (y0 + 9 * 0.22)) < 1 && Math.abs(h.x0 - x0) < 0.6 && Math.abs(h.x1 - x1) < 0.6), `box ${[x0, x1]} vs ${JSON.stringify(hits)}`);
  // Drawn: the highlighted words sit on yellow.
  const pdf = await open(r.bytes);
  const pg = await pdf.getPage(1), vp = pg.getViewport({ scale: 2 });
  const c = kit.create(Math.round(vp.width), Math.round(vp.height)), ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await pg.render({ canvasContext: ctx, canvas: c, viewport: vp, intent: "print", annotationMode: lib.AnnotationMode.ENABLE }).promise;
  const [x0, y0, x1, y1] = r.spec.ops[0].boxes[0];
  const [px, py] = vp.convertToViewportPoint(x0 + 1, (y0 + y1) / 2 - (y1 - y0) * 0.35);
  const rgba = ctx.getImageData(Math.round(px), Math.round(py), 1, 1).data;
  assert.ok(rgba[0] > 200 && rgba[1] > 180 && rgba[2] < 140, `colour under the highlight: ${[...rgba]}`);
  await pdf.loadingTask.destroy();
  await assert.rejects(editPdf({ file: "paper.pdf", ops: [{ op: "highlight", page: 1, find: "not on this page" }] }, h), /Edit 1 \(highlight\): “not on this page” is not on page 1/);
  // Replayed from the stored edits, no search is needed.
  let searched = false;
  await editPdf(r.spec, { ...h, words: async () => { searched = true; return []; } });
  assert.equal(searched, false);
});

test("notes, text boxes, stamps and page numbers are added, upright on a turned page", async () => {
  const h = helpers({ "a.pdf": await numbered(3) });
  const r = await editPdf({ file: "a.pdf", ops: [
    { op: "rotate", pages: "3", degrees: 90 },
    { op: "note", page: 1, text: "Check this figure." },
    { op: "text", page: 2, bbox: [40, 40, 300, 120], text: "Corrected value: 4.7 kΩ is wrong, use 4.7 k", background: "#ffffff", align: "center" },
    { op: "stamp", text: "DRAFT", pages: "1" },
    { op: "pageNumbers", format: "{n} of {total}", position: "bottom-right" },
  ] }, h).catch((e) => e);
  // Ω is not Latin-1: the text box is refused with the reason, and nothing is made.
  assert.match(String(r.message), /Edit 3 \(text\): .*standard PDF fonts cannot set/);
  const ok = await editPdf({ file: "a.pdf", ops: [
    { op: "rotate", pages: "3", degrees: 90 },
    { op: "note", page: 1, text: "Check this figure." },
    { op: "text", page: 2, bbox: [40, 40, 300, 120], text: "Corrected value: 4.7 kOhm", background: "#ffffff", align: "center" },
    { op: "stamp", text: "DRAFT", pages: "1" },
    { op: "pageNumbers", format: "{n} of {total}", position: "bottom-right" },
  ] }, h);
  const pages = await read(ok.bytes);
  assert.ok(pages[0].annots.some((a: any) => a.subtype === "Text" && a.contentsObj.str === "Check this figure."));
  assert.match(pages[0].text, /DRAFT/);
  assert.match(pages[1].text, /Corrected value: 4\.7 kOhm/);
  assert.deepEqual(pages.map((p) => /(\d) of 3/.exec(p.text)?.[1]), ["1", "2", "3"]);
  // On the turned page the number reads left to right as the page is shown, at its shown bottom right.
  const num = pages[2].items.find((i: any) => i.str === "3 of 3");
  const vp = pages[2].view, m = [vp.transform[0] * num.transform[0] + vp.transform[2] * num.transform[1], vp.transform[1] * num.transform[0] + vp.transform[3] * num.transform[1]];
  assert.ok(m[0] > 0 && Math.abs(m[1]) < 1e-6, `direction as shown: ${m}`);
  const [sx, sy] = vp.convertToViewportPoint(num.transform[4], num.transform[5]);
  assert.ok(sx > vp.width * 0.7 && sy > vp.height * 0.85, `shown at ${sx}, ${sy} of ${vp.width} × ${vp.height}`);
  assert.deepEqual(ok.changed, [1, 2, 3]);
});

test("form fields are filled (text, checkbox, choice), unknown names are answered with the real ones, and a form can be flattened", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]), form = doc.getForm();
  form.createTextField("name").addToPage(page, { x: 40, y: 220, width: 200, height: 20 });
  form.createCheckBox("agree").addToPage(page, { x: 40, y: 180, width: 14, height: 14 });
  const level = form.createDropdown("level");
  level.addOptions(["Beginner", "Advanced"]);
  level.addToPage(page, { x: 40, y: 140, width: 120, height: 20 });
  const h = helpers({ "form.pdf": await doc.save() });
  const r = await editPdf({ file: "form.pdf", ops: [{ op: "fill", fields: { name: "Amira Hassan", agree: true, level: "Advanced" } }] }, h);
  const filled = (await PDFDocument.load(r.bytes)).getForm();
  assert.equal(filled.getTextField("name").getText(), "Amira Hassan");
  assert.equal(filled.getCheckBox("agree").isChecked(), true);
  assert.deepEqual(filled.getDropdown("level").getSelected(), ["Advanced"]);
  await assert.rejects(editPdf({ file: "form.pdf", ops: [{ op: "fill", fields: { nmae: "x" } }] }, h), /No field named "nmae"\. The fields are: "name", "agree", "level"/);
  await assert.rejects(editPdf({ file: "form.pdf", ops: [{ op: "fill", fields: { level: "Expert" } }] }, h), /"level" takes one of: "Beginner", "Advanced"/);
  const flat = await editPdf({ file: "form.pdf", ops: [{ op: "fill", fields: { name: "Amira Hassan" }, flatten: true }] }, h);
  assert.equal((await PDFDocument.load(flat.bytes)).getForm().getFields().length, 0);
  assert.match((await read(flat.bytes))[0].text, /Amira Hassan/);
});

test("crops are laid out one per page with their caption and source; with no file they make a new PDF of just those figures", async () => {
  const source = new Uint8Array(await fixture("textbook-circuit.pdf"));
  const box: [number, number, number, number] = [126, 383, 477, 541];
  const meta: CropAsset = { id: "crop-0000aaaa", file: "textbook-circuit.pdf", page: 1, box, units: "pt", width: 700, height: 316, vector: true, caption: "Figure 2.4 A series–parallel circuit.", created: 0 };
  const png = await kit.encode(kit.create(10, 10), "image/png");
  const h = helpers({}, { "crop-0000aaaa": { meta, png, pdf: await vectorCrop(source, 1, box) }, "crop-0000bbbb": { meta: { ...meta, id: "crop-0000bbbb", vector: false, units: "px", box: [0, 0, 300, 150], file: "photo.png", page: undefined, caption: undefined }, png } });
  const r = await editPdf({ name: "Circuit figures", ops: [{ op: "crops", assets: ["crop-0000aaaa", "crop-0000bbbb"] }] }, h);
  const pages = await read(r.bytes);
  assert.equal(pages.length, 2);
  assert.match(pages[0].text, /R1 = 4/, "the circuit is vectors");
  assert.match(pages[0].text, /A series–parallel circuit\. Source: textbook-circuit\.pdf, p\. 1\./);
  assert.match(pages[1].text, /Source: photo\.png\./);
  assert.equal(r.spec.source, undefined);
  await assert.rejects(editPdf({ ops: [{ op: "crops", assets: ["crop-0000ffff"] }] }, h), /no crop "crop-0000ffff"/);
});

test("mistakes say which edit and why, and nothing is made", async () => {
  const h = helpers({ "a.pdf": await numbered(2) });
  await assert.rejects(editPdf({ file: "a.pdf", ops: [] }, h), /"ops" must list the edits/);
  await assert.rejects(editPdf({ file: "a.pdf", ops: [{ op: "rotate", pages: "1" }, { op: "explode" }] }, h), /Edit 2 \(explode\): Unknown edit/);
  await assert.rejects(editPdf({ file: "a.pdf", ops: [{ op: "delete", pages: "1-2" }] }, h), /every page/);
  await assert.rejects(editPdf({ file: "a.pdf", ops: [{ op: "delete", pages: "1" }, { op: "note", page: 2, text: "x" }] }, h), /Edit 2 \(note\): "page" must be 1–1/);
  await assert.rejects(editPdf({ file: "missing.pdf", ops: [{ op: "rotate" }] }, h), /No file named "missing\.pdf"/);
  await assert.rejects(editPdf({ file: "a.pdf", ops: [{ op: "reorder", order: [1, 1] }] }, h), /every page once/);
});
