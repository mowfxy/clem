import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFDict } from "pdf-lib";
import { kit, open } from "./pdf-kit.ts";
import { editPdf, type EditHelpers } from "../../desktop/pdf-edit-tools.ts";
import { parseContent, rewriteContent, redactPage, streamBytes, type Box } from "../../desktop/pdf-redact.ts";
import { unsafeSvg } from "../../desktop/svg-safety.ts";
import { excelWorkbook } from "../../desktop/xlsx-workbook.ts";

/** The window's part with pdf.js in Node; the picture of a page is blank (only where it goes matters here). */
const helpers = (files: Record<string, Uint8Array>): EditHelpers => ({
  load: async (ref) => ({ bytes: files[ref], source: "src-00000000-0000-0000-0000-000000000001", name: ref }),
  words: async (bytes, page) => {
    const pdf = await open(bytes);
    try {
      const content = await (await pdf.getPage(page)).getTextContent();
      return (content.items as any[]).filter((i) => i.str).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, size: Math.hypot(i.transform[2], i.transform[3]) }));
    } finally {
      await pdf.loadingTask.destroy();
    }
  },
  crop: async () => undefined,
  raster: async (bytes, page) => {
    const pdf = await open(bytes);
    try {
      const vp = (await pdf.getPage(page)).getViewport({ scale: 1, rotation: 0 });
      const c = kit.create(Math.round(vp.width), Math.round(vp.height)), ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      return kit.encode(c, "image/jpeg", 0.9);
    } finally {
      await pdf.loadingTask.destroy();
    }
  },
});
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
const leaks = (bytes: Uint8Array, word: string) => { const raw = rawText(bytes); return raw.includes(word) || raw.includes(hexOf(word)); };

test("a page turned into a picture leaves nothing of itself in the file, and bookmarks to it go to the picture", async () => {
  const doc = await PDFDocument.create(), ctx = doc.context;
  const page = doc.addPage([400, 300]);
  page.drawText("Patient SECRETNAME", { x: 40, y: 200, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  // A curve across the box: the page cannot be cleaned exactly.
  page.drawEllipse({ x: 120, y: 205, xScale: 60, yScale: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  const outlines = ctx.nextRef(), item = ctx.nextRef();
  ctx.assign(item, ctx.obj({ Title: "Chapter", Parent: outlines, Dest: [page.ref, PDFName.of("Fit")] }));
  ctx.assign(outlines, ctx.obj({ Type: "Outlines", First: item, Last: item, Count: 1 }));
  doc.catalog.set(PDFName.of("Outlines"), outlines);
  const src = await doc.save();
  assert.ok(leaks(src, "SECRETNAME"));
  const r = await editPdf({ file: "a.pdf", ops: [{ op: "redact", page: 1, bbox: [90, 190, 250, 220] }] }, helpers({ "a.pdf": src }));
  assert.match(r.done[0], /turned into a picture/);
  assert.ok(!leaks(r.bytes, "SECRETNAME"), "the old page's content is gone from the file");
  const out = await PDFDocument.load(r.bytes);
  const dest = ((out.catalog.lookup(PDFName.of("Outlines")) as PDFDict).lookup(PDFName.of("First")) as PDFDict).lookup(PDFName.of("Dest")) as PDFArray;
  assert.equal(dest.get(0), out.getPage(0).ref, "the bookmark goes to the page as it is now");
});

test("a form field under the box loses its value even when the page has to become a picture", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]), form = doc.getForm();
  const field = form.createTextField("name");
  field.setText("FIELDSECRET");
  field.addToPage(page, { x: 90, y: 220, width: 200, height: 20 });
  page.drawEllipse({ x: 150, y: 230, xScale: 60, yScale: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  const r = await editPdf({ file: "f.pdf", ops: [{ op: "redact", page: 1, bbox: [85, 215, 295, 245] }] }, helpers({ "f.pdf": await doc.save() }));
  assert.match(r.done[0], /turned into a picture/);
  assert.ok(!leaks(r.bytes, "FIELDSECRET"));
});

test("a rectangle drawn under a turned transform is judged by all four of its corners", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const boxes: Box[] = [];
  const content = new TextEncoder().encode("q 0.7071 0.7071 -0.7071 0.7071 200 100 cm 0 0 100 10 re f Q");
  rewriteContent(doc, content, page.node.Resources(), [1, 0, 0, 1, 0, 0], [0, 0, 400, 300], { glyph: () => true, mark: (b) => { boxes.push(b); return "keep"; }, form: () => "keep" });
  const [x0, y0, x1, y1] = boxes[0];
  assert.ok(Math.abs(x0 - 192.93) < 0.05 && Math.abs(x1 - 270.71) < 0.05 && Math.abs(y0 - 100) < 0.05 && Math.abs(y1 - 177.78) < 0.05, String(boxes[0]));
});

test("a path painted and clipping at once (W f) under the box loses its painting and keeps its clip", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const content = (src: string) => { page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(src))); };
  const after = () => { const c = page.node.Contents()!; const parts = c instanceof PDFArray ? c.asArray().map((_, i) => c.lookup(i)) : [c]; return parts.map((x) => Buffer.from(streamBytes(x)).toString("latin1")).join("\n"); };
  // Wholly under the box: the clip stays, nothing is painted.
  content("q 100 100 50 20 re W f Q");
  redactPage(doc, page, [[90, 90, 200, 130]]);
  assert.deepEqual(parseContent(after()).map((o) => o.op), ["q", "q", "re", "W", "n", "Q", "Q"]);
  // Crossing it: the painting is cut (drawn first, outside the new clip), and the clip stays whole.
  content("q 50 100 200 20 re W f Q");
  redactPage(doc, page, [[100, 90, 150, 130]]);
  const ops = parseContent(after());
  assert.deepEqual(ops.map((o) => o.op), ["q", "q", "m", "l", "l", "l", "h", "m", "l", "l", "l", "h", "f", "re", "W", "n", "Q", "Q"]);
  assert.deepEqual(ops[13].args, [50, 100, 200, 20]);
  // Kept whole when it is clear of the box.
  content("q 100 100 50 20 re W f Q");
  redactPage(doc, page, [[300, 200, 350, 250]]);
  assert.match(after(), /re W f/);
});

test("a content stream ending inside a string's escape is read, not crashed on", () => {
  assert.deepEqual(parseContent("(abc\\").map((o) => o.op), []);
  assert.deepEqual(parseContent("(a) Tj (b\\").map((o) => o.op), ["Tj"]);
});

test("control characters XML cannot hold (a form feed, a vertical tab) do not make a Word file Word refuses", async () => {
  // The Word maker opens Chromium only for figures and pictures of maths: bundled with a stand-in for electron.
  await build({
    stdin: { contents: `export {wordDocument} from "./desktop/docx-document.ts";`, resolveDir: process.cwd(), loader: "ts" },
    outfile: "desktop-dist/audit-documents-test.cjs", bundle: true, platform: "node", format: "cjs", logLevel: "error",
    plugins: [{ name: "electron", setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class BrowserWindow { destroy() {} } export const nativeImage = {};", loader: "js" }));
    } }],
  });
  const { wordDocument } = createRequire(import.meta.url)("../../desktop-dist/audit-documents-test.cjs");
  const bytes = await wordDocument({ title: "Notes\x0b on\x01 circuits", sections: [{ heading: "Ohm\x0cs law", text: "Copied\x0cfrom a PDF:\x0b V = IR.\x00" }] }, { checkVoice: false });
  const xml = strFromU8(unzipSync(new Uint8Array(bytes))["word/document.xml"]);
  assert.doesNotMatch(xml, /[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  assert.match(xml, /V = IR\./);
});

test("a drawing cannot slip a script, an embedded page or a javascript: link past the check with a namespace prefix or an animation", () => {
  for (const bad of [
    '<svg xmlns:x="http://www.w3.org/2000/svg"><x:script>alert(1)</x:script></svg>',
    '<svg><svg:foreignObject xmlns:svg="http://www.w3.org/2000/svg"/></svg>',
    '<svg><h:iframe xmlns:h="http://www.w3.org/1999/xhtml" srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/></svg>',
    '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>',
    "<svg><a><set attributeName='xlink:href' to='javascript:alert(1)'/></a></svg>",
  ]) assert.equal(unsafeSvg.test(bad), true, bad);
  // Animating anything else, and a text that merely mentions a script, stay fine.
  for (const ok of ['<svg><rect><animate attributeName="opacity" values="0;1"/></rect></svg>', "<svg><text>the script: on stage</text></svg>"])
    assert.equal(unsafeSvg.test(ok), false, ok);
});

test("a workbook whose totals name no columns is answered with what totals must be, not a crash", () => {
  assert.throws(() => excelWorkbook({ sheets: [{ name: "S", columns: [{ header: "A" }], rows: [[1]], totals: { label: "Total" } as any }] }), /"totals" must be \{"label"\?, "columns"/);
  assert.ok(excelWorkbook({ sheets: [{ name: "S", columns: [{ header: "A" }], rows: [[1]], totals: { columns: { A: "sum" } } }] }).length > 0);
});

test("sheet names Excel would repair (edge apostrophes, the reserved History) are refused", () => {
  for (const name of ["'Q1", "Q1'", "History", "history"])
    assert.throws(() => excelWorkbook({ sheets: [{ name, columns: [{ header: "A" }], rows: [[1]] }] }), /not be "History"/);
  assert.ok(excelWorkbook({ sheets: [{ name: "Q1's plan", columns: [{ header: "A" }], rows: [[1]] }] }).length > 0);
});

test("a redacted page keeps no thumbnail of itself and no editor's private copy of its content", async () => {
  const doc = await PDFDocument.create(), ctx = doc.context;
  const page = doc.addPage([400, 300]);
  page.drawText("Patient SECRETNAME", { x: 40, y: 200, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  page.node.set(PDFName.of("Thumb"), ctx.register(ctx.stream("THUMB-SECRETNAME", { Width: 1, Height: 1, ColorSpace: "DeviceGray", BitsPerComponent: 8 })));
  page.node.set(PDFName.of("PieceInfo"), ctx.obj({ Illustrator: ctx.obj({ Private: ctx.register(ctx.stream("AI-SECRETNAME")) }) }));
  const r = await editPdf({ file: "t.pdf", ops: [{ op: "redact", page: 1, find: "SECRETNAME" }] }, helpers({ "t.pdf": await doc.save() }));
  assert.ok(!leaks(r.bytes, "SECRETNAME"));
});
