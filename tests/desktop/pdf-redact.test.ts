import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFString, PDFHexString, PDFDict, PDFArray, PDFStream, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { kit, lib, fixture, open } from "./pdf-kit.ts";
import { editPdf, type EditHelpers, type Box } from "../../desktop/pdf-edit-tools.ts";
import { parseContent, redactPage, collectGarbage, streamBytes, Unclean } from "../../desktop/pdf-redact.ts";
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

/** Every string of a file, decoded as PDF reads it (UTF-16 included), and every stream's text. */
async function everyText(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes), out: string[] = [rawText(bytes)];
  const visit = (v: unknown): void => {
    if (v instanceof PDFString || v instanceof PDFHexString) out.push(v.decodeText());
    else if (v instanceof PDFName) out.push(v.decodeText());
    else if (v instanceof PDFDict) for (const [k, x] of v.entries()) { visit(k); visit(x); }
    else if (v instanceof PDFArray) v.asArray().forEach(visit);
    else if (v instanceof PDFStream) { visit(v.dict); try { out.push(Buffer.from(v instanceof PDFRawStream ? (v.dict.has(PDFName.of("Filter")) ? decodePDFRawStream(v).decode() : v.contents) : (v as any).getContents()).toString("utf8")); } catch { /* unreadable */ } }
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) visit(obj);
  return out.join("\n");
}

test("redacted words are cleaned from bookmarks, properties, XMP, tags, comments and named destinations too", async () => {
  const doc = await PDFDocument.create(), ctx = doc.context;
  const page = doc.addPage([400, 300]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Patient: Amira Hassan", { x: 40, y: 200, size: 14, font: f });
  page.drawText("Seen on 3 March.", { x: 40, y: 150, size: 14, font: f });
  doc.setTitle("Notes on Amira Hassan");
  doc.getInfoDict().set(PDFName.of("Author"), PDFString.of("AMIRA  hassan's doctor"));
  doc.setSubject("Clinic");
  const target = ctx.register(ctx.obj([page.ref, PDFName.of("XYZ"), null, null, null]));
  const outlines = ctx.nextRef(), item = ctx.nextRef();
  ctx.assign(item, ctx.obj({ Title: PDFString.of("Amira Hassan, first visit"), Parent: outlines, Dest: PDFHexString.fromText("amira hassan") }));
  ctx.assign(outlines, ctx.obj({ Type: "Outlines", First: item, Last: item, Count: 1 }));
  doc.catalog.set(PDFName.of("Outlines"), outlines);
  doc.catalog.set(PDFName.of("Names"), ctx.obj({ Dests: ctx.obj({ Names: [PDFHexString.fromText("amira hassan"), target, PDFString.of("zz-other"), target] }) }));
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Keywords="amira hassan; clinic"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Notes on Amira&#32;Hassan &amp; co</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  doc.catalog.set(PDFName.of("Metadata"), ctx.register(ctx.stream(Buffer.from(xmp, "utf8"), { Type: "Metadata", Subtype: "XML" })));
  const elem = ctx.register(ctx.obj({ Type: "StructElem", S: "Figure", Alt: PDFHexString.fromText("Photo of Amira Hassan"), ActualText: PDFString.of("Amira Hassan"), Pg: page.ref }));
  doc.catalog.set(PDFName.of("StructTreeRoot"), ctx.obj({ Type: "StructTreeRoot", K: ctx.obj([ctx.obj({ S: "Document", K: elem })]) }));
  page.node.set(PDFName.of("Annots"), ctx.obj([ctx.register(ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [300, 50, 318, 68], Contents: PDFHexString.fromText("Call Amira Hassan back"), T: PDFString.of("Reviewer") }))]));
  // A link away from the box whose address holds the name, written as addresses write it, with another chained after it.
  const next = ctx.obj({ S: "URI", URI: PDFString.of("https://clinic.example/patients/Amira%20Hassan") });
  (page.node.lookup(PDFName.of("Annots")) as PDFArray).push(ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [40, 140, 140, 160], A: ctx.obj({ S: "URI", URI: PDFString.of("mailto:amira.hassan@clinic.example"), Next: next }) })));
  const src = await doc.save();
  // The name's box only: what pdf.js reads there is what is cleaned elsewhere.
  const r = await editPdf({ file: "n.pdf", ops: [{ op: "redact", page: 1, bbox: [95, 195, 200, 216] }] }, helpers({ "n.pdf": src }));
  assert.match(r.done[0], /also removed from 1 bookmark, the document title and author, the XMP metadata, 1 tagged element, 1 comment, 1 link and 1 named destination$/);
  // The addresses stay valid: the name percent-encoded as █, the rest as it was.
  const annots = (await PDFDocument.load(r.bytes)).getPage(0).node.lookup(PDFName.of("Annots")) as PDFArray;
  const action = annots.asArray().map((_, i) => annots.lookup(i) as PDFDict).find((a) => a.lookup(PDFName.of("Subtype")) === PDFName.of("Link"))!.lookup(PDFName.of("A")) as PDFDict;
  const address = (a: PDFDict) => Buffer.from((a.lookup(PDFName.of("URI")) as PDFHexString).asBytes()).toString("latin1");
  assert.equal(address(action), "mailto:" + "%E2%96%88".repeat(12) + "@clinic.example");
  assert.equal(address(action.lookup(PDFName.of("Next")) as PDFDict), "https://clinic.example/patients/" + "%E2%96%88".repeat(14));
  const all = await everyText(r.bytes);
  assert.doesNotMatch(all, /amira|hassan/i, "the name is in no string or stream of the file");
  assert.ok(!all.includes(hexOf("Amira")) && !all.includes(Buffer.from("﻿Amira", "utf16le").swap16().toString("hex").toUpperCase()));
  assert.match(await textOf(r.bytes), /Patient:[\s\S]*Seen on 3 March\./, "the rest of the page is still text");
  const out = await PDFDocument.load(r.bytes);
  assert.equal(out.getTitle(), "Notes on ████████████", "the same length, the rest of the title kept");
  assert.equal(out.getSubject(), "Clinic");
  assert.match((out.getInfoDict().lookup(PDFName.of("Author")) as PDFHexString).decodeText(), /^█{13}'s doctor$/, "across case and doubled spaces");
  // The XMP is still XML, its markup and entities intact.
  const meta = all.match(/<\?xpacket begin="﻿"[\s\S]*?end="w"\?>/)![0];
  assert.match(meta, /pdf:Keywords="█{12}; clinic"/);
  assert.match(meta, /<rdf:li xml:lang="x-default">Notes on █{12} &amp; co<\/rdf:li>/);
  // The bookmark still goes to the destination, renamed with it.
  const first = (out.catalog.lookup(PDFName.of("Outlines")) as PDFDict).lookup(PDFName.of("First")) as PDFDict;
  const names = ((out.catalog.lookup(PDFName.of("Names")) as PDFDict).lookup(PDFName.of("Dests")) as PDFDict).lookup(PDFName.of("Names")) as PDFArray;
  assert.equal((first.lookup(PDFName.of("Dest")) as PDFHexString).decodeText(), "█".repeat(12));
  assert.deepEqual(names.asArray().filter((_, i) => i % 2 === 0).map((k) => (k as PDFString).decodeText()), ["zz-other", "█".repeat(12)], "kept in byte order");
  // A box with no text under it leaves the rest of the file alone.
  const empty = await editPdf({ file: "n.pdf", ops: [{ op: "redact", page: 1, bbox: [40, 40, 100, 80] }] }, helpers({ "n.pdf": src }));
  assert.doesNotMatch(empty.done[0], /also removed/);
  assert.equal((await PDFDocument.load(empty.bytes)).getTitle(), "Notes on Amira Hassan");
});

/** Every point of every path on page 1, in page space (forms aside). */
async function pathPoints(bytes: Uint8Array) {
  const page = (await PDFDocument.load(bytes)).getPage(0), contents = page.node.Contents()!;
  const parts = contents instanceof PDFArray ? contents.asArray().map((_, i) => contents.lookup(i)) : [contents];
  const src = parts.map((p) => Buffer.from(streamBytes(p)).toString("latin1")).join("\n");
  type M = [number, number, number, number, number, number];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [], out: [number, number][] = [];
  const at = (x: number, y: number): [number, number] => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  for (const { op, args } of parseContent(src)) {
    const v = args.map(Number);
    if (op === "q") stack.push(ctm);
    else if (op === "Q") ctm = stack.pop() ?? ctm;
    else if (op === "cm") { const n = ctm; ctm = [v[0] * n[0] + v[1] * n[2], v[0] * n[1] + v[1] * n[3], v[2] * n[0] + v[3] * n[2], v[2] * n[1] + v[3] * n[3], v[4] * n[0] + v[5] * n[2] + n[4], v[4] * n[1] + v[5] * n[3] + n[5]]; }
    else if (op === "re") out.push(at(v[0], v[1]), at(v[0] + v[2], v[1]), at(v[0], v[1] + v[3]), at(v[0] + v[2], v[1] + v[3]));
    else if ("mlcvy".includes(op) && op.length === 1) for (let i = 0; i + 1 < v.length; i += 2) out.push(at(v[i], v[i + 1]));
  }
  return out;
}

test("a ruled table crossing the box is cut at its edge, as vectors: no line goes on under the fill and nothing outside moves", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const f = await doc.embedFont(StandardFonts.Helvetica), ink = rgb(0, 0, 0);
  // A header row filled and ruled (fill and stroke at once), the table's frame, its rules, and a name in one cell.
  page.drawRectangle({ x: 50, y: 180, width: 300, height: 40, color: rgb(0.85, 0.85, 0.85), borderColor: ink, borderWidth: 1 });
  page.drawRectangle({ x: 50, y: 60, width: 300, height: 160, borderColor: ink, borderWidth: 1.5 });
  for (const x of [150, 250]) page.drawLine({ start: { x, y: 60 }, end: { x, y: 220 }, thickness: 1, color: ink });
  for (const y of [100, 140]) page.drawLine({ start: { x: 50, y }, end: { x: 350, y }, thickness: 0.75, color: ink });
  page.drawText("Amira Hassan", { x: 160, y: 155, size: 12, font: f });
  page.drawText("Name", { x: 60, y: 195, size: 12, font: f });
  page.drawText("Kept row", { x: 60, y: 75, size: 12, font: f });
  const src = await doc.save();
  const box: Box = [140, 120, 260, 200];
  const r = await editPdf({ file: "t.pdf", ops: [{ op: "redact", page: 1, bbox: box }] }, helpers({ "t.pdf": src }));
  assert.doesNotMatch(r.done[0], /picture/);
  assert.equal([...Buffer.from(r.bytes).toString("latin1").matchAll(/\/Subtype\s*\/Image/g)].length, 0, "the page has no picture");
  const text = await textOf(r.bytes);
  assert.ok(!/Amira|Hassan/.test(text) && /Name/.test(text) && /Kept row/.test(text), text);
  const points = await pathPoints(r.bytes);
  // The fill drawn over the box is itself a path: it is the only one with points on its corners and none inside.
  const stray = points.filter(([x, y]) => x > box[0] + 1e-3 && x < box[2] - 1e-3 && y > box[1] + 1e-3 && y < box[3] - 1e-3);
  assert.deepEqual(stray, [], "no path point lies inside the box");
  assert.ok(points.some(([x, y]) => Math.abs(x - 150) < 1e-3 && Math.abs(y - 120) < 1e-3), "the rule stops at the box's edge");
  const { outside, black } = await compare(src, r.bytes, [box]);
  assert.ok(outside < 20, `${outside} pixels changed outside the box`);
  assert.ok(black > 0.97);
});

const make = async (draw: (p: ReturnType<PDFDocument["addPage"]>) => void) => { const d = await PDFDocument.create(); draw(d.addPage([400, 300])); return d.save(); };

test("dashed lines crossing the box are cut too, each piece's dashes falling where they fell", async () => {
  const box: Box = [143, 121, 257, 200];
  const src = await make((p) => {
    p.drawLine({ start: { x: 50, y: 160 }, end: { x: 350, y: 160 }, thickness: 2, dashArray: [7, 3], dashPhase: 2 });
    // A closed outline whose start corner is outside the box, and a pattern of odd length (it repeats with dash and gap swapped).
    p.drawRectangle({ x: 60, y: 90, width: 280, height: 60, borderColor: rgb(0, 0, 0), borderWidth: 2, borderDashArray: [5] });
  });
  const r = await editPdf({ file: "d.pdf", ops: [{ op: "redact", page: 1, bbox: box }] }, helpers({ "d.pdf": src }));
  assert.doesNotMatch(r.done[0], /picture/);
  assert.deepEqual((await pathPoints(r.bytes)).filter(([x, y]) => x > box[0] + 1e-3 && x < box[2] - 1e-3 && y > box[1] + 1e-3 && y < box[3] - 1e-3), []);
  const { outside, black } = await compare(src, r.bytes, [box]);
  assert.ok(outside < 20, `${outside} pixels changed outside the box`);
  assert.ok(black > 0.97);
});

test("a drawing that cannot be cut exactly (turned, curved) still makes the page a picture", async () => {
  const box: Box = [140, 120, 260, 200];
  const turned = await make((p) => p.drawRectangle({ x: 100, y: 100, width: 120, height: 60, rotate: degrees(30), borderColor: rgb(0, 0, 0), borderWidth: 1 }));
  const curve = await make((p) => p.drawEllipse({ x: 140, y: 160, xScale: 60, yScale: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 }));
  for (const [name, src] of Object.entries({ turned, curve })) {
    const r = await editPdf({ file: "d.pdf", ops: [{ op: "redact", page: 1, bbox: box }] }, helpers({ "d.pdf": src }));
    assert.match(r.done[0], /turned into a picture/, name);
  }
  // Straight lines only partly under the box under a plain transform are cut, not turned into a picture.
  const plain = await make((p) => p.drawLine({ start: { x: 50, y: 160 }, end: { x: 350, y: 160 }, thickness: 1 }));
  assert.doesNotMatch((await editPdf({ file: "d.pdf", ops: [{ op: "redact", page: 1, bbox: box }] }, helpers({ "d.pdf": plain }))).done[0], /picture/);
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
