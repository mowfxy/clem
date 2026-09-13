/**
 * Tests for ingest/chunk.ts (structure-aware chunking).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, chunkMarkdown, chunkPdf } from "../../src/ingest/chunk.js";
import { ingestText } from "../../src/ingest/text.js";
import { ingestMarkdown } from "../../src/ingest/markdown.js";
import type { PdfDocument, PdfPage } from "../../src/ingest/pdf.js";

test("chunkText: short doc is one chunk", () => {
  const doc = ingestText("Hello, world!\nLine two.");
  const chunks = chunkText(doc);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].text.includes("Hello"));
});

test("chunkText: long doc splits into multiple chunks", () => {
  const long = Array.from({ length: 200 }, (_, i) => "Line " + i + " with some text content.").join("\n");
  const doc = ingestText(long);
  const chunks = chunkText(doc, { maxChars: 200, overlapChars: 0, minChars: 50 });
  assert.ok(chunks.length > 1, "long doc should produce multiple chunks, got " + chunks.length);
});

test("chunkText: chunks have stable sourceId", () => {
  const doc = ingestText("a\nb\nc\nd\ne\nf\ng\nh");
  const chunks = chunkText(doc);
  for (const c of chunks) assert.equal(c.sourceId, doc.sourceId);
});

test("chunkText: line ranges are valid", () => {
  const doc = ingestText("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl");
  const chunks = chunkText(doc, { maxChars: 5, overlapChars: 0, minChars: 1 });
  for (const c of chunks) {
    assert.ok(c.startLine >= 0 && c.endLine <= 12);
    assert.ok(c.startLine < c.endLine, "start < end");
  }
});

test("chunkText: respects minChars (merges tiny chunks)", () => {
  const doc = ingestText("a\nb\nc\n\nd\ne\nf");
  const chunks = chunkText(doc, { maxChars: 1000, minChars: 100 });
  // All text is short, so chunks may be 1, and may contain merged content.
  assert.ok(chunks.length >= 1);
  // Total chars across all chunks should not lose content.
  const total = chunks.map(c => c.text).join("\n");
  assert.ok(total.includes("a") && total.includes("f"));
});

test("chunkMarkdown: section becomes heading", () => {
  const md = ingestMarkdown("# Intro\n\nThis is the intro.\n\n# Body\n\nThis is the body.");
  const chunks = chunkMarkdown(md);
  assert.ok(chunks.length >= 2);
  // Each chunk should have a heading.
  for (const c of chunks) assert.ok(typeof c.heading === "string" && c.heading.length > 0);
});

test("chunkMarkdown: nested sections get depth > 0", () => {
  const md = ingestMarkdown("# Top\n\n## Sub\n\nNested content.\n");
  const chunks = chunkMarkdown(md);
  const sub = chunks.find(c => c.heading.toLowerCase().includes("sub"));
  assert.ok(sub, "should have a sub-section chunk");
  assert.ok(sub!.depth >= 1, "depth should be >= 1, got " + sub!.depth);
});

test("chunkPdf: page-aware chunking", () => {
  const doc: PdfDocument = {
    sourceId: "src-pdf",
    title: "Test PDF",
    pages: [
      { page: 1, text: "Page one content with Karnaugh map details." },
      { page: 2, text: "Page two content about flip-flops and latches." },
    ],
    warnings: [],
    createdAt: new Date().toISOString(),
    byteLength: 100,
  };
  const chunks = chunkPdf(doc, { maxChars: 50, minChars: 1 });
  assert.ok(chunks.length >= 1);
  // Page number is preserved in heading somewhere or chunk carries the page.
  for (const c of chunks) {
    assert.ok(c.text.length > 0);
  }
});

test("chunkPdf: round-trip preserves page text", () => {
  const doc: PdfDocument = {
    sourceId: "x",
    pages: [
      { page: 1, text: "AAA BBB CCC DDD" },
      { page: 2, text: "EEE FFF GGG HHH" },
      { page: 3, text: "III JJJ KKK LLL" },
    ],
    warnings: [],
    createdAt: new Date().toISOString(),
    byteLength: 0,
  };
  const chunks = chunkPdf(doc, { maxChars: 12, minChars: 1, overlapChars: 0 });
  const all = chunks.map(c => c.text).join(" ");
  // All three pages' words should appear somewhere in the chunk text.
  for (const word of ["AAA", "EEE", "III"]) {
    assert.ok(all.includes(word), "expected " + word + " to appear in chunks");
  }
});
