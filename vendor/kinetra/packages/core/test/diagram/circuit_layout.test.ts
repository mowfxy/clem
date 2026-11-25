import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutCircuit, layoutSchematic } from "../../src/diagram/circuit_schematic.js";
import type { CircuitLayout, CircuitSpec, Schematic } from "../../src/diagram/circuit_schematic.js";
import { CLEAR, boxSegDistance, labelLines, formatValue, near } from "../../src/diagram/schematic_kit.js";
import type { Box, Pt } from "../../src/diagram/schematic_kit.js";

const figures: Record<string, CircuitSpec> = {
  dependent: { title: "Dependent sources", elements: [
    { kind: "current-source", from: "0", to: "1", label: "1 A" },
    { kind: "resistor", from: "1", to: "0", label: "4 ohm", value: 4, unit: "ohm" },
    { kind: "resistor", from: "1", to: "3", label: "R", value: 1, unit: "ohm", voltage: "v_o" },
    { kind: "dependent-voltage-source", from: "2", to: "1", label: "4i_o" },
    { kind: "resistor", from: "2", to: "0", value: 1, unit: "ohm", current: "i_o" },
    { kind: "dependent-current-source", from: "2", to: "3", label: "2v_o" },
    { kind: "resistor", from: "3", to: "0", value: 4, unit: "Ω" },
    { kind: "resistor", from: "3", to: "4", value: 2, unit: "Ω" },
    { kind: "voltage-source", from: "0", to: "4", value: 10, unit: "V" }] },
  nested: { elements: [
    { kind: "voltage-source", from: "0", to: "a", value: 16, unit: "V" },
    { kind: "current-source", from: "a", to: "b", label: "I_S" },
    { kind: "resistor", from: "a", to: "c", value: 4, unit: "Ω" },
    { kind: "voltage-source", from: "c", to: "b", value: 12, unit: "V" },
    { kind: "resistor", from: "b", to: "0", value: 5, unit: "Ω" },
    { kind: "resistor", from: "c", to: "d", value: 2, unit: "Ω" },
    { kind: "current-source", from: "b", to: "d", value: 2, unit: "A" },
    { kind: "resistor", from: "d", to: "0", value: 4, unit: "Ω" }] },
  bridge: { title: "Wheatstone bridge", elements: [
    { kind: "battery", from: "gnd", to: "top", value: 9, unit: "V" },
    { kind: "resistor", from: "top", to: "l", label: "R_1", value: 1000, unit: "Ω" },
    { kind: "resistor", from: "top", to: "r", label: "R_2", value: 2200, unit: "Ω" },
    { kind: "resistor", from: "l", to: "gnd", label: "R_3", value: 330, unit: "Ω" },
    { kind: "resistor", from: "r", to: "gnd", label: "R_x" },
    { kind: "ammeter", from: "l", to: "r", label: "G" }] },
  rlc: { elements: [
    { kind: "ac-source", from: "0", to: "in", label: "v_s", value: 10, unit: "V" },
    { kind: "resistor", from: "in", to: "m", label: "R", value: 100, unit: "Ω", current: "i" },
    { kind: "inductor", from: "m", to: "out", label: "L", value: 0.01, unit: "H" },
    { kind: "capacitor", from: "out", to: "0", label: "C", value: 1e-6, unit: "F", voltage: "v_C" },
    { kind: "switch", from: "in", to: "out", label: "S" },
    { kind: "diode", from: "m", to: "0", label: "D_1" }] },
};

/** Rebuilds the electrical nets from the drawn wires: ends that meet, or an end on another wire, are joined; plain crossings are not. */
function nets(layout: CircuitLayout) {
  const pts: Pt[] = [];
  const id = (p: Pt) => { let i = pts.findIndex((q) => Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5); if (i < 0) { pts.push(p); i = pts.length - 1; } return i; };
  const parent: number[] = [];
  const find = (i: number): number => (parent[i] === undefined || parent[i] === i ? (parent[i] = i) : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (const s of layout.segments) join(id(s.a), id(s.b));
  for (const p of [...pts]) for (const s of layout.segments) {
    const onV = s.a.x === s.b.x && Math.abs(p.x - s.a.x) < 0.5 && p.y > Math.min(s.a.y, s.b.y) - 0.5 && p.y < Math.max(s.a.y, s.b.y) + 0.5;
    const onH = s.a.y === s.b.y && Math.abs(p.y - s.a.y) < 0.5 && p.x > Math.min(s.a.x, s.b.x) - 0.5 && p.x < Math.max(s.a.x, s.b.x) + 0.5;
    const t = s.a.x !== s.b.x && s.a.y !== s.b.y && boxSegDistance({ ...p, w: 0, h: 0 }, s) < 0.3;
    if (onV || onH || t) join(id(p), id(s.a));
  }
  return (p: Pt) => find(id(p));
}

function check(name: string, spec: CircuitSpec, layout = layoutCircuit(spec), slants = false, clearances = true) {
  assert.ok(!/NaN|Infinity/.test(layout.svg), `${name}: non-finite SVG`);
  if (!slants) for (const s of layout.segments) assert.ok(s.a.x === s.b.x || s.a.y === s.b.y, `${name}: slanted wire ${JSON.stringify(s)}`);
  // The drawing connects exactly what the netlist connects.
  const net = nets(layout);
  const byNode = new Map<string, Set<number>>();
  spec.elements.forEach((e, i) => {
    const at = layout.pins.find((p) => p.id === (e.id ?? `E${i + 1}`))!.at;
    for (const [node, p] of [[e.from, at[0]], [e.to, at[1]]] as const) (byNode.get(node) ?? byNode.set(node, new Set()).get(node)!).add(net(p));
  });
  for (const [node, set] of byNode) assert.equal(set.size, 1, `${name}: node ${node} is drawn as ${set.size} separate nets`);
  const all = [...byNode.values()].map((s) => [...s][0]);
  assert.equal(new Set(all).size, all.length, `${name}: two different nodes are drawn connected`);
  if (!clearances) return;
  // Every label keeps its clearance from wires, symbols and other labels.
  const labels = layout.labels;
  for (const l of labels) {
    for (const s of layout.segments) assert.ok(boxSegDistance(l.box, s) >= CLEAR - 0.5, `${name}: "${l.lines.join(" ")}" is ${boxSegDistance(l.box, s).toFixed(1)}px from a wire`);
    for (const b of layout.bodies) assert.ok(!near(l.box, b, CLEAR - 0.5), `${name}: "${l.lines.join(" ")}" touches a symbol`);
    for (const o of labels) if (o !== l) assert.ok(!near(l.box, o.box, CLEAR - 0.5), `${name}: "${l.lines.join(" ")}" touches "${o.lines.join(" ")}"`);
    const vb = layout.svg.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
    assert.ok(l.box.x >= vb[0] && l.box.y >= vb[1] && l.box.x + l.box.w <= vb[0] + vb[2] && l.box.y + l.box.h <= vb[1] + vb[3], `${name}: label outside the frame`);
  }
}

for (const [name, spec] of Object.entries(figures)) test(`circuit layout: ${name} is orthogonal, connected as specified and clearly labelled`, () => check(name, spec));

test("circuit layout: random ladder and bridge circuits stay orthogonal, correct and uncluttered", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const kinds = ["resistor", "capacitor", "inductor", "voltage-source", "current-source", "dependent-voltage-source", "dependent-current-source", "diode"];
  for (let n = 0; n < Number(process.env.FUZZ ?? 60); n++) {
    const count = 2 + Math.floor(rnd() * 4), nodes = Array.from({ length: count }, (_, i) => `n${i + 1}`);
    const elements: CircuitSpec["elements"] = [];
    for (const [i, node] of nodes.entries()) {
      if (rnd() < 0.8 || i === 0) elements.push({ kind: kinds[Math.floor(rnd() * kinds.length)], from: node, to: "0", label: `X_${elements.length + 1}`, value: Math.round(rnd() * 1000), unit: "Ω" });
      if (i > 0) elements.push({ kind: kinds[Math.floor(rnd() * kinds.length)], from: nodes[i - 1], to: node, label: `Y${elements.length + 1}` });
    }
    for (let k = 0; k < Math.floor(rnd() * 3); k++) {
      const a = Math.floor(rnd() * count), b = Math.floor(rnd() * count);
      if (a !== b) elements.push({ kind: "resistor", from: nodes[a], to: nodes[b], value: 10, unit: "kΩ", current: rnd() < 0.3 ? "i_x" : undefined });
    }
    check(`random ${n}`, { elements });
  }
});

// The problem from a textbook: two columns of nodes joined by rungs and diagonals, with the source looping round the left.
const R = (from: string, to: string, value: number, more: Partial<CircuitSpec["elements"][number]> = {}) => ({ kind: "resistor", from, to, value, unit: "Ω", ...more });
const ladder: CircuitSpec = {
  layout: { 1: [1, 0], 2: [1, 1], 3: [1, 2], 0: [1, 3], 4: [3, 0], 5: [3, 1], 6: [3, 2], 7: [3, 3] }, dots: "all", earth: false,
  elements: [{ kind: "voltage-source", from: "0", to: "1", value: 120, unit: "V", at: [0, 1.5] }, R("1", "2", 10), R("2", "3", 10), R("3", "0", 10),
    R("1", "4", 10), R("1", "5", 20), R("5", "2", 20, { current: "i_1", currentAt: "to" }), R("3", "5", 20), R("3", "6", 20, { current: "i_2", currentAt: "to" }),
    R("3", "7", 10), R("7", "0", 5), R("4", "5", 10), R("5", "6", 20), R("6", "7", 10)],
};

test("circuit grid: a figure's own arrangement is kept, slanted branches included", () => {
  const drawn = layoutCircuit(ladder);
  check("ladder", ladder, drawn, true);
  // Every pin sits where its node was placed (one scale for both axes), and all eight nodes carry a dot.
  const pin = (i: number, end: 0 | 1) => drawn.pins[i].at[end];
  const unit = pin(1, 1).y - pin(1, 0).y;
  ladder.elements.forEach((e, i) => ([e.from, e.to] as const).forEach((n, end) => {
    const [x, y] = ladder.layout![n] as [number, number], p = pin(i, end as 0 | 1);
    assert.ok(Math.abs(p.x - x * unit) < 1 && Math.abs(p.y - y * unit) < 1, `node ${n} is drawn at ${p.x / unit},${p.y / unit}`);
  }));
  assert.equal(drawn.dots.length, 8);
  // Exactly the three diagonals of the figure are slanted: two pieces each.
  assert.equal(drawn.segments.filter((s) => s.a.x !== s.b.x && s.a.y !== s.b.y).length, 6);
});

test("circuit grid: the source loops round the figure and no label, dot or ground is invented", () => {
  const drawn = layoutCircuit(ladder);
  assert.ok(drawn.segments.some((s) => Math.abs(s.a.x) < 1 && Math.abs(s.b.x) < 1), "the source stands in its own column");
  assert.equal(layoutCircuit({ ...ladder, earth: true }).bodies.length, drawn.bodies.length + 1);
  const named = layoutCircuit({ ...ladder, nodeLabels: true });
  for (const n of ["0", "1", "7"]) assert.ok(named.labels.some((l) => l.lines[0] === n));
  check("named", ladder, named, true);
});

test("circuit grid: a netlist too interconnected for one rail is arranged on a grid, the same way every time", () => {
  const bare = { elements: ladder.elements.map(({ at: _at, ...e }) => e) };
  const drawn = layoutCircuit(bare);
  check("bare", bare, drawn, true);
  assert.ok(drawn.height > 350, "still a single rail");
  assert.equal(drawn.svg, layoutCircuit(bare).svg);
});

test("circuit grid: rails, parallel branches, crossings, corners and pixel coordinates", () => {
  const V: CircuitSpec["elements"][number] = { kind: "voltage-source", from: "0", to: "a", value: 10, unit: "V" };
  check("rail", { elements: [V] , layout: { a: [0, 0], 0: [0, 1] } });
  const rail: CircuitSpec = { layout: { a: [0, 0], b: [1, 0], c: [2, 0], 0: [[0, 1], [2, 1]] }, elements: [V, R("a", "b", 1000, { current: "i" }), R("b", "0", 2000, { voltage: "v_x" }), R("b", "c", 500), R("c", "0", 100), R("c", "0", 100), R("a", "c", 47)] };
  check("parallel", rail);
  const x: CircuitSpec = { layout: { a: [0, 0], b: [1, 0], c: [0, 1], 0: [1, 1] }, elements: [R("a", "b", 1), R("c", "0", 2), R("a", "c", 3), R("b", "0", 4), R("a", "0", 5), R("b", "c", 6)] };
  check("crossing", x, undefined, true);
  const cross = layoutCircuit(x).pins[4].at;
  assert.ok(cross[0].x < cross[1].x && cross[0].y < cross[1].y, "crossing diagonals keep their corners");
  check("corners", { layout: { a: [1, 0], 0: [1, 2] }, elements: [{ ...V, via: [[0, 2], [0, 0]] }, R("a", "0", 5)] });
  check("pixels", { layout: { a: [100, 50], b: [300, 50], 0: [100, 200], c: [300, 200] }, elements: [V, R("a", "b", 1), R("b", "c", 3), R("c", "0", 4), R("b", "0", 3)] }, undefined, true);
  // Two nodes placed on one spot cannot be drawn: the circuit is arranged another way rather than shorted.
  check("clash", { layout: { a: [0, 0], b: [0, 0], 0: [0, 1] }, elements: [V, R("a", "b", 1), R("b", "0", 1)] }, undefined, true);
});

test("circuit grid: random placements never connect what the netlist does not", () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let n = 0; n < Number(process.env.FUZZ ?? 40); n++) {
    const names = ["0", "a", "b", "c", "d", "e"].slice(0, 3 + Math.floor(rnd() * 4));
    const cells = Array.from({ length: 12 }, (_, i): [number, number] => [i % 4, Math.floor(i / 4)]).sort(() => rnd() - 0.5);
    const elements: CircuitSpec["elements"] = names.slice(1).map((m, i) => R(names[Math.floor(rnd() * (i + 1))], m, i + 1));
    for (let k = 0; k < 5; k++) { const a = Math.floor(rnd() * names.length), b = Math.floor(rnd() * names.length); if (a !== b) elements.push(R(names[a], names[b], 9)); }
    const spec: CircuitSpec = { elements, layout: Object.fromEntries(names.map((m, i) => [m, cells[i]])) };
    check(`placed ${n}`, spec, undefined, true, false);
  }
});

test("circuit layout: values print once with engineering prefixes", () => {
  assert.deepEqual(labelLines("4 ohm", 4, "ohm"), ["4 Ω"]);
  assert.deepEqual(labelLines("1 ohm, vo", 1, "Ω"), ["vo", "1 Ω"]);
  assert.deepEqual(labelLines("R1", 2200, "Ω"), ["R1", "2.2 kΩ"]);
  assert.deepEqual(labelLines("R1 = 4 Ω", 4, "Ω"), ["R1 = 4 Ω"]);
  assert.equal(formatValue(0.002, "A"), "2 mA");
  assert.equal(formatValue(1e-6, "F"), "1 µF");
  assert.equal(formatValue(1, "kΩ"), "1 kΩ");
});

test("circuit layout: a bad netlist is rejected with a reason", () => {
  assert.throws(() => layoutCircuit({ elements: [{ kind: "resistor", from: "a", to: "a" }] }), /itself/);
  assert.throws(() => layoutCircuit({ elements: [{ kind: "flux-capacitor", from: "a", to: "0" }] }), /unsupported component kind/);
  assert.throws(() => layoutCircuit({ elements: [{ kind: "resistor", from: "a", to: "0" }], layout: { a: [0, 0] } }), /no position for node "0"/);
  assert.throws(() => layoutCircuit({ elements: [{ kind: "resistor", from: "a", to: "0" }], layout: { a: [0, 0], 0: [1, "x"] } as never }), /numbers/);
});

test("placed schematic: wires given without corners are routed at right angles and labels stay clear", () => {
  const s: Schematic = { width: 600, height: 420, world: { xMin: 0, xMax: 8, yMin: 0, yMax: 5 }, components: [
    { id: "V", kind: "voltage-source", value: 10, unit: "V", position: { x: 1, y: 2.5 }, rotationDeg: 90 },
    { id: "R1", kind: "resistor", label: "1 ohm, vo", value: 1, unit: "Ω", position: { x: 4, y: 4.2 } },
    { id: "G", kind: "dependent-current-source", label: "2v_o", position: { x: 5, y: 2.5 } },
    { id: "R2", kind: "resistor", value: 4, unit: "Ω", position: { x: 7, y: 2.5 }, rotationDeg: 90 },
    { id: "GND", kind: "ground", position: { x: 4, y: 0.6 } }],
    wires: [{ from: { componentId: "V", pin: 1 }, to: { componentId: "R1", pin: 0 } }, { from: { componentId: "R1", pin: 1 }, to: { componentId: "R2", pin: 1 } },
      { from: { componentId: "R1", pin: 0 }, to: { componentId: "G", pin: 0 } }, { from: { componentId: "G", pin: 1 }, to: { componentId: "R2", pin: 1 } },
      { from: { componentId: "R2", pin: 0 }, to: { componentId: "GND", pin: 0 } }, { from: { componentId: "V", pin: 0 }, to: { componentId: "GND", pin: 0 } }] };
  const layout = layoutSchematic(s);
  for (const seg of layout.segments) assert.ok(seg.a.x === seg.b.x || seg.a.y === seg.b.y, "slanted wire");
  for (const l of layout.labels) {
    for (const seg of layout.segments) assert.ok(boxSegDistance(l.box, seg) >= CLEAR - 0.5, `"${l.lines.join(" ")}" crowds a wire`);
    for (const o of layout.labels) if (o !== l) assert.ok(!near(l.box, o.box, 1), "labels overlap");
  }
  assert.ok(!layout.svg.includes("(1Ω)") && !layout.svg.includes("ohm"), "value repeated in the label");
});
