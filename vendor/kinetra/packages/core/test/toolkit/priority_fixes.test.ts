/**
 * Agent 3 priority fixes: real SVG sub/superscripts, labels over grid lines
 * behind a halo, canvas-bounded routing, built-in contacts (phasors sharing
 * the polar origin, wires crossing without a junction) and the expression
 * parser workaround (-3^2, a number right before ")").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkToolkitStyle, compose, formatLabelMarkup, measureLabelWidth, plainLabelText, toolkitEvalQuantity, toolkitRouteOrthogonal, toolkitVariableScope } from "../../src/toolkit/index.js";
import { parseExpr } from "../../src/math/expression.js";
import { evaluate } from "../../src/math/eval.js";
import type { ElementSpec } from "../../src/toolkit/index.js";
import { close, err, model, ok } from "./helpers.js";
import { svgOracle } from "./parts_helpers.js";

const O = { x: 0, y: 0 };

// --- 1. sub/superscripts -------------------------------------------------------------------------------------

test("scripts: capital and multi-letter scripts render as tspans, not Unicode", () => {
  for (const [src, plain] of [["F_N", "FN"], ["V_{CC}", "VCC"], ["R_L", "RL"], ["I_B", "IB"], ["x^2", "x2"], ["v_{max}", "vmax"]] as const) {
    const r = ok(model([{ id: "p", type: "point", at: O, label: src }]));
    assert.equal(plainLabelText(formatLabelMarkup(src)), plain);
    assert.match(r.svg, /<tspan font-size="9" dy="(3\.6|-4\.8)">/, src);
    assert.equal(r.svg.match(/[-]/u), null, "no private-use carrier code points leak into the SVG");
    assert.deepEqual(checkToolkitStyle(r.svg), []);
    assert.deepEqual(svgOracle(r.svg, 600, 400), []);
  }
  const r = ok(model([{ id: "p", type: "point", at: O, label: "V_{CC} = 5 V" }]));
  assert.match(r.svg, />\s*V<tspan font-size="9" dy="3.6">CC<\/tspan><tspan dy="-3.6"> = 5 V<\/tspan>\s*<\/text>/);
});

test("scripts: measurement scales script glyphs and the label box grows for the shift", () => {
  const full = measureLabelWidth("FN", 12), rich = measureLabelWidth(formatLabelMarkup("F_N"), 12);
  assert.ok(rich < full && rich >= measureLabelWidth("F", 12) + measureLabelWidth("N", 9), `${rich} vs ${full}`);
  const plain = ok(model([{ id: "p", type: "point", at: O, label: { text: "FN", position: "right" } }])).report.labels[0]!.box;
  const sub = ok(model([{ id: "p", type: "point", at: O, label: { text: "F_N", position: "right" } }])).report.labels[0]!.box;
  const sup = ok(model([{ id: "p", type: "point", at: O, label: { text: "x^2", position: "right" } }])).report.labels[0]!.box;
  assert.ok(sub.y1 - sub.y0 > plain.y1 - plain.y0, "subscript box is taller (lowered glyphs)");
  assert.ok(sup.y1 - sup.y0 > plain.y1 - plain.y0, "superscript box is taller (raised glyphs)");
});

test("scripts: part text, axis labels and tables take scripts; unsupported script characters are rejected", () => {
  const r = ok(model([{ id: "b", type: "roundedBox", at: O, w: 2.4, h: 1, text: "R_L = 1 k\\Omega" }]));
  assert.match(r.svg, /R<tspan font-size="9" dy="3.6">L<\/tspan>/);
  assert.deepEqual(checkToolkitStyle(r.svg), []);
  err(model([{ id: "p", type: "point", at: O, label: "F_{→}" }]), "E_TEXT_UNSUPPORTED");
  err(model([{ id: "p", type: "point", at: O, label: "F_{}" }]), "E_TEXT_UNSUPPORTED");
});

test("scripts: the style checker rejects off-contract tspans", () => {
  const r = ok(model([{ id: "p", type: "point", at: O, label: "F_N" }]));
  assert.ok(checkToolkitStyle(r.svg.replace('font-size="9" dy', 'font-size="10" dy')).some(v => v.rule === "script"));
  assert.ok(checkToolkitStyle(r.svg.replace('<tspan font-size="9"', '<tspan fill="#c0392b" font-size="9"')).some(v => v.rule === "script"));
  assert.ok(checkToolkitStyle(r.svg.replace('dy="3.6"', 'dy="30"')).some(v => v.rule === "script"));
  assert.ok(checkToolkitStyle(r.svg.replace("<tspan font-size", "<b>x</b><tspan font-size")).some(v => v.rule === "text"));
});

// --- 2. labels over grid lines --------------------------------------------------------------------------------

const GRID_AX: ElementSpec = { id: "ax", type: "axes", at: { x: -4, y: -2.5 }, w: 8, h: 5, x: { min: 0, max: 8, ticks: 16, grid: true }, y: { min: 0, max: 5, ticks: 10, grid: true } };

test("grid: a label may sit over grid lines behind a white halo", () => {
  const r = ok(model([GRID_AX, { id: "pt", type: "plotPoint", axes: "ax", x: 4, y: 2.5, label: { text: "operating point Q", position: "right" } }]));
  assert.match(r.svg, /<rect [^>]*fill="#fff" stroke="none"/, "halo drawn");
  assert.deepEqual(svgOracle(r.svg, 600, 400), []);
  assert.deepEqual(checkToolkitStyle(r.svg), []);
  // Without grid lines there is no halo: output for ordinary labels is unchanged.
  const plain = ok(model([{ ...GRID_AX, x: { min: 0, max: 8, ticks: 16 }, y: { min: 0, max: 5, ticks: 10 } }, { id: "pt", type: "plotPoint", axes: "ax", x: 4, y: 2.5, label: { text: "operating point Q", position: "right" } }]));
  assert.doesNotMatch(plain.svg, /fill="#fff" stroke="none"/);
});

test("grid: labels still never overlap curves, axes text or other labels", () => {
  const curve = err(model([GRID_AX, { id: "s", type: "series", axes: "ax", fn: "2.5 + 0*x" }, { id: "pt", type: "plotPoint", axes: "ax", x: 3, y: 2.5, label: { text: "on the curve", position: "right" } }]), "E_COLLISION");
  assert.ok(curve.elements.includes("s"));
  const tick = err(model([GRID_AX, { id: "pt", type: "plotPoint", axes: "ax", x: 0.6, y: 0.2, label: { text: "near ticks", position: "below-left" } }]), "E_COLLISION");
  assert.ok(tick.elements.includes("ax"));
  err(model([GRID_AX, { id: "p1", type: "plotPoint", axes: "ax", x: 4, y: 2.5, label: { text: "first label", position: "right" } }, { id: "p2", type: "plotPoint", axes: "ax", x: 4.6, y: 2.5, label: { text: "second", position: "left" } }]), "E_COLLISION");
});

// --- 3. router inside the canvas -----------------------------------------------------------------------------

test("router: orthogonal routes stay inside the canvas", () => {
  const boxes = (id: string, x: number, y: number): ElementSpec => ({ id, type: "roundedBox", at: { x, y }, w: 1.6, h: 1, text: id });
  // The wall spans almost the whole height; the shorter detour (over the top) would leave the canvas.
  const els: ElementSpec[] = [boxes("A", -4, 2.8), boxes("B", 4, 2.8), { id: "wall", type: "rect", at: { x: 0, y: -0.6 }, w: 0.4, h: 6.4 },
    { id: "c", type: "connector", from: "A.right", to: "B.left", route: "orthogonal", avoid: ["wall"] }];
  const r = compose(model(els));
  if (r.ok) {
    const pts = r.report.elements.find(e => e.id === "c")!.points!;
    assert.ok(r.report.gate!.outOfBounds === 0, JSON.stringify(pts));
  } else {
    assert.ok(r.errors.every(e => e.code !== "E_OUT_OF_BOUNDS"), JSON.stringify(r.errors));
  }
  // Direct router call: with bounds the route never leaves them.
  const route = toolkitRouteOrthogonal({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }, { x: -1, y: 0 }, [{ x0: 4, y0: -1, x1: 6, y1: 9.5 }], [], 0.5, {}, { x0: -1, y0: -3, x1: 11, y1: 10 })!;
  assert.ok(route.every(p => p.x >= -1 && p.x <= 11 && p.y >= -3 && p.y <= 10), JSON.stringify(route));
  assert.ok(route.some(p => p.y < -1), "detours below the obstacle");
  const unbounded = toolkitRouteOrthogonal({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }, { x: -1, y: 0 }, [{ x0: 4, y0: -1, x1: 6, y1: 9.5 }], [], 0.5)!;
  assert.ok(unbounded.length > 0);
  assert.equal(toolkitRouteOrthogonal({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }, { x: -1, y: 0 }, [{ x0: 4, y0: -5, x1: 6, y1: 9.8 }], [], 0.5, {}, { x0: -1, y0: -3, x1: 11, y1: 10 }), undefined);
});

// --- 4. built-in contacts --------------------------------------------------------------------------------------

const PA: ElementSpec = { id: "pa", type: "polarAxes", at: O, r: 3, rMax: 2, spokes: 90, ringLabels: false };

test("contacts: phasors sharing the polar origin touch without mayTouch", () => {
  const r = ok(model([PA, { id: "v1", type: "phasor", axes: "pa", magnitude: 1.6, angle: 0 }, { id: "v2", type: "phasor", axes: "pa", magnitude: 1.2, angle: 120, color: "rayAlt" }, { id: "v3", type: "phasor", axes: "pa", magnitude: 1.2, angle: -120, color: "normal" }]));
  assert.equal(r.report.contacts.filter(c => c.reason === "phasors share the polar origin").length, 3);
  // Nearly collinear phasors overlap along their length: still a collision.
  err(model([PA, { id: "v1", type: "phasor", axes: "pa", magnitude: 1.6, angle: 0 }, { id: "v2", type: "phasor", axes: "pa", magnitude: 1.2, angle: 2 }]), "E_COLLISION");
});

test("contacts: crossing wires need no mayTouch and get no junction dot; real nodes still need one", () => {
  const r = ok(model([{ id: "a", type: "wire", points: [{ x: -2, y: 0 }, { x: 2, y: 0 }] }, { id: "b", type: "wire", points: [{ x: -1, y: 2 }, { x: -1, y: -2 }] }, { id: "c", type: "wire", points: [{ x: 1, y: 2 }, { x: 1, y: -2 }] }]));
  assert.equal(r.report.contacts.filter(c => c.reason === "wires cross without connecting (no junction)").length, 2);
  assert.doesNotMatch(r.svg, /<circle/);
  err(model([{ id: "a", type: "wire", points: [{ x: -2, y: 0 }, { x: 2, y: 0 }] }, { id: "b", type: "wire", points: [O, { x: 0, y: -2 }] }]), "E_COLLISION");
  err(model([{ id: "a", type: "wire", points: [{ x: -2, y: 0 }, { x: 2, y: 0 }] }, { id: "b", type: "wire", points: [{ x: -1, y: 2 }, { x: -1, y: -2 }] }, { id: "j", type: "junction", at: { x: 1, y: 0 }, wires: ["a", "b"] }]), "E_CONSTRAINT_VIOLATED");
});

// --- 5. expression parser workaround ----------------------------------------------------------------------------

test("expr: the toolkit evaluates -3^2 as -9 and reads a number right before ')' correctly", () => {
  const scope = toolkitVariableScope({ a: "2 m", n: "3" });
  const q = (s: string) => toolkitEvalQuantity(s, scope, "t", ["x"]).value;
  close(q("-3^2"), -9);
  close(q("2 - 3^2"), -7);
  close(q("(-3)^2"), 9);
  close(q("-n^2"), -9);
  close(q("2*(1 + 2)"), 6);
  close(q("(4)"), 4);
  close(q("(1 + 2) * a"), 6);
  close(q("sqrt(16)"), 4);
  close(q("max(1, 2)"), 2);
  close(q("(a + 50 cm)"), 2.5);
  // Clem patches the core parser so unary minus binds looser than ^; the toolkit agrees with it.
  const raw = (s: string) => evaluate(parseExpr(s), { vars: {} });
  close(raw("-3^2"), -9);
});
