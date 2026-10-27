/**
 * Worked examples built from the part library (examples/toolkit/parts/):
 * each composes, passes its declared checks and the gate, conforms to the
 * style contract and the SVG oracle, and is deterministic. Also checks that
 * docs/toolkit/parts.md is the current output of its generator.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { checkToolkitStyle, compose } from "../../src/toolkit/index.js";
import { svgOracle } from "./parts_helpers.js";
// @ts-ignore -- plain ESM script, no type declarations
import { partsMarkdown } from "../../../../scripts/toolkit-parts-doc.mjs";

const DIR = new URL("../../../../examples/toolkit/parts/", import.meta.url);
const files = readdirSync(DIR).filter(f => f.endsWith(".json")).sort();

test("part examples: at least ten worked examples are present", () => {
  assert.ok(files.length >= 10, files.join(", "));
});

for (const f of files) {
  test(`part examples: ${f} composes, passes its checks and the gate, and conforms to the style contract`, () => {
    const m = JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
    const r = compose(m);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    if (!r.ok) return;
    assert.ok((m.checks ?? []).length >= 1, "each example declares at least one check");
    assert.ok(r.report.checks.length >= 1 && r.report.checks.every(c => c.pass));
    assert.deepEqual({ collisions: r.report.gate!.collisions, outOfBounds: r.report.gate!.outOfBounds, nonFinite: r.report.gate!.nonFinite }, { collisions: 0, outOfBounds: 0, nonFinite: 0 });
    assert.deepEqual(checkToolkitStyle(r.svg, { title: m.title, caption: r.report.caption }), []);
    assert.deepEqual(svgOracle(r.svg, m.canvas.width, m.canvas.height), []);
    const again = compose(JSON.parse(readFileSync(new URL(f, DIR), "utf8")));
    assert.equal(again.ok && again.svg, r.svg);
  });
}

test("parts catalogue: docs/toolkit/parts.md is the current generator output (npm run docs:toolkit-parts)", () => {
  const doc = readFileSync(new URL("../../../../docs/toolkit/parts.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(doc, partsMarkdown());
});
