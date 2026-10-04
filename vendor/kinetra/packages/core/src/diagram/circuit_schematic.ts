/**
 * Circuit schematics for analog electrical circuits, drawn the way a textbook draws them: every wire runs
 * horizontally or vertically, junctions carry dots, sources show upright polarity, and every label is placed
 * clear of wires, symbols and other labels.
 *
 * Two entry points:
 * - `renderCircuit` takes a netlist (elements between named nodes) and lays the whole figure out itself:
 *   ground rail at the bottom, nodes along a top rail, shunt elements hanging between them, series elements on
 *   the rail and longer connections arched over it. This is the preferred way to draw a circuit.
 * - `renderSchematic` takes components placed in world coordinates and wires between their pins. Wires given
 *   without right-angle corners are routed orthogonally around the symbols.
 */

import { createArtifact, withRendering } from "../artifacts.js";
import { sceneTransform, validateScene2D } from "./scene2d.js";
import {
  CLEAR, INK, FONT, LINE_H, SIZE, aroundSymbol, blockSize, bodyEnds, dotSvg, drawSymbol, groundSymbol, junctions, labelLines,
  leadArrow, num, place, segBox, symbolKind, textBlock, textWidth, wirePath,
} from "./schematic_kit.js";
import type { Box, Candidate, Pt, Scene, Seg, SymbolKind } from "./schematic_kit.js";

export type ComponentKind = SymbolKind | "ground";

export interface Component {
  id: string;
  kind: ComponentKind;
  label?: string;
  /** Value (ohms, farads, henries, volts, amps) for display. */
  value?: number;
  /** Unit symbol. */
  unit?: string;
  /** Center position in world coordinates. */
  position: { x: number; y: number };
  /** Rotation in degrees. Defaults to 0 (horizontal). */
  rotationDeg?: number;
  /** Only for switches; omitted means open. */
  closed?: boolean;
  /**
   * Two pin offsets relative to the centre, in local coordinates.
   * Defaults to the standard horizontal pair for the component kind.
   */
  pins?: [{ x: number; y: number }, { x: number; y: number }];
}

export interface Wire {
  /** Optional explicit routing points in world coordinates. Crossings without a dot are not connections. */
  via?: { x: number; y: number }[];
  from: { componentId: string; pin: 0 | 1 };
  to: { componentId: string; pin: 0 | 1 } | { point: { x: number; y: number } };
}

export interface Schematic {
  components: Component[];
  wires: Wire[];
  world: { xMin: number; xMax: number; yMin: number; yMax: number };
  width: number; height: number;
  title?: string;
}

/** Pin offsets in world units for components placed without explicit pins. */
const WORLD_PIN: Record<ComponentKind, number> = {
  resistor: 0.3, capacitor: 0.15, inductor: 0.36, "voltage-source": 0.18, "current-source": 0.18, "ac-source": 0.18,
  "dependent-voltage-source": 0.19, "dependent-current-source": 0.19, battery: 0.15, switch: 0.2, diode: 0.12, led: 0.12,
  lamp: 0.18, ammeter: 0.18, voltmeter: 0.18, wire: 0.3, ground: 0,
};

const kindOf = (kind: string): ComponentKind => (String(kind).toLowerCase() === "ground" ? "ground" : symbolKind(kind));

export function validateSchematic(s: Schematic): void {
  validateScene2D({ ...s, shapes: [] });
  if (!Array.isArray(s.components) || s.components.length === 0) throw new Error("Schematic: needs at least one component");
  if (!Array.isArray(s.wires)) throw new Error("Schematic: wires must be a list");
  const ids = new Set<string>();
  for (const c of s.components) {
    if (![c.position?.x, c.position?.y, c.rotationDeg ?? 0, ...(c.pins ?? []).flatMap((p) => [p.x, p.y])].every(Number.isFinite)) throw new Error("Schematic: component geometry must be finite");
    try { kindOf(c.kind); } catch (e) { throw new Error(`Schematic: ${(e as Error).message}`); }
    if (ids.has(c.id)) throw new Error(`Schematic: duplicate component id ${c.id}`);
    ids.add(c.id);
  }
  for (const w of s.wires) {
    if (![0, 1].includes(w.from.pin) || ("componentId" in w.to && ![0, 1].includes(w.to.pin))) throw new Error("Schematic: pin must be 0 or 1");
    if ((w.via ?? []).some((p) => ![p.x, p.y].every(Number.isFinite)) || ("point" in w.to && ![w.to.point.x, w.to.point.y].every(Number.isFinite))) throw new Error("Schematic: wire coordinates must be finite");
    if (!ids.has(w.from.componentId)) throw new Error(`Schematic: wire references unknown component ${w.from.componentId}`);
    if ("componentId" in w.to && !ids.has(w.to.componentId)) throw new Error(`Schematic: wire references unknown component ${w.to.componentId}`);
  }
}

// --- Shared drawing ------------------------------------------------------------

export type CircuitLayout = {
  svg: string;
  width: number;
  height: number;
  /** Every wire and lead, all horizontal or vertical. */
  segments: Seg[];
  /** Symbol bodies (and the ground symbol). */
  bodies: Box[];
  /** Every placed text block, with its lines. */
  labels: { box: Box; lines: string[] }[];
  dots: Pt[];
  /** Where each element's two terminals are drawn (pin 0 / `from` first). */
  pins: { id: string; at: [Pt, Pt] }[];
};

const unit = (a: Pt, b: Pt): Pt => { const d = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }; };
const key = (p: Pt) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
/** Joins consecutive collinear pieces and drops zero-length ones. */
function tidy(segments: Seg[]) {
  const out: Seg[] = [];
  for (const s of segments) {
    if (Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y) < 0.5) continue;
    const last = out[out.length - 1];
    if (last && key(last.b) === key(s.a) && ((last.a.x === last.b.x && s.a.x === s.b.x && last.a.x === s.a.x) || (last.a.y === last.b.y && s.a.y === s.b.y && last.a.y === s.a.y))) {
      const d1 = unit(last.a, last.b), d2 = unit(s.a, s.b);
      if (d1.x * d2.x + d1.y * d2.y > 0) { last.b = s.b; continue; }
    }
    out.push({ a: { ...s.a }, b: { ...s.b } });
  }
  return out;
}

/** Writes the finished figure: wires, symbols, dots, then labels; the frame grows to hold anything placed outside it. */
function finish(frame: Box, title: string | undefined, parts: { segments: Seg[]; symbols: string; bodies: Box[]; labels: { box: Box; lines: string[]; anchor: "start" | "middle" | "end" }[]; extra: string; dots: Pt[]; pins: CircuitLayout["pins"] }, fit: boolean): CircuitLayout {
  const all = [...parts.labels.map((l) => l.box), ...parts.bodies, ...parts.segments.map(segBox)];
  let x0 = frame.x, y0 = frame.y, x1 = frame.x + frame.w, y1 = frame.y + frame.h;
  if (fit && all.length) {
    x0 = Math.min(...all.map((b) => b.x)) - 18; y0 = Math.min(...all.map((b) => b.y)) - 18;
    x1 = Math.max(...all.map((b) => b.x + b.w)) + 18; y1 = Math.max(...all.map((b) => b.y + b.h)) + 18;
  } else {
    for (const b of all) { x0 = Math.min(x0, b.x - 10); y0 = Math.min(y0, b.y - 10); x1 = Math.max(x1, b.x + b.w + 10); y1 = Math.max(y1, b.y + b.h + 10); }
  }
  let head = "";
  if (title) {
    const tw = textWidth(title, 15);
    x0 = Math.min(x0, (x0 + x1) / 2 - tw / 2 - 12); x1 = Math.max(x1, (x0 + x1) / 2 + tw / 2 + 12);
    if (fit) y0 -= 30;
    head = `<text x="${num((x0 + x1) / 2)}" y="${num(y0 + 22)}" font-family="${FONT}" font-size="15" font-weight="600" fill="${INK}" text-anchor="middle">${title.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)}</text>`;
  }
  const w = Math.ceil(x1 - x0), h = Math.ceil(y1 - y0);
  const body = head + wirePath(parts.segments) + parts.symbols + parts.extra + parts.dots.map(dotSvg).join("") + parts.labels.map((l) => textBlock(l.box, l.lines, l.anchor)).join("");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x0)} ${num(y0)} ${w} ${h}" width="${w}" height="${h}">\n<rect x="${num(x0)}" y="${num(y0)}" width="${w}" height="${h}" fill="#fff"/>\n${body}\n</svg>`;
  return { svg, width: w, height: h, segments: parts.segments, bodies: parts.bodies, labels: parts.labels.map(({ box, lines }) => ({ box, lines })), dots: parts.dots, pins: parts.pins };
}

/** "+ v −" beside a symbol (+ at the pin-0 end), on the side the placer finds clear. */
function voltageCandidates(c: Pt, e: Pt, t: number, half: number, label: string, prefer: 1 | -1): (Candidate & { plus: Pt; minus: Pt; text: Box })[] {
  const lw = textWidth(label), out: (Candidate & { plus: Pt; minus: Pt; text: Box })[] = [];
  const horizontal = Math.abs(e.x) >= Math.abs(e.y);
  for (const side of [prefer, -prefer]) for (const [k, step] of [0, 10, 22].entries()) {
    if (horizontal) {
      const u = Math.max(half, lw / 2 + 14), y = c.y + side * (t + CLEAR + step + LINE_H / 2);
      const plus = { x: c.x - e.x * u, y }, minus = { x: c.x + e.x * u, y };
      const text = { x: c.x - lw / 2, y: y - LINE_H / 2, w: lw, h: LINE_H };
      out.push({ box: { x: c.x - u - 5, y: y - LINE_H / 2, w: 2 * u + 10, h: LINE_H }, anchor: "middle", cost: (side === prefer ? 0 : 6) + k * 4, plus, minus, text });
    } else {
      const u = Math.max(half, LINE_H / 2 + 12), cx = c.x + side * (t + CLEAR + step + Math.max(5, lw / 2));
      const plus = { x: cx, y: c.y - e.y * u }, minus = { x: cx, y: c.y + e.y * u };
      const text = { x: cx - lw / 2, y: c.y - LINE_H / 2, w: lw, h: LINE_H };
      out.push({ box: { x: cx - Math.max(5, lw / 2), y: c.y - u - 5, w: Math.max(10, lw), h: 2 * u + 10 }, anchor: "middle", cost: (side === prefer ? 0 : 6) + k * 4, plus, minus, text });
    }
  }
  return out;
}
const markSvg = (p: Pt, plus: boolean) => `<path d="M${num(p.x - 4)} ${num(p.y)} H${num(p.x + 4)}${plus ? ` M${num(p.x)} ${num(p.y - 4)} V${num(p.y + 4)}` : ""}" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`;

/** Candidates for a label beside a straight lead: either side, stepping outward and sliding along the lead. */
function besideLead(lead: Seg, d: Pt, size: { w: number; h: number }): Candidate[] {
  const out: Candidate[] = [];
  const horizontal = Math.abs(d.x) >= Math.abs(d.y), length = Math.hypot(lead.b.x - lead.a.x, lead.b.y - lead.a.y);
  for (const [j, slide] of [0, 0.3, -0.3, 0.45, -0.45].entries()) {
    const mid = { x: (lead.a.x + lead.b.x) / 2 + d.x * slide * length, y: (lead.a.y + lead.b.y) / 2 + d.y * slide * length };
    for (const side of [-1, 1]) for (const [k, step] of [0, 8, 18].entries()) {
      const box = horizontal
        ? { x: mid.x - size.w / 2, y: side < 0 ? mid.y - 6 - CLEAR - step - size.h : mid.y + 6 + CLEAR + step, w: size.w, h: size.h }
        : { x: side < 0 ? mid.x - 6 - CLEAR - step - size.w : mid.x + 6 + CLEAR + step, y: mid.y - size.h / 2, w: size.w, h: size.h };
      out.push({ box, anchor: horizontal ? "middle" : side < 0 ? "end" : "start", cost: k * 4 + j * 3 + (side < 0 ? 0 : 1) });
    }
  }
  return out;
}

type Drawn = { id: string; kind: SymbolKind; c: Pt; e: Pt; scale: number; lines: string[]; prefer: 1 | -1; current?: string; voltage?: string; lead?: Seg; closed?: boolean };

/** Symbols, then labels: main labels first, then voltage marks, then current arrows and their labels. */
function decorate(drawn: Drawn[], scene: Scene, labels: { box: Box; lines: string[]; anchor: "start" | "middle" | "end" }[]) {
  let symbols = "", extra = "";
  for (const d of drawn) {
    const sym = drawSymbol(d.kind, d.c, d.e, d.scale, { closed: d.closed });
    symbols += `<g data-component="${d.id.replace(/[&<>"']/g, "")}">${sym.svg}</g>`;
  }
  const arrows: { d: Drawn; box: Box }[] = [];
  for (const d of drawn) if (d.current && d.lead) {
    const mid = { x: (d.lead.a.x + d.lead.b.x) / 2, y: (d.lead.a.y + d.lead.b.y) / 2 };
    const a = leadArrow(mid, d.e);
    extra += a.svg; scene.boxes.push(a.box); arrows.push({ d, box: a.box });
  }
  for (const d of drawn) {
    if (!d.lines.length) continue;
    const { thick, half } = SIZE[d.kind];
    const size = blockSize(d.lines);
    const best = place(aroundSymbol(d.c, d.e, Math.max(thick * d.scale, 3), half * d.scale, size, d.prefer), scene);
    labels.push({ box: best.box, lines: d.lines, anchor: best.anchor });
  }
  for (const d of drawn) {
    if (!d.voltage) continue;
    const { thick, half } = SIZE[d.kind];
    const best = place(voltageCandidates(d.c, d.e, Math.max(thick * d.scale, 3), half * d.scale, d.voltage, (-d.prefer) as 1 | -1), scene) as ReturnType<typeof voltageCandidates>[number];
    extra += markSvg(best.plus, true) + markSvg(best.minus, false);
    labels.push({ box: best.text, lines: [d.voltage], anchor: "middle" });
  }
  for (const { d } of arrows) {
    const size = blockSize([d.current!]);
    const best = place(besideLead(d.lead!, d.e, size), scene);
    labels.push({ box: best.box, lines: [d.current!], anchor: best.anchor });
  }
  return { symbols, extra };
}

// --- Netlist layout -------------------------------------------------------------

export interface CircuitElement {
  id?: string;
  /** resistor, capacitor, inductor, voltage-source, current-source, dependent-voltage-source, dependent-current-source, ac-source, battery, switch, diode, led, lamp, ammeter, voltmeter, wire. */
  kind: string;
  /** Node names. Voltage sources and batteries have + at `to`; current sources and diodes point from `from` to `to`. */
  from: string;
  to: string;
  /** Name such as "R1", "V_s" or "4i_o" (underscores make subscripts). */
  label?: string;
  value?: number;
  unit?: string;
  /** A current through the element: an arrow on its lead pointing from `from` to `to`, labelled with this text. */
  current?: string;
  /** A voltage across the element: + beside the `from` end, − beside the `to` end, labelled with this text. */
  voltage?: string;
  closed?: boolean;
}
export interface CircuitSpec {
  title?: string;
  elements: CircuitElement[];
  /** The reference node drawn as the bottom rail. Defaults to a node named 0, gnd or ground. */
  ground?: string;
  /** Left-to-right order of the other nodes along the top rail. Defaults to the order with the fewest long or crossing connections. */
  order?: string[];
}

const GROUND = /^(0|gnd|ground|ref|com|common)$/i;

/** The node order along the rail with the shortest connections and fewest crossings (exhaustive up to 8 nodes). */
function bestOrder(nodes: string[], pairs: [string, string][]): string[] {
  const cost = (order: string[]) => {
    const pos = new Map(order.map((n, i) => [n, i]));
    const spans = pairs.map(([a, b]) => [Math.min(pos.get(a)!, pos.get(b)!), Math.max(pos.get(a)!, pos.get(b)!)]);
    let c = 0;
    for (const [lo, hi] of spans) c += (hi - lo - 1) * 3;
    for (let i = 0; i < spans.length; i++) for (let j = 0; j < spans.length; j++) {
      const [a, b] = spans[i], [p, q] = spans[j];
      if (a < p && p < b && b < q) c += 12;
    }
    return c;
  };
  if (nodes.length <= 1) return nodes;
  if (nodes.length <= 8) {
    let best = nodes, score = cost(nodes);
    const permute = (rest: string[], acc: string[]) => {
      if (!rest.length) { const s = cost(acc); if (s < score) { score = s; best = acc.slice(); } return; }
      for (let i = 0; i < rest.length; i++) { acc.push(rest[i]); permute([...rest.slice(0, i), ...rest.slice(i + 1)], acc); acc.pop(); }
    };
    permute(nodes, []);
    return best;
  }
  let order = nodes.slice(), score = cost(order), improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
      const next = order.slice(); [next[i], next[j]] = [next[j], next[i]];
      const s = cost(next);
      if (s < score) { order = next; score = s; improved = true; }
    }
  }
  return order;
}

/** Lays out a netlist and returns the drawing with its geometry (used by the tests to measure clearances). */
export function layoutCircuit(spec: CircuitSpec): CircuitLayout {
  if (!spec || !Array.isArray(spec.elements) || spec.elements.length === 0) throw new Error('Circuit: needs "elements": [{kind, from, to, label?, value?, unit?}]');
  if (spec.elements.length > 60) throw new Error("Circuit: at most 60 elements");
  const els = spec.elements.map((e, i) => {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string" || !e.from.trim() || !e.to.trim()) throw new Error(`Circuit: element ${i + 1} needs "from" and "to" node names`);
    if (e.from === e.to) throw new Error(`Circuit: element ${i + 1} (${e.label ?? e.kind}) connects node "${e.from}" to itself`);
    if (e.value !== undefined && !Number.isFinite(e.value)) throw new Error(`Circuit: element ${i + 1} value must be a number`);
    let kind: SymbolKind;
    try { kind = symbolKind(e.kind); } catch (err) { throw new Error(`Circuit: element ${i + 1}: ${(err as Error).message}`); }
    return { ...e, kind, id: e.id ?? `E${i + 1}`, index: i, lines: labelLines(e.label, e.value, e.unit) };
  });
  const names: string[] = [];
  for (const e of els) for (const n of [e.from, e.to]) if (!names.includes(n)) names.push(n);
  const degree = (n: string) => els.filter((e) => e.from === n || e.to === n).length;
  let ground = spec.ground ?? names.find((n) => GROUND.test(n));
  const earth = ground !== undefined;
  if (ground === undefined) ground = names.reduce((a, b) => (degree(b) > degree(a) ? b : a));
  if (!names.includes(ground)) throw new Error(`Circuit: ground node "${ground}" is not used by any element`);
  for (const e of els) if (e.from === ground && e.to === ground) throw new Error("Circuit: an element connects ground to ground");
  const others = names.filter((n) => n !== ground);
  if (others.length === 0) throw new Error("Circuit: needs at least one node besides ground");
  if (others.length > 16) throw new Error("Circuit: at most 16 nodes besides ground");
  const series = els.filter((e) => e.from !== ground && e.to !== ground);
  let order: string[];
  if (spec.order) {
    if (!Array.isArray(spec.order) || spec.order.some((n) => !others.includes(n))) throw new Error(`Circuit: order must list node names from: ${others.join(", ")}`);
    order = [...new Set(spec.order), ...others.filter((n) => !spec.order!.includes(n))];
  } else order = bestOrder(others, series.map((e) => [e.from, e.to]));
  const pos = new Map(order.map((n, i) => [n, i]));

  // Series elements: the first between each pair of neighbouring nodes sits on the rail; the rest arch over it.
  const rail = new Map<number, typeof els[number]>();
  const arcs: { el: typeof els[number]; lo: number; hi: number; level: number }[] = [];
  for (const e of series) {
    const lo = Math.min(pos.get(e.from)!, pos.get(e.to)!), hi = Math.max(pos.get(e.from)!, pos.get(e.to)!);
    if (hi - lo === 1 && !rail.has(lo)) rail.set(lo, e);
    else arcs.push({ el: e, lo, hi, level: 0 });
  }
  const placed: typeof arcs = [];
  for (const a of [...arcs].sort((p, q) => p.hi - p.lo - (q.hi - q.lo) || p.el.index - q.el.index)) {
    let level = 1 + Math.max(0, ...placed.filter((b) => a.lo <= b.lo && b.hi <= a.hi).map((b) => b.level));
    while (placed.some((b) => b.level === level && b.lo < a.hi && a.lo < b.hi)) level++;
    a.level = level;
    placed.push(a);
  }
  const shunts = els.filter((e) => e.from === ground || e.to === ground);

  // Columns: per node, arches arriving from the left (innermost first), shunts, arches leaving right (outermost first),
  // so a lower arch never crosses the riser of a higher one.
  type Slot = { kind: "arc"; arc: typeof arcs[number] } | { kind: "shunt"; el: typeof els[number] } | { kind: "point" };
  const sideNeed = (e: typeof els[number]) => Math.max(e.voltage ? textWidth(e.voltage) + 10 : 0, e.current ? textWidth(e.current) + 6 : 0);
  const extent = (s: Slot) => {
    if (s.kind !== "shunt") return { L: 22, R: 22 };
    const t = SIZE[s.el.kind].thick, label = blockSize(s.el.lines).w, side = sideNeed(s.el);
    return { L: Math.max(28, t + CLEAR + (side ? side + CLEAR : 0) + 6), R: Math.max(28, t + CLEAR + (label ? label + CLEAR : 0) + 6) };
  };
  const slots: Slot[][] = order.map((n, i) => {
    const left = arcs.filter((a) => a.hi === i).sort((p, q) => p.level - q.level);
    const right = arcs.filter((a) => a.lo === i).sort((p, q) => q.level - p.level);
    const list: Slot[] = [...left.map((arc) => ({ kind: "arc" as const, arc })), ...shunts.filter((e) => e.from === n || e.to === n).map((el) => ({ kind: "shunt" as const, el })), ...right.map((arc) => ({ kind: "arc" as const, arc }))];
    return list.length ? list : [{ kind: "point" }];
  });
  const xs: number[][] = [];
  let x = 0, prev: { L: number; R: number } | null = null;
  for (let i = 0; i < order.length; i++) {
    xs.push([]);
    for (const [k, s] of slots[i].entries()) {
      const ext = extent(s);
      if (prev) {
        if (k > 0) x += Math.max(prev.R + ext.L, 56);
        else {
          const r = rail.get(i - 1);
          if (r) {
            const lead = r.current ? 34 : 24, label = blockSize(r.lines).w;
            x += Math.max(prev.R + ext.L, 2 * SIZE[r.kind].half + 2 * lead, label + 2 * CLEAR + 20, r.voltage ? textWidth(r.voltage) + 2 * SIZE[r.kind].half + 40 : 0);
          } else x += Math.max(prev.R + ext.L, 64);
        }
      }
      xs[i].push(x);
      prev = ext;
    }
  }
  // Arches need room for their symbol between the risers.
  for (const a of arcs) {
    const need = 2 * SIZE[a.el.kind].half + 2 * (a.el.current ? 34 : 24);
    const x1 = xs[a.lo][slots[a.lo].findIndex((s) => s.kind === "arc" && s.arc === a)], x2 = xs[a.hi][slots[a.hi].findIndex((s) => s.kind === "arc" && s.arc === a)];
    if (x2 - x1 < need) for (let i = a.hi; i < order.length; i++) xs[i] = xs[i].map((v, k) => (i > a.hi || k >= slots[a.hi].findIndex((s) => s.kind === "arc" && s.arc === a) ? v + need - (x2 - x1) : v));
  }

  // Heights: room above each horizontal symbol for its label, and below it for marks.
  const horizontal = [...rail.values(), ...arcs.map((a) => a.el)];
  const maxThick = Math.max(17, ...horizontal.map((e) => SIZE[e.kind].thick));
  const above = Math.max(LINE_H, ...horizontal.map((e) => blockSize(e.lines).h));
  const below = Math.max(0, ...horizontal.map((e) => (e.voltage || e.current ? LINE_H + 6 : 0)));
  const levelGap = Math.max(72, 2 * maxThick + above + below + 4 * CLEAR);
  const levels = Math.max(0, ...arcs.map((a) => a.level));
  const y0 = (horizontal.length ? maxThick + above + 2 * CLEAR : 0) + levels * levelGap;
  const shuntH = Math.max(140, ...shunts.map((e) => Math.max(2 * SIZE[e.kind].half + 2 * (e.current ? 40 : 28), blockSize(e.lines).h + 56, e.voltage ? LINE_H + 64 : 0)));
  const yG = y0 + shuntH;

  const segments: Seg[] = [], drawn: Drawn[] = [], bodies: Box[] = [], pins: CircuitLayout["pins"] = [];
  const addElement = (e: typeof els[number], p: Pt, q: Pt, prefer: 1 | -1) => {
    // p is the `from` end, q the `to` end.
    const ev = unit(p, q), c = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const [s0, s1] = bodyEnds(e.kind, c, ev);
    pins.push({ id: e.id, at: [p, q] });
    const lead = { a: p, b: s0 };
    segments.push(lead, { a: s1, b: q });
    if (e.kind !== "wire") bodies.push(drawSymbol(e.kind, c, ev).box);
    drawn.push({ id: e.id, kind: e.kind, c, e: ev, scale: 1, lines: e.lines, prefer, current: e.current, voltage: e.voltage, lead, closed: e.closed });
  };
  const groundXs: number[] = [];
  for (let i = 0; i < order.length; i++) {
    const row = xs[i];
    for (let k = 1; k < row.length; k++) segments.push({ a: { x: row[k - 1], y: y0 }, b: { x: row[k], y: y0 } });
    for (const [k, s] of slots[i].entries()) {
      if (s.kind !== "shunt") continue;
      const top = { x: row[k], y: y0 }, bottom = { x: row[k], y: yG };
      groundXs.push(row[k]);
      addElement(s.el, s.el.from === ground ? bottom : top, s.el.from === ground ? top : bottom, 1);
    }
    const r = rail.get(i);
    if (r) {
      const a = { x: row[row.length - 1], y: y0 }, b = { x: xs[i + 1][0], y: y0 };
      addElement(r, r.from === order[i] ? a : b, r.from === order[i] ? b : a, 1);
    }
  }
  for (const a of arcs) {
    const k1 = slots[a.lo].findIndex((s) => s.kind === "arc" && s.arc === a), k2 = slots[a.hi].findIndex((s) => s.kind === "arc" && s.arc === a);
    const x1 = xs[a.lo][k1], x2 = xs[a.hi][k2], y = y0 - a.level * levelGap;
    segments.push({ a: { x: x1, y: y0 }, b: { x: x1, y } }, { a: { x: x2, y: y0 }, b: { x: x2, y } });
    const left = { x: x1, y }, right = { x: x2, y };
    addElement(a.el, order[a.lo] === a.el.from ? left : right, order[a.lo] === a.el.from ? right : left, 1);
  }
  groundXs.sort((p, q) => p - q);
  for (let k = 1; k < groundXs.length; k++) if (groundXs[k] - groundXs[k - 1] > 0.5) segments.push({ a: { x: groundXs[k - 1], y: yG }, b: { x: groundXs[k], y: yG } });
  const wires = tidy(segments);
  const dots = junctions(wires);
  let extraSvg = "";
  if (earth && groundXs.length) {
    const mid = (groundXs[0] + groundXs[groundXs.length - 1]) / 2;
    const gx = groundXs.length === 1 ? groundXs[0] : groundXs.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
    // Between two columns when the rail has a middle span, so the earth stem never lands on a junction.
    const i = groundXs.findIndex((v) => v > mid);
    const at = groundXs.length > 1 && !dots.some((d) => Math.abs(d.x - gx) < 0.5 && Math.abs(d.y - yG) < 0.5) ? gx : groundXs.length > 1 && i > 0 ? (groundXs[i - 1] + groundXs[i]) / 2 : gx;
    const g = groundSymbol({ x: at, y: yG });
    extraSvg += g.svg; bodies.push(g.box);
  }
  const scene: Scene = { segments: wires, boxes: bodies.slice(), labels: [], frame: { x: -1e5, y: -1e5, w: 2e5, h: 2e5 } };
  const labels: { box: Box; lines: string[]; anchor: "start" | "middle" | "end" }[] = [];
  const { symbols, extra } = decorate(drawn, scene, labels);
  return finish({ x: 0, y: 0, w: 0, h: 0 }, spec.title, { segments: wires, symbols, bodies, labels, extra: extraSvg + extra, dots, pins }, true);
}

/** A textbook circuit schematic from a netlist; the layout, wiring, junction dots and label placement are automatic. */
export function renderCircuit(spec: CircuitSpec): string {
  return layoutCircuit(spec).svg;
}

// --- Placed components ------------------------------------------------------------

function rotate(v: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  return { x: v.x * cs - v.y * sn, y: v.x * sn + v.y * cs };
}
function crosses(s: Seg, b: Box) {
  // Whether an orthogonal segment passes through the inside of a box.
  const i = { x: b.x + 1.5, y: b.y + 1.5, w: b.w - 3, h: b.h - 3 };
  if (i.w <= 0 || i.h <= 0) return false;
  const sb = segBox(s);
  return sb.x < i.x + i.w && sb.x + sb.w > i.x && sb.y < i.y + i.h && sb.y + sb.h > i.y;
}
function collinearOverlap(s: Seg, t: Seg) {
  if (s.a.x === s.b.x && t.a.x === t.b.x && Math.abs(s.a.x - t.a.x) < 0.5)
    return Math.max(0, Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y)) - Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y)));
  if (s.a.y === s.b.y && t.a.y === t.b.y && Math.abs(s.a.y - t.a.y) < 0.5)
    return Math.max(0, Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x)) - Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x)));
  return 0;
}
function crossing(s: Seg, t: Seg) {
  const sv = s.a.x === s.b.x, tv = t.a.x === t.b.x;
  if (sv === tv) return false;
  const [v, h] = sv ? [s, t] : [t, s];
  return v.a.x > Math.min(h.a.x, h.b.x) + 0.5 && v.a.x < Math.max(h.a.x, h.b.x) - 0.5 && h.a.y > Math.min(v.a.y, v.b.y) + 0.5 && h.a.y < Math.max(v.a.y, v.b.y) - 0.5;
}

/** Lays out placed components; wires without right angles are routed orthogonally around the symbols. */
export function layoutSchematic(s: Schematic): CircuitLayout {
  validateSchematic(s);
  const t = sceneTransform({ ...s, shapes: [] });
  const view = (p: Pt): Pt => ({ x: t.tx + p.x * t.sx, y: t.ty - p.y * t.sy });
  type Placed = { c: Component; kind: ComponentKind; pins: [Pt, Pt]; out: [Pt | null, Pt | null]; box: Box | null };
  const comps = new Map<string, Placed>();
  const segments: Seg[] = [], bodies: Box[] = [], drawn: Drawn[] = [];
  let extraSvg = "";
  for (const c of s.components) {
    const kind = kindOf(c.kind), rot = c.rotationDeg ?? 0, half = WORLD_PIN[kind];
    const local = c.pins ?? [{ x: -half, y: 0 }, { x: half, y: 0 }];
    const world = local.map((p) => ({ x: c.position.x + rotate(p, rot).x, y: c.position.y + rotate(p, rot).y }));
    const pins = world.map(view) as [Pt, Pt];
    if (kind === "ground") {
      const g = groundSymbol(pins[0]);
      extraSvg += `<g data-component="${c.id.replace(/[&<>"']/g, "")}">${g.svg}</g>`;
      bodies.push(g.box);
      comps.set(c.id, { c, kind, pins, out: [{ x: 0, y: -1 }, { x: 0, y: -1 }], box: g.box });
      if (c.label) drawn.push({ id: c.id, kind: "wire", c: { x: pins[0].x, y: pins[0].y + 12 }, e: { x: 0, y: 1 }, scale: 1, lines: labelLines(c.label, c.value, c.unit), prefer: 1 });
      continue;
    }
    const sk = kind as SymbolKind;
    const d = Math.hypot(pins[1].x - pins[0].x, pins[1].y - pins[0].y);
    const e = d > 0.5 ? unit(pins[0], pins[1]) : (() => { const r = rotate({ x: 1, y: 0 }, rot); return { x: r.x, y: -r.y }; })();
    const center = d > 0.5 ? { x: (pins[0].x + pins[1].x) / 2, y: (pins[0].y + pins[1].y) / 2 } : view(c.position);
    const scale = SIZE[sk].half > 0 && d > 0.5 ? Math.min(1, d / (2 * SIZE[sk].half)) : 1;
    const [b0, b1] = bodyEnds(sk, center, e, scale);
    segments.push({ a: pins[0], b: b0 }, { a: b1, b: pins[1] });
    const sym = drawSymbol(sk, center, e, scale, { closed: c.closed });
    if (sk !== "wire") bodies.push(sym.box);
    comps.set(c.id, { c, kind, pins, out: [{ x: -e.x, y: -e.y }, e], box: sk === "wire" ? null : sym.box });
    drawn.push({ id: c.id, kind: sk, c: center, e, scale, lines: labelLines(c.label, c.value, c.unit), prefer: 1, closed: c.closed });
  }
  const routed: Seg[] = [];
  const cost = (route: Pt[], from?: Pt | null, to?: Pt | null) => {
    let c = route.length * 1.5;
    for (let i = 1; i < route.length; i++) {
      const sg = { a: route[i - 1], b: route[i] };
      c += Math.hypot(sg.a.x - sg.b.x, sg.a.y - sg.b.y) * 0.004;
      for (const b of bodies) if (crosses(sg, b)) c += 200;
      for (const o of routed) { const ov = collinearOverlap(sg, o); if (ov > 2) c += 40 + ov * 0.2; if (crossing(sg, o)) c += 3; }
    }
    // Leave and reach a pin along the symbol's axis, not across it.
    const along = (a: Pt, b: Pt, d?: Pt | null) => { if (!d) return 0; const u = unit(a, b); return u.x * d.x + u.y * d.y > 0.7 ? 0 : 6; };
    if (route.length > 1) c += along(route[0], route[1], from) + along(route[route.length - 1], route[route.length - 2], to);
    return c;
  };
  for (const w of s.wires) {
    const fc = comps.get(w.from.componentId)!;
    const start = fc.pins[w.from.pin], startOut = fc.kind === "ground" ? { x: 0, y: -1 } : fc.out[w.from.pin];
    let end: Pt, endOut: Pt | null = null;
    if ("point" in w.to) end = view(w.to.point);
    else { const tc = comps.get(w.to.componentId)!; end = tc.pins[w.to.pin]; endOut = tc.kind === "ground" ? { x: 0, y: -1 } : tc.out[w.to.pin]; }
    const pts = [start, ...(w.via ?? []).map(view), end];
    const route: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = route[route.length - 1], b = pts[i];
      const first = i === 1 ? startOut : null, last = i === pts.length - 1 ? endOut : null;
      const options: Pt[][] = [];
      if (Math.abs(a.x - b.x) < 0.75 || Math.abs(a.y - b.y) < 0.75) {
        const bb = Math.abs(a.x - b.x) < 0.75 ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
        options.push([bb]);
        // A straight run blocked by a symbol steps around it.
        const n = Math.abs(a.x - b.x) < 0.75 ? { x: 1, y: 0 } : { x: 0, y: 1 };
        for (const dist of [28, -28, 52, -52]) options.push([{ x: a.x + n.x * dist, y: a.y + n.y * dist }, { x: bb.x + n.x * dist, y: bb.y + n.y * dist }, bb]);
      } else {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        options.push([{ x: b.x, y: a.y }, b], [{ x: a.x, y: b.y }, b], [{ x: mx, y: a.y }, { x: mx, y: b.y }, b], [{ x: a.x, y: my }, { x: b.x, y: my }, b]);
        for (const d of [first, last ? { x: -last.x, y: -last.y } : null]) {
          if (!d) continue;
          // Out of a pin along its axis first, then across.
          const o = d === first ? { x: a.x + d.x * 18, y: a.y + d.y * 18 } : null;
          if (o) options.push([o, { x: b.x, y: o.y }, b], [o, { x: o.x, y: b.y }, b]);
          if (last && d !== first) { const p = { x: b.x + last.x * 18, y: b.y + last.y * 18 }; options.push([{ x: p.x, y: a.y }, p, b], [{ x: a.x, y: p.y }, p, b]); }
        }
      }
      let best = options[0], score = Infinity;
      for (const o of options) {
        const r = [a, ...o].filter((p, k, arr) => k === 0 || Math.hypot(p.x - arr[k - 1].x, p.y - arr[k - 1].y) > 0.5);
        if (r.some((p, k) => k > 0 && Math.abs(p.x - r[k - 1].x) > 0.75 && Math.abs(p.y - r[k - 1].y) > 0.75)) continue;
        const sc = cost(r, first, last);
        if (sc < score - 1e-9) { score = sc; best = o; }
      }
      route.push(...best);
    }
    const segs: Seg[] = [];
    for (let i = 1; i < route.length; i++) segs.push({ a: route[i - 1], b: route[i] });
    routed.push(...segs);
  }
  // Snap near-orthogonal pieces exactly so the drawing has no hairline slants.
  for (const sg of routed) { if (Math.abs(sg.a.x - sg.b.x) < 0.75) sg.b = { x: sg.a.x, y: sg.b.y }; else if (Math.abs(sg.a.y - sg.b.y) < 0.75) sg.b = { x: sg.b.x, y: sg.a.y }; }
  const wires = tidy([...segments, ...routed]);
  const dots = junctions(wires);
  const frame = { x: 0, y: 0, w: s.width, h: s.height };
  const scene: Scene = { segments: wires, boxes: bodies.slice(), labels: [], frame };
  if (s.title) scene.labels.push({ x: s.width / 2 - textWidth(s.title, 15) / 2, y: 0, w: textWidth(s.title, 15), h: 30 });
  const labels: { box: Box; lines: string[]; anchor: "start" | "middle" | "end" }[] = [];
  const { symbols, extra } = decorate(drawn, scene, labels);
  return finish(frame, s.title, { segments: wires, symbols, bodies, labels, extra: extraSvg + extra, dots, pins: [...comps.values()].map((p) => ({ id: p.c.id, at: p.pins })) }, false);
}

export function renderSchematic(s: Schematic): string {
  return layoutSchematic(s).svg;
}

export function schematicArtifact(s: Schematic, title = "Schematic"): ReturnType<typeof createArtifact<"schematic", Schematic>> {
  const a = createArtifact({ kind: "schematic", title, model: s });
  return withRendering(a, "svg", { format: "svg", content: renderSchematic(s), contentType: "image/svg+xml" });
}

