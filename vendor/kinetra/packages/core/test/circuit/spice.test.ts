import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newCircuit,
  addNode,
  addGround,
  addResistor,
  addCapacitor,
  addInductor,
  addVoltageSource,
  addCurrentSource,
  validateCircuit,
} from "../../src/circuit/circuit.js";
import { solveDC, solveTransient } from "../../src/circuit/spice.js";

// Helper: voltage-divider DC check.
function mkVoltageDivider(vSrc: number, r1: number, r2: number) {
  const c = newCircuit("vdiv");
  const n1 = addNode(c);
  const n2 = addNode(c);
  addGround(c, 0);
  addResistor(c, n1, n2, r1);
  addResistor(c, n2, 0, r2);
  addVoltageSource(c, n1, 0, vSrc);
  validateCircuit(c);
  return c;
}

test("solveDC: voltage divider Vmid = Vsrc * R2/(R1+R2)", () => {
  const c = mkVoltageDivider(10, 1000, 1000);
  const r = solveDC(c);
  // The mid node is the second non-ground node, sorted ascending -> index 1.
  const ids = [...new Set(c.components.flatMap((x) => x.nodes))].filter((n) => n !== 0).sort((a, b) => a - b);
  const vMid = r.nodeVoltages.get(ids[1])!;
  assert.ok(Math.abs(vMid - 5) < 1e-6, "vMid=" + vMid);
});

test("solveDC: voltage divider with R1=1k, R2=2k -> Vmid = 10 * 2/3", () => {
  const c = mkVoltageDivider(10, 1000, 2000);
  const r = solveDC(c);
  const ids = [...new Set(c.components.flatMap((x) => x.nodes))].filter((n) => n !== 0).sort((a, b) => a - b);
  const vMid = r.nodeVoltages.get(ids[1])!;
  assert.ok(Math.abs(vMid - 10 * 2 / 3) < 1e-6, "vMid=" + vMid);
});

test("solveDC: current-source feeds a known current through a resistor", () => {
  // 10 mA flows from ground to n1 through the source; through R it goes from n1 back to ground.
  // KCL: at n1, source supplies +10 mA, resistor carries (V_n1 - 0)/100 out -> V_n1/100 = 0.01 -> V_n1 = 1 V.
  const c = newCircuit("cs");
  const n1 = addNode(c);
  addGround(c, 0);
  addResistor(c, n1, 0, 100);
  addCurrentSource(c, 0, n1, 0.01); // current from a to b: from ground (0) to n1
  validateCircuit(c);
  const r = solveDC(c);
  assert.ok(Math.abs(r.nodeVoltages.get(n1)! - 1) < 1e-6, "V_n1=" + r.nodeVoltages.get(n1)!);
});

test("solveTransient: RC low-pass step response (R=1k, C=1uF, V=5V) matches textbook", () => {
  // Topology: Vsrc -> R -> n1 -> C -> gnd. tau = R*C = 1 ms.
  // V_c(t) = 5 * (1 - exp(-t/tau)). At t=tau: V_c = 5 * (1 - 1/e) ~ 3.16.
  const c = newCircuit("rc_lp");
  const nSrc = addNode(c);
  const n1 = addNode(c);
  addGround(c, 0);
  addResistor(c, nSrc, n1, 1000);
  addCapacitor(c, n1, 0, 1e-6);
  addVoltageSource(c, nSrc, 0, 5);
  validateCircuit(c);
  const dt = 1e-5;
  const endTime = 0.005; // 5*tau
  const tr = solveTransient(c, { startTime: 0, endTime, dt, recordNodes: [n1] });
  const v = tr.nodeVoltages.get(n1)!;
  // At t=0+, Vc starts near 0 (initial cap voltage is 0).
  assert.ok(v[0] < 0.5, "V_c(0)=" + v[0] + " should be small");
  // At t=tau (1 ms), V_c ~= 3.16 V; allow 5% tolerance for discretization.
  const idxTau = Math.round(0.001 / dt);
  const vTau = v[idxTau];
  const vTauExpected = 5 * (1 - 1 / Math.E);
  assert.ok(Math.abs(vTau - vTauExpected) < 0.05 * vTauExpected, `V_c(tau)=${vTau} expected ${vTauExpected.toFixed(3)}`);
  // At t=5*tau (5 ms), V_c ~ 5 V (within a few percent).
  const vFinal = v[v.length - 1];
  assert.ok(Math.abs(vFinal - 5) < 0.1, `V_c(5tau)=${vFinal} expected ~5`);
  // Monotonic non-decreasing charging.
  for (let i = 1; i < v.length; i++) assert.ok(v[i] >= v[i - 1] - 1e-9, `non-monotonic at i=${i}: ${v[i - 1]} -> ${v[i]}`);
});

test("solveTransient: RC high-pass step response (Vsrc -> C -> n1 -> R -> gnd) starts at Vsrc then decays", () => {
  // At t=0+: capacitor is uncharged, so all of Vsrc appears across the resistor (V_n1 = Vsrc = 5).
  // At t=tau = RC: V_n1 = Vsrc * exp(-1) ~ 1.84.
  // At t=5*tau: V_n1 ~ 0.
  const c = newCircuit("rc_hp");
  const nSrc = addNode(c);
  const n1 = addNode(c);
  addGround(c, 0);
  addCapacitor(c, nSrc, n1, 1e-6);
  addResistor(c, n1, 0, 1000);
  addVoltageSource(c, nSrc, 0, 5);
  validateCircuit(c);
  const dt = 1e-5;
  const tr = solveTransient(c, { startTime: 0, endTime: 0.005, dt, recordNodes: [n1] });
  const v = tr.nodeVoltages.get(n1)!;
  // At t=0, V starts near 5 (capacitor initially uncharged, ideal step).
  assert.ok(v[0] > 4, `V_n1(0)=${v[0]} expected ~5`);
  const idxTau = Math.round(0.001 / dt);
  const vTau = v[idxTau];
  const vTauExpected = 5 * Math.exp(-1);
  assert.ok(Math.abs(vTau - vTauExpected) < 0.1 * vTauExpected, `V_n1(tau)=${vTau} expected ${vTauExpected.toFixed(3)}`);
  // Monotonic non-increasing decay.
  for (let i = 1; i < v.length; i++) assert.ok(v[i] <= v[i - 1] + 1e-9, `non-monotonic at i=${i}`);
});

test("solveTransient: RL step response (R=100, L=10mH, V=10V) matches exponential growth", () => {
  // Topology: Vsrc -> R -> n1 -> L -> gnd. tau = L/R = 0.1 ms.
  // I_L(t) = (V/R) * (1 - exp(-t/tau)); V_n1(t) = Vsrc - I*R.
  // At t=tau: I_L = 0.1 * 0.632 = 0.0632 A, V_n1 = 10 - 0.0632*100 = 3.68 V.
  const c = newCircuit("rl");
  const nSrc = addNode(c);
  const n1 = addNode(c);
  addGround(c, 0);
  addResistor(c, nSrc, n1, 100);
  const l = addInductor(c, n1, 0, 0.01);
  addVoltageSource(c, nSrc, 0, 10);
  validateCircuit(c);
  const dt = 1e-5;
  const tr = solveTransient(c, { startTime: 0, endTime: 0.005, dt, recordNodes: [n1], recordComponents: [l.id] });
  const v = tr.nodeVoltages.get(n1)!;
  const iL = tr.componentCurrents.get(l.id)!;
  // V_n1 starts near Vsrc (inductor blocks the initial change in current).
  assert.ok(v[0] > 9, `V_n1(0)=${v[0]} expected ~10`);
  // I_L starts near 0 and grows toward V/R = 0.1 A.
  assert.ok(iL[0] < 0.05, `I_L(0)=${iL[0]} expected ~0`);
  assert.ok(iL[iL.length - 1] > 0.099, `I_L(5ms)=${iL[iL.length - 1]} expected ~0.1`);
  // I_L is monotonically increasing.
  for (let i = 1; i < iL.length; i++) assert.ok(iL[i] >= iL[i - 1] - 1e-9, `non-monotonic at i=${i}`);
  // I_L at tau (0.1 ms) within 10% of 0.0632.
  const idxTau = Math.round(0.0001 / dt);
  const iTau = iL[idxTau];
  assert.ok(Math.abs(iTau - 0.0632) < 0.01, `I_L(tau)=${iTau} expected ~0.0632`);
  // V_n1 decays from Vsrc toward 0 (since I_L grows and drops more voltage across R).
  assert.ok(v[v.length - 1] < 0.01, `V_n1(5ms)=${v[v.length - 1]} expected ~0`);
});

test("solveTransient: capacitor on initial voltage starts near its initial voltage", () => {
  // RC circuit with cap pre-charged to 3V and Vsrc=0.
  // Capacitor should discharge: V_c(t) = V0 * exp(-t/tau).
  const c = newCircuit("rc_disc");
  const nSrc = addNode(c);
  const n1 = addNode(c);
  addGround(c, 0);
  addResistor(c, nSrc, n1, 1000);
  const cap = addCapacitor(c, n1, 0, 1e-6);
  cap.initialVoltage = 3;
  addVoltageSource(c, nSrc, 0, 0);
  validateCircuit(c);
  const dt = 1e-5;
  const tr = solveTransient(c, { startTime: 0, endTime: 0.005, dt, recordNodes: [n1] });
  const v = tr.nodeVoltages.get(n1)!;
  // First step: V_c slightly below 3V (the Norton companion leaks some current).
  assert.ok(Math.abs(v[0] - 3) < 0.05, `V_c(0)=${v[0]} expected ~3`);
  // At t=tau, V_c ~= 3 * exp(-1) ~ 1.10.
  const idxTau = Math.round(0.001 / dt);
  const vTau = v[idxTau];
  const vTauExpected = 3 * Math.exp(-1);
  assert.ok(Math.abs(vTau - vTauExpected) < 0.15 * vTauExpected, `V_c(tau)=${vTau} expected ~${vTauExpected.toFixed(3)}`);
});

test("solveTransient: inductor tied to ground (not just floating) does not produce NaN", () => {
  // The previous bug: x[nodeIndex(0)] was undefined -> NaN propagation.
  // Verify a simple RL circuit where one inductor terminal IS ground.
  const c = newCircuit("rl_gnd");
  const nSrc = addNode(c);
  const n1 = addNode(c);
  addGround(c, 0);
  addResistor(c, nSrc, n1, 100);
  const l = addInductor(c, n1, 0, 0.01);
  addVoltageSource(c, nSrc, 0, 10);
  validateCircuit(c);
  const tr = solveTransient(c, { startTime: 0, endTime: 0.001, dt: 1e-5, recordComponents: [l.id] });
  const iL = tr.componentCurrents.get(l.id)!;
  for (const v of iL) assert.ok(Number.isFinite(v), "I_L should be finite, got " + v);
});

test("solveTransient: RL with inductor initial current starts at that value", () => {
  const c = newCircuit("rl_init");
  const nSrc = addNode(c);
  const n1 = addNode(c);
  addGround(c, 0);
  addResistor(c, nSrc, n1, 100);
  const l = addInductor(c, n1, 0, 0.01);
  l.initialCurrent = 0.05;
  addVoltageSource(c, nSrc, 0, 0); // source off, but cap pre-charged
  validateCircuit(c);
  const tr = solveTransient(c, { startTime: 0, endTime: 0.005, dt: 1e-5, recordComponents: [l.id] });
  const iL = tr.componentCurrents.get(l.id)!;
  // Starts at 0.05 A, decays toward 0 (Vsrc=0, so the inductor dumps its current into R).
  assert.ok(Math.abs(iL[0] - 0.05) < 0.005, `I_L(0)=${iL[0]} expected ~0.05`);
  assert.ok(iL[iL.length - 1] < 0.005, `I_L(5ms)=${iL[iL.length - 1]} expected ~0`);
});

test("solveDC: voltage source feeds power to a resistor (power balance)", () => {
  // V=10 V, R=100 ohm. Current = 0.1 A. Power from source = 10*0.1 = 1 W. Power in R = 0.01*100 = 1 W.
  const c = newCircuit("pwr");
  const n1 = addNode(c);
  addGround(c, 0);
  addResistor(c, n1, 0, 100);
  addVoltageSource(c, n1, 0, 10);
  validateCircuit(c);
  const r = solveDC(c);
  const id = [...r.componentPowers.keys()].find((k) => k.startsWith("r_"))!;
  const vSrcId = [...r.componentPowers.keys()].find((k) => k.startsWith("v_"))!;
  assert.ok(Math.abs(r.componentPowers.get(id)! - 1) < 1e-6, `P_R=${r.componentPowers.get(id)} expected 1 W`);
  assert.ok(Math.abs(Math.abs(r.componentPowers.get(vSrcId)!) - 1) < 1e-6, `P_V_magnitude=${Math.abs(r.componentPowers.get(vSrcId)!)} expected 1 W`);
});
