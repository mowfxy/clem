/**
 * Behaviour tests for the part library: geometry that must be exact (rope
 * tangency, meshing, rims), wrapped template symbols that must match the
 * originals, the connector router, circuit junction rules, plot values exposed
 * to checks, and the text rules of the overlap gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutSchematic } from "../../src/diagram/circuit_schematic.js";
import type { ComponentKind } from "../../src/diagram/circuit_schematic.js";
import { logicTerminals } from "../../src/diagram/logic_schematic.js";
import { toolkitRouteOrthogonal } from "../../src/toolkit/index.js";
import { autoTicks, tickText } from "../../src/toolkit/parts/plots.js";
import { beltTangent } from "../../src/toolkit/parts/mechanics.js";
import { gateTerminalsUnits } from "../../src/toolkit/parts/logic.js";
import type { ComposeModel, ElementSpec } from "../../src/toolkit/index.js";
import { close, err, model, ok } from "./helpers.js";
import { resolveModel } from "./parts_helpers.js";

const pt = (r: ReturnType<typeof ok>, id: string, key: string) => (r.report.elements.find(e => e.id === id)!.points as Record<string, { x: number; y: number }>)?.[key];
const anchorOf = (m: ComposeModel, id: string, name: string, arg?: number) => { const { ctx, res } = resolveModel(m); return res.defs.get(id)!.anchor(res.instances.get(id)!, name, arg, ctx)!; };
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// --- circuits: wrapped template symbols -----------------------------------------------------------------

const TEMPLATE: [ComponentKind, string][] = [["resistor", "resistor"], ["capacitor", "capacitor"], ["inductor", "inductor"], ["voltage-source", "voltageSource"], ["current-source", "currentSource"], ["switch", "switch"]];
for (const [kind, type] of TEMPLATE) for (const rot of [0, 90, 30]) {
  test(`circuits: toolkit ${type} has the template schematic's pin positions (rotation ${rot})`, () => {
    const canvas = { width: 400, height: 300, world: { xMin: -2, xMax: 2, yMin: -1.5, yMax: 1.5 } };
    // Clem: the schematic routes its wires as one path, so read the pins from its layout.
    const lines = layoutSchematic({ ...canvas, components: [{ id: "c", kind, position: { x: 0.2, y: -0.1 }, rotationDeg: rot }], wires: [{ from: { componentId: "c", pin: 0 }, to: { point: { x: -1.8, y: 1.3 } } }, { from: { componentId: "c", pin: 1 }, to: { point: { x: 1.8, y: -1.3 } } }] }).pins.find(p => p.id === "c")!.at;
    const m: ComposeModel = { canvas, elements: [{ id: "c", type, at: { x: 0.2, y: -0.1 }, rotation: rot }] };
    const { ctx } = resolveModel(m);
    for (const [k, pin] of ["pin0", "pin1"].entries()) {
      const v = ctx.view.toView(anchorOf(m, "c", pin));
      close(v.x, lines[k]!.x, 1e-9); close(v.y, lines[k]!.y, 1e-9);
    }
  });
}

test("circuits: the toolkit resistor zig-zag has the template path's vertices and stroke width", () => {
  const m: ComposeModel = { canvas: { width: 400, height: 300, world: { xMin: -2, xMax: 2, yMin: -1.5, yMax: 1.5 } }, elements: [{ id: "R", type: "resistor", at: { x: 0, y: 0 } }] };
  const { ctx, res } = resolveModel(m);
  const shapes = res.defs.get("R")!.draw(res.instances.get("R")!, ctx).filter(s => s.kind === "segment") as { from: { x: number; y: number }; to: { x: number; y: number }; width?: number }[];
  // Template: M -0.3 0 l 0.06 -0.18 l 0.12 0.36 l 0.12 -0.36 l 0.12 0.36 l 0.12 -0.36 l 0.06 0.18 (circuit_schematic.ts).
  const exp = [[-0.3, 0], [-0.24, -0.18], [-0.12, 0.18], [0, -0.18], [0.12, 0.18], [0.24, -0.18], [0.3, 0]];
  shapes.forEach((s, k) => { close(s.from.x, exp[k]![0]!); close(s.from.y, exp[k]![1]!); close(s.to.x, exp[k + 1]![0]!); close(s.to.y, exp[k + 1]![1]!); assert.equal(s.width, 1.4); });
  assert.equal(shapes.length, 6);
});

test("circuits: span extends the leads symmetrically and keeps the pins on the axis", () => {
  const m = model([{ id: "R", type: "resistor", at: { x: 1, y: 0.5 }, span: 2, rotation: 90 }]);
  const a = anchorOf(m, "R", "pin0"), b = anchorOf(m, "R", "pin1");
  close(dist(a, b), 2); close(a.x, 1); close(b.x, 1);
  err(model([{ id: "R", type: "resistor", at: { x: 0, y: 0 }, span: 0.2 }]), "E_INVALID_VALUE");
});

test("circuits: a junction is accepted only at a real node of three or more wire ends", () => {
  const w = (id: string, pts: { x: number; y: number }[]): ElementSpec => ({ id, type: "wire", points: pts });
  const o = { x: 0, y: 0 };
  ok(model([w("a", [{ x: -2, y: 0 }, { x: 2, y: 0 }]), w("b", [o, { x: 0, y: -2 }]), { id: "j", type: "junction", at: o, wires: ["a", "b"] }]));
  const corner = err(model([w("a", [{ x: -2, y: 0 }, o]), w("b", [o, { x: 0, y: -2 }]), { id: "j", type: "junction", at: o, wires: ["a", "b"] }]), "E_CONSTRAINT_VIOLATED");
  assert.match(corner.message, /only 2 wire ends/);
  err(model([w("a", [{ x: -2, y: 1 }, { x: 2, y: 1 }]), w("b", [o, { x: 0, y: -2 }]), { id: "j", type: "junction", at: o, wires: ["a", "b"] }]), "E_CONSTRAINT_VIOLATED");
  // Without the junction the T is two touching wires: the gate rejects it.
  err(model([w("a", [{ x: -2, y: 0 }, { x: 2, y: 0 }]), w("b", [o, { x: 0, y: -2 }])]), "E_COLLISION");
});

test("circuits: crossing wires without a junction are not connected and are allowed by the wire part itself", () => {
  // Agent 3: a clean crossing no longer needs mayTouch; the contact is reported with its reason.
  const els: ElementSpec[] = [{ id: "a", type: "wire", points: [{ x: -2, y: 0 }, { x: 2, y: 0 }] }, { id: "b", type: "wire", points: [{ x: 0, y: 2 }, { x: 0, y: -2 }] }];
  const r = ok(model(els));
  assert.ok(r.report.contacts.some(c => c.reason === "wires cross without connecting (no junction)"));
  assert.ok(!r.svg.includes("<circle"), "no junction dot is drawn at a crossing");
  ok(model([{ ...els[0]!, mayTouch: ["b"] }, els[1]!]));
  // Not crossings: a T without a junction, a shared corner, a collinear overlap, a crossing next to a corner.
  err(model([els[0]!, { id: "b", type: "wire", points: [{ x: 0, y: 0 }, { x: 0, y: -2 }] }]), "E_COLLISION");
  err(model([{ id: "a", type: "wire", points: [{ x: -2, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 }] }, { id: "b", type: "wire", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }]), "E_COLLISION");
  err(model([els[0]!, { id: "b", type: "wire", points: [{ x: -1, y: 0 }, { x: 1, y: 0 }] }]), "E_COLLISION");
  err(model([els[0]!, { id: "b", type: "wire", points: [{ x: 0.02, y: 2 }, { x: 0.02, y: 0.02 }, { x: 1, y: -1 }] }]), "E_COLLISION");
});

test("circuits: wires attached to pins may touch their components; the op-amp and transistors expose role pins", () => {
  const r = ok(model([
    { id: "U", type: "opamp", at: { x: 0, y: 0 }, scale: 3 },
    { id: "w1", type: "wire", points: [{ x: -3, y: 0.45 }, "U.inMinus"] },
    { id: "w2", type: "wire", points: ["U.out", { x: 3, y: 0 }] },
    { id: "Q", type: "bjt", at: { x: 0, y: -2.5 }, scale: 2 },
  ]));
  assert.ok(r.report.contacts.some(c => c.reason === "mayTouch"));
  const m = model([{ id: "U", type: "opamp", at: { x: 0, y: 0 }, scale: 3 }]);
  close(anchorOf(m, "U", "inPlus").y, -0.45); close(anchorOf(m, "U", "out").x, 1.35);
});

test("circuits: meter letters must fit inside the meter at the current zoom", () => {
  const e = err({ canvas: { width: 200, height: 150, world: { xMin: -4, xMax: 4, yMin: -3, yMax: 3 } }, elements: [{ id: "A", type: "ammeter", at: { x: 0, y: 0 } }] }, "E_INVALID_VALUE");
  assert.match(e.suggestion ?? "", /scale/);
});

// --- logic ---------------------------------------------------------------------------------------------

test("logic: IEC gate terminals match logic_schematic.ts logicTerminals for 1-6 inputs", () => {
  for (let n = 1; n <= 6; n++) {
    const g = { id: "g", kind: n === 1 ? "NOT" : "AND", inputs: Array.from({ length: n }, (_, k) => `i${k}`), output: "o" } as Parameters<typeof logicTerminals>[0];
    const ref = logicTerminals(g, { x: 100, y: 200 });
    const mine = gateTerminalsUnits(n);
    ref.inputs.forEach((p, k) => { close(mine.inputs[k]!.x, p.x - 100); close(mine.inputs[k]!.y, p.y - 200); });
    close(mine.output.x, ref.output.x - 100); close(mine.output.y, ref.output.y - 200);
    // And the composed part puts in(k) there (unit = w / 56, y flipped).
    const m = model([{ id: "G", type: "logicGate", kind: n === 1 ? "NOT" : "AND", inputs: n, at: { x: 0, y: 0 }, w: 1.12 }]);
    const u = 1.12 / 56;
    for (let k = 0; k < n; k++) { const a = anchorOf(m, "G", "in", k); close(a.x, (ref.inputs[k]!.x - 100 - 28) * u); close(a.y, -(ref.inputs[k]!.y - 200) * u); }
  }
});

test("logic: gate input counts are validated; transitions and self-loops start and end on the state rims", () => {
  err(model([{ id: "G", type: "logicGate", kind: "NOT", inputs: 2, at: { x: 0, y: 0 } }]), "E_INVALID_VALUE");
  err(model([{ id: "G", type: "logicGate", kind: "AND", inputs: 1, at: { x: 0, y: 0 } }]), "E_INVALID_VALUE");
  const els: ElementSpec[] = [
    { id: "a", type: "state", at: { x: -2, y: 0 }, r: 0.6, text: "A" }, { id: "b", type: "state", at: { x: 2, y: 0 }, r: 0.6, text: "B", accepting: true },
    { id: "t", type: "transition", from: "a", to: "b", bend: 0.25 }, { id: "l", type: "selfLoop", state: "a", angle: 90 },
  ];
  const m = model(els);
  ok(m);
  close(dist(anchorOf(m, "t", "start"), { x: -2, y: 0 }), 0.6, 1e-9);
  assert.ok(Math.abs(dist(anchorOf(m, "t", "end"), { x: 2, y: 0 }) - 0.6) < 0.05);
  close(dist(anchorOf(m, "l", "start"), { x: -2, y: 0 }), 0.6, 1e-9);
  close(dist(anchorOf(m, "l", "end"), { x: -2, y: 0 }), 0.6, 1e-9);
  err(model([els[0]!, { id: "t", type: "transition", from: "a", to: "a" }]), "E_SCHEMA");
});

// --- mechanics -------------------------------------------------------------------------------------------

test("mechanics: rope runs are exact common tangents of the wrapped pulleys", () => {
  const m = model([
    { id: "p1", type: "pulley", at: { x: -1.5, y: 1.5 }, r: 0.6 }, { id: "p2", type: "pulley", at: { x: 1.5, y: 0.5 }, r: 0.4 },
    { id: "A", type: "point", at: { x: -2.1, y: -2 } }, { id: "B", type: "point", at: { x: 1.9, y: -2 } },
    { id: "rope", type: "rope", route: ["A", { around: "p1", dir: "cw" }, { around: "p2", dir: "ccw" }, "B"] },
  ]);
  ok(m);
  const { res } = resolveModel(m);
  const segs = (res.instances.get("rope")!.props as { segments: [{ x: number; y: number }, { x: number; y: number }][] }).segments;
  const lineDist = (c: { x: number; y: number }, [a, b]: [{ x: number; y: number }, { x: number; y: number }]) => Math.abs((b.x - a.x) * (a.y - c.y) - (a.x - c.x) * (b.y - a.y)) / dist(a, b);
  close(lineDist({ x: -1.5, y: 1.5 }, segs[0]!), 0.6, 1e-12);
  close(lineDist({ x: -1.5, y: 1.5 }, segs[1]!), 0.6, 1e-12);
  close(lineDist({ x: 1.5, y: 0.5 }, segs[1]!), 0.4, 1e-12);
  close(lineDist({ x: 1.5, y: 0.5 }, segs[2]!), 0.4, 1e-12);
  // Contact points lie on the rims.
  close(dist(segs[1]![0], { x: -1.5, y: 1.5 }), 0.6, 1e-12);
  close(dist(segs[1]![1], { x: 1.5, y: 0.5 }), 0.4, 1e-12);
});

test("mechanics: beltTangent handles open and crossed belts and rejects overlapping wheels", () => {
  const [a, b] = beltTangent({ x: 0, y: 0 }, 1, { x: 5, y: 0 }, 1)!; close(a.y, b.y); close(Math.abs(a.y), 1);
  const [c, d] = beltTangent({ x: 0, y: 0 }, 1, { x: 5, y: 0 }, -1)!; close(dist(c, { x: 0, y: 0 }), 1); close(dist(d, { x: 5, y: 0 }), 1); assert.ok(c.y * d.y < 0);
  assert.equal(beltTangent({ x: 0, y: 0 }, 1, { x: 1, y: 0 }, -1), undefined);
  err(model([{ id: "p", type: "pulley", at: { x: 0, y: 0 }, r: 1 }, { id: "r", type: "rope", route: [{ x: 0.2, y: 0 }, { around: "p" }, { x: 3, y: 0 }] }]), "E_CONTRADICTORY");
});

test("mechanics: spring coils adapt to length and an over-tight pitch is rejected", () => {
  const coils = (L: number) => { const m = model([{ id: "s", type: "coilSpring", from: { x: -L / 2, y: 0 }, to: { x: L / 2, y: 0 } }]); const r = ok(m); void r; const { ctx, res } = resolveModel(m); return res.defs.get("s")!.refs!(res.instances.get("s")!, ctx).coils!.value; };
  assert.ok(coils(6) > coils(3));
  const e = err(model([{ id: "s", type: "coilSpring", from: { x: -1, y: 0 }, to: { x: 1, y: 0 }, coils: 40 }]), "E_INVALID_VALUE");
  assert.match(e.suggestion ?? "", /coils/);
});

test("mechanics: gears placed tangentTo each other mesh at the pitch circles", () => {
  const m = model([{ id: "g1", type: "gear", at: { x: -1, y: 0 }, r: 1, teeth: 20 }, { id: "g2", type: "gear", r: 0.5, teeth: 10, place: [{ tangentTo: "g1" }, { y: 0 }], prefer: "right", mayTouch: ["g1"] }]);
  const r = ok(m);
  close(r.report.elements.find(e => e.id === "g2")!.origin.x, 0.5, 1e-9);
});

test("mechanics: incline refs feed checks; distributed-load resultant sits at the load centroid", () => {
  ok(model([{ id: "inc", type: "incline", at: { x: -3, y: -2 }, base: 5, angle: "30 deg" }], { checks: [{ type: "equal", left: "inc.angle", right: "30 deg" }, { type: "equal", left: "inc.height", right: "5 m * tan(30 deg)", tol: "1e-9 m" }] }));
  const m = model([{ id: "b", type: "beam", from: { x: -3, y: 0 }, to: { x: 3, y: 0 } }, { id: "q", type: "distributedLoad", from: "b.topStart", to: "b.topEnd", height: 1.2, endHeight: 0 }]);
  ok(m);
  close(anchorOf(m, "q", "resultant").x, -3 + 6 / 3, 1e-9);
});

test("mechanics: point loads with magnitudes take part in vectorSum and the automatic scale check", () => {
  const r = ok(model([
    { id: "b", type: "beam", from: { x: -3, y: 0 }, to: { x: 3, y: 0 } },
    { id: "F1", type: "pointLoad", tip: "b.top(0.25)", magnitude: "20 N" },
    { id: "F2", type: "pointLoad", tip: "b.bottom(0.75)", magnitude: "20 N", angle: 90 },
  ], { scales: { force: { per: "10 N" } }, checks: [{ type: "vectorSum", vectors: ["F1", "F2"] }] }));
  assert.ok(r.report.checks.every(c => c.pass));
  assert.ok(r.report.checks.length >= 2);
});

test("mechanics: truss counts support the m + r = 2j check", () => {
  ok(model([{ id: "t", type: "truss", joints: [{ x: -2, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 1.5 }, { x: 1, y: 1.5 }], members: [[0, 1], [1, 2], [0, 3], [3, 1], [1, 4], [4, 2], [3, 4]] }], { checks: [{ type: "equal", left: "t.members + 3", right: "2*t.joints" }] }));
  err(model([{ id: "t", type: "truss", joints: [{ x: -2, y: 0 }, { x: 0, y: 0 }], members: [[0, 1], [1, 0]] }]), "E_SCHEMA");
});

// --- general --------------------------------------------------------------------------------------------

test("general: the orthogonal router avoids obstacles with axis-aligned runs", () => {
  const m = model([
    { id: "A", type: "roundedBox", at: { x: -4, y: 0 }, w: 1.2, h: 0.8, text: "A" },
    { id: "B", type: "roundedBox", at: { x: 4, y: 0 }, w: 1.2, h: 0.8, text: "B" },
    { id: "W", type: "roundedBox", at: { x: 0, y: 0 }, w: 1.2, h: 3, text: "W" },
    { id: "c", type: "connector", from: "A.right", to: "B.left", route: "orthogonal", avoid: ["W"] },
  ]);
  ok(m);
  const { res } = resolveModel(m);
  const path = (res.instances.get("c")!.props as { path: { x: number; y: number }[] }).path;
  for (let k = 1; k < path.length; k++) assert.ok(Math.abs(path[k]!.x - path[k - 1]!.x) < 1e-9 || Math.abs(path[k]!.y - path[k - 1]!.y) < 1e-9, "axis-aligned");
  for (const p of path) assert.ok(!(p.x > -0.6 && p.x < 0.6 && p.y > -1.5 && p.y < 1.5), "no corner inside the obstacle");
  assert.ok(path.some(p => Math.abs(p.y) > 1.5), "goes around");
  close(path[0]!.x, -3.4); close(path[path.length - 1]!.x, 3.4);
});

test("general: the router prefers the route that does not cross a listed connector", () => {
  const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  // Another connector comes up from below and stops under the obstacle: the route below would cross it.
  const other = [{ x: 0, y: -3 }, { x: 0, y: -0.45 }];
  const route = toolkitRouteOrthogonal({ x: -2, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, [box(-0.4, -0.4, 0.4, 0.4)], [other], 0.1)!;
  assert.ok(route.every(p => p.y >= -1e-9), "never goes below the start");
  assert.ok(route.some(p => p.y > 0.4), "goes over the obstacle, away from the other connector");
});

test("general: dimension text is the measured length in the chosen unit; angleArc exposes its angle", () => {
  const m = model([{ id: "d", type: "dimension", from: { x: -2, y: 0 }, to: { x: 1, y: 0 }, unit: "cm" }]);
  const { ctx, res } = resolveModel(m);
  const t = res.defs.get("d")!.draw(res.instances.get("d")!, ctx).find(s => s.kind === "label") as { text: string };
  assert.equal(t.text, "300 cm");
  ok(model([{ id: "o", type: "point", at: { x: 0, y: 0 } }, { id: "a", type: "angleArc", vertex: { x: 0, y: 0 }, start: { x: 2, y: 0 }, end: { x: "2*cos(40 deg)", y: "2*sin(40 deg)" }, r: 1, text: "\\alpha" }], { checks: [{ type: "equal", left: "a.angle", right: "40 deg", tol: "1e-9 rad" }] }));
});

test("general: curved-arrow apex is bend x chord from the chord midpoint; brace tip sits at its depth", () => {
  const m = model([{ id: "c", type: "curvedArrow", from: { x: -2, y: 0 }, to: { x: 2, y: 0 }, bend: 0.25 }, { id: "b", type: "brace", from: { x: 2, y: -2 }, to: { x: -2, y: -2 }, depth: 0.4 }]);
  ok(m);
  close(anchorOf(m, "c", "apex").y, 1, 1e-12);
  const tip = anchorOf(m, "b", "tip"); close(tip.x, 0, 1e-12); close(tip.y, -2.4, 1e-12);
});

test("general: table rows must agree in length; legend and table expose row anchors", () => {
  err(model([{ id: "t", type: "table", at: { x: 0, y: 0 }, rows: [["a", "b"], ["c"]] }]), "E_SCHEMA");
  const m = model([{ id: "t", type: "table", at: { x: 0, y: 0 }, rows: [["x", "y"], [1, 2]] }, { id: "l", type: "legend", at: { x: 0, y: 2.5 }, entries: [{ text: "a" }, { text: "b", kind: "arrow", color: "force" }] }]);
  ok(m);
  assert.ok(anchorOf(m, "t", "row", 1).y < anchorOf(m, "t", "row", 0).y);
  assert.ok(anchorOf(m, "l", "entry", 1).y < anchorOf(m, "l", "entry", 0).y);
});

// --- fields and fluids ---------------------------------------------------------------------------------------

test("fields: a field grid that is zero everywhere is rejected; a uniform grid draws nx x ny arrows", () => {
  err(model([{ id: "g", type: "fieldGrid", from: { x: -3, y: -2 }, to: { x: 3, y: 2 }, ex: "0", ey: "0*x" }]), "E_NON_FINITE");
  const m = model([{ id: "g", type: "fieldGrid", from: { x: -3, y: -2 }, to: { x: 3, y: 2 }, nx: 4, ny: 3 }]);
  ok(m);
  const { ctx, res } = resolveModel(m);
  assert.equal(res.defs.get("g")!.draw(res.instances.get("g")!, ctx).filter(s => s.kind === "vector").length, 12);
});

test("fluids: tank surface anchor sits at level x height; piston gas text must fit", () => {
  const m = model([{ id: "t", type: "tank", at: { x: 0, y: -2 }, w: 3, h: 3, level: 0.4 }]);
  ok(m);
  close(anchorOf(m, "t", "surface").y, -2 + 1.2, 1e-12);
  err({ canvas: { width: 120, height: 90, world: { xMin: -4, xMax: 4, yMin: -3, yMax: 3 } }, elements: [{ id: "p", type: "pistonCylinder", at: { x: 0, y: -2 }, w: 0.6, h: 2, text: "gas at 300 K" }] }, "E_INVALID_VALUE");
});

// --- plots ------------------------------------------------------------------------------------------------------

test("plots: auto ticks are nice numbers; log ticks are decades; tick text formats both", () => {
  assert.deepEqual(autoTicks(0, 10, "linear"), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(autoTicks(0.01, 1000, "log"), [0.01, 0.1, 1, 10, 100, 1000]);
  const ax = { min: 0, max: 1, scale: "linear" as const, ticks: [0, 0.25, 0.5], grid: false, minor: [] };
  assert.equal(tickText(0.25, ax), "0.25");
  assert.equal(tickText(-1, { ...ax, ticks: [-1, 0, 1] }), "−1");
  assert.equal(tickText(1e-4, { ...ax, scale: "log" }), "10⁻⁴");
});

const AX: ElementSpec = { id: "ax", type: "axes", at: { x: -4.5, y: -2.8 }, w: 9, h: 5.6, x: { min: 0, max: 4, ticks: 4 }, y: { min: 0, max: 3, ticks: 3 } };

test("plots: a plotPoint on a fn series passes onCurve; shade area integrates 1/x; slope and intercept refs are exact", () => {
  ok(model([AX, { id: "s", type: "series", axes: "ax", fn: "x^2/8 + 0.5" }, { id: "p", type: "plotPoint", axes: "ax", x: 2, series: "s" }], { checks: [{ type: "onCurve", point: "p", curve: "s", tol: 1e-9 }] }));
  err(model([AX, { id: "s", type: "series", axes: "ax", fn: "x^2/8 + 0.5" }, { id: "p", type: "plotPoint", axes: "ax", x: 2, y: 1.1, mayTouch: ["s"] }], { checks: [{ type: "onCurve", point: "p", curve: "s", tol: 1e-6 }] }), "E_CHECK_FAILED");
  ok(model([AX, { id: "sh", type: "shade", axes: "ax", upper: "1/x", from: 1, to: 3 }], { checks: [{ type: "equal", left: "sh.area", right: "ln(3)", tol: 1e-4 }] }));
  ok(model([AX, { id: "s", type: "series", axes: "ax", fn: "0.6*x + 0.2" }, { id: "k", type: "slopeTriangle", series: "s", x: 1, run: 2 }], { checks: [{ type: "equal", left: "k.slope", right: 0.6, tol: 1e-12 }] }));
  const cross: ElementSpec = { ...AX, x: { min: -2, max: 2, ticks: [-2, 2] }, y: { min: -2, max: 2, ticks: [-2, 2] }, frame: "cross" };
  ok(model([cross, { id: "s", type: "series", axes: "ax", fn: "x/2 + 0.5", domain: [-1.6, 1.8] }, { id: "z", type: "intercept", series: "s" }], { checks: [{ type: "equal", left: "z.value", right: -1, tol: 1e-9 }] }));
});

test("plots: points outside the axes, log axes with min <= 0 and overlapping tick labels are rejected", () => {
  err(model([AX, { id: "p", type: "plotPoint", axes: "ax", x: 9, y: 1 }]), "E_INVALID_VALUE");
  err(model([{ ...AX, x: { min: 0, max: 10, scale: "log" } }]), "E_INVALID_VALUE");
  err(model([{ ...AX, w: 2, x: { min: 0, max: 1000, ticks: Array.from({ length: 21 }, (_, k) => k * 50) } }]), "E_INVALID_VALUE");
  err(model([AX, { id: "s", type: "series", axes: "missing", fn: "x" }]), "E_UNKNOWN_REF");
});

test("plots: a log x axis clips non-positive data and plots decades evenly", () => {
  const m = model([{ ...AX, x: { min: 0.1, max: 1000, scale: "log" }, y: { min: -60, max: 10, ticks: [-60, -40, -20, 0] } }, { id: "s", type: "series", axes: "ax", fn: "-20*log10(sqrt(1 + x^2))" }]);
  ok(m);
  const a1 = anchorOf(m, "ax", "x", 1), a10 = anchorOf(m, "ax", "x", 10), a100 = anchorOf(m, "ax", "x", 100);
  close(a10.x - a1.x, a100.x - a10.x, 1e-9);
});

test("plots: phasors expose re/im and chain tip-to-tail with `from`", () => {
  ok(model([{ id: "pa", type: "polarAxes", at: { x: 0, y: 0 }, r: 3, rMax: 2, spokes: 90, ringLabels: false }, { id: "v1", type: "phasor", axes: "pa", magnitude: 1, angle: 0 }, { id: "v2", type: "phasor", axes: "pa", from: "v1", magnitude: 1, angle: 90, color: "rayAlt" }],
    { checks: [{ type: "equal", left: "v1.re + v2.re", right: 1, tol: 1e-12 }, { type: "equal", left: "v2.im", right: 1, tol: 1e-12 }] }));
});

// --- the gate's text rules -----------------------------------------------------------------------------------------

test("gate: parts allowed to touch still may not run through each other's text", () => {
  const cross: ElementSpec = { ...AX, x: { min: -2, max: 2, ticks: [-2, -1, 1, 2] }, y: { min: -2, max: 2, ticks: [-2, 2] }, frame: "cross" };
  const e = err(model([cross, { id: "s", type: "series", axes: "ax", fn: "x - 1.15" }]), "E_COLLISION");
  assert.match(e.message, /text/);
});

test("gate: a part's own line through its own text is rejected", () => {
  const e = err({ canvas: { width: 200, height: 150, world: { xMin: -2, xMax: 2, yMin: -1.5, yMax: 1.5 } }, elements: [{ id: "inc", type: "incline", at: { x: -1.8, y: -1.3 }, base: 0.5, angle: 15 }] }, "E_INVALID_VALUE");
  assert.match(e.suggestion ?? "", /markText|larger/);
});
