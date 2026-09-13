/**
 * Tests for ingest/pdf.ts.
 *
 * Builds minimal valid PDFs and verifies Kinetra ingests them correctly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { ingestPdf } from "../../src/ingest/pdf.js";

/** Build a minimal one-page PDF with a single BT..ET text block. */
function buildOnePagePdf(text: string): Uint8Array {
  // Use special content that doesn't contain "1 0 R" / "3 0 R" / "4 0 R" /
  // similar xref patterns that could confuse the page-tree parser.
  const content = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const compressed = deflateSync(Buffer.from(content, "latin1"));
  // Use object numbers far from text patterns (e.g. 100, 200, 300).
  const objects: string[] = [];
  objects.push("100 0 obj<</Type /Catalog /Pages 200 0 R>>endobj");
  objects.push("200 0 obj<</Type /Pages /Kids [300 0 R] /Count 1>>endobj");
  objects.push("300 0 obj<</Type /Page /Parent 200 0 R /MediaBox [0 0 612 792] /Contents 400 0 R>>endobj");
  objects.push(`400 0 obj<</Length ${compressed.length} /Filter /FlateDecode>>stream\n${Buffer.from(compressed).toString("latin1")}\nendstream\nendobj`);
  const header = "%PDF-1.4\n";
  const body = objects.join("\n");
  const xrefStart = header.length + body.length + 1;
  let xref = "xref\n0 401\n0000000000 65535 f \n";
  for (let i = 1; i <= 400; i++) xref += "0000000000 00000 n \n";
  const trailer = `trailer<</Size 401 /Root 100 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  const pdf = header + body + "\n" + xref + trailer;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

test("ingestPdf: rejects non-PDF bytes", () => {
  assert.throws(() => ingestPdf(new Uint8Array(Buffer.from("hello world"))), /header|parse/i);
});

test("ingestPdf: rejects empty bytes", () => {
  assert.throws(() => ingestPdf(new Uint8Array()), /empty|parse/i);
});

test("ingestPdf: ingests one-page PDF and extracts text", () => {
  const pdf = buildOnePagePdf("Karnaugh map minimization");
  const doc = ingestPdf(pdf, "Test");
  assert.equal(doc.title, "Test");
  assert.equal(doc.pages.length, 1);
  const t = doc.pages[0].text;
  assert.ok(t.includes("Karnaugh") || t.includes("minimization"), "expected text from page, got: " + t);
});

test("ingestPdf: sourceId is content hash, stable across calls", () => {
  const pdf = buildOnePagePdf("stable hash test");
  const a = ingestPdf(pdf);
  const b = ingestPdf(pdf);
  assert.equal(a.sourceId, b.sourceId);
  assert.equal(a.sourceId.length, 64);
});

test("ingestPdf: byteLength matches input", () => {
  const pdf = buildOnePagePdf("byte length test");
  const doc = ingestPdf(pdf);
  assert.equal(doc.byteLength, pdf.byteLength);
});

test("ingestPdf: page numbers are 1-based and ordered", () => {
  const pdf = buildOnePagePdf("single page test");
  const doc = ingestPdf(pdf);
  for (let i = 0; i < doc.pages.length; i++) {
    assert.equal(doc.pages[i].page, i + 1, "pages must be 1-based and contiguous");
  }
});

test("ingestPdf: handles PDF with no text content (graphics-only)", () => {
  // Build a PDF whose content stream has no text operators.
  const content = "q 0 0 612 792 re f Q"; // graphics only
  const compressed = deflateSync(Buffer.from(content, "latin1"));
  const objects = [
    "100 0 obj<</Type /Catalog /Pages 200 0 R>>endobj",
    "200 0 obj<</Type /Pages /Kids [300 0 R] /Count 1>>endobj",
    "300 0 obj<</Type /Page /Parent 200 0 R /MediaBox [0 0 612 792] /Contents 400 0 R>>endobj",
    `400 0 obj<</Length ${compressed.length} /Filter /FlateDecode>>stream\n${Buffer.from(compressed).toString("latin1")}\nendstream\nendobj`,
  ];
  const header = "%PDF-1.4\n";
  const body = objects.join("\n");
  const xrefStart = header.length + body.length + 1;
  let xref = "xref\n0 401\n0000000000 65535 f \n";
  for (let i = 1; i <= 400; i++) xref += "0000000000 00000 n \n";
  const trailer = `trailer<</Size 401 /Root 100 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  const pdf = new Uint8Array(Buffer.from(header + body + "\n" + xref + trailer, "latin1"));
  const doc = ingestPdf(pdf);
  assert.equal(doc.pages.length, 1);
  // Graphics-only content should yield no text. Either empty string or a warning.
  assert.ok(doc.pages[0].text === "" || doc.warnings.length > 0);
});

test("ingestPdf: createdAt is a valid ISO timestamp", () => {
  const pdf = buildOnePagePdf("timestamp test");
  const doc = ingestPdf(pdf);
  assert.ok(!isNaN(Date.parse(doc.createdAt)), "createdAt must be valid ISO 8601");
});
