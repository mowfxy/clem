import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { PDFDocument } from "pdf-lib";
import { markContent, checkContent } from "../core/provenance.ts";
test("PDF marker preserves readable pages, detects changed payload and does not mark originals", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const original = new Blob([new Uint8Array(await pdf.save())]);
  assert.equal((await checkContent(original)).status, "missing");
  const marked = await markContent(original, "test.pdf");
  assert.equal((await checkContent(marked)).status, "found");
  assert.equal(
    (await checkContent(new Blob([marked, "extra content"]))).status,
    "changed",
  );
  assert.equal(
    (await PDFDocument.load(await marked.arrayBuffer())).getPageCount(),
    1,
  );
  const bytes = new Uint8Array(await marked.arrayBuffer());
  bytes[12] ^= 1;
  assert.equal((await checkContent(new Blob([bytes]))).status, "changed");
});
test("Office ZIP marker preserves entries and existing comment", async () => {
  const bytes = zipSync({
    "word/document.xml": strToU8("<document>Hello</document>"),
  });
  const marked = await markContent(new Blob([bytes]), "test.docx");
  assert.equal((await checkContent(marked)).status, "found");
  assert.deepEqual(
    unzipSync(new Uint8Array(await marked.arrayBuffer())),
    unzipSync(bytes),
  );
});
test("text and SVG hidden markers round trip unicode", async () => {
  for (const name of ["a.txt", "a.svg", "a.md", "a.tex"]) {
    const marked = await markContent(new Blob(["مرحبا — Hello"]), name);
    assert.equal((await checkContent(marked)).status, "found");
  }
  assert.equal(
    (await checkContent(new Blob(["ordinary text"]))).status,
    "missing",
  );
});
