/**
 * Analog electrical circuit model. Independent of any solver or
 * renderer. Components have a type, a value, and a list of node
 * connections. Ground is a special node (id 0).
 */

import { symbolKind } from "../diagram/schematic_kit.js";
import type { SymbolKind } from "../diagram/schematic_kit.js";

export type CircuitNodeId = number;

export type ComponentKind =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "voltage-source"
  | "current-source"
  | "switch"
  | "diode"
  | "ground";

export interface ComponentBase {
  id: string;
  kind: ComponentKind;
  /** Connected nodes (1-based, ground is 0). */
  nodes: [CircuitNodeId, CircuitNodeId];
  label?: string;
  meta?: Record<string, unknown>;
}

export interface Resistor extends ComponentBase { kind: "resistor"; ohms: number; }
export interface Capacitor extends ComponentBase { kind: "capacitor"; farads: number; initialVoltage?: number; }
export interface Inductor extends ComponentBase { kind: "inductor"; henries: number; initialCurrent?: number; }
export interface VoltageSource extends ComponentBase { kind: "voltage-source"; volts: number; }
export interface CurrentSource extends ComponentBase { kind: "current-source"; amps: number; }
export interface Switch extends ComponentBase { kind: "switch"; closed: boolean; }
export interface Diode extends ComponentBase { kind: "diode"; }
export interface Ground extends ComponentBase { kind: "ground"; }

export type AnyComponent = Resistor | Capacitor | Inductor | VoltageSource | CurrentSource | Switch | Diode | Ground;

export interface Circuit {
  id: string;
  name: string;
  components: AnyComponent[];
  /** Node id 0 is reserved for ground. Other ids are assigned automatically. */
  nextNodeId: number;
  metadata: Record<string, unknown>;
}

export function newCircuit(name: string): Circuit {
  return { id: "cir_" + Math.random().toString(36).slice(2, 10), name, components: [], nextNodeId: 1, metadata: {} };
}

export function addNode(c: Circuit): CircuitNodeId {
  const id = c.nextNodeId;
  c.nextNodeId += 1;
  return id;
}

export function addResistor(c: Circuit, a: CircuitNodeId, b: CircuitNodeId, ohms: number, label?: string): Resistor {
  const r: Resistor = { id: "r_" + c.components.length, kind: "resistor", ohms, nodes: [a, b], label };
  c.components.push(r);
  return r;
}

export function addCapacitor(c: Circuit, a: CircuitNodeId, b: CircuitNodeId, farads: number, label?: string): Capacitor {
  const r: Capacitor = { id: "c_" + c.components.length, kind: "capacitor", farads, nodes: [a, b], label };
  c.components.push(r);
  return r;
}

export function addInductor(c: Circuit, a: CircuitNodeId, b: CircuitNodeId, henries: number, label?: string): Inductor {
  const r: Inductor = { id: "l_" + c.components.length, kind: "inductor", henries, nodes: [a, b], label };
  c.components.push(r);
  return r;
}

export function addVoltageSource(c: Circuit, a: CircuitNodeId, b: CircuitNodeId, volts: number, label?: string): VoltageSource {
  const r: VoltageSource = { id: "v_" + c.components.length, kind: "voltage-source", volts, nodes: [a, b], label };
  c.components.push(r);
  return r;
}

export function addCurrentSource(c: Circuit, a: CircuitNodeId, b: CircuitNodeId, amps: number, label?: string): CurrentSource {
  const r: CurrentSource = { id: "i_" + c.components.length, kind: "current-source", amps, nodes: [a, b], label };
  c.components.push(r);
  return r;
}

export function addSwitch(c: Circuit, a: CircuitNodeId, b: CircuitNodeId, closed: boolean, label?: string): Switch {
  const r: Switch = { id: "s_" + c.components.length, kind: "switch", closed, nodes: [a, b], label };
  c.components.push(r);
  return r;
}

export function addGround(c: Circuit, a: CircuitNodeId): Ground {
  const r: Ground = { id: "g_" + c.components.length, kind: "ground", nodes: [a, 0], label: "GND" };
  c.components.push(r);
  return r;
}

export function nodeIds(c: Circuit): number[] {
  const set = new Set<number>();
  for (const comp of c.components) {
    set.add(comp.nodes[0]);
    set.add(comp.nodes[1]);
  }
  return [...set].sort((a, b) => a - b);
}

export function validateCircuit(c: Circuit): void {
  if (c.components.length === 0) throw new Error("Circuit: empty");
  for (const comp of c.components) {
    if (comp.kind === "resistor" && comp.ohms <= 0) throw new Error("Resistor must have positive ohms");
    if (comp.kind === "capacitor" && comp.farads <= 0) throw new Error("Capacitor must have positive farads");
    if (comp.kind === "inductor" && comp.henries <= 0) throw new Error("Inductor must have positive henries");
  }
  // Must have a ground reference.
  const hasGround = c.components.some((x) => x.kind === "ground");
  if (!hasGround) throw new Error("Circuit: missing ground");
}

// --- Netlists ------------------------------------------------------------------
// The same netlist `renderCircuit` (diagram/circuit_schematic.ts) draws: elements between named nodes. One
// description of a circuit is solved and drawn, so the numbers in a text and the figure beside it always agree.

export interface NetlistElement {
  id?: string;
  /** resistor, capacitor, inductor, voltage-source, current-source, dependent-voltage-source, dependent-current-source, ac-source, battery, switch, diode, led, lamp, ammeter, voltmeter, wire (and their aliases). */
  kind: string;
  /** Node names. Voltage sources and batteries have + at `to`; current sources and diodes point from `from` to `to`. */
  from: string;
  to: string;
  /** A name such as "R_1" or, for a dependent source, its expression such as "4i_o" or "2v_o". */
  label?: string;
  value?: number;
  /** "Ω", "kΩ", "V", "mA", "µF", "mH"…: the value is converted to SI with the prefix. */
  unit?: string;
  /** Names the current through this element (from → to), which dependent sources may use ("i_o"). */
  current?: string;
  /** Names the voltage across this element (+ at from), which dependent sources may use ("v_o"). */
  voltage?: string;
  closed?: boolean;
  /** Dependent sources: the controlling quantity (a `current` or `voltage` name) and its multiplier. Read from the label ("4i_o") when absent. */
  control?: string;
  gain?: number;
}
export interface Netlist {
  title?: string;
  elements: NetlistElement[];
  /** The reference node. Defaults to a node named 0, gnd or ground, else the node with the most connections (as the drawing does). */
  ground?: string;
  order?: string[];
}
/** A netlist element, checked and in SI units. `si` is in ohms, farads, henries, volts or amperes (undefined when not given). */
export interface NormalElement {
  index: number;
  id: string;
  name: string;
  kind: SymbolKind;
  from: string;
  to: string;
  si?: number;
  closed: boolean;
  current?: string;
  voltage?: string;
  /** Dependent sources only. */
  control?: { name: string; gain: number };
}
export interface NormalNetlist {
  ground: string;
  /** Every node except ground, in order of first use. */
  nodes: string[];
  elements: NormalElement[];
}

/** Node names that mean ground, shared with the drawing so both pick the same reference. */
export const GROUND_NAME = /^(0|gnd|ground|ref|com|common)$/i;

/** The reference node: the one named ground, else the node with the most connections (the drawing's bottom rail). */
export function netlistGround(elements: { from: string; to: string }[], ground?: string): { ground: string; named: boolean } {
  const names: string[] = [];
  for (const e of elements) for (const n of [e.from, e.to]) if (!names.includes(n)) names.push(n);
  const degree = (n: string) => elements.filter((e) => e.from === n || e.to === n).length;
  const found = ground ?? names.find((n) => GROUND_NAME.test(n));
  if (found !== undefined) return { ground: found, named: true };
  return { ground: names.reduce((a, b) => (degree(b) > degree(a) ? b : a)), named: false };
}

/** The SI unit of each kind's value (a diode's value is its forward voltage). */
const BASE: Partial<Record<SymbolKind, string>> = {
  resistor: "Ω", lamp: "Ω", capacitor: "F", inductor: "H", "voltage-source": "V", battery: "V", "ac-source": "V",
  "current-source": "A", diode: "V", led: "V",
};
const PREFIXES: Record<string, number> = { G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, "µ": 1e-6, "μ": 1e-6, u: 1e-6, n: 1e-9, p: 1e-12 };

/** A value in SI units: 2.2 "kΩ" → 2200, 10 "mA" → 0.01. Throws when the unit does not fit the kind (a resistor in volts). */
export function siValue(value: number, unit: string | undefined, kind: SymbolKind, where = "element"): number {
  const base = BASE[kind];
  const u = String(unit ?? "").replace(/\s+/g, "").replace(/ohms?$/i, "Ω");
  if (!u || !base || u === base) return value;
  const prefix = u.slice(0, -base.length);
  if (u.endsWith(base) && PREFIXES[prefix] !== undefined) return value * PREFIXES[prefix];
  throw new Error(`Circuit: ${where} has unit "${unit}", but a ${kind} value is in ${base} (with a prefix such as k, m or µ)`);
}

/** What a dependent source's label states: "4i_o" → 4 × i_o, "0.5 v_x" → 0.5 × v_x, "i_b" → 1 × i_b. */
export function parseControl(label: string): { name: string; gain: number } | null {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|[-+])?\s*[*·×]?\s*([A-Za-z]\w*(?:\{\w+\})?)\s*$/.exec(String(label ?? "").replace(/\$/g, ""));
  if (!m) return null;
  const gain = m[1] === undefined || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1]);
  return Number.isFinite(gain) ? { name: m[2].replace(/[{}]/g, ""), gain } : null;
}

/**
 * Checks a netlist with the drawing's rules (renderCircuit) and puts every value in SI units. Each dependent source
 * is linked to the element whose `current` or `voltage` it names.
 */
export function normalizeNetlist(spec: Netlist): NormalNetlist {
  if (!spec || !Array.isArray(spec.elements) || spec.elements.length === 0) throw new Error('Circuit: needs "elements": [{kind, from, to, label?, value?, unit?}]');
  if (spec.elements.length > 60) throw new Error("Circuit: at most 60 elements");
  const controls = new Map<string, number>();
  const elements: NormalElement[] = spec.elements.map((e, i) => {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string" || !e.from.trim() || !e.to.trim()) throw new Error(`Circuit: element ${i + 1} needs "from" and "to" node names`);
    const name = String(e.label ?? e.id ?? `E${i + 1}`);
    if (e.from === e.to) throw new Error(`Circuit: element ${i + 1} (${name}) connects node "${e.from}" to itself`);
    if (e.value !== undefined && (typeof e.value !== "number" || !Number.isFinite(e.value))) throw new Error(`Circuit: element ${i + 1} value must be a number`);
    let kind: SymbolKind;
    try { kind = symbolKind(e.kind); } catch (err) { throw new Error(`Circuit: element ${i + 1}: ${(err as Error).message}`); }
    const where = `element ${i + 1} (${name})`;
    const si = e.value === undefined || kind.startsWith("dependent") ? undefined : siValue(e.value, e.unit, kind, where);
    for (const field of ["current", "voltage"] as const) {
      const label = e[field];
      if (label === undefined) continue;
      if (typeof label !== "string" || !label.trim()) throw new Error(`Circuit: ${where} "${field}" must be a name such as "${field[0]}_x"`);
      const key = label.replace(/[\s$]/g, "");
      if (controls.has(key)) throw new Error(`Circuit: "${label}" names two quantities; give each current and voltage its own name`);
      controls.set(key, i);
    }
    return { index: i, id: e.id ?? `E${i + 1}`, name, kind, from: e.from, to: e.to, si, closed: e.closed === true, current: e.current, voltage: e.voltage };
  });
  spec.elements.forEach((e, i) => {
    const el = elements[i];
    if (!el.kind.startsWith("dependent")) return;
    const parsed = e.control !== undefined ? { name: String(e.control), gain: e.gain ?? e.value ?? 1 } : parseControl(e.label ?? "");
    if (parsed && e.gain !== undefined) parsed.gain = e.gain;
    const known = [...controls.keys()];
    const key = parsed?.name.replace(/[\s$]/g, "");
    const match = key === undefined ? undefined : controls.has(key) ? key : known.find((k) => k.toLowerCase() === key.toLowerCase());
    if (!parsed || match === undefined)
      throw new Error(`Circuit: dependent source ${i + 1} (${el.name}) must say what controls it: a label such as "4i_o" or "2v_x" (or "control" and "gain"), where i_o or v_x is the "current" or "voltage" of another element${known.length ? `; this circuit names ${known.join(", ")}` : "; no element names a current or voltage yet"}`);
    if (typeof parsed.gain !== "number" || !Number.isFinite(parsed.gain)) throw new Error(`Circuit: dependent source ${i + 1} (${el.name}) gain must be a number`);
    if (controls.get(match) === i) throw new Error(`Circuit: dependent source ${i + 1} (${el.name}) cannot be controlled by its own ${match}`);
    el.control = { name: match, gain: parsed.gain };
  });
  const { ground } = netlistGround(elements, spec.ground);
  const names: string[] = [];
  for (const e of elements) for (const n of [e.from, e.to]) if (!names.includes(n)) names.push(n);
  if (!names.includes(ground)) throw new Error(`Circuit: ground node "${ground}" is not used by any element`);
  const nodes = names.filter((n) => n !== ground);
  if (nodes.length === 0) throw new Error("Circuit: needs at least one node besides ground");
  if (nodes.length > 16) throw new Error("Circuit: at most 16 nodes besides ground");
  return { ground, nodes, elements };
}

/**
 * The netlist as this module's numbered Circuit (ground is node 0, the others 1, 2… in order of first use), for
 * solveTransient. Wires, ammeters and closed switches become closed switches; voltmeters and open switches are open.
 * Dependent sources, diodes and AC sources have no numbered equivalent and are refused.
 */
export function circuitFromNetlist(spec: Netlist): { circuit: Circuit; nodes: Map<string, number>; ground: string; ids: Map<string, string> } {
  const net = normalizeNetlist(spec);
  const c = newCircuit(spec.title ?? "Circuit");
  const nodes = new Map<string, number>([[net.ground, 0]]);
  for (const n of net.nodes) nodes.set(n, addNode(c));
  addGround(c, 0);
  const ids = new Map<string, string>();
  for (const e of net.elements) {
    const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
    const need = () => { if (e.si === undefined) throw new Error(`Circuit: element ${e.index + 1} (${e.name}) needs a value`); return e.si; };
    let made: AnyComponent | undefined;
    switch (e.kind) {
      case "resistor": case "lamp": made = addResistor(c, a, b, need(), e.name); break;
      case "capacitor": made = addCapacitor(c, a, b, need(), e.name); break;
      case "inductor": made = addInductor(c, a, b, need(), e.name); break;
      // + at `to`, while the numbered source holds V(first pin) − V(second pin) = volts: the pins are swapped.
      case "voltage-source": case "battery": made = addVoltageSource(c, b, a, need(), e.name); break;
      case "current-source": made = addCurrentSource(c, a, b, need(), e.name); break;
      case "switch": made = addSwitch(c, a, b, e.closed, e.name); break;
      case "wire": case "ammeter": made = addSwitch(c, a, b, true, e.name); break;
      case "voltmeter": break;
      default: throw new Error(`Circuit: element ${e.index + 1} (${e.name}) is a ${e.kind}, which the transient solver does not model; use solveNetlist for DC`);
    }
    if (made) ids.set(e.id, made.id);
  }
  return { circuit: c, nodes, ground: net.ground, ids };
}