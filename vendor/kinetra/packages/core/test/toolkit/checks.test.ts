import { test } from "node:test";
import assert from "node:assert/strict";
import { close, err, model, ok } from "./helpers.js";
import type { CheckSpec, ElementSpec } from "../../src/toolkit/index.js";

const forces = (fy = "m*g"): ElementSpec[] => [
  { id: "b", type: "block", w: 1, h: 1, at: { x: 0, y: 0 } },
  { id: "W", type: "force", from: "b.center", angle: -90, magnitude: "m*g", mayTouch: ["b", "N"] },
  { id: "N", type: "force", from: "b.center", angle: 90, magnitude: fy, mayTouch: ["b"] },
];
const physics = (checks: CheckSpec[], fy?: string) => model(forces(fy), { vars: { m: "2 kg", g: "9.81 m/s^2" }, scales: { force: { per: "10 N" } }, checks });

test("toolkit checks: vectorSum passes for balanced forces and lists every check", () => {
  const r = ok(physics([{ id: "eq", type: "vectorSum", vectors: ["W", "N"] }]));
  const ids = r.report.checks.map(c => [c.id, c.pass, !!c.automatic]);
  assert.deepEqual(ids, [["eq", true, false], ["scale:force", true, true]]);
  assert.match(r.report.caption!, /Arrow scale: 1 unit = 10 N \(force\)/);
});

test("toolkit checks: a failing vectorSum blocks the render with expected vs actual", () => {
  const e = err(physics([{ id: "eq", type: "vectorSum", vectors: ["W", "N"] }], "1.5*m*g"), "E_CHECK_FAILED");
  assert.deepEqual(e.elements, ["check:eq", "W", "N"]);
  const m = e.measured as { expected: { x: number; y: number }; actual: { x: number; y: number }; residual: number };
  assert.deepEqual(m.expected, { x: 0, y: 0 });
  close(m.actual.y, 0.5 * 2 * 9.81, 1e-9);
  assert.match(e.message, /expected .*got/);
  assert.match(e.suggestion!, /W, N/);
});

test("toolkit checks: equality and inequalities with units and tolerance", () => {
  ok(physics([
    { id: "a", type: "equal", left: "N.magnitude", right: "19.62 N", tol: "1e-9 N" },
    { id: "b", type: "greater", left: "W.length", right: "1 m" },
    { id: "c", type: "lessEqual", left: "N.vy", right: "m*g" },
  ]));
  let e = err(physics([{ id: "a", type: "equal", left: "N.magnitude", right: "20 N", tol: "0.1 N" }]), "E_CHECK_FAILED");
  close((e.measured as { residual: number }).residual, 0.38, 1e-9);
  err(physics([{ id: "a", type: "less", left: "N.magnitude", right: "1 N" }]), "E_CHECK_FAILED");
  e = err(physics([{ id: "a", type: "equal", left: "N.magnitude", right: "2 m" }]), "E_UNIT_MISMATCH");
  assert.deepEqual(e.elements, ["check:a"]);
  err(physics([{ id: "a", type: "equal", left: "N.magnitude", right: "20 N", tol: "1 s" }]), "E_UNIT_MISMATCH");
});

test("toolkit checks: momentSum about a point", () => {
  const els: ElementSpec[] = [
    { id: "beam", type: "block", w: 8, h: 0.2, at: { x: 0, y: 0 } },
    { id: "F1", type: "force", from: { x: -2, y: -0.1 }, angle: -90, magnitude: "30 N", mayTouch: ["beam"] },
    { id: "F2", type: "force", from: { x: 3, y: -0.1 }, angle: -90, magnitude: "20 N", mayTouch: ["beam"] },
  ];
  const r = ok(model(els, { scales: { force: { per: "20 N" } }, checks: [{ id: "m", type: "momentSum", about: { x: 0, y: 0 }, vectors: ["F1", "F2"], tol: "1e-9 N*m" }] }));
  assert.equal(r.report.checks[0]!.unit, "J (kg*m^2*s^-2)");
  const e = err(model(els, { scales: { force: { per: "20 N" } }, checks: [{ id: "m", type: "momentSum", about: { x: 1, y: 0 }, vectors: ["F1", "F2"] }] }), "E_CHECK_FAILED");
  close((e.measured as { actual: { total: number } }).actual.total, 30 * 3 - 20 * 2, 1e-9);
});

test("toolkit checks: kcl, table and onCurve", () => {
  const els: ElementSpec[] = [
    { id: "c", type: "curve", fn: "x^2/4", domain: [-2, 2] },
    { id: "P", type: "point", at: "c.at(1)", mayTouch: ["c"] },
  ];
  const r = ok(model(els, { checks: [
    { id: "k", type: "kcl", node: "n1", currents: [{ value: "2 A", direction: "in" }, { value: "500 mA", direction: "in" }, { value: "2.5 A", direction: "out" }] },
    { id: "t", type: "table", fn: "x^2/4", var: "x", rows: [[0, 0], [1, 0.25], [2, 1]] },
    { id: "on", type: "onCurve", point: "P", curve: "c" },
  ] }));
  assert.ok(r.report.checks.every(c => c.pass));
  err(model(els, { checks: [{ id: "k", type: "kcl", currents: [{ value: "2 A", direction: "in" }, { value: "1 A", direction: "out" }] }] }), "E_CHECK_FAILED");
  err(model(els, { checks: [{ id: "k", type: "kcl", currents: [{ value: "2 A", direction: "in" }, { value: "2 V", direction: "out" }] }] }), "E_UNIT_MISMATCH");
  const t = err(model(els, { checks: [{ id: "t", type: "table", fn: "x^2/4", var: "x", rows: [[0, 0], [2, 1.1]] }] }), "E_CHECK_FAILED");
  assert.deepEqual((t.measured as { expected: unknown }).expected, [{ row: 1, x: 2, y: 1 }]);
  err(model([...els, { id: "Q", type: "point", at: { x: 1, y: 0.3 } }], { checks: [{ id: "on", type: "onCurve", point: "Q", curve: "c" }] }), "E_CHECK_FAILED");
});

test("toolkit checks: explicit proportional check on rendered arrow lengths", () => {
  const r = ok(physics([{ id: "p", type: "proportional", arrows: ["W", "N"] }], "m*g/2"));
  const c = r.report.checks.find(x => x.id === "p")!;
  assert.ok(c.pass);
  // px per newton: 50 px per world unit / 10 N per world unit
  close(c.expected as number, 5, 1e-9);
});

test("toolkit checks: bad check specs give schema and reference errors", () => {
  err(physics([{ id: "x", type: "vectorSum", vectors: ["b"] } as CheckSpec]), "E_SCHEMA");
  err(physics([{ id: "x", type: "vectorSum", vectors: ["nope"] } as CheckSpec]), "E_UNKNOWN_REF");
  err(physics([{ id: "x", type: "median" } as unknown as CheckSpec]), "E_SCHEMA");
  err(physics([{ id: "x", type: "onCurve", point: "b", curve: "b" }]), "E_SCHEMA");
});
