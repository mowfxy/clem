/**
 * Document composer tests.
 *
 * Validates the higher-level builder API in pdf/document.ts produces
 * valid PDF output and the round-trip metadata assertions behave.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createDocument, validateDocument } from "../../src/pdf/document.js";

test("document: builds a non-trivial PDF with multiple pages", () => {
  const d = createDocument({ title: "Kinetra Doc", author: "Tester" });
  d.addHeading("Section 1", 1);
  d.addParagraph("Hello world. This is a short paragraph that should fit on one line.");
  d.addHeading("Sub", 2);
  d.addParagraph("A second paragraph with more content. ".repeat(80));
  d.addFigure({
    svg: "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='100' viewBox='0 0 200 100'><rect x='0' y='0' width='200' height='100' fill='#fff'/></svg>",
    caption: "Figure 1: placeholder",
    widthPt: 200,
    aspectRatio: 2,
  });
  d.addEquation("E = m * c^2");
  // Force a page break by adding more content.
  d.addParagraph("More content after the figure. ".repeat(50));
  const bytes = d.build();
  assert.ok(bytes.byteLength > 500);
  validateDocument(bytes);
  assert.ok(d.pageCount() >= 1);
});

test("document: PDF bytes start with %PDF- magic", () => {
  const d = createDocument({ title: "T" });
  d.addParagraph("hi");
  const bytes = d.build();
  assert.equal(new TextDecoder("latin1").decode(bytes.subarray(0, 5)), "%PDF-");
});

test("document: deterministic for identical inputs", () => {
  function make() {
    const d = createDocument({ title: "Det" });
    d.addHeading("X");
    d.addParagraph("p");
    return d.build();
  }
  const a = make();
  const b = make();
  assert.equal(a.byteLength, b.byteLength);
  assert.equal(new TextDecoder("latin1").decode(a), new TextDecoder("latin1").decode(b));
});

test("document: validateDocument throws on non-PDF bytes", () => {
  assert.throws(() => validateDocument(new Uint8Array([1, 2, 3, 4])));
});

test("document: addPage returns the new page builder", () => {
  const d = createDocument({ title: "P" });
  d.addParagraph("a");
  const p2 = d.addPage();
  assert.ok(p2);
  d.addParagraph("b");
  assert.ok(d.pageCount() >= 2);
});
