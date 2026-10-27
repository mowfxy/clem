/**
 * Engine and part weaknesses found while building the proof set
 * (examples/toolkit/proof/), each fixed additively and pinned here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compose, toolkitEvalQuantity, toolkitVariableScope } from "../../src/toolkit/index.js";
import type { ElementSpec } from "../../src/toolkit/index.js";
import { close, err, model, ok } from "./helpers.js";
import { svgOracle } from "./parts_helpers.js";

const O = { x: 0, y: 0 };

test("checks read anchor coordinates as <id>.<anchor>.x / .y (in SI lengths)", () => {
  const tank: ElementSpec = { id: "T", type: "tank", at: { x: 1, y: 0.5 }, w: 2, h: 2, level: 0.5 };
  const r = ok(model([tank], { checks: [{ id: "surface", type: "equal", left: "T.surface.y", right: "1.5 m", tol: "1e-12 m" }, { id: "rim", type: "equal", left: "T.top.y - T.bottom.y", right: "2 m", tol: "1e-12 m" }] }));
  assert.ok(r.report.checks.every(c => c.pass));
  // Argument anchors are not exposed; refs keep priority over anchors of the same name.
  err(model([tank], { checks: [{ type: "equal", left: "T.leftAt.y", right: "0 m" }] }), "E_EXPR_UNKNOWN_NAME");
  const cm = ok(model([{ id: "s", type: "segment", from: O, to: { x: 2, y: 0 } }], { canvas: { width: 600, height: 400, world: { xMin: -6, xMax: 6, yMin: -4, yMax: 4 }, worldUnit: "cm" }, checks: [{ type: "equal", left: "s.end.x", right: "2 cm", tol: "1e-12 m" }] }));
  assert.ok(cm.report.checks[0]!.pass);
});

test("background regions: other elements may be drawn over a rect or polygon with background: true", () => {
  const glass: ElementSpec = { id: "g", type: "rect", at: { x: 0, y: -1.5 }, w: 8, h: 3, fill: "surfaceFill", stroke: "white", background: true };
  const ray: ElementSpec = { id: "r", type: "arrow", from: { x: -2, y: -2 }, to: { x: 0, y: 0 }, color: "ray" };
  const t: ElementSpec = { id: "t", type: "text", text: "glass", at: { x: -2.5, y: -0.6 } };
  const arc: ElementSpec = { id: "a", type: "angleArc", vertex: O, fromAngle: 225, toAngle: 270, r: 0.8, text: "θ", mayTouch: ["r"] };
  ok(model([glass, ray, t, arc]));
  err(model([{ ...glass, background: false }, ray]), "E_COLLISION");
  ok(model([{ id: "p", type: "polygon", points: [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 0, y: 2 }], fill: "bodyFill", stroke: "white", background: true }, ray]));
  err(model([{ ...glass, background: "yes" } as ElementSpec]), "E_SCHEMA");
});

test("grid lines are low priority for other elements' lines too, but never for a part's own text", () => {
  const ax: ElementSpec = { id: "ax", type: "axes", at: { x: -4, y: -2.5 }, w: 8, h: 5, x: { min: 0, max: 8, ticks: 8, grid: true }, y: { min: 0, max: 5, ticks: 5, grid: true } };
  ok(model([ax, { id: "a", type: "arrow", from: { x: -3, y: -1.2 }, to: { x: 2.7, y: 1.4 } }]));
  ok(model([ax, { id: "l", type: "leader", target: { x: 2.3, y: -1.1 }, text: "note", dx: 2.2, dy: 1.1, marker: "dot" }]));
  // The leader's own text centred on a grid line: part text gets no halo, so it still collides.
  const e = err(model([ax, { id: "l", type: "leader", target: { x: -2.7, y: -2.6 }, text: "callout", dx: 1.1, dy: 1.1, marker: "dot" }]), "E_COLLISION");
  assert.ok(e.elements.includes("ax") && e.elements.includes("l"));
});

test("labels clear their own marker: a point label uses the marker box as its extent", () => {
  const ax: ElementSpec = { id: "ax", type: "axes", at: { x: -4, y: -2.5 }, w: 8, h: 5, x: { min: 0, max: 8, ticks: 4 }, y: { min: 0, max: 5, ticks: 5 } };
  for (const marker of ["x", "circle", "square", "triangle", "cross"]) {
    const r = ok(model([ax, { id: "p", type: "plotPoint", axes: "ax", x: 4, y: 2.5, marker, label: { text: "P", position: "right" } }]));
    assert.equal(r.report.labels[0]!.position, "right", marker);
    assert.deepEqual(svgOracle(r.svg, 600, 400), []);
  }
});

test("an inline current arrow may sit on any wire or segment it marks; a misplaced one still collides", () => {
  const w: ElementSpec = { id: "w", type: "segment", from: { x: -3, y: 0 }, to: { x: 3, y: 0 }, width: 1.2 };
  const r = ok(model([w, { id: "i", type: "currentArrow", from: { x: -3, y: 0 }, to: { x: 3, y: 0 }, label: "I" }]));
  assert.ok(r.report.contacts.some(c => c.reason === "current arrow on its conductor"));
  ok(model([{ id: "w", type: "wire", points: [{ x: -3, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 }] }, { id: "i", type: "currentArrow", from: { x: -3, y: 0 }, to: { x: 0, y: 0 } }]));
  err(model([w, { id: "i", type: "currentArrow", from: { x: -3, y: 0.06 }, to: { x: 3, y: 0.06 } }]), "E_COLLISION");
});

test("signal connectors may cross cleanly without mayTouch; touching at ends or corners still fails", () => {
  const A = (id: string, x: number, y: number): ElementSpec => ({ id, type: "roundedBox", at: { x, y }, w: 1, h: 0.6, text: id });
  const els = [A("A", -4, 0), A("B", 4, 0), A("C", 0, 3), A("D", 0, -3)];
  const r = ok(model([...els, { id: "h", type: "connector", from: "A.right", to: "B.left" }, { id: "v", type: "connector", from: "C.bottom", to: "D.top" }]));
  assert.ok(r.report.contacts.some(c => c.reason === "signal lines cross without connecting"));
  // A connector ending on another connector's line is a T, not a crossing.
  err(model([...els, { id: "h", type: "connector", from: "A.right", to: "B.left" }, { id: "v", type: "connector", from: "C.bottom", to: { x: 0, y: 0 } }]), "E_COLLISION");
});

test("connector via accepts a single corner point", () => {
  const r = ok(model([{ id: "c", type: "connector", from: { x: -3, y: 2 }, to: { x: 2, y: -2 }, route: "orthogonal", via: [{ x: -3, y: -2 }] }]));
  assert.deepEqual(r.report.elements.find(e => e.id === "c")!.points!.via, [{ x: -3, y: -2 }]);
  err(model([{ id: "c", type: "connector", from: { x: -3, y: 2 }, to: { x: 2, y: -2 }, route: "orthogonal", via: [] }]), "E_SCHEMA");
  err(model([{ id: "p", type: "polyline", points: [{ x: 0, y: 0 }] }]), "E_SCHEMA");
});

test("units: electron-volts and nanometres for atomic physics", () => {
  const q = (s: string) => toolkitEvalQuantity(s, toolkitVariableScope({}), "t", ["x"]).value;
  close(q("1 eV"), 1.602176634e-19, 1e-30);
  close(q("2 keV") / q("1 eV"), 2000, 1e-9);
  close(q("656 nm"), 656e-9, 1e-18);
  close(q("3 µm"), 3e-6, 1e-15);
  close(q("6.62607015e-34 J*s*2.99792458e8 m/s/(1.89 eV)") / 1e-9, 656.0, 0.1);
  // A variable named like a unit still wins.
  close(toolkitEvalQuantity("nm*2", toolkitVariableScope({ nm: "3" }), "t", ["x"]).value, 6);
});

test("label error messages and the report show plain text, not script carriers", () => {
  const e = err(model([{ id: "p", type: "point", at: O, label: { text: "F_N", position: "right" } }, { id: "s", type: "segment", from: { x: 0.1, y: -0.4 }, to: { x: 0.1, y: 0.4 } }]), "E_COLLISION");
  assert.match(e.message, /"FN"/);
  const r = compose(model([{ id: "p", type: "point", at: O, label: "V_{CC}" }]));
  assert.ok(r.ok && r.report.labels[0]!.text === "VCC");
});
