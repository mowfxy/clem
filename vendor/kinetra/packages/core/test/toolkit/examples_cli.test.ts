import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkToolkitStyle, compose } from "../../src/toolkit/index.js";
import { runCli } from "../compat/api_surface.js";

const EXAMPLES = new URL("../../../../examples/toolkit/", import.meta.url);
const files = readdirSync(EXAMPLES).filter(f => f.endsWith(".json")).sort();

test("toolkit examples: five basic-shape compositions are present", () => {
  assert.deepEqual(files, ["ball-on-ramp.json", "block-on-incline.json", "kcl-node.json", "parabola-table.json", "seesaw-moments.json"]);
});

for (const f of files) {
  test(`toolkit examples: ${f} composes, passes its checks and the gate, and conforms to the style contract`, () => {
    const m = JSON.parse(readFileSync(new URL(f, EXAMPLES), "utf8"));
    const r = compose(m);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    if (!r.ok) return;
    assert.ok(r.report.checks.length >= 1 && r.report.checks.every(c => c.pass));
    assert.ok((m.checks ?? []).length >= 1, "each example declares at least one check");
    assert.deepEqual({ collisions: r.report.gate!.collisions, outOfBounds: r.report.gate!.outOfBounds, nonFinite: r.report.gate!.nonFinite }, { collisions: 0, outOfBounds: 0, nonFinite: 0 });
    assert.deepEqual(checkToolkitStyle(r.svg, { title: m.title, caption: r.report.caption }), []);
    assert.equal(compose(JSON.parse(readFileSync(new URL(f, EXAMPLES), "utf8"))).ok && r.svg, r.svg);
  });
}

test("toolkit CLI: `compose <model.json> <out.svg>` writes the SVG and report", () => {
  const dir = mkdtempSync(join(tmpdir(), "kinetra-compose-"));
  const out = join(dir, "incline.svg");
  const r = runCli(["compose", "examples/toolkit/block-on-incline.json", out]);
  assert.equal(r.status, 0, r.stdout);
  const expected = compose(JSON.parse(readFileSync(new URL("block-on-incline.json", EXAMPLES), "utf8")));
  assert.ok(expected.ok);
  assert.equal(readFileSync(out, "utf8"), expected.ok ? expected.svg : "");
  assert.ok(existsSync(join(dir, "incline.report.json")));
});

test("toolkit CLI: a bad model prints structured errors and exits 1 without writing", () => {
  const dir = mkdtempSync(join(tmpdir(), "kinetra-compose-"));
  const bad = join(dir, "bad.json"), out = join(dir, "bad.svg");
  writeFileSync(bad, JSON.stringify({ canvas: { width: 600, height: 400, world: { xMin: -6, xMax: 6, yMin: -4, yMax: 4 } }, elements: [{ id: "a", type: "rect", w: 1, h: 1 }] }));
  const r = runCli(["compose", bad, out]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errors[0].code, "E_UNDERCONSTRAINED");
  assert.ok(!existsSync(out));
  writeFileSync(bad, "{ not json");
  const r2 = runCli(["compose", bad, out]);
  assert.equal(r2.status, 1);
  assert.equal(JSON.parse(r2.stdout).errors[0].code, "E_SCHEMA");
});

test("toolkit CLI: help is listed and existing commands are untouched", () => {
  const help = runCli(["--help"]).stdout;
  assert.match(help, /compose\s+composed diagram from a toolkit model/);
  assert.match(runCli(["compose", "--help"]).stdout, /kinetra compose <model\.json> <out\.svg>/);
  assert.equal(runCli(["compose", "only-input.json"]).status, 2);
});
