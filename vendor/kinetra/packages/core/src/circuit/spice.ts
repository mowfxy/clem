/**
 * Deterministic circuit solver for Kinetra. Supports:
 *  - DC analysis (modified nodal analysis) for circuits with R, V, I, switches.
 *  - Transient analysis via backward Euler for RC, RL, RLC.
 *
 * The solver is intentionally simple and documented. It is NOT a SPICE
 * replacement. It handles the common first- and second-order circuits
 * found in introductory electronics.
 */

import { validateCircuit, normalizeNetlist, circuitFromNetlist } from "./circuit.js";
import type { Circuit, Netlist, NormalElement } from "./circuit.js";
import type { AnyComponent, CircuitNodeId } from "./circuit.js";

export interface DCResult {
  /** Node voltages (index = nodeId, value = voltage in volts; node 0 = 0). */
  nodeVoltages: Map<number, number>;
  /** Component currents (keyed by component id). */
  componentCurrents: Map<string, number>;
  /** Component powers (W). */
  componentPowers: Map<string, number>;
}

export interface TransientOptions {
  startTime: number; // s
  endTime: number; // s
  /** Time step. */
  dt: number;
  /** Component that switches state at given time. */
  events?: { t: number; componentId: string; closed: boolean }[];
  /** Optional list of node ids to record. */
  recordNodes?: number[];
  /** Optional list of component ids whose current is recorded. */
  recordComponents?: string[];
  /** Source waveform function for voltage source components with id === "v0" by default. */
  waveform?: (t: number) => number;
}

export interface TransientResult {
  times: number[];
  /** Map of nodeId -> array of voltages. */
  nodeVoltages: Map<number, number[]>;
  /** Map of componentId -> array of currents. */
  componentCurrents: Map<string, number[]>;
}

/**
 * DC analysis. Uses MNA: KCL at every non-ground node, plus a branch
 * variable for each independent voltage source. Solves Ax = b via Gaussian
 * elimination with partial pivoting.
 */
export function solveDC(circuit: Circuit, opts: { sourceOverride?: Map<string, number> } = {}): DCResult {
  validateCircuit(circuit);
  // Build MNA matrix.
  const nodeIds = [...new Set(circuit.components.flatMap((c) => c.nodes))].filter((n) => n !== 0).sort((a, b) => a - b);
  const vSources = circuit.components.filter((c) => c.kind === "voltage-source") as any[];
  // Variable order: [node1, node2, ..., nodeN, vbranch_1, vbranch_2, ...]
  const nNodes = nodeIds.length;
  const nVsrc = vSources.length;
  const dim = nNodes + nVsrc;
  const A: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
  const b: number[] = new Array(dim).fill(0);
  // Helper: node index in matrix (-1 for ground)
  const nodeIndex = (n: number) => (n === 0 ? -1 : nodeIds.indexOf(n));
  // For voltage sources, find branch index
  const vbranchIndex = (id: string) => {
    const i = vSources.findIndex((v) => v.id === id);
    return i < 0 ? -1 : nNodes + i;
  };
  // Stamp components
  for (const comp of circuit.components) {
    const [a, b2] = comp.nodes;
    const ia = nodeIndex(a);
    const ib = nodeIndex(b2);
    switch (comp.kind) {
      case "resistor": {
        const g = 1 / comp.ohms;
        if (ia >= 0) A[ia][ia] += g;
        if (ib >= 0) A[ib][ib] += g;
        if (ia >= 0 && ib >= 0) { A[ia][ib] -= g; A[ib][ia] -= g; }
        break;
      }
      case "current-source": {
        const I = comp.amps;
        if (ia >= 0) b[ia] -= I;
        if (ib >= 0) b[ib] += I;
        break;
      }
      case "voltage-source": {
        const vb = vbranchIndex(comp.id);
        if (vb < 0) throw new Error("VSource branch index missing");
        if (ia >= 0) { A[ia][vb] += 1; A[vb][ia] += 1; }
        if (ib >= 0) { A[ib][vb] -= 1; A[vb][ib] -= 1; }
        const V = opts.sourceOverride?.get(comp.id) ?? comp.volts;
        b[vb] += V;
        break;
      }
      case "switch": {
        if (comp.closed) {
          // Treat as a 0-ohm resistor.
          const g = 1e9;
          if (ia >= 0) A[ia][ia] += g;
          if (ib >= 0) A[ib][ib] += g;
          if (ia >= 0 && ib >= 0) { A[ia][ib] -= g; A[ib][ia] -= g; }
        }
        break;
      }
      // Capacitors, inductors, diodes not used in DC.
    }
  }
  // Solve
  const x = solveLinear(A, b);
  const nodeVoltages = new Map<number, number>();
  nodeVoltages.set(0, 0);
  for (let i = 0; i < nNodes; i++) nodeVoltages.set(nodeIds[i], x[i]);
  // Component currents
  const componentCurrents = new Map<string, number>();
  const componentPowers = new Map<string, number>();
  for (const comp of circuit.components) {
    const va = nodeVoltages.get(comp.nodes[0])!;
    const vb = nodeVoltages.get(comp.nodes[1])!;
    let I = 0, P = 0;
    switch (comp.kind) {
      case "resistor": {
        I = (va - vb) / comp.ohms; P = I * I * comp.ohms; break;
      }
      case "voltage-source": {
        const vb2 = vbranchIndex(comp.id);
        I = x[vb2]; P = -I * (va - vb); break;
      }
      case "current-source": {
        I = comp.amps; P = I * (va - vb); break;
      }
      case "switch": {
        if (comp.closed) I = (va - vb) / 1e-9; P = I * I * 1e-9;
        break;
      }
    }
    componentCurrents.set(comp.id, I);
    componentPowers.set(comp.id, P);
  }
  return { nodeVoltages, componentCurrents, componentPowers };
}

/**
 * Transient analysis via backward Euler. Resistors + sources + capacitors
 * + inductors are supported. Switch events are honoured.
 */
export function solveTransient(circuit: Circuit, opts: TransientOptions): TransientResult {
  validateCircuit(circuit);
  const dt = opts.dt;
  const steps = Math.max(1, Math.round((opts.endTime - opts.startTime) / dt));
  const nodeIds = [...new Set(circuit.components.flatMap((c) => c.nodes))].filter((n) => n !== 0).sort((a, b) => a - b);
  const dim = nodeIds.length;
  const times: number[] = [];
  const nodeVoltages: Map<number, number[]> = new Map();
  const componentCurrents: Map<string, number[]> = new Map();
  for (const n of nodeIds) nodeVoltages.set(n, []);
  for (const c of circuit.components) componentCurrents.set(c.id, []);
  if (opts.recordNodes) for (const n of opts.recordNodes) if (!nodeVoltages.has(n)) nodeVoltages.set(n, []);
  if (opts.recordComponents) for (const c of opts.recordComponents) if (!componentCurrents.has(c)) componentCurrents.set(c, []);

  // State: previous step voltages and inductor currents.
  const vPrev = new Array(dim + 1).fill(0);
  // Seed vPrev from capacitor initial voltages (V_initial is V_a - V_b).
  // We accumulate contributions: each cap adds initialVoltage to node a and subtracts it from node b.
  // For a single capacitor between a non-ground node and ground, this sets vPrev[cap_node+1] = initialVoltage.
  // For two capacitors in series, their contributions add, which is the expected behaviour.
  for (const c of circuit.components) {
    if (c.kind === "capacitor" && (c as any).initialVoltage !== undefined) {
      const [a, b] = c.nodes;
      const Vinit = (c as any).initialVoltage as number;
      if (a !== 0) vPrev[nodeIds.indexOf(a) + 1] += Vinit;
      if (b !== 0) vPrev[nodeIds.indexOf(b) + 1] -= Vinit;
    }
  }
  const iLPrev = new Map<string, number>();
  for (const c of circuit.components) if (c.kind === "inductor") iLPrev.set(c.id, c.initialCurrent ?? 0);

  const switchStates = new Map<string, boolean>();
  for (const c of circuit.components) if (c.kind === "switch") switchStates.set(c.id, (c as any).closed);
  const events = (opts.events ?? []).slice().sort((a, b) => a.t - b.t);
  let nextEvent = 0;

  for (let s = 0; s <= steps; s++) {
    const t = opts.startTime + s * dt;
    while (nextEvent < events.length && events[nextEvent].t <= t) {
      switchStates.set(events[nextEvent].componentId, events[nextEvent].closed);
      nextEvent += 1;
    }
    // Build A, b for this step
    const A: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
    const b: number[] = new Array(dim).fill(0);
    const nodeIndex = (n: number) => (n === 0 ? -1 : nodeIds.indexOf(n));
    // Apply source waveform override
    const sourceOverride = new Map<string, number>();
    const mainV = circuit.components.find((c) => c.kind === "voltage-source");
    if (mainV) {
      const V = opts.waveform ? opts.waveform(t) : (mainV as any).volts;
      sourceOverride.set(mainV.id, V);
    }
    for (const comp of circuit.components) {
      const [a, b2] = comp.nodes;
      const ia = nodeIndex(a); const ib = nodeIndex(b2);
      switch (comp.kind) {
        case "resistor": {
          const g = 1 / comp.ohms;
          if (ia >= 0) A[ia][ia] += g;
          if (ib >= 0) A[ib][ib] += g;
          if (ia >= 0 && ib >= 0) { A[ia][ib] -= g; A[ib][ia] -= g; }
          break;
        }
        case "capacitor": {
          // Backward Euler: I_cap = C*(V_ab_new - V_ab_prev)/dt
          // Rewrite as Norton companion: conductance g = C/dt between (a, b)
          // plus a current source g*V_ab_prev flowing from b -> a (so that
          // the open-circuit voltage of the Norton equals V_prev).
          // KCL contributions: A[a][a] += g, A[a][b] -= g, b[a] += g*V_prev
          //                    A[b][a] -= g, A[b][b] += g, b[b] -= g*V_prev
          // vPrev[ia + 1] uses +1 because index 0 is reserved for ground (which
          // is always 0 and not stored). vPrev[ia] for the first non-ground
          // node would incorrectly read vPrev[0] (ground), off by one.
          const g = comp.farads / dt;
          if (ia >= 0) A[ia][ia] += g;
          if (ib >= 0) A[ib][ib] += g;
          if (ia >= 0 && ib >= 0) { A[ia][ib] -= g; A[ib][ia] -= g; }
          const prevV = (vPrev[ia + 1] ?? 0) - (vPrev[ib + 1] ?? 0);
          const I = g * prevV;
          if (ia >= 0) b[ia] += I;
          if (ib >= 0) b[ib] -= I;
          break;
        }
        case "inductor": {
          // Backward Euler: V = L*(I - I_prev)/dt; treat as a voltage source with that voltage.
          const L = comp.henries;
          const Iprev = iLPrev.get(comp.id) ?? 0;
          const Vsrc = L * (Iprev - Iprev) / dt; // placeholder; we will need a branch variable
          // We avoid a full MNA for the inductor by approximating with a Thevenin companion
          // (resistor in series with a voltage source). This is a common engineering trick.
          // Companion: R_eq = L/dt, V_eq = R_eq * I_prev.
          const Req = L / dt;
          const Veq = Req * Iprev;
          const g = 1 / Req;
          if (ia >= 0) A[ia][ia] += g;
          if (ib >= 0) A[ib][ib] += g;
          if (ia >= 0 && ib >= 0) { A[ia][ib] -= g; A[ib][ia] -= g; }
          // Current source: Veq / Req from b to a (i.e. into node a if Veq > 0 means current goes from a to b at the previous step)
          if (ia >= 0) b[ia] -= Veq / Req;
          if (ib >= 0) b[ib] += Veq / Req;
          break;
        }
        case "voltage-source": {
          // Augmented MNA: branch variable.
          // For simplicity in this introductory solver we treat voltage sources as ideal but
          // require the source to be in series with a small resistance; here we apply a stiff
          // companion if no resistor is present. To keep the implementation tractable we only
          // support a single voltage source per circuit in transient mode.
          const V = sourceOverride.get(comp.id) ?? (comp as any).volts;
          const g = 1e6;
          if (ia >= 0) A[ia][ia] += g;
          if (ib >= 0) A[ib][ib] += g;
          if (ia >= 0 && ib >= 0) { A[ia][ib] -= g; A[ib][ia] -= g; }
          const I = g * V;
          if (ia >= 0) b[ia] += I;
          if (ib >= 0) b[ib] -= I;
          break;
        }
        case "current-source": {
          const I = comp.amps;
          if (ia >= 0) b[ia] -= I;
          if (ib >= 0) b[ib] += I;
          break;
        }
        case "switch": {
          const closed = switchStates.get(comp.id) ?? false;
          if (closed) {
            const g = 1e9;
            if (ia >= 0) A[ia][ia] += g;
            if (ib >= 0) A[ib][ib] += g;
            if (ia >= 0 && ib >= 0) { A[ia][ib] -= g; A[ib][ia] -= g; }
          }
          break;
        }
      }
    }
    const x = solveLinear(A, b);
    times.push(t);
    for (let i = 0; i < dim; i++) {
      nodeVoltages.get(nodeIds[i])!.push(x[i]);
      vPrev[i + 1] = x[i];
    }
    // Update inductor currents. nodeIndex returns -1 for ground; treat that
    // as 0V so inductors tied to ground do not produce NaN.
    const xAt = (n: number) => (n === 0 ? 0 : x[nodeIndex(n)]);
    for (const c of circuit.components) {
      if (c.kind === "inductor") {
        const v = xAt(c.nodes[0]) - xAt(c.nodes[1]);
        const I = (iLPrev.get(c.id) ?? 0) + (dt / c.henries) * v;
        iLPrev.set(c.id, I);
        componentCurrents.get(c.id)!.push(I);
      }
    }
    // Record other component currents if requested
    for (const c of circuit.components) {
      if (c.kind === "resistor" && componentCurrents.has(c.id)) {
        const I = (xAt(c.nodes[0]) - xAt(c.nodes[1])) / c.ohms;
        componentCurrents.get(c.id)!.push(I);
      }
    }
  }
  return { times, nodeVoltages, componentCurrents };
}

// --- Netlists ---------------------------------------------------------------

/** One element of a solved netlist. `voltage` is V(from) − V(to); `current` flows through the element from `from` to
 *  `to`; `power` is absorbed (passive sign convention), so a source delivering power shows a negative value. */
export interface NetlistElementResult {
  id: string;
  label: string;
  kind: string;
  from: string;
  to: string;
  voltage: number;
  current: number;
  power: number;
  /** Diodes and LEDs: whether the diode conducts in the solution. */
  conducting?: boolean;
}
export interface NetlistDCResult {
  ground: string;
  /** Node voltages in volts, relative to ground (which is 0). */
  nodes: Record<string, number>;
  elements: NetlistElementResult[];
  /** Every named `current` and `voltage` (i_o, v_o…) with its value in amperes or volts. */
  quantities: Record<string, number>;
  units: { voltage: "V"; current: "A"; power: "W" };
}

/** Diode forward voltages when the netlist gives none. */
const FORWARD: Record<string, number> = { diode: 0.7, led: 2 };

/**
 * DC operating point of a netlist (the one renderCircuit draws): node voltages and the current, voltage and power of
 * every element. Capacitors are open, inductors, wires and ammeters are shorts, voltmeters and open switches are open,
 * dependent sources follow the current or voltage their label names ("4i_o"), and diodes use a constant forward drop
 * (their value in volts, else 0.7 V; LEDs 2 V). Every element gets its own current unknown, so a current used as a
 * control is available whatever kind of element carries it.
 */
export function solveNetlist(spec: Netlist): NetlistDCResult {
  const net = normalizeNetlist(spec);
  const { nodes, elements } = net;
  for (const e of elements) {
    if (e.kind === "ac-source") throw new Error(`Circuit: element ${e.index + 1} (${e.name}) is an AC source; the DC solver needs DC sources (voltage-source, battery, current-source)`);
    if (["resistor", "lamp", "voltage-source", "battery", "current-source"].includes(e.kind) && e.si === undefined)
      throw new Error(`Circuit: element ${e.index + 1} (${e.name}) needs a value to be solved`);
    if ((e.kind === "resistor" || e.kind === "lamp") && !(e.si! > 0)) throw new Error(`Circuit: element ${e.index + 1} (${e.name}) needs a positive resistance`);
  }
  const N = nodes.length, E = elements.length, dim = N + E;
  const node = (n: string) => (n === net.ground ? -1 : nodes.indexOf(n));
  const controlOf = new Map<string, { index: number; type: "i" | "v" }>();
  for (const e of elements) {
    if (e.current) controlOf.set(e.current.replace(/[\s$]/g, ""), { index: e.index, type: "i" });
    if (e.voltage) controlOf.set(e.voltage.replace(/[\s$]/g, ""), { index: e.index, type: "v" });
  }
  const diodes = elements.filter((e) => e.kind === "diode" || e.kind === "led");
  const on = new Map(diodes.map((d) => [d.index, false]));
  const forward = (e: NormalElement) => e.si ?? FORWARD[e.kind];
  const solveOnce = () => {
    const A: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
    const b: number[] = new Array(dim).fill(0);
    // KCL: the currents leaving each node sum to zero (an element's current leaves `from` and enters `to`).
    elements.forEach((e, k) => {
      const f = node(e.from), t = node(e.to);
      if (f >= 0) A[f][N + k] += 1;
      if (t >= 0) A[t][N + k] -= 1;
    });
    // One equation per element. row += V(from) − V(to) with coefficient c.
    elements.forEach((e, k) => {
      const row = N + k, f = node(e.from), t = node(e.to);
      const across = (c: number, r = row) => { if (f >= 0) A[r][f] += c; if (t >= 0) A[r][t] -= c; };
      const control = (gain: number) => {
        const q = controlOf.get(e.control!.name)!;
        if (q.type === "i") A[row][N + q.index] -= gain;
        else { const c = elements[q.index], cf = node(c.from), ct = node(c.to); if (cf >= 0) A[row][cf] -= gain; if (ct >= 0) A[row][ct] += gain; }
      };
      switch (e.kind) {
        case "resistor": case "lamp": across(1); A[row][N + k] -= e.si!; break;
        case "voltage-source": case "battery": across(1); b[row] = -e.si!; break; // + at `to`: V(to) − V(from) = V.
        case "current-source": A[row][N + k] = 1; b[row] = e.si!; break;
        case "dependent-voltage-source": across(-1); control(e.control!.gain); break; // V(to) − V(from) = gain × control.
        case "dependent-current-source": A[row][N + k] = 1; control(e.control!.gain); break;
        case "capacitor": case "voltmeter": A[row][N + k] = 1; break;
        case "inductor": case "wire": case "ammeter": across(1); break;
        case "switch": if (e.closed) across(1); else A[row][N + k] = 1; break;
        case "diode": case "led": if (on.get(e.index)) { across(1); b[row] = forward(e); } else A[row][N + k] = 1; break;
        default: throw new Error(`Circuit: element ${e.index + 1} (${e.name}) is a ${e.kind}, which the DC solver does not model`);
      }
    });
    try {
      return solveLinear(A, b);
    } catch {
      throw new Error("Circuit: the circuit has no unique DC solution. Look for a node joined to the rest only through capacitors, open switches or voltmeters, a loop of voltage sources, inductors or wires, or current sources in series.");
    }
  };
  let x = solveOnce();
  // Diodes: switch each one whose state contradicts the solution, until every state is consistent.
  for (let round = 0; ; round++) {
    const wrong = diodes.find((d) => {
      const k = d.index, v = (node(d.from) >= 0 ? x[node(d.from)] : 0) - (node(d.to) >= 0 ? x[node(d.to)] : 0);
      return on.get(k) ? x[N + k] < -1e-12 : v > forward(d) + 1e-9;
    });
    if (!wrong) break;
    if (round >= 4 * diodes.length + 20) throw new Error("Circuit: the diode states did not settle");
    on.set(wrong.index, !on.get(wrong.index));
    x = solveOnce();
  }
  const volt = (n: string) => (n === net.ground ? 0 : x[nodes.indexOf(n)]);
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  const results = elements.map((e, k): NetlistElementResult => {
    const voltage = clean(volt(e.from) - volt(e.to)), current = clean(x[N + k]);
    return { id: e.id, label: e.name, kind: e.kind, from: e.from, to: e.to, voltage, current, power: clean(voltage * current), ...(on.has(k) ? { conducting: on.get(k) } : {}) };
  });
  const quantities: Record<string, number> = {};
  for (const e of elements) {
    if (e.current) quantities[e.current] = results[e.index].current;
    if (e.voltage) quantities[e.voltage] = results[e.index].voltage;
  }
  return {
    ground: net.ground,
    nodes: Object.fromEntries([[net.ground, 0], ...nodes.map((n) => [n, clean(volt(n))])]),
    elements: results,
    quantities,
    units: { voltage: "V", current: "A", power: "W" },
  };
}

/**
 * Transient response of a netlist (backward Euler, through solveTransient): node voltages by name and the currents
 * of resistors and inductors by element id. Same limits as solveTransient (one voltage source carries `waveform`).
 */
export function solveNetlistTransient(spec: Netlist, opts: Omit<TransientOptions, "recordNodes" | "recordComponents" | "events"> & { events?: { t: number; element: string; closed: boolean }[] }) {
  const { circuit, nodes, ids } = circuitFromNetlist(spec);
  const element = (name: string) => {
    const i = spec.elements.findIndex((e, k) => (e.id ?? `E${k + 1}`) === name || e.label === name);
    const found = i < 0 ? undefined : ids.get(spec.elements[i].id ?? `E${i + 1}`);
    if (!found) throw new Error(`Circuit: no switch "${name}" (use the element's id, such as E3, or its label)`);
    return found;
  };
  const r = solveTransient(circuit, { ...opts, events: opts.events?.map((e) => ({ t: e.t, componentId: element(e.element), closed: e.closed })) });
  const back = new Map([...ids].map(([k, v]) => [v, k]));
  return {
    times: r.times,
    nodes: Object.fromEntries([...nodes].map(([name, id]) => [name, id === 0 ? r.times.map(() => 0) : r.nodeVoltages.get(id) ?? []])),
    currents: Object.fromEntries([...r.componentCurrents].filter(([id, v]) => back.has(id) && v.length).map(([id, v]) => [back.get(id)!, v])),
  };
}

// --- Linear algebra ---------------------------------------------------------

export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Copy to augmented matrix
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  // Gaussian elimination with partial pivoting
  for (let k = 0; k < n; k++) {
    let max = Math.abs(M[k][k]);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(M[i][k]) > max) { max = Math.abs(M[i][k]); maxRow = i; }
    }
    if (max < 1e-15) throw new Error("Singular matrix");
    if (maxRow !== k) { const tmp = M[k]; M[k] = M[maxRow]; M[maxRow] = tmp; }
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}