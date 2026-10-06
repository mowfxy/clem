import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, safeEval } from "../core/expr.ts";
import { namedSources } from "../core/source-context.ts";
import { Calculator, cellKey, type Grid, type Value } from "../core/xlsx-formulas.ts";
import { decodeEntities, parseCaptions } from "../core/captions.ts";
import { planEdits, textBoxes, textInside } from "../core/pdf-edit.ts";
import { cleanAiName } from "../core/file-naming.ts";

test("expressions reject inherited names: constructor, toString and __proto__ are not variables or functions", () => {
  for (const src of ["constructor", "toString + 1", "__proto__", "constructor(1)", "valueOf()"]) assert.throws(() => compile(src, ["x"]), /Unknown (name|function)/, src);
  // Without an allowlist the name is still looked up on the values only, never on Object.prototype.
  assert.ok(Number.isNaN(safeEval(compile("constructor + 1"), { x: 1 })));
  assert.equal(safeEval(compile("2x + pi", ["x"]), { x: 1 }), 2 + Math.PI);
  assert.equal(safeEval(compile("k(x-1)", ["k", "x"]), { k: 3, x: 2 }), 3);
});

test("a numbered file name in a non-Latin script matches the request that names it", () => {
  assert.deepEqual(namedSources(["محاضرة_03.pdf", "Lecture_03.pdf", "Lecture 30.pdf"], "اشرح محاضرة 3"), [0]);
  assert.deepEqual(namedSources(["محاضرة_03.pdf", "Lecture_03.pdf", "Lecture 30.pdf"], "explain lecture 3"), [1]);
});

const sheet = (rows: (Value | string)[][]): Grid => {
  const cells = new Map<string, any>();
  rows.forEach((row, r) => row.forEach((v, c) => { if (v !== null) cells.set(cellKey(r + 1, c + 1), typeof v === "string" && v.startsWith("=") ? { formula: v } : { value: v }); }));
  return new Map([["Sheet1", cells]]);
};
const calc = (rows: (Value | string)[][], formula: string) => new Calculator(sheet([...rows, [formula]])).value("Sheet1", rows.length + 1, 1);

test("INDEX on a single row takes its one number as the column", () => {
  const row = [["a", "b", "c"]];
  assert.equal(calc(row, "=INDEX(A1:C1,3)"), "c");
  assert.equal(calc(row, "=INDEX(A1:C1,1,2)"), "b");
  assert.equal(calc([[1], [2], [3]], "=INDEX(A1:A3,2)"), 2);
});

test("MATCH honours its match type, approximate by default as in Excel", () => {
  const bands = [[0, 50, 60, 70]];
  assert.equal(calc(bands, "=MATCH(65,A1:D1)"), 3);
  assert.equal(calc(bands, "=MATCH(65,A1:D1,1)"), 3);
  assert.deepEqual(calc(bands, "=MATCH(65,A1:D1,0)"), { error: "#N/A" });
  assert.equal(calc(bands, "=MATCH(60,A1:D1,0)"), 3);
  assert.deepEqual(calc(bands, "=MATCH(-1,A1:D1)"), { error: "#N/A" });
  assert.equal(calc([[70, 60, 50, 0]], "=MATCH(65,A1:D1,-1)"), 1);
});

test("a caption entity past Unicode stays as text instead of losing the whole transcript", () => {
  assert.equal(decodeEntities("a &#x110000; b &#39;c&#39;"), "a &#x110000; b 'c'");
  const xml = '<transcript><text start="1">first</text><text start="2">bad &#99999999; entity</text></transcript>';
  assert.deepEqual(parseCaptions(xml).map((c) => c.text), ["first", "bad &#99999999; entity"]);
  assert.equal(parseCaptions("1\n00:00:01,000 --> 00:00:02,000\nhi &#1114112;\n").length, 1);
});

test("PDF text edits and boxes stay on the right run when a line holds letters outside the BMP", () => {
  // Word and unicode-math equations put 𝑉, 𝐼, 𝑅 (surrogate pairs) in the text layer.
  const items = [
    { str: "𝑉 = 𝐼𝑅", x: 0, y: 700, width: 50, size: 12 },
    { str: "Ohm law", x: 60, y: 700, width: 50, size: 12 },
  ];
  const [edit] = planEdits([items], [{ page: 1, find: "law", replace: "rule" }]);
  assert.equal(edit.before, "Ohm law");
  assert.equal(edit.text, "Ohm rule");
  assert.equal(planEdits([items], [{ page: 1, find: "Ohm", replace: "Georg" }])[0].text, "Georg law");
  const [box] = textBoxes(items, "law");
  assert.ok(box.x0 > 60 && box.x1 <= 110.001, JSON.stringify(box));
  assert.deepEqual(textInside(items, [0, 690, 200, 720]), ["𝑉 = 𝐼𝑅 Ohm law"]);
  // A pair is taken whole or not at all.
  for (const part of textInside(items, [0, 690, 30, 720])) assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(part), part);
});

test("an AI file name keeps a section number that looks like an extension", () => {
  assert.equal(cleanAiName("Kinematics – Section 2.10", ".pdf"), "Kinematics – Section 2.10.pdf");
  assert.equal(cleanAiName("Requirements Spec v2.10", ".docx"), "Requirements Spec v2.10.docx");
  assert.equal(cleanAiName("Nodal Analysis – Lecture 3.pdf", ".pdf"), "Nodal Analysis – Lecture 3.pdf");
  assert.equal(cleanAiName("Lab 3 Results.mp4", ".pdf"), "Lab 3 Results.pdf");
});
