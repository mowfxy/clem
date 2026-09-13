/**
 * Tests for the PDF emitter.
 *
 * Validates structural correctness and round-trip with the PDF parser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { PdfBuilder, LETTER, A4, BLACK, RED, BLUE } from "../../src/pdf/pdf.js";
import { ingestPdf } from "../../src/ingest/pdf.js";

function rawStreamBytes(allBytes, matchStart, matchLen) {
  const after = matchStart + "stream\n".length;
  const end = matchStart + matchLen - "\nendstream".length;
  return allBytes.subarray(after, end);
}

function countInDecompressedStreams(allBytes, needle) {
  // Walk the file line-by-line. A stream begins on a line whose first token is `stream`
  // (preceded only by whitespace) and ends on a line that begins with `endstream`.
  // This avoids matching the `stream` suffix inside `endstream`.
  const buf = Buffer.from(allBytes);
  const lines = buf.toString("binary").split("\n");
  let inStream = false;
  let streamBytes: number[] = [];
  let total = 0;
  // The Kinetra emitter writes text as UTF-16BE inside <feff...>Tj hex strings.
  // Search both the raw decompressed bytes and the UTF-16BE hex form of `needle`.
  const utf16beHex = Buffer.from(needle, "utf16le").swap16().toString("hex");
  for (const line of lines) {
    if (!inStream) {
      if (/^stream\s*$/.test(line)) { inStream = true; streamBytes = []; }
      continue;
    }
    if (/^endstream\s*$/.test(line)) {
      let decompressed: Buffer;
      try { decompressed = inflateSync(Buffer.from(streamBytes)); }
      catch (_e) { decompressed = Buffer.from(streamBytes); }
      const text = decompressed.toString("binary");
      // Count needle occurrences in the text and its UTF-16BE hex encoding.
      total += countOccurrences(text, needle);
      total += countOccurrences(text, utf16beHex);
      inStream = false;
      continue;
    }
    for (let i = 0; i < line.length; i++) streamBytes.push(line.charCodeAt(i) & 0xff);
    streamBytes.push(0x0a);
  }
  return total;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    n++;
    from = i + Math.max(1, needle.length);
  }
  return n;
}

test("pdf: emits a valid PDF header and trailer", () => {
  const doc = new PdfBuilder({ metadata: { title: "Test" }, compress: false });
  doc.addPage();
  const bytes = doc.build();
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  assert.equal(head, "%PDF-1.4");
  const tail = new TextDecoder("latin1").decode(bytes.subarray(bytes.length - 6));
  assert.equal(tail, "%%EOF\n");
});

test("pdf: catalog and pages object exist", () => {
  const doc = new PdfBuilder({ compress: false });
  doc.addPage();
  doc.addPage();
  doc.addPage();
  const bytes = doc.build();
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.includes("/Type /Catalog"));
  assert.ok(s.includes("/Type /Pages"));
  assert.ok(s.includes("/Count 3"));
});

test("pdf: standard fonts are declared", () => {
  const doc = new PdfBuilder({ compress: false });
  doc.addPage();
  const bytes = doc.build();
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.includes("/BaseFont /Helvetica"));
  assert.ok(s.includes("/BaseFont /Helvetica-Bold"));
  assert.ok(s.includes("/BaseFont /Times-Roman"));
  assert.ok(s.includes("/BaseFont /Courier"));
});

test("pdf: text emits a content stream with BT/Tj operators", () => {
  const doc = new PdfBuilder({ compress: false });
  const p = doc.addPage();
  p.text("Hello world", { x: 50, y: 750, fontSize: 12 });
  const bytes = doc.build();
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.includes("BT"));
  assert.ok(s.includes("ET"));
  assert.ok(s.includes("Tj"));
  assert.ok(s.includes("<feff"));
});

test("pdf: line operator appears in content stream", () => {
  const doc = new PdfBuilder({ compress: false });
  const p = doc.addPage();
  p.line({ from: { x: 10, y: 20 }, to: { x: 100, y: 200 }, color: RED, lineWidth: 2 });
  const bytes = doc.build();
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.includes("10 20 m"));
  assert.ok(s.includes("100 200 l"));
  assert.ok(s.includes("S"));
});

test("pdf: rect draws with re operator", () => {
  const doc = new PdfBuilder({ compress: false });
  const p = doc.addPage();
  p.rect({ x: 10, y: 20, width: 100, height: 50, fill: BLUE });
  const bytes = doc.build();
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.includes("10 20 100 50 re"));
  assert.ok(s.includes("f"));
});

test("pdf: compressed stream decodes to expected content", () => {
  const doc = new PdfBuilder({ compress: true });
  const p = doc.addPage();
  p.text("Compressed test", { x: 50, y: 750, fontSize: 14 });
  p.line({ from: { x: 50, y: 700 }, to: { x: 562, y: 700 } });
  const bytes = doc.build();
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.includes("/FlateDecode"));
  const m = /stream\n([\s\S]*?)\nendstream/.exec(s);
  assert.ok(m, "expected a stream block");
  const inflated = inflateSync(rawStreamBytes(bytes, m.index, m[0].length));
  const content = new TextDecoder("latin1").decode(inflated);
  assert.ok(content.includes("BT"));
  assert.ok(content.includes("Tj"));
  assert.ok(content.includes("50 700 m"));
});

test("pdf: deterministic output for same input", () => {
  function make() {
    const doc = new PdfBuilder({ metadata: { title: "Det" }, compress: true });
    const p = doc.addPage();
    p.text("Same", { x: 50, y: 750, fontSize: 12 });
    p.line({ from: { x: 10, y: 20 }, to: { x: 100, y: 200 } });
    return doc.build();
  }
  const a = make();
  const b = make();
  assert.equal(a.length, b.length);
  assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
});

test("pdf: empty document builds successfully", () => {
  const doc = new PdfBuilder();
  const bytes = doc.build();
  assert.ok(bytes.length > 0);
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.startsWith("%PDF-"));
  assert.ok(s.includes("%%EOF"));
});

test("pdf: page sizes can be customized", () => {
  const doc1 = new PdfBuilder({ pageSize: LETTER });
  const p1 = doc1.addPage();
  assert.equal(p1.width, 612);
  assert.equal(p1.height, 792);

  const doc2 = new PdfBuilder({ pageSize: A4 });
  const p2 = doc2.addPage();
  assert.equal(p2.width, 595);
  assert.equal(p2.height, 842);

  const p3 = doc2.addPage({ width: 200, height: 300 });
  assert.equal(p3.width, 200);
  assert.equal(p3.height, 300);
});

test("pdf: metadata in info dict", () => {
  const doc = new PdfBuilder({
    metadata: {
      title: "Lecture 1",
      author: "Kinetra",
      subject: "Digital Logic",
      keywords: "K-map, boolean",
    },
    compress: false,
  });
  doc.addPage();
  const bytes = doc.build();
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.includes("/Title (Lecture 1)"));
  assert.ok(s.includes("/Author (Kinetra)"));
  assert.ok(s.includes("/Subject (Digital Logic)"));
  assert.ok(s.includes("/Keywords (K-map, boolean)"));
});

test("pdf: round-trip via ingestPdf", () => {
  const doc = new PdfBuilder({ compress: true });
  const p = doc.addPage();
  p.text("Karnaugh maps simplify Boolean expressions", { x: 50, y: 750, fontSize: 12 });
  p.text("Groups wrap around edges", { x: 50, y: 720, fontSize: 12 });
  const bytes = doc.build();
  const parsed = ingestPdf(bytes, "round-trip");
  assert.equal(parsed.pages.length, 1);
  const t = parsed.pages.map((pg) => pg.text).join("\n");
  assert.ok(t.includes("Karnaugh"), "got: " + t);
  assert.ok(t.includes("Groups"), "got: " + t);
});

test("pdf: xref offsets are correct", () => {
  const doc = new PdfBuilder({ compress: false });
  doc.addPage();
  const bytes = doc.build();
  const s = new TextDecoder("latin1").decode(bytes);
  const m = /startxref\n(\d+)\n%%EOF/.exec(s);
  assert.ok(m, "expected startxref");
  const xrefOffset = parseInt(m[1], 10);
  assert.equal(s.indexOf("xref"), xrefOffset);
});

test("pdf: polyline and polygon", () => {
  const doc = new PdfBuilder({ compress: false });
  const p = doc.addPage();
  p.polyline([{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }], { color: RED, lineWidth: 1 });
  p.polygon([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 86 }], { fill: BLUE });
  const bytes = doc.build();
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.includes("0 0 m"));
  assert.ok(s.includes("50 50 l"));
  assert.ok(s.includes("100 0 l"));
  assert.ok(s.includes(" f\n") || s.includes(" f"));
});

test("pdf: multiple pages", () => {
  const doc = new PdfBuilder({ compress: true });
  const p1 = doc.addPage();
  p1.text("Page 1", { x: 50, y: 750, fontSize: 12 });
  const p2 = doc.addPage();
  p2.text("Page 2", { x: 50, y: 750, fontSize: 12 });
  const p3 = doc.addPage();
  p3.text("Page 3", { x: 50, y: 750, fontSize: 12 });
  const bytes = doc.build();
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.includes("/Count 3"));
  const count = countInDecompressedStreams(bytes, "Page ");
  assert.ok(count >= 3, "expected 'Page ' at least 3 times, got " + count);
});
