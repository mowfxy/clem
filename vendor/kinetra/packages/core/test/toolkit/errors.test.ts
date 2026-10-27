import { test } from "node:test";
import assert from "node:assert/strict";
import { compose, TOOLKIT_ERROR_CODES } from "../../src/toolkit/index.js";
import type { ComposeModel, ElementSpec } from "../../src/toolkit/index.js";
import { err, model } from "./helpers.js";

const pt = (id: string, x = 0, y = 0): ElementSpec => ({ id, type: "point", at: { x, y } });

/** One bad model per error code: what an agent might plausibly get wrong. */
const CASES: [string, ComposeModel][] = [
  ["E_SCHEMA", { canvas: { width: 600, height: 400, world: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 } }, elements: [], } as ComposeModel],
  ["E_DUPLICATE_ID", model([pt("a"), pt("a", 1)])],
  ["E_UNKNOWN_PART", model([{ id: "a", type: "spring", at: { x: 0, y: 0 } }])],
  ["E_UNKNOWN_REF", model([{ id: "a", type: "point", at: "ghost.top" }])],
  ["E_UNKNOWN_ANCHOR", model([{ id: "b", type: "rect", w: 1, h: 1, at: { x: 0, y: 0 } }, { id: "a", type: "point", at: "b.rim(30 deg)" }])],
  ["E_EXPR_PARSE", model([{ id: "a", type: "point", at: { x: "(1 + 2", y: 0 } }])],
  ["E_EXPR_UNKNOWN_NAME", model([{ id: "a", type: "point", at: { x: "width/2", y: 0 } }])],
  ["E_UNIT_MISMATCH", model([{ id: "a", type: "circle", r: "2 kg", at: { x: 0, y: 0 } }])],
  ["E_NON_FINITE", model([{ id: "a", type: "point", at: { x: "1/0", y: 0 } }])],
  ["E_INVALID_VALUE", model([{ id: "a", type: "circle", r: -1, at: { x: 0, y: 0 } }])],
  ["E_SCALE_MISSING", model([{ id: "F", type: "force", from: { x: 0, y: 0 }, angle: 0, magnitude: "10 N" }])],
  ["E_UNDERCONSTRAINED", model([{ id: "a", type: "rect", w: 1, h: 1, place: { x: 0 } }])],
  ["E_CONTRADICTORY", model([pt("o"), { id: "a", type: "point", place: [{ distance: 1, from: "o" }, { at: { x: 3, y: 0 } }] }])],
  ["E_AMBIGUOUS", model([pt("o"), { id: "a", type: "point", place: [{ distance: 1, from: "o" }, { y: 0.5 }] }])],
  ["E_CIRCULAR", model([{ id: "a", type: "rect", w: 1, h: 1, place: { rightOf: "b" } }, { id: "b", type: "rect", w: 1, h: 1, place: { rightOf: "a" } }])],
  ["E_CONSTRAINT_VIOLATED", model([{ id: "box", type: "rect", w: 1, h: 1, at: { x: 0, y: 0 } }, { id: "c", type: "circle", r: 0.3, place: [{ at: { x: 3, y: 0 } }, { inside: "box" }] }])],
  ["E_CHECK_FAILED", model([pt("a")], { checks: [{ id: "c", type: "equal", left: "a.x", right: "1 m" }] })],
  // Capital subscripts render as real SVG scripts since Agent 3, so an unknown symbol is the rejected case.
  ["E_TEXT_UNSUPPORTED", model([{ ...pt("a"), label: "\\foo_Q" }])],
  ["E_STYLE", model([{ id: "a", type: "segment", from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, color: "hotpink" }])],
  ["E_ARROW_TOO_SHORT", model([{ id: "a", type: "arrow", from: { x: 0, y: 0 }, angle: 0, length: 0.1 }])],
  ["E_COLLISION", model([{ id: "a", type: "circle", r: 1, fill: "bodyFill", at: { x: 0, y: 0 } }, { id: "b", type: "circle", r: 1, fill: "bodyFill", at: { x: 1, y: 0 } }])],
  ["E_OUT_OF_BOUNDS", model([{ id: "a", type: "circle", r: 1, at: { x: 5.5, y: 0 } }])],
  ["E_LABEL_UNPLACEABLE", model([{ id: "a", type: "rect", w: 11.9, h: 7.9, fill: "bodyFill", at: { x: 0, y: 0 } }, { id: "p", type: "point", at: { x: 1, y: 1 }, label: { text: "a very long label that cannot fit", leader: false }, mayTouch: ["a"] }])],
];

for (const [code, m] of CASES) {
  test(`toolkit errors: ${code} is reported with elements, message and context`, () => {
    const e = err(m, code);
    assert.ok(Array.isArray(e.elements));
    assert.ok(e.message.length > 10, e.message);
    if (!["E_SCHEMA", "E_CHECK_FAILED", "E_EXPR_PARSE", "E_NON_FINITE"].includes(code)) assert.ok(e.elements.length > 0, `${code} should name elements`);
    assert.ok(e.suggestion || e.measured, `${code} should carry a suggestion or measured values`);
  });
}

test("toolkit errors: every documented error code has a reproducing case", () => {
  assert.deepEqual([...new Set(CASES.map(c => c[0]))].sort(), Object.keys(TOOLKIT_ERROR_CODES).sort());
});

test("toolkit errors: compose never throws on malformed input", () => {
  const bad: unknown[] = [null, 42, {}, { canvas: {} }, { canvas: { width: 10, height: 10, world: {} }, elements: [] },
    { canvas: { width: 600, height: 400, world: { xMin: 1, xMax: 0, yMin: 0, yMax: 1 } }, elements: [pt("a")] },
    { canvas: { width: 600, height: 400, world: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 } }, elements: "nope" },
    { canvas: { width: 600, height: 400, world: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 } }, elements: [null] },
    { canvas: { width: 600, height: 400, world: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 } }, elements: [pt("a")], extra: 1 },
    model([{ id: "a", type: "point", at: [0, 0] as unknown as ElementSpec["at"] }]),
    model([{ id: "a", type: "polyline", points: [{ x: 0, y: 0 }] }]),
    model([{ id: "a", type: "arrow", from: { x: 0, y: 0 } }]),
    model([{ id: "a", type: "curve" }]),
    model([pt("a")], { checks: "all" as unknown as [] }),
    model([pt("a")], { scales: { force: {} } as never }),
  ];
  for (const m of bad) {
    const r = compose(m as ComposeModel);
    assert.equal(r.ok, false, JSON.stringify(m));
    if (!r.ok) assert.ok(r.errors.length > 0 && r.errors.every(e => e.code in TOOLKIT_ERROR_CODES));
  }
});

test("toolkit errors: unused scales and unknown top-level keys are rejected", () => {
  err(model([pt("a")], { scales: { force: { per: "10 N" } } }), "E_SCHEMA");
  err({ ...model([pt("a")]), colour: "red" } as ComposeModel, "E_SCHEMA");
});
