import { test } from "node:test";
import assert from "node:assert/strict";
import { circuitFromNetlist, netlistGround, normalizeNetlist, parseControl, siValue } from "../../src/circuit/circuit.js";
import { solveNetlist, solveNetlistTransient } from "../../src/circuit/spice.js";
import { layoutCircuit, type CircuitSpec } from "../../src/diagram/circuit_schematic.js";

const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

/** KCL at every node and the power balance, from the solved element currents alone. */
function balanced(spec: CircuitSpec) {
  const r = solveNetlist(spec);
  for (const n of Object.keys(r.nodes)) {
    if (n === r.ground) continue;
    const out = r.elements.reduce((s, e) => s + (e.from === n ? e.current : 0) - (e.to === n ? e.current : 0), 0);
    close(out, 0, 1e-9);
  }
  close(r.elements.reduce((s, e) => s + e.power, 0), 0, 1e-9);
  return r;
}

test("netlist: voltage divider with prefixed units", () => {
  const r = balanced({ elements: [
    { kind: "voltage-source", from: "0", to: "in", value: 12, unit: "V" },
    { kind: "resistor", from: "in", to: "out", label: "R_1", value: 1, unit: "kΩ" },
    { kind: "resistor", from: "out", to: "0", label: "R_2", value: 2, unit: "kohm" },
  ] });
  close(r.nodes.in, 12);
  close(r.nodes.out, 8);
  close(r.elements[1].current, 0.004);
  // The source delivers 48 mW: absorbed power is negative.
  close(r.elements[0].power, -0.048);
});

test("netlist: the circuit recipe (dependent sources named by label) matches hand nodal analysis", () => {
  const spec: CircuitSpec = { elements: [
    { kind: "current-source", from: "0", to: "1", value: 1, unit: "A" },
    { kind: "resistor", from: "1", to: "0", label: "R_1", value: 4, unit: "Ω" },
    { kind: "dependent-voltage-source", from: "2", to: "1", label: "4i_o" },
    { kind: "resistor", from: "2", to: "0", label: "R_2", value: 1, unit: "Ω", current: "i_o" },
    { kind: "resistor", from: "1", to: "3", label: "R_3", value: 1, unit: "Ω", voltage: "v_o" },
    { kind: "dependent-current-source", from: "2", to: "3", label: "2v_o" },
    { kind: "resistor", from: "3", to: "4", label: "R_4", value: 2, unit: "Ω" },
    { kind: "voltage-source", from: "0", to: "4", value: 10, unit: "V" },
  ] };
  const r = balanced(spec);
  // Nodal analysis by hand: v1 = 740/123, v2 = 148/123, v3 = 810/123, v4 = 10.
  close(r.nodes["1"], 740 / 123);
  close(r.nodes["2"], 148 / 123);
  close(r.nodes["3"], 810 / 123);
  close(r.nodes["4"], 10);
  close(r.quantities.i_o, 148 / 123);
  close(r.quantities.v_o, r.nodes["1"] - r.nodes["3"]);
  // The controlled quantities hold: V(1) − V(2) = 4 i_o and the dependent current is 2 v_o.
  close(r.nodes["1"] - r.nodes["2"], 4 * r.quantities.i_o);
  close(r.elements[5].current, 2 * r.quantities.v_o);
});

test("netlist: solver and drawing pick the same ground", () => {
  const spec: CircuitSpec = { elements: [
    { kind: "battery", from: "a", to: "b", value: 9, unit: "V" },
    { kind: "resistor", from: "b", to: "c", value: 100 },
    { kind: "resistor", from: "c", to: "a", value: 200 },
    { kind: "resistor", from: "c", to: "a", value: 200 },
  ] };
  const r = solveNetlist(spec);
  assert.equal(r.ground, netlistGround(spec.elements).ground);
  assert.equal(r.ground, "a"); // the first of the nodes with the most connections, as layoutCircuit draws on the rail
  assert.equal(layoutCircuit(spec).svg.length > 0, true);
  close(r.nodes.a - r.nodes.c, -9 * 100 / 200); // 9 V over 100 Ω + (200 ∥ 200) Ω
  assert.equal(solveNetlist({ ...spec, ground: "c" }).ground, "c");
});

test("netlist: capacitors open, inductors short, meters and switches", () => {
  const r = balanced({ elements: [
    { kind: "voltage-source", from: "0", to: "1", value: 5 },
    { kind: "ammeter", from: "1", to: "2", current: "i_s" },
    { kind: "inductor", from: "2", to: "3", value: 10, unit: "mH" },
    { kind: "resistor", from: "3", to: "0", value: 50 },
    { kind: "capacitor", from: "3", to: "0", value: 1, unit: "µF" },
    { kind: "voltmeter", from: "3", to: "0", voltage: "v_m" },
    { kind: "switch", from: "1", to: "4" },
    { kind: "resistor", from: "4", to: "0", value: 10 },
  ] });
  close(r.quantities.i_s, 0.1);
  close(r.quantities.v_m, 5);
  close(r.elements[4].current, 0);
  close(r.nodes["4"], 0); // the open switch carries nothing
  const closed = solveNetlist({ elements: [{ kind: "voltage-source", from: "0", to: "1", value: 5 }, { kind: "switch", from: "1", to: "2", closed: true }, { kind: "resistor", from: "2", to: "0", value: 10 }] });
  close(closed.elements[1].current, 0.5);
});

test("netlist: diodes conduct only forward, with their drop", () => {
  const forward = balanced({ elements: [{ kind: "voltage-source", from: "0", to: "1", value: 5 }, { kind: "resistor", from: "1", to: "2", value: 1000 }, { kind: "diode", from: "2", to: "0" }] });
  assert.equal(forward.elements[2].conducting, true);
  close(forward.elements[1].current, 4.3e-3);
  const reverse = solveNetlist({ elements: [{ kind: "voltage-source", from: "0", to: "1", value: 5 }, { kind: "resistor", from: "1", to: "2", value: 1000 }, { kind: "diode", from: "0", to: "2" }] });
  assert.equal(reverse.elements[2].conducting, false);
  close(reverse.elements[1].current, 0);
  const led = solveNetlist({ elements: [{ kind: "voltage-source", from: "0", to: "1", value: 5 }, { kind: "resistor", from: "1", to: "2", value: 150 }, { kind: "led", from: "2", to: "0", value: 1.8, unit: "V" }] });
  close(led.elements[1].current, 3.2 / 150);
});

test("netlist: clear errors for what cannot be solved", () => {
  assert.throws(() => solveNetlist({ elements: [{ kind: "resistor", from: "1", to: "0", value: 1, unit: "V" }] }), /unit "V".*Ω/);
  assert.throws(() => solveNetlist({ elements: [{ kind: "voltage-source", from: "0", to: "1", value: 1 }, { kind: "dependent-current-source", from: "1", to: "0", label: "3i_x" }] }), /must say what controls it.*no element names/);
  assert.throws(() => solveNetlist({ elements: [{ kind: "voltage-source", from: "0", to: "1", value: 1 }, { kind: "voltage-source", from: "0", to: "1", value: 2 }] }), /no unique DC solution/);
  assert.throws(() => solveNetlist({ elements: [{ kind: "current-source", from: "0", to: "1", value: 1 }, { kind: "capacitor", from: "1", to: "0", value: 1e-6 }] }), /no unique DC solution/);
  assert.throws(() => solveNetlist({ elements: [{ kind: "resistor", from: "1", to: "0" }] }), /needs a value/);
  assert.throws(() => solveNetlist({ elements: [{ kind: "ac-source", from: "0", to: "1", value: 1 }, { kind: "resistor", from: "1", to: "0", value: 1 }] }), /AC source/);
  assert.throws(() => normalizeNetlist({ elements: [{ kind: "resistor", from: "1", to: "1", value: 1 }] }), /to itself/);
});

test("netlist: units, controls and gains", () => {
  close(siValue(2.2, "kΩ", "resistor"), 2200);
  close(siValue(47, "uF", "capacitor"), 47e-6);
  close(siValue(10, "mA", "current-source"), 0.01);
  assert.deepEqual(parseControl("4i_o"), { name: "i_o", gain: 4 });
  assert.deepEqual(parseControl("0.5 v_{x}"), { name: "v_x", gain: 0.5 });
  assert.deepEqual(parseControl("-i_b"), { name: "i_b", gain: -1 });
  assert.equal(parseControl("R1 = 4"), null);
  // An explicit control and gain override the label.
  const r = solveNetlist({ elements: [{ kind: "voltage-source", from: "0", to: "1", value: 2 }, { kind: "resistor", from: "1", to: "0", value: 1, current: "i_x" }, { kind: "cccs", from: "0", to: "2", label: "β i_x", control: "i_x", gain: 50 }, { kind: "resistor", from: "2", to: "0", value: 1 }] });
  close(r.nodes["2"], 100);
});

test("netlist transient: RC charging matches 1 − e^(−t/RC) and maps back to names", () => {
  const spec: CircuitSpec = { elements: [{ kind: "voltage-source", from: "0", to: "in", value: 5 }, { kind: "resistor", from: "in", to: "out", value: 1, unit: "kΩ", id: "R" }, { kind: "capacitor", from: "out", to: "0", value: 1, unit: "µF" }] };
  const r = solveNetlistTransient(spec, { startTime: 0, endTime: 0.005, dt: 1e-5 });
  const at = Math.round(0.001 / 1e-5);
  assert.ok(Math.abs(r.nodes.out[at] - 5 * (1 - 1 / Math.E)) < 0.05 * 5 * (1 - 1 / Math.E));
  assert.ok(Array.isArray(r.currents.R) && r.currents.R.length === r.times.length);
  assert.ok(r.nodes.in.at(-1)! > 4.9);
  assert.throws(() => circuitFromNetlist({ elements: [{ kind: "vcvs", from: "0", to: "1", label: "2v_x" }, { kind: "resistor", from: "1", to: "0", value: 1, voltage: "v_x" }] }), /transient solver does not model/);
});
