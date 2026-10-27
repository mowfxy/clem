/**
 * Generic tests run for every part in the library (TOOLKIT_PART_CATALOG):
 * its sample composes cleanly at several seeds and zooms, conforms to the
 * style contract and the SVG oracle, its collision shapes cover everything it
 * paints, every documented anchor resolves, it is deterministic, it takes a
 * label when it says it does, a duplicate is rejected, unknown keys are
 * rejected, and it is documented in docs/toolkit/parts.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkToolkitStyle, compose, TOOLKIT_PART_CATALOG, TOOLKIT_PART_SAMPLES, getToolkitPart } from "../../src/toolkit/index.js";
import type { ElementSpec } from "../../src/toolkit/index.js";
import { cellModel, resolveModel, svgOracle, uncovered } from "./parts_helpers.js";

const DOC = readFileSync(new URL("../../../../docs/toolkit/parts.md", import.meta.url), "utf8");

/** Anchors that exist only for some option values; the sample may not enable them. */
const CONDITIONAL_ANCHORS: Record<string, string[]> = {
  axes: ["zero", "y2(v)"], // zero: only when (0, 0) is in range; y2: only with a y2 axis
  mass: ["topLeft", "topRight", "bottomLeft", "bottomRight"], // box shape only
  logicGate: ["in1", "in2", "in3"], // one per input
  flipFlop: ["d", "j", "k", "t", "s", "r", "clk"], // depend on kind and clock
};

test("part catalogue: every part has a sample, a category and a description, and type names are unique", () => {
  const types = TOOLKIT_PART_CATALOG.map(p => p.type);
  assert.equal(new Set(types).size, types.length);
  assert.ok(types.length >= 90, `${types.length} parts`);
  for (const p of TOOLKIT_PART_CATALOG) {
    assert.ok(TOOLKIT_PART_SAMPLES.has(p.type), `${p.type} has no sample`);
    assert.ok(p.description.length > 30, `${p.type} needs a description`);
    assert.ok(getToolkitPart(p.type), `${p.type} is registered`);
    for (const a of p.aliases) assert.equal(getToolkitPart(a)?.type, p.type, `alias ${a}`);
  }
});

for (const part of TOOLKIT_PART_CATALOG) {
  const t = part.type;
  test(`part ${t}: sample composes at 3 seeds and 2 zooms, conforms to the style contract and the SVG oracle`, () => {
    for (const seed of [1, 2, 3]) for (const ppu of [50, 70]) {
      const m = cellModel(t, seed, ppu);
      const r = compose(m);
      assert.ok(r.ok, `seed ${seed} @${ppu}: ${JSON.stringify(!r.ok && r.errors.map(e => `${e.code} ${e.message}`))}`);
      if (!r.ok) return;
      assert.deepEqual(checkToolkitStyle(r.svg, { title: m.title, caption: r.report.caption }), []);
      assert.deepEqual(svgOracle(r.svg, m.canvas.width, m.canvas.height), []);
      assert.equal(r.report.gate!.collisions + r.report.gate!.outOfBounds + r.report.gate!.nonFinite, 0);
    }
  });

  test(`part ${t}: collision shapes cover everything it paints`, () => {
    for (const seed of [1, 2]) {
      const misses = uncovered(cellModel(t, seed, 60)).filter(u => u.missed > 0);
      assert.deepEqual(misses, []);
    }
  });

  test(`part ${t}: every documented anchor resolves to a finite point`, () => {
    const { ctx, res } = resolveModel(cellModel(t, 1, 60));
    const inst = res.instances.get("p")!, def = res.defs.get("p")!;
    assert.equal(inst.type === t || part.aliases.includes(inst.type), true);
    for (const name of part.anchors) {
      const m = /^(\w+)\((\w+)\)$/.exec(name);
      if (!m) {
        const p = def.anchor(inst, name, undefined, ctx);
        if (!p && CONDITIONAL_ANCHORS[t]?.includes(name)) continue;
        assert.ok(p && Number.isFinite(p.x) && Number.isFinite(p.y), `${t}.${name}`);
        continue;
      }
      const kind = def.anchorArgs?.[m[1]!];
      assert.ok(kind, `${t}.${name} declares its argument kind`);
      const args = kind === "angle" ? [Math.PI / 6, 0] : [0, 0.5, 1, 0.25];
      const hits = args.map(a => def.anchor(inst, m[1]!, a, ctx)).filter(Boolean);
      if (!hits.length && CONDITIONAL_ANCHORS[t]?.includes(name)) continue;
      assert.ok(hits.length > 0 && hits.every(p => Number.isFinite(p!.x) && Number.isFinite(p!.y)), `${t}.${name} resolves for some argument`);
    }
  });

  test(`part ${t}: output is deterministic`, () => {
    const a = compose(cellModel(t, 2, 60)), b = compose(cellModel(t, 2, 60));
    assert.ok(a.ok && b.ok);
    assert.equal(a.ok && a.svg, b.ok && b.svg);
  });

  test(`part ${t}: a duplicate on top of it is rejected with E_COLLISION, and an unknown key with E_SCHEMA`, () => {
    const m = cellModel(t, 1, 60);
    const dup = structuredClone(m.elements[0]!) as ElementSpec;
    dup.id = "p_dup"; delete dup.label;
    const r = compose({ ...m, elements: [...m.elements, dup] });
    assert.ok(!r.ok && r.errors.some(e => e.code === "E_COLLISION" && e.elements.includes("p_dup")), JSON.stringify(!r.ok && r.errors.map(e => e.code)));
    const bad = { ...m, elements: [{ ...m.elements[0]!, bogusKey: 1 }, ...m.elements.slice(1)] };
    const r2 = compose(bad);
    assert.ok(!r2.ok && r2.errors[0]!.code === "E_SCHEMA" && /accepts/.test(r2.errors[0]!.suggestion ?? ""));
  });

  if (getToolkitPart(t)!.label) test(`part ${t}: takes a label that the placer positions clear of everything`, () => {
    const m = cellModel(t, 1, 80);
    m.canvas = { width: 480, height: 360, world: { xMin: -1, xMax: 5, yMin: -0.75, yMax: 3.75 } };
    const main = m.elements[0]!;
    main.label = { text: "X₁", size: 11 };
    const r = compose(m);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors.map(e => `${e.code} ${e.message}`)));
    if (r.ok) { assert.ok(r.report.labels.some(l => l.owner === "p")); assert.deepEqual(svgOracle(r.svg, 480, 360), []); }
  });

  test(`part ${t}: is documented in docs/toolkit/parts.md`, () => {
    assert.ok(DOC.includes(`### \`${t}\``), `${t} missing from parts.md`);
    for (const a of part.anchors) assert.ok(DOC.includes(a), `${t} anchor ${a} missing from parts.md`);
  });
}
