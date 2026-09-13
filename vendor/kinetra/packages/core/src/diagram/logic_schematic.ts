/** IEC-style rectangular symbols with distinct input terminals. Combinational
 * layouts are topological and independent of the caller's gate array order. */
import { createArtifact, withRendering } from "../artifacts.js";
import { el, line, renderSvg, text } from "./primitives.js";
import type { SvgElement, Vec2 } from "./primitives.js";
import type { Circuit, Gate } from "../dld/circuit.js";
export interface LogicSchematic {
  circuit: Circuit;
  width: number;
  height: number;
  title?: string;
}
const W = 56;
const inverse = (g: Gate) => ["NAND", "NOR", "NOT", "XNOR"].includes(g.kind);
const height = (g: Gate) => Math.max(44, ((g.inputs ?? []).length + 1) * 16);
export function layoutLogic(c: Circuit): Map<string, Vec2> {
  const producers = c.gates.filter(g => g.output);
  const byNet = new Map(producers.map(g => [g.output, g]));
  if (new Set(c.gates.map(g => g.id)).size !== c.gates.length || byNet.size !== producers.length)
    throw new Error("Logic: duplicate gate id or net producer");
  const levels = new Map<string, number>(), visiting = new Set<string>();
  const visit = (g: Gate): number => {
    if (levels.has(g.id))
      return levels.get(g.id)!;
    if (visiting.has(g.id))
      throw new Error("Logic: feedback layout unsupported; provide an acyclic combinational circuit");
    visiting.add(g.id);
    const preds = (g.kind === "INPUT" ? [] : g.inputs ?? []).map(net => { const p = byNet.get(net); if (!p)
      throw new Error("Logic: input net has no producer: " + net); return visit(p); });
    const level = preds.length ? Math.max(...preds) + 1 : 0;
    visiting.delete(g.id);
    levels.set(g.id, level);
    return level;
  };
  for (const g of c.gates)
    visit(g);
  const result = new Map<string, Vec2>(), bottoms = new Map<number, number>();
  for (const g of [...c.gates].sort((a, b) => a.id.localeCompare(b.id))) {
    const level = levels.get(g.id)!, top = bottoms.get(level) ?? 70;
    result.set(g.id, { x: 55 + level * 140, y: top + height(g) / 2 });
    bottoms.set(level, top + height(g) + 36);
  }
  return result;
}
export function logicTerminals(g: Gate, p: Vec2): {
  inputs: Vec2[];
  output: Vec2;
} {
  const inputs = g.kind === "INPUT" ? [] : g.inputs ?? [], h = height(g);
  return { inputs: inputs.map((_, i) => ({ x: p.x - 10, y: p.y - h / 2 + (i + 1) * h / (inputs.length + 1) })), output: { x: p.x + W + 12, y: p.y } };
}
export function renderLogicSchematic(s: LogicSchematic): string {
  if (![s.width, s.height].every(n => Number.isFinite(n) && n > 0))
    throw new Error("Logic: viewport must be positive and finite");
  const c = s.circuit, positions = layoutLogic(c), out: SvgElement[] = [];
  const byNet = new Map(c.gates.map(g => [g.output, g]));
  for (const g of c.gates) {
    const p = positions.get(g.id)!, pins = logicTerminals(g, p);
    (g.kind === "INPUT" ? [] : g.inputs ?? []).forEach((net, i) => {
      const prod = byNet.get(net)!, from = logicTerminals(prod, positions.get(prod.id)!).output, to = pins.inputs[i];
      const lane = from.x + (to.x - from.x) * (0.35 + 0.3 * (i + 1) / (pins.inputs.length + 1));
      out.push(el("path", { "data-net": net, "data-input": g.id + ":" + i, d: "M " + from.x + " " + from.y + " H " + lane + " V " + to.y + " H " + to.x, fill: "none", stroke: "#333", "stroke-width": 1.2 }));
    });
  }
  const labels: Record<string, string> = { AND: "&", NAND: "&", OR: "≥1", NOR: "≥1", XOR: "=1", XNOR: "=1", NOT: "1", BUF: "1" };
  for (const g of c.gates) {
    const p = positions.get(g.id)!, pins = logicTerminals(g, p), h = height(g);
    out.push(el("rect", { x: p.x, y: p.y - h / 2, width: W, height: h, fill: "#fff", stroke: "#333", "stroke-width": 1.4 }));
    for (const pin of pins.inputs)
      out.push(line(pin.x, pin.y, p.x, pin.y, "#333", 1.2));
    const neg = inverse(g);
    if (neg)
      out.push(el("circle", { cx: p.x + W + 3, cy: p.y, r: 3, fill: "#fff", stroke: "#333", "stroke-width": 1.2 }));
    out.push(line(p.x + W + (neg ? 6 : 0), p.y, pins.output.x, pins.output.y, "#333", 1.2));
    const named = [...c.inputs, ...c.outputs].find(port => port.id === g.id || port.id === g.output || port.id === g.meta?.inputPinId)?.label;
    const symbol = ["XOR", "XNOR"].includes(g.kind) && (g.inputs ?? []).length > 2 ? "odd" : labels[g.kind];
    out.push(text(p.x + W / 2, p.y + 5, named ?? symbol ?? g.kind, "#222", 13, "middle"));
  }
  const maxX = Math.max(1, ...[...positions.values()].map(p => p.x + W + 35));
  const maxY = Math.max(1, ...c.gates.map(g => positions.get(g.id)!.y + height(g) / 2 + 25));
  const scale = Math.min(1, (s.width - 16) / maxX, (s.height - 35) / maxY);
  if (scale <= 0)
    throw new Error("Logic: viewport too small");
  const root = el("g", {}, [el("g", { transform: "translate(8 24) scale(" + scale + ")" }, out)]);
  if (s.title)
    root.children.push(text(s.width / 2, 18, s.title, "#222", 14, "middle"));
  return renderSvg(root, { width: s.width, height: s.height, background: "#fff" });
}
export function logicSchematicArtifact(c: Circuit, title = "Logic schematic", width = 800, height = 600) {
  return withRendering(createArtifact({ kind: "logic-schematic", title, model: { circuit: c, width, height } }), "svg", { format: "svg", content: renderLogicSchematic({ circuit: c, width, height, title }), contentType: "image/svg+xml" });
}
