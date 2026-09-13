/**
 * Analog electrical circuit model. Independent of any solver or
 * renderer. Components have a type, a value, and a list of node
 * connections. Ground is a special node (id 0).
 */

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