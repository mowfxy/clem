/**
 * Circuit (netlist) representation. Independent of the renderer.
 *
 * A circuit is a directed graph of gates / pins / nets. The renderer turns
 * it into a schematic; the simulator evaluates the graph for a given input
 * vector.
 */

import { KinetraError } from "../errors.js";
import { collectVariables } from "./expression.js";
import type { BoolExpr } from "./expression.js";
import { walk } from "./expression.js";

export type GateKind =
  | "AND" | "OR" | "NOT" | "NAND" | "NOR" | "XOR" | "XNOR"
  | "BUF" | "INPUT" | "OUTPUT" | "MUX" | "DEMUX" | "DECODER" | "ENCODER"
  | "ADDER" | "SUBTRACTOR" | "COMPARATOR"
  | "DFF" | "JKFF" | "SRFF" | "TFF";

export interface Pin {
  id: string;
  /** Display name shown next to the pin in the schematic. */
  label?: string;
}

export interface Gate {
  id: string;
  kind: GateKind;
  inputs: string[];
  output: string;
  /** Optional width for bus gates. */
  width?: number;
  /** Custom metadata (timing parameters, value labels...). */
  meta?: Record<string, unknown>;
}

export interface Net {
  fromGate: string;
  fromPin?: string; // undefined for gate output
  toGate: string;
  toPin?: string; // undefined for gate input list
}

export interface Circuit {
  id: string;
  name: string;
  inputs: Pin[];
  outputs: Pin[];
  gates: Gate[];
  nets: Net[];
  metadata: Record<string, unknown>;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}${counter}`;
}

export function newCircuit(name: string): Circuit {
  return {
    id: nextId("c_"),
    name,
    inputs: [],
    outputs: [],
    gates: [],
    nets: [],
    metadata: {},
  };
}

export function addInput(c: Circuit, label?: string): Pin {
  const p: Pin = { id: nextId("in_"), label };
  c.inputs.push(p);
  return p;
}

export function addOutput(c: Circuit, label?: string): Pin {
  const p: Pin = { id: nextId("out_"), label };
  c.outputs.push(p);
  return p;
}

export function addGate(c: Circuit, kind: GateKind, inputCount: number, meta?: Record<string, unknown>): Gate {
  const g: Gate = {
    id: nextId(kind.toLowerCase() + "_"),
    kind,
    inputs: Array.from({ length: inputCount }, () => nextId("net_")),
    output: nextId("net_"),
    meta,
  };
  c.gates.push(g);
  return g;
}

export function connect(c: Circuit, from: { gate: string; pin?: string }, to: { gate: string; pin?: string }): void {
  c.nets.push({ fromGate: from.gate, fromPin: from.pin, toGate: to.gate, toPin: to.pin });
}

export function gateOutputNet(c: Circuit, gate: string): string {
  const g = c.gates.find((x) => x.id === gate);
  if (!g) throw new KinetraError("missing", `Unknown gate: ${gate}`);
  return g.output;
}

/** Simulate a combinational circuit for a given input assignment. */
export function simulateCombinational(c: Circuit, inputs: Record<string, 0 | 1>): Record<string, 0 | 1> {
  const evalGate = (g: Gate, values: Map<string, 0 | 1>): 0 | 1 => {
    const inValues = g.inputs.map((net) => values.get(net) ?? 0);
    switch (g.kind) {
      case "AND": return inValues.every((v) => v === 1) ? 1 : 0;
      case "OR": return inValues.some((v) => v === 1) ? 1 : 0;
      case "NOT": return inValues[0] === 1 ? 0 : 1;
      case "NAND": return inValues.every((v) => v === 1) ? 0 : 1;
      case "NOR": return inValues.some((v) => v === 1) ? 0 : 1;
      case "XOR": return inValues.reduce<number>((a, b) => a ^ b, 0) as 0 | 1;
      case "XNOR": return (inValues.reduce<number>((a, b) => a ^ b, 0) === 0 ? 1 : 0) as 0 | 1;
      case "BUF": return inValues[0] ?? 0;
      case "INPUT": return 0;
      case "OUTPUT": return inValues[0] ?? 0;
      case "MUX": {
        const data = inValues.slice(0, -1);
        const sel = inValues[inValues.length - 1];
        return data[sel] ?? 0;
      }
      default: throw new KinetraError("unsupported", `Simulation not implemented: ${g.kind}`, { kind: g.kind });
    }
  };

  const values = new Map<string, 0 | 1>();
  for (const inp of c.inputs) {
    if (!(inp.label && inp.label in inputs)) {
      throw new KinetraError("validation", `Missing input value for ${inp.label ?? inp.id}`, { id: inp.id });
    }
    values.set(inp.id, inputs[inp.label!]);
  }

  // Constant BUF gates (zero-input) hold a value via meta.constant.
  for (const g of c.gates) {
    if (g.kind === "BUF" && g.inputs.length === 0 && g.meta && typeof g.meta.constant === "number") {
      values.set(g.output, (g.meta.constant ? 1 : 0) as 0 | 1);
    }
  }

  // Initialise INPUT gate outputs from the external input vector.
  // The expressionToCircuit builder places one INPUT gate per variable; the
  // gate's meta carries the inputPinId so we can map back to the external value.
  for (const g of c.gates) {
    if (g.kind === "INPUT") {
      const pinId = (g.meta?.inputPinId ?? "") as string;
      if (!pinId) continue;
      const pin = c.inputs.find((p) => p.id === pinId);
      if (!pin || !pin.label) continue;
      const v = inputs[pin.label];
      if (v === undefined) {
        throw new KinetraError("validation", `Missing input value for ${pin.label}`, { id: pinId });
      }
      values.set(g.output, v);
    }
  }
  for (const o of c.outputs) values.set(o.id, 0);

  for (let iter = 0; iter < c.gates.length + 2; iter++) {
    let changed = false;
    for (const g of c.gates) {
      if (g.kind === "INPUT") continue;
      if (g.kind === "OUTPUT") {
        if (g.inputs.length > 0 && !values.has(g.inputs[0])) continue;
        if (g.inputs.length > 0) {
          const v = values.get(g.inputs[0]) ?? 0;
          if (values.get(g.output) !== v) { values.set(g.output, v); changed = true; }
        }
        continue;
      }
      const ready = g.inputs.every((n) => values.has(n));
      if (!ready) continue;
      const v = evalGate(g, values);
      if (values.get(g.output) !== v) {
        values.set(g.output, v);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const out: Record<string, 0 | 1> = {};
  for (const o of c.outputs) out[o.label ?? o.id] = (values.get(o.id) ?? 0) as 0 | 1;
  return out;
}

// --- Build circuits from Boolean expressions --------------------------------

/**
 * Map a variable name to the Pin that represents it as a primary input.
 * We then connect that input pin to a real INPUT gate whose output is a
 * named net. All downstream gates consume that net. INPUT gates in this
 * representation are the only gates that do not depend on other nets —
 * they produce a value from the external input vector.
 */
function ensureInputGate(c: Circuit, pin: Pin, inputMap: Map<string, string>): string {
  const existing = inputMap.get(pin.id);
  if (existing !== undefined) return existing;
  // The "input gate" in this engine is a BUF whose first input is a sentinel
  // net. The simulator recognises it and pulls the value from the input vector.
  const g: Gate = {
    id: `inp_${pin.id}`,
    kind: "INPUT",
    inputs: [`__pin__:${pin.id}`],
    output: nextIdNet(),
    meta: { inputPinId: pin.id, inputLabel: pin.label ?? pin.id },
  };
  c.gates.push(g);
  // Also create a `Net` entry so the schematic renderer can draw the line.
  // The sentinel net "__pin__:<pinId>" has no fromGate, signalling "from input pin".
  c.nets.push({ fromGate: "", fromPin: pin.id, toGate: g.id, toPin: g.inputs[0] });
  inputMap.set(pin.id, g.output);
  return g.output;
}

let netCounter = 0;
function nextIdNet(): string {
  netCounter += 1;
  return `net_${netCounter}`;
}

/** Build a NAND-only netlist for a Boolean expression. */
export function expressionToCircuit(name: string, expr: BoolExpr): Circuit {
  const c = newCircuit(name);
  // Create a Pin for each variable. The Pin's id is the stable handle used
  // by INPUT gates to look up the external value during simulation.
  const pinForVar = new Map<string, Pin>();
  for (const v of collectVariables(expr)) {
    const p = addInput(c, v);
    pinForVar.set(v, p);
  }
  // Map pinId -> output net of the corresponding INPUT gate.
  const inputNet = new Map<string, string>();
  const out = expressionToGates(c, expr, pinForVar, inputNet);
  const outPin = addOutput(c, "F");
  // The final OUTPUT gate is a BUF that propagates `out` to the output pin.
  c.gates.push({
    id: outPin.id,
    kind: "OUTPUT",
    inputs: [out],
    output: outPin.id,
    meta: {},
  });
  c.nets.push({ fromGate: "", fromPin: "", toGate: outPin.id, toPin: out });
  return c;
}

function expressionToGates(
  c: Circuit,
  expr: BoolExpr,
  pinForVar: Map<string, Pin>,
  inputNet: Map<string, string>,
): string {
  switch (expr.type) {
    case "const": {
      const g = addGate(c, "BUF", 0);
      g.meta = { constant: expr.value };
      return g.output;
    }
    case "var": {
      const pin = pinForVar.get(expr.name);
      if (!pin) throw new KinetraError("missing", `Input not declared: ${expr.name}`);
      const net = ensureInputGate(c, pin, inputNet);
      return net;
    }
    case "not": {
      const sub = expressionToGates(c, expr.arg, pinForVar, inputNet);
      const g = addGate(c, "NOT", 1);
      wireInternal(c, sub, g, 0);
      return g.output;
    }
    case "and": {
      if (expr.args.length === 0) {
        const g = addGate(c, "BUF", 0);
        g.meta = { constant: 1 };
        return g.output;
      }
      const subNets = expr.args.map((a) => expressionToGates(c, a, pinForVar, inputNet));
      const g = addGate(c, "AND", subNets.length);
      for (let i = 0; i < subNets.length; i++) wireInternal(c, subNets[i], g, i);
      return g.output;
    }
    case "or": {
      if (expr.args.length === 0) {
        const g = addGate(c, "BUF", 0);
        g.meta = { constant: 0 };
        return g.output;
      }
      const subNets = expr.args.map((a) => expressionToGates(c, a, pinForVar, inputNet));
      const g = addGate(c, "OR", subNets.length);
      for (let i = 0; i < subNets.length; i++) wireInternal(c, subNets[i], g, i);
      return g.output;
    }
    case "xor": {
      const subNets = expr.args.map((a) => expressionToGates(c, a, pinForVar, inputNet));
      const g = addGate(c, "XOR", subNets.length);
      for (let i = 0; i < subNets.length; i++) wireInternal(c, subNets[i], g, i);
      return g.output;
    }
  }
}

/** Wire an internal net into a specific pin of a gate. */
function wireInternal(c: Circuit, sourceNet: string, target: Gate, pinIndex: number): void {
  // The target's pre-allocated input net is replaced by the actual source
  // net so the simulator can trace the value. We also record a Net entry
  // for the schematic renderer, using the original (pre-replacement) net
  // id as the target pin label.
  const original = target.inputs[pinIndex];
  target.inputs[pinIndex] = sourceNet;
  c.nets.push({
    fromGate: "",
    fromPin: sourceNet,
    toGate: target.id,
    toPin: original,
  });
}
