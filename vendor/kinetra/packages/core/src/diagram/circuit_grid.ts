/**
 * Circuits drawn with their nodes where the source figure has them: every element runs from its `from` node to its
 * `to` node (slanted when the figure slants it), through `via` corners when given, and a route that would touch a
 * node or wire it is not connected to is bent around it. Also finds node positions on its own for circuits too
 * interconnected to read as one rail.
 */

import { SIZE } from "./schematic_kit.js";
import type { Pt, Seg, SymbolKind } from "./schematic_kit.js";

export type XY = [number, number];
export type GridElement = { id: string; kind: SymbolKind; from: string; to: string; via?: XY[]; at?: XY; current?: string; labelWidth: number };
/** Node positions in grid units, x right and y down. A node with several positions is a wire joining them in order. */
export type GridLayout = Record<string, XY | XY[]>;
/** A routed element: the points it runs through from its `from` node, and the body on leg `leg` (points[leg] to points[leg + 1]). */
export type GridRoute = { id: string; points: Pt[]; leg: number; c: Pt; e: Pt; scale: number };
export type Grid = { routes: GridRoute[]; nodes: Map<string, Pt[]>; rails: (Seg & { net: string })[]; cost: number; problem?: string };

type Piece = Seg & { net: string; body?: number };
/** A cost at or above this means the drawing would connect something the netlist does not, or hide a symbol. */
const BROKEN = 1000;

const sub = (a: Pt, b: Pt) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const lerp = (a: Pt, b: Pt, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function pointSeg(p: Pt, s: Seg) {
  const d = sub(s.b, s.a), l2 = d.x * d.x + d.y * d.y;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - s.a.x) * d.x + (p.y - s.a.y) * d.y) / l2)) : 0;
  return len(p, lerp(s.a, s.b, t));
}
function properCross(s: Seg, t: Seg) {
  const d1 = cross(sub(s.b, s.a), sub(t.a, s.a)), d2 = cross(sub(s.b, s.a), sub(t.b, s.a));
  const d3 = cross(sub(t.b, t.a), sub(s.a, t.a)), d4 = cross(sub(t.b, t.a), sub(s.b, t.a));
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
}
const endGap = (s: Seg, t: Seg) => Math.min(pointSeg(s.a, t), pointSeg(s.b, t), pointSeg(t.a, s), pointSeg(t.b, s));
const segSeg = (s: Seg, t: Seg) => (properCross(s, t) ? 0 : endGap(s, t));

/** What drawing p beside q costs: false connections and covered symbols are broken, crossings only untidy. */
function clash(p: Piece, q: Piece) {
  const d = segSeg(p, q);
  if (p.body !== undefined || q.body !== undefined) {
    const room = (p.body ?? 0) + (q.body ?? 0);
    // Two symbols on one spot cost more than a wire through one, so crossing branches each slide clear of the crossing.
    return d < 2 + room ? BROKEN * (p.body !== undefined && q.body !== undefined ? 2 : 1) : d < room + 12 ? 60 : 0;
  }
  if (p.net === q.net) return properCross(p, q) ? 15 : 0;
  // A crossing right beside a wire's end reads as a joint there.
  if (properCross(p, q)) return endGap(p, q) < 6 ? BROKEN : 45;
  return d < 4 ? BROKEN : d < 14 ? 80 : 0;
}

type Option = { points: Pt[]; leg: number; t: number; cost: number };
type Made = { pieces: Piece[]; c: Pt; e: Pt };

function pieces(el: GridElement, o: Option, scale: number): Made {
  const a = o.points[o.leg], b = o.points[o.leg + 1], d = len(a, b) || 1;
  const e = { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  const c = lerp(a, b, o.t), half = SIZE[el.kind].half * scale;
  const s0 = { x: c.x - e.x * half, y: c.y - e.y * half }, s1 = { x: c.x + e.x * half, y: c.y + e.y * half };
  const out: Piece[] = [];
  for (let i = 0; i < o.leg; i++) out.push({ a: o.points[i], b: o.points[i + 1], net: el.from });
  out.push({ a, b: s0, net: el.from });
  if (el.kind !== "wire") out.push({ a: s0, b: s1, net: `#${el.id}`, body: SIZE[el.kind].thick * scale });
  out.push({ a: s1, b, net: el.to });
  for (let i = o.leg + 1; i < o.points.length - 1; i++) out.push({ a: o.points[i], b: o.points[i + 1], net: el.to });
  return { pieces: out.filter((s) => s.body !== undefined || len(s.a, s.b) > 0.5), c, e };
}

/** The longest run of a chain of points: where the symbol sits when the figure does not say. */
function longest(points: Pt[]) {
  let leg = 0;
  for (let i = 1; i < points.length - 1; i++) if (len(points[i], points[i + 1]) > len(points[leg], points[leg + 1]) + 1e-6) leg = i;
  return leg;
}
const slanted = (a: Pt, b: Pt) => Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5;

/** The space an element's symbol, current arrow and label need on a straight run. */
const runLength = (el: GridElement, horizontal: boolean) =>
  Math.max(2 * SIZE[el.kind].half + 2 * (el.current ? 44 : 34), horizontal ? el.labelWidth + 34 : 0);

/** Routes every element between the given node positions. `slantCost` discourages slanted runs the caller did not ask for. */
export function routeGrid(els: GridElement[], layout: GridLayout, slantCost = 0, roomier = 1): Grid {
  const raw = new Map<string, XY[]>();
  for (const [n, v] of Object.entries(layout)) raw.set(n, (Array.isArray(v[0]) ? v : [v]) as XY[]);
  // Grid units become pixels so that the shortest run still holds its symbol, its arrow and its label.
  let wanted = 0;
  const pt = ([x, y]: XY): Pt => ({ x, y });
  let anySlant = false;
  for (const e of els) {
    if (e.kind === "wire") continue;
    let run = 0, flat = true, straight = !!(e.via || e.at);
    for (const p of raw.get(e.from)!) for (const q of raw.get(e.to)!) {
      const chain = [p, ...(e.via ?? []), q].map(pt), i = longest(chain), l = len(chain[i], chain[i + 1]);
      if (p[0] === q[0] || p[1] === q[1]) straight = true;
      if (l > run) { run = l; flat = Math.abs(chain[i].x - chain[i + 1].x) >= Math.abs(chain[i].y - chain[i + 1].y); }
    }
    if (!straight) anySlant = true;
    if (run > 1e-6) wanted = Math.max(wanted, runLength(e, flat) / run);
  }
  if (anySlant) wanted *= 1.25;
  const all = [...raw.values()].flat().concat(els.flatMap((e) => e.via ?? []));
  const xsAll = all.map((p) => p[0]), ysAll = all.map((p) => p[1]);
  const span = Math.max(Math.max(...xsAll) - Math.min(...xsAll), Math.max(...ysAll) - Math.min(...ysAll), 1e-6);
  wanted = (wanted || 120 / span) * roomier;
  const unit = Math.min(wanted, 1800 / span);
  const scale = Math.max(0.6, Math.min(1, unit / wanted));
  const px = (p: XY): Pt => ({ x: Math.round(p[0] * unit * 100) / 100, y: Math.round(p[1] * unit * 100) / 100 });

  const nodes = new Map<string, Pt[]>([...raw].map(([n, ps]) => [n, ps.map(px)]));
  const rails: Piece[] = [];
  for (const [n, ps] of nodes) for (let i = 1; i < ps.length; i++) {
    const a = ps[i - 1], b = ps[i];
    if (slanted(a, b)) { const m = { x: b.x, y: a.y }; rails.push({ a, b: m, net: n }, { a: m, b, net: n }); }
    else rails.push({ a, b, net: n });
  }
  const points = [...nodes].flatMap(([net, ps]) => ps.map((p) => ({ p, net })));
  const minX = Math.min(...points.map((q) => q.p.x)), maxX = Math.max(...points.map((q) => q.p.x));
  const minY = Math.min(...points.map((q) => q.p.y)), maxY = Math.max(...points.map((q) => q.p.y));

  /** Where an element may leave node n when it heads toward t: the listed positions, and straight off the node's own wire. */
  const anchors = (n: string, t: Pt[]): Pt[] => {
    const out = [...nodes.get(n)!];
    for (const r of rails) if (r.net === n) for (const p of t) {
      if (Math.abs(r.a.y - r.b.y) < 0.5 && p.x > Math.min(r.a.x, r.b.x) && p.x < Math.max(r.a.x, r.b.x)) out.push({ x: p.x, y: r.a.y });
      if (Math.abs(r.a.x - r.b.x) < 0.5 && p.y > Math.min(r.a.y, r.b.y) && p.y < Math.max(r.a.y, r.b.y)) out.push({ x: r.a.x, y: p.y });
    }
    return out;
  };
  const reach = (p: Pt, q: Pt) => len(p, q) * (slanted(p, q) ? 1.6 : 1);
  const nearest = (ps: Pt[], t: Pt) => ps.reduce((a, b) => (reach(b, t) < reach(a, t) - 0.5 ? b : a));

  const options = (el: GridElement): Option[] => {
    const out: Option[] = [], half = SIZE[el.kind].half * scale;
    const add = (pts: Pt[], cost: number, ts = [0.5, 0.36, 0.64]) => {
      const p = pts.filter((q, i) => i === 0 || len(q, pts[i - 1]) > 0.5);
      if (p.length < 2) return;
      const leg = longest(p);
      for (const [k, t] of ts.entries()) out.push({ points: p, leg, t, cost: cost + (p.length - 2) * 10 + k * 5 });
    };
    const A = nodes.get(el.from)!, B = nodes.get(el.to)!;
    if (el.via?.length) {
      const via = el.via.map(px), last = via[via.length - 1];
      add([nearest(anchors(el.from, [via[0]]), via[0]), ...via, nearest(anchors(el.to, [last]), last)], 0);
    }
    if (el.at) {
      const c = px(el.at);
      if (!el.via?.length) {
        const p = nearest(anchors(el.from, [c]), c), q = nearest(anchors(el.to, [c]), c);
        if (pointSeg(c, { a: p, b: q }) < 8) add([p, q], 0, [0.5]);
        // The symbol stands off the straight line: wires run out to it and back, parallel to the line between the nodes.
        else if (Math.abs(p.y - q.y) >= Math.abs(p.x - q.x)) add([p, { x: c.x, y: p.y }, { x: c.x, y: q.y }, q], 0, [0.5]);
        else add([p, { x: p.x, y: c.y }, { x: q.x, y: c.y }, q], 0, [0.5]);
      }
      // The symbol is centred where the figure has it.
      for (const o of out) {
        let best = Infinity;
        for (let i = 0; i < o.points.length - 1; i++) {
          const a = o.points[i], b = o.points[i + 1], d = pointSeg(c, { a, b }), l = len(a, b);
          if (d >= best - 0.5 || l < 2 * half + 12) continue;
          const m = (half + 6) / l;
          best = d; o.leg = i;
          o.t = Math.max(m, Math.min(1 - m, ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (l * l)));
        }
      }
    }
    const given = out.length ? 400 : 0;
    const pairs: [Pt, Pt][] = [];
    for (const p of anchors(el.from, B)) for (const q of anchors(el.to, A)) if (len(p, q) > 0.5) pairs.push([p, q]);
    pairs.sort((r, s) => reach(...r) - reach(...s));
    for (const [k, [p, q]] of pairs.slice(0, 5).entries()) {
      const base = given + k * 8 + (reach(p, q) - reach(...pairs[0])) * 0.1;
      if (slanted(p, q)) {
        add([p, q], base + slantCost);
        add([p, { x: q.x, y: p.y }, q], base + 60);
        add([p, { x: p.x, y: q.y }, q], base + 60);
      } else {
        add([p, q], base);
        // Beside the straight run: parallel elements, and runs that another node or symbol blocks.
        const v = Math.abs(p.x - q.x) < 0.5;
        for (const [j, off] of [56, -56, 84, -84, 112, -112].entries())
          add(v ? [p, { x: p.x + off, y: p.y }, { x: q.x + off, y: q.y }, q] : [p, { x: p.x, y: p.y + off }, { x: q.x, y: q.y + off }, q], base + 80 + j * 4);
      }
      if (k < 2) for (const [j, off] of [70, 110, 150].entries()) {
        for (const x of [minX - off, maxX + off]) add([p, { x, y: p.y }, { x, y: q.y }, q], base + 110 + j * 12 + (Math.abs(p.x - x) + Math.abs(q.x - x)) * 0.1);
        for (const y of [minY - off, maxY + off]) add([p, { x: p.x, y }, { x: q.x, y }, q], base + 110 + j * 12 + (Math.abs(p.y - y) + Math.abs(q.y - y)) * 0.1);
      }
    }
    return out;
  };

  const chosen = new Map<string, { o: Option; made: Made; cost: number }>();
  const score = (el: GridElement, o: Option, limit = Infinity) => {
    const made = pieces(el, o, scale);
    let cost = o.cost;
    for (const p of made.pieces) {
      for (const r of rails) cost += clash(p, r);
      for (const { p: q, net } of points) {
        const d = pointSeg(q, p);
        if (p.body !== undefined) cost += d < p.body + 2 ? BROKEN : 0;
        else if (net !== p.net && d < 9) cost += BROKEN;
      }
    }
    // Wires of one branch that run over its own symbol, or whose two ends touch each other.
    for (const [i, p] of made.pieces.entries()) for (const q of made.pieces.slice(i + 2)) if (segSeg(p, q) < (p.body ?? q.body ?? 0) + 2) cost += BROKEN;
    const l = len(o.points[o.leg], o.points[o.leg + 1]), need = 2 * SIZE[el.kind].half * scale;
    if (l < need + 4) cost += BROKEN; else if (l < need + 30) cost += 40;
    for (const [id, other] of chosen) {
      if (id === el.id) continue;
      if (cost >= limit) break;
      for (const p of made.pieces) for (const q of other.made.pieces) cost += clash(p, q);
    }
    return { made, cost };
  };
  const choose = (el: GridElement, opts: Option[]) => {
    let best: { o: Option; made: Made; cost: number } | null = null;
    for (const o of opts) {
      if (best && o.cost >= best.cost) continue;
      const s = score(el, o, best?.cost);
      if (!best || s.cost < best.cost - 1e-9) best = { o, ...s };
    }
    if (best) chosen.set(el.id, best);
  };
  const opts = new Map(els.map((e) => [e.id, options(e)]));
  // Placed branches first, then straight ones, then slanted; short before long, so the long ones find their way round.
  const rank = (e: GridElement) => {
    const o = opts.get(e.id)![0];
    if (!o) return 0;
    const a = o.points[0], b = o.points[o.points.length - 1];
    return (e.via || e.at ? 0 : 1e6) + (slanted(a, b) ? 5e5 : 0) + len(a, b);
  };
  const order = [...els].sort((a, b) => rank(a) - rank(b));
  for (let pass = 0; pass < 3; pass++) for (const e of order) choose(e, opts.get(e.id)!);

  let cost = 0, problem: string | undefined;
  for (const { p, net } of points) for (const r of rails) if (r.net !== net && pointSeg(p, r) < 9) problem = `node "${net}" sits on the wire of node "${r.net}"`;
  for (const r of rails) for (const q of rails) if (r.net !== q.net && endGap(r, q) < 4) problem = `the wires of nodes "${r.net}" and "${q.net}" touch`;
  for (const [i, a] of points.entries()) for (const b of points.slice(i + 1)) if (a.net !== b.net && len(a.p, b.p) < 24) problem = `nodes "${a.net}" and "${b.net}" share a position`;
  for (const e of els) {
    const got = chosen.get(e.id);
    if (!got) { problem ??= `element ${e.id} has no room between its nodes`; continue; }
    const now = score(e, got.o).cost;
    cost += now;
    if (now >= BROKEN) problem ??= `element ${e.id} (${e.from} to ${e.to}) runs into another node, wire or symbol`;
  }
  const routes = els.filter((e) => chosen.has(e.id)).map((e) => { const { o, made } = chosen.get(e.id)!; return { id: e.id, points: o.points, leg: o.leg, c: made.c, e: made.e, scale }; });
  return { routes, nodes, rails: rails.map(({ a, b, net }) => ({ a, b, net })), cost, problem };
}

/** Node positions with short, uncrossed connections, found by a seeded search so the same circuit always draws the same. */
export function autoGrid(els: GridElement[], names: string[], ground: string): Grid | null {
  const edges = els.map((e) => [names.indexOf(e.from), names.indexOf(e.to)]);
  const g = names.indexOf(ground), n = names.length;
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const tried: { at: XY[]; cost: number }[] = [];
  for (let cols = 2; cols <= Math.min(n, 5); cols++) for (const rows of [Math.ceil(n / cols), Math.ceil(n / cols) + 1]) {
    if (rows < 2 && n > 3) continue;
    const cells = cols * rows;
    const pos = (c: number): XY => [c % cols, Math.floor(c / cols)];
    const energy = (slot: number[]) => {
      const at = slot.slice(0, n).map(pos);
      let c = (rows - 1 - at[g][1]) * 6;
      for (let i = 0; i < edges.length; i++) {
        const a = at[edges[i][0]], b = at[edges[i][1]], dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
        c += dx && dy ? 1.5 + dx + dy : dx + dy - 1;
        const s = { a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } };
        // A run past another node can go round the outside of the figure; inside it has no way past.
        for (let k = 0; k < n; k++) if (k !== edges[i][0] && k !== edges[i][1] && pointSeg({ x: at[k][0], y: at[k][1] }, s) < 0.1)
          c += (!dx && (a[0] === 0 || a[0] === cols - 1)) || (!dy && (a[1] === 0 || a[1] === rows - 1)) ? 2 : 7;
        for (let j = i + 1; j < edges.length; j++) {
          const p = at[edges[j][0]], q = at[edges[j][1]];
          if (properCross(s, { a: { x: p[0], y: p[1] }, b: { x: q[0], y: q[1] } })) c += 6;
        }
      }
      return c;
    };
    let bestSlot: number[] = [], bestE = Infinity;
    for (let start = 0; start < 3; start++) {
      // slot[k] is the cell of node k; the entries past the nodes are the empty cells.
      const slot = Array.from({ length: cells }, (_, i) => i);
      for (let i = cells - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [slot[i], slot[j]] = [slot[j], slot[i]]; }
      let cur = energy(slot);
      const steps = Math.max(500, Math.min(2500, Math.round(600000 / edges.length ** 2)));
      for (let s = 0; s < steps; s++) {
        const i = Math.floor(rnd() * n), j = Math.floor(rnd() * cells);
        if (i === j) continue;
        [slot[i], slot[j]] = [slot[j], slot[i]];
        const next = energy(slot);
        if (next <= cur || rnd() < Math.exp((cur - next) / (4 * (1 - s / steps) + 0.05))) {
          cur = next;
          if (cur < bestE) { bestE = cur; bestSlot = slot.slice(0, n); }
        } else [slot[i], slot[j]] = [slot[j], slot[i]];
      }
    }
    if (bestSlot.length) tried.push({ at: bestSlot.map(pos), cost: bestE });
  }
  tried.sort((a, b) => a.cost - b.cost);
  // The source reads on the left, as textbooks draw it.
  const source = els.find((e) => /source|battery/.test(e.kind));
  let best: Grid | null = null;
  for (const t of tried.slice(0, 4)) {
    const w = Math.max(...t.at.map((p) => p[0]));
    const flip = source !== undefined && t.at[names.indexOf(source.from)][0] + t.at[names.indexOf(source.to)][0] > w;
    const layout: GridLayout = {};
    names.forEach((name, i) => { layout[name] = [(flip ? w - t.at[i][0] : t.at[i][0]) * 1.25, t.at[i][1]]; });
    const grid = routeGrid(els, layout, 20);
    if (!grid.problem && (!best || grid.cost < best.cost)) best = grid;
  }
  return best;
}
