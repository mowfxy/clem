/**
 * One bad model per failure mode the part library adds. Each must fail with
 * the expected code, name the offending element and explain itself. The
 * library adds no new error codes; it uses the engine's table.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLKIT_ERROR_CODES, compose } from "../../src/toolkit/index.js";
import type { ComposeModel, ElementSpec } from "../../src/toolkit/index.js";
import { model } from "./helpers.js";

const O = { x: 0, y: 0 };
const AX: ElementSpec = { id: "ax", type: "axes", at: { x: -4.5, y: -2.8 }, w: 9, h: 5.6, x: { min: 0, max: 4 }, y: { min: 0, max: 3 } };
const small = (els: ElementSpec[]): ComposeModel => ({ canvas: { width: 160, height: 120, world: { xMin: -4, xMax: 4, yMin: -3, yMax: 3 } }, elements: els });

const CASES: [string, ComposeModel, keyof typeof TOOLKIT_ERROR_CODES, string, RegExp?][] = [
  // schema
  ["leader without text", model([{ id: "a", type: "leader", target: O }]), "E_SCHEMA", "a"],
  ["series without fn/data", model([AX, { id: "s", type: "series", axes: "ax" }]), "E_SCHEMA", "s", /fn/],
  ["series on a non-axes element", model([{ id: "b", type: "rect", w: 1, h: 1, at: O }, { id: "s", type: "series", axes: "b", fn: "x" }]), "E_SCHEMA", "s", /axes/],
  ["bad enum", model([{ id: "a", type: "connector", from: O, to: { x: 2, y: 0 }, route: "diagonal" }]), "E_SCHEMA", "a", /straight, orthogonal, curved/],
  ["rope route ending on a pulley", model([{ id: "p", type: "pulley", r: 0.5, at: O }, { id: "r", type: "rope", route: [{ x: -2, y: -2 }, { around: "p" }] }]), "E_SCHEMA", "r", /start and end/],
  ["duplicate truss member", model([{ id: "t", type: "truss", joints: [O, { x: 2, y: 0 }], members: [[0, 1], [1, 0]] }]), "E_SCHEMA", "t", /twice/],
  ["truss member index out of range", model([{ id: "t", type: "truss", joints: [O, { x: 2, y: 0 }], members: [[0, 5]] }]), "E_SCHEMA", "t"],
  ["junction naming a non-wire", model([{ id: "b", type: "rect", w: 1, h: 1, at: { x: 2, y: 2 } }, { id: "j", type: "junction", at: O, wires: ["b"] }]), "E_SCHEMA", "j", /not a wire/],
  ["transition from a box", model([{ id: "b", type: "rect", w: 1, h: 1, at: { x: -2, y: 0 } }, { id: "s", type: "state", at: { x: 2, y: 0 } }, { id: "t", type: "transition", from: "b", to: "s" }]), "E_SCHEMA", "t", /round/],
  ["self-loop on a box", model([{ id: "b", type: "rect", w: 1, h: 1, at: O }, { id: "l", type: "selfLoop", state: "b" }]), "E_SCHEMA", "l"],
  ["shade with upper and series", model([AX, { id: "s", type: "series", axes: "ax", fn: "x" }, { id: "h", type: "shade", axes: "ax", upper: "x", series: "s" }]), "E_SCHEMA", "h"],
  ["plotPoint without y", model([AX, { id: "p", type: "plotPoint", axes: "ax", x: 1 }]), "E_SCHEMA", "p"],
  ["guideLine with x and y", model([AX, { id: "g", type: "guideLine", axes: "ax", x: 1, y: 1 }]), "E_SCHEMA", "g"],
  ["fieldGrid with ex only", model([{ id: "f", type: "fieldGrid", from: { x: -2, y: -2 }, to: { x: 2, y: 2 }, ex: "1" }]), "E_SCHEMA", "f"],
  ["table rows of different lengths", model([{ id: "t", type: "table", at: O, rows: [["a", "b"], ["c"]] }]), "E_SCHEMA", "t"],
  ["legend entry without text", model([{ id: "l", type: "legend", at: O, entries: [{ kind: "line" }] }]), "E_SCHEMA", "l"],
  ["phasor on Cartesian axes", model([AX, { id: "v", type: "phasor", axes: "ax", magnitude: 1, angle: 0 }]), "E_SCHEMA", "v", /polarAxes/],
  ["axis spec with an unknown key", model([{ ...AX, x: { min: 0, max: 4, colour: "red" } }]), "E_SCHEMA", "ax", /Axis options/],
  ["pointLoad with length and magnitude", model([{ id: "F", type: "pointLoad", tip: O, length: 1, magnitude: "1 N" }]), "E_SCHEMA", "F"],
  // invalid values
  ["rounded corner larger than the box", model([{ id: "b", type: "roundedBox", at: O, w: 1, h: 0.5, r: 0.4 }]), "E_INVALID_VALUE", "b", /radius/],
  ["incline angle out of range", model([{ id: "i", type: "incline", at: O, base: 2, angle: 85 }]), "E_INVALID_VALUE", "i"],
  ["spring pitch too tight", model([{ id: "s", type: "coilSpring", from: { x: -1, y: 0 }, to: { x: 1, y: 0 }, coils: 40 }]), "E_INVALID_VALUE", "s", /pitch/],
  ["gear with too many teeth", model([{ id: "g", type: "gear", at: O, r: 0.5, teeth: 80 }]), "E_INVALID_VALUE", "g", /pitch/],
  ["moment sweep too small", model([{ id: "m", type: "moment", at: O, sweep: 10 }]), "E_INVALID_VALUE", "m"],
  ["meter letter does not fit", small([{ id: "A", type: "ammeter", at: O }]), "E_INVALID_VALUE", "A", /fit/],
  ["box text does not fit", model([{ id: "b", type: "roundedBox", at: O, w: 0.4, h: 0.3, text: "Controller" }]), "E_INVALID_VALUE", "b", /fit/],
  ["tick labels overlap", model([{ ...AX, w: 2, x: { min: 0, max: 1000, ticks: Array.from({ length: 21 }, (_, k) => k * 50) } }]), "E_INVALID_VALUE", "ax", /overlap/],
  ["log axis with min 0", model([{ ...AX, x: { min: 0, max: 10, scale: "log" } }]), "E_INVALID_VALUE", "ax", /log/],
  ["cross frame with grid", model([{ ...AX, frame: "cross", x: { min: -1, max: 1, grid: true } }]), "E_INVALID_VALUE", "ax", /cross/],
  ["plotPoint off the axes", model([AX, { id: "p", type: "plotPoint", axes: "ax", x: 9, y: 1 }]), "E_INVALID_VALUE", "p", /outside/],
  ["shade with an empty range", model([AX, { id: "h", type: "shade", axes: "ax", upper: "1", from: 3, to: 2 }]), "E_INVALID_VALUE", "h"],
  ["series entirely off the axes", model([AX, { id: "s", type: "series", axes: "ax", fn: "x + 10" }]), "E_INVALID_VALUE", "s", /visible/],
  ["intercept with no root", model([AX, { id: "s", type: "series", axes: "ax", fn: "x + 1" }, { id: "z", type: "intercept", series: "s" }]), "E_INVALID_VALUE", "z", /cross/],
  ["slope triangle leaving the axes", model([AX, { id: "s", type: "series", axes: "ax", fn: "x" }, { id: "k", type: "slopeTriangle", series: "s", x: 3, run: 3 }]), "E_INVALID_VALUE", "k"],
  ["span shorter than the symbol", model([{ id: "R", type: "resistor", at: O, span: 0.2 }]), "E_INVALID_VALUE", "R", /span/],
  ["NOT gate with two inputs", model([{ id: "G", type: "logicGate", kind: "NOT", inputs: 2, at: O }]), "E_INVALID_VALUE", "G"],
  ["square on a non-right angle", model([{ id: "a", type: "angleArc", vertex: O, fromAngle: 0, toAngle: 60, square: true }]), "E_INVALID_VALUE", "a", /90/],
  ["own line through own text", small([{ id: "i", type: "incline", at: { x: -3, y: -2 }, base: 0.8, angle: 12 }]), "E_INVALID_VALUE", "i"],
  // arrows too short
  ["double arrow too short", model([{ id: "d", type: "doubleArrow", from: O, to: { x: 0.3, y: 0 } }]), "E_ARROW_TOO_SHORT", "d"],
  ["curved arrow too short", model([{ id: "c", type: "curvedArrow", from: O, to: { x: 0.2, y: 0 } }]), "E_ARROW_TOO_SHORT", "c"],
  ["point load too short", model([{ id: "F", type: "pointLoad", tip: O, length: 0.1 }]), "E_ARROW_TOO_SHORT", "F"],
  ["phasor too short", model([{ id: "pa", type: "polarAxes", at: O, r: 2, ringLabels: false }, { id: "v", type: "phasor", axes: "pa", magnitude: 0.05, angle: 0 }]), "E_ARROW_TOO_SHORT", "v"],
  ["heat arrow too short", model([{ id: "q", type: "heatFlow", from: O, to: { x: 0.4, y: 0 } }]), "E_ARROW_TOO_SHORT", "q"],
  // contradictions and constraints
  ["no route around the obstacles", model([{ id: "A", type: "roundedBox", at: { x: -2, y: 0 }, w: 1, h: 1 }, { id: "W", type: "roundedBox", at: { x: 2, y: 0 }, w: 3, h: 3, fill: "none" }, { id: "B", type: "roundedBox", at: { x: 2, y: 0 }, w: 1, h: 1 }, { id: "c", type: "connector", from: "A.right", to: "B.left", route: "orthogonal", avoid: ["W"] }]), "E_CONTRADICTORY", "c", /route/], // the target sits inside an obstacle
  ["rope end inside its pulley", model([{ id: "p", type: "pulley", at: O, r: 1 }, { id: "r", type: "rope", route: [{ x: 0.2, y: 0 }, { around: "p" }, { x: 3, y: 0 }] }]), "E_CONTRADICTORY", "r", /tangent/],
  ["states too close for a transition", model([{ id: "a", type: "state", at: { x: -0.45, y: 0 } }, { id: "b", type: "state", at: { x: 0.45, y: 0 } }, { id: "t", type: "transition", from: "a", to: "b" }]), "E_CONTRADICTORY", "t"],
  ["junction at a plain corner", model([{ id: "a", type: "wire", points: [{ x: -2, y: 0 }, O] }, { id: "b", type: "wire", points: [O, { x: 0, y: -2 }] }, { id: "j", type: "junction", at: O, wires: ["a", "b"] }]), "E_CONSTRAINT_VIOLATED", "j", /node/],
  // values and units
  ["a field that vanishes everywhere", model([{ id: "f", type: "fieldGrid", from: { x: -2, y: -2 }, to: { x: 2, y: 2 }, ex: "0", ey: "0" }]), "E_NON_FINITE", "f"],
  ["plot expression with units", model([AX, { id: "s", type: "series", axes: "ax", fn: "x * 1 m" }]), "E_UNIT_MISMATCH", "s", /plain number/],
  ["trigonometry of a plain number", model([AX, { id: "s", type: "series", axes: "ax", fn: "sin(x)" }]), "E_UNIT_MISMATCH", "s"],
  ["point load magnitude without a scale", model([{ id: "F", type: "pointLoad", tip: O, magnitude: "10 N" }]), "E_SCALE_MISSING", "F"],
  ["point load magnitude against a mismatched scale", model([{ id: "F", type: "pointLoad", tip: O, magnitude: "10 N" }], { scales: { force: { per: "1 m/s" } } }), "E_UNIT_MISMATCH", "F"],
  ["rope around a missing pulley", model([{ id: "r", type: "rope", route: [{ x: -2, y: 0 }, { around: "ghost" }, { x: 2, y: 0 }] }]), "E_UNKNOWN_REF", "r"],
  ["off-palette colour in a legend", model([{ id: "l", type: "legend", at: O, entries: [{ text: "a", color: "pink" }] }]), "E_STYLE", "l", /palette/],
  ["text size off the contract", model([{ id: "b", type: "roundedBox", at: O, w: 2, h: 1, text: "A", textSize: 14 }]), "E_STYLE", "b"],
  ["unknown symbol in part text", model([{ id: "b", type: "roundedBox", at: O, w: 2, h: 1, text: "\\foo_N" }]), "E_TEXT_UNSUPPORTED", "b"],
  ["non-Latin script in part text", model([{ id: "b", type: "roundedBox", at: O, w: 2, h: 1, text: "F_{→}" }]), "E_TEXT_UNSUPPORTED", "b"],
  // gate
  ["an allowed contact through text", model([{ ...AX, x: { min: -2, max: 2, ticks: [-2, -1, 1, 2] }, y: { min: -2, max: 2, ticks: [-2, 2] }, frame: "cross" }, { id: "s", type: "series", axes: "ax", fn: "x - 1.15" }]), "E_COLLISION", "s", /text/],
  ["two parts overlapping", model([{ id: "a", type: "pulley", at: O, r: 1 }, { id: "b", type: "gear", at: { x: 0.5, y: 0 }, r: 1 }]), "E_COLLISION", "b"],
];

for (const [name, m, code, id, re] of CASES) {
  test(`part errors: ${name} -> ${code}`, () => {
    const r = compose(m);
    assert.ok(!r.ok, "expected a failure");
    if (r.ok) return;
    const hit = r.errors.find(e => e.code === code);
    assert.ok(hit, `expected ${code}, got ${r.errors.map(e => `${e.code}: ${e.message}`).join("; ")}`);
    assert.ok(hit!.elements.includes(id), `${code} names ${JSON.stringify(hit!.elements)}, expected "${id}"`);
    assert.ok(hit!.message.length > 10);
    if (re) assert.match(`${hit!.message} ${hit!.suggestion ?? ""}`, re);
  });
}

test("part errors: every code used is in the engine's table (no new codes)", () => {
  for (const [, , code] of CASES) assert.ok(code in TOOLKIT_ERROR_CODES);
});
