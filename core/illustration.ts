import { numeric, safeEval, type Compiled, type Vars } from './expr.ts';

/**
 * Textbook illustrations: the drawings in a physics or engineering book (pulleys with spring scales, blocks on
 * inclines, levers and wheelbarrows, charged spheres and wires with their field lines, vessels of liquid), built
 * from a short list of parts in world units (y up). The geometry is computed, not traced: ropes leave every pulley
 * along its true tangent, blocks sit on the incline they are placed on, and field lines are integrated from the
 * charges in the scene. One renderer serves the chat (```visual kind "figure"), PDFs (Kinetra clem.illustration),
 * exports and thumbnails, so a figure looks the same everywhere. Output is a self-contained SVG string.
 */

type Num = number | string;
type V = [number, number];
type Item = Record<string, any> & { type: string; id?: string };

export const figureItemTypes = [
  'ground', 'ceiling', 'wall', 'surface', 'incline', 'table',
  'block', 'ball', 'pulley', 'wheel', 'rope', 'spring', 'scale', 'rod', 'wire', 'pivot', 'container',
  'force', 'dimension', 'angle', 'line', 'curve', 'polygon', 'rect', 'ellipse', 'text', 'point', 'charge', 'fieldLines', 'fbd',
] as const;
export const figureIdPattern = /^[A-Za-z][\w-]{0,39}$/;
export type FigureSpec = { items: Item[]; view?: { x?: [Num, Num]; y?: [Num, Num] }; background?: string; width?: number };
/**
 * Checked by hand rather than with a schema library, so the Kinetra worker that draws PDF figures stays small (it
 * starts afresh for every call). The chat's ```visual schema (core/visual-spec.ts) checks the same shape with zod.
 */
function checkSpec(raw: unknown): FigureSpec {
  const bad = (path: string, message: string): never => { throw Error(`The figure description is incomplete (${path}: ${message}).`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('root', 'expected an object with "items"');
  const spec = raw as Record<string, unknown>, items = spec.items;
  if (!Array.isArray(items) || !items.length) return bad('items', 'expected a list of 1 to 150 items');
  if (items.length > 150) bad('items', 'at most 150 items');
  items.forEach((it, i) => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) bad(`items.${i}`, 'expected an object');
    const o = it as Record<string, unknown>;
    if (!(figureItemTypes as readonly string[]).includes(o.type as string)) bad(`items.${i}.type`, `expected one of ${figureItemTypes.join(', ')}`);
    if (o.id !== undefined && (typeof o.id !== 'string' || !figureIdPattern.test(o.id))) bad(`items.${i}.id`, 'ids start with a letter and use letters, digits, _ or -');
  });
  const span = (v: unknown, path: string) => { if (v !== undefined && (!Array.isArray(v) || v.length !== 2 || v.some(x => typeof x !== 'number' && typeof x !== 'string'))) bad(path, 'expected [min, max]'); };
  if (spec.view !== undefined) { if (typeof spec.view !== 'object' || !spec.view) bad('view', 'expected {"x":[a,b],"y":[c,d]}'); span((spec.view as any).x, 'view.x'); span((spec.view as any).y, 'view.y'); }
  if (spec.width !== undefined && !(typeof spec.width === 'number' && spec.width >= 240 && spec.width <= 1600)) bad('width', 'expected a number from 240 to 1600');
  return spec as FigureSpec;
}

/* ── Palette: printed-textbook colours on paper ── */
const PAPER = '#fffdf8', INK = '#232323', HATCH = '#5b5b5b';
const named: Record<string, string> = {
  orange: '#f29b3a', blue: '#4a7fd1', red: '#d9473b', green: '#4c9a52', gray: '#9aa1a8', grey: '#9aa1a8', yellow: '#f2d14b', purple: '#8a63c9',
  teal: '#2e9c9a', steel: '#aab3bc', metal: '#aab3bc', iron: '#8d949b', copper: '#c97b45', brass: '#d1a94a', gold: '#d8b04a', wood: '#c48d53', glass: '#bfe3ee',
  rubber: '#4b4f55', plastic: '#e9e4d8', black: '#2b2b2b', white: '#f4f4f2', ink: INK, sand: '#e7c98f', water: '#bcdcf2', oil: '#e9cf7d', mercury: '#b9bfc6',
  incline: '#f5eeae', paper: PAPER, force: '#e0245e', force2: '#f27a9b', velocity: '#2f7fd1', acceleration: '#2e9c5a', positive: '#d0342c', negative: '#2a62c9', field: '#4d4d4d',
};
const colorOf = (value: unknown, fallback: string) => {
  if (typeof value === 'string') { const v = value.trim().toLowerCase(); if (named[v]) return named[v]; if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v)) return v; }
  return named[fallback] ?? fallback;
};
const rgb = (hex: string): [number, number, number] => { let h = hex.slice(1); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]; };
const hex = (c: number[]) => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, f: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * f)); };
const light = (c: string, f: number) => mix(c, '#ffffff', f), dark = (c: string, f: number) => mix(c, '#000000', f);

/* ── Vectors (world, y up) ── */
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]], sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]], mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const len = (a: V) => Math.hypot(a[0], a[1]), unit = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; }, left = (a: V): V => [-a[1], a[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const polar = (deg: number, r = 1): V => [Math.cos(deg * Math.PI / 180) * r, Math.sin(deg * Math.PI / 180) * r];
const lerp = (a: V, b: V, f: number): V => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

/* ── Text: textbook labels with subscripts, superscripts and Greek ── */
const greek: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Omega: 'Ω', perp: '⊥', parallel: '∥', cdot: '·', times: '×', degree: '°', circ: '°', approx: '≈', infty: '∞', vec: '' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Run = { text: string; shift: number };
function runs(raw: string): Run[] {
  const s = raw.replace(/\\([A-Za-z]+)\s?/g, (m, w) => (w in greek ? greek[w] : m)).replace(/\$/g, '').slice(0, 120), out: Run[] = [];
  let i = 0, cur = '';
  const push = (text: string, shift: number) => { if (text) out.push({ text, shift }); };
  while (i < s.length) {
    const c = s[i];
    if ((c === '_' || c === '^') && i + 1 < s.length) {
      push(cur, 0); cur = '';
      let body: string;
      if (s[i + 1] === '{') { const end = s.indexOf('}', i + 2); body = end < 0 ? s.slice(i + 2) : s.slice(i + 2, end); i = end < 0 ? s.length : end + 1; } else { body = s[i + 1]; i += 2; }
      push(body, c === '_' ? 1 : -1);
    } else { cur += c; i++; }
  }
  push(cur, 0);
  return out;
}
const glyphW = (ch: string) => /[il.,:;'|!]/.test(ch) ? 0.3 : /[mwMW]/.test(ch) ? 0.85 : /[A-Z0-9θ]/.test(ch) ? 0.64 : 0.52;
const measure = (raw: string, size: number) => runs(raw).reduce((w, r) => w + [...r.text].reduce((a, ch) => a + glyphW(ch), 0) * size * (r.shift ? 0.7 : 1), 0);
const SERIF = "'Mowafy Serif',serif";
type TextOpts = { size?: number; color?: string; anchor?: 'start' | 'middle' | 'end'; italic?: boolean; bold?: boolean; halo?: boolean | string };
function richText(raw: string, x: number, y: number, o: TextOpts = {}) {
  const size = o.size ?? 19, rs = runs(raw);
  const base = rs[0]?.text ?? '', italic = o.italic ?? /^[A-Za-zα-ωΔΩ]$/.test(base.trim());
  let shift = 0, body = '';
  for (const r of rs) {
    const target = r.shift * size * 0.32, dy = target - shift; shift = target;
    body += `<tspan${dy ? ` dy="${n(dy)}"` : ''}${r.shift ? ` font-size="${n(size * 0.7)}" font-style="${r.shift === 1 && italic ? 'normal' : 'inherit'}"` : ''}>${esc(r.text)}</tspan>`;
  }
  const halo = o.halo === false ? '' : ` stroke="${typeof o.halo === 'string' ? o.halo : PAPER}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`;
  return `<text x="${n(x)}" y="${n(y)}" font-family="${SERIF}" font-size="${n(size)}"${italic ? ' font-style="italic"' : ''}${o.bold ? ' font-weight="700"' : ''} fill="${o.color ?? INK}" text-anchor="${o.anchor ?? 'middle'}" dominant-baseline="central"${halo}>${body}</text>`;
}
const n = (v: number) => (Math.round(v * 100) / 100).toString();

/* ── Physics: charges as 3D objects lying in the page, for field lines ── */
type Source = { kind: 'point'; c: V; q: number; r: number } | { kind: 'line'; a: V; b: V; q: number; r: number };
/** Electric field (k = 1) at p from point charges (q r̂/r²) and finite uniformly charged segments (exact integral). */
export function fieldAt(sources: Source[], p: V): V {
  let ex = 0, ey = 0;
  for (const s of sources) {
    if (s.kind === 'point') {
      const d = sub(p, s.c), r2 = Math.max(dot(d, d), 1e-9), k = s.q / (r2 * Math.sqrt(r2));
      ex += d[0] * k; ey += d[1] * k;
    } else {
      const L = len(sub(s.b, s.a)); if (L < 1e-9) continue;
      const u = unit(sub(s.b, s.a)), lam = s.q / L, x1 = dot(sub(s.a, p), u), x2 = dot(sub(s.b, p), u);
      const foot = add(s.a, mul(u, dot(sub(p, s.a), u))), perp = sub(p, foot), h = Math.max(len(perp), 1e-6), nn = h > 1e-6 ? mul(perp, 1 / h) : left(u);
      const r1 = Math.hypot(x1, h), r2 = Math.hypot(x2, h), eu = lam * (1 / r2 - 1 / r1), en = lam / h * (x2 / r2 - x1 / r1);
      ex += u[0] * eu + nn[0] * en; ey += u[1] * eu + nn[1] * en;
    }
  }
  return [ex, ey];
}
const insideSource = (s: Source, p: V, grow = 1) => {
  if (s.kind === 'point') return len(sub(p, s.c)) < s.r * grow;
  const u = unit(sub(s.b, s.a)), t = Math.max(0, Math.min(len(sub(s.b, s.a)), dot(sub(p, s.a), u)));
  return len(sub(p, add(s.a, mul(u, t)))) < s.r * grow;
};
/** Field lines: seeded evenly on each charged body in proportion to |q|, traced with RK4 until they end on a body or leave the view. */
export function traceFieldLines(sources: Source[], box: [number, number, number, number], density = 14) {
  const lines: { pts: V[]; reversed: boolean }[] = [];
  const maxQ = Math.max(...sources.map(s => Math.abs(s.q)), 1e-12), spanX = box[2] - box[0], spanY = box[3] - box[1];
  const ds = Math.hypot(spanX, spanY) / 420, pad = 0.12, lim = [box[0] - spanX * pad, box[1] - spanY * pad, box[2] + spanX * pad, box[3] + spanY * pad];
    const dir = (p: V, sign: number): V | null => { const e = fieldAt(sources, p), m = len(e); return m > 1e-14 ? [e[0] / m * sign, e[1] / m * sign] : null; };
  for (const src of sources) {
    if (!src.q) continue;
    const sign = src.q > 0 ? 1 : -1, count = Math.max(4, Math.round(density * Math.abs(src.q) / maxQ));
    const seeds: V[] = [];
    if (src.kind === 'point') for (let i = 0; i < count; i++) seeds.push(add(src.c, polar((i + 0.5) * 360 / count, src.r * 1.04)));
    else {
      const L = len(sub(src.b, src.a)), u = unit(sub(src.b, src.a)), nn = left(u), r = src.r * 1.04, per = 2 * L + 2 * Math.PI * r;
      for (let i = 0; i < count; i++) {
        let d = (i + 0.5) * per / count;
        if (d < L) { seeds.push(add(add(src.a, mul(u, d)), mul(nn, r))); continue; } d -= L;
        if (d < Math.PI * r) { const a = d / r; seeds.push(add(src.b, add(mul(nn, r * Math.cos(a)), mul(u, r * Math.sin(a))))); continue; } d -= Math.PI * r;
        if (d < L) { seeds.push(add(add(src.b, mul(u, -d)), mul(nn, -r))); continue; } d -= L;
        const a = d / r; seeds.push(add(src.a, add(mul(nn, -r * Math.cos(a)), mul(u, -r * Math.sin(a)))));
      }
    }
    for (const seed of seeds) {
      const pts: V[] = [seed];
      let p = seed, endedOn: Source | null = null;
      for (let k = 0; k < 1600; k++) {
        const k1 = dir(p, sign); if (!k1) break;
        const k2 = dir(add(p, mul(k1, ds / 2)), sign); if (!k2) break;
        const k3 = dir(add(p, mul(k2, ds / 2)), sign); if (!k3) break;
        const k4 = dir(add(p, mul(k3, ds)), sign); if (!k4) break;
        p = add(p, mul([k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0], k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]], ds / 6));
        pts.push(p);
        const hit = sources.find(s => s !== src && insideSource(s, p));
        if (hit) { endedOn = hit; break; }
        if (k > 4 && insideSource(src, p, 0.98)) break;
        if (p[0] < lim[0] || p[0] > lim[2] || p[1] < lim[1] || p[1] > lim[3]) break;
      }
      // A line traced back from a negative charge that ends on a positive one repeats a line already drawn from that positive.
      if (sign < 0 && endedOn && endedOn.q > 0) continue;
      if (pts.length > 2) lines.push({ pts, reversed: sign < 0 });
    }
  }
  return lines;
}

/* ── Compiled figure ── */
type Geom = { anchors: Record<string, V>; along?: (f: number) => V; normal?: (f: number) => V; tangentDeg?: (f: number) => number; box: [number, number, number, number]; source?: Source; circle?: { c: V; r: number } };
type Ctx = {
  N(v: unknown, what: string, fallback?: number): number;
  P(v: unknown, what: string, fallback?: V): V;
  /** A formula in one free variable (x of a curve, s of a parametric path), with the sliders and t also in scope. */
  F(src: unknown, name: string): (v: number) => number;
  geom(id: string): Geom;
};
type Layer = 0 | 1 | 2 | 3 | 4 | 5;
const layerOf: Record<string, Layer> = { ground: 0, ceiling: 0, wall: 0, surface: 0, incline: 0, table: 0, container: 0, rect: 0, polygon: 0, ellipse: 0, curve: 0, line: 0, fieldLines: 1, pulley: 2, wheel: 2, pivot: 2, rope: 3, spring: 3, block: 4, ball: 4, scale: 4, rod: 4, wire: 4, force: 5, dimension: 5, angle: 5, text: 5, point: 5, charge: 5, fbd: 5 };

export type CompiledFigure = { render(values: Vars, t: number, opts?: { focus?: Set<string> | null; idPrefix?: string; background?: string }): string; usesTime: boolean; aspect: number };

/** Validate and compile a figure. `allowed` are the slider names (t is always allowed). Throws an Error naming the item at fault. */
export function compileFigure(raw: unknown, allowed: string[] = [], defaults: Vars = {}): CompiledFigure {
  const spec = checkSpec(raw), items = spec.items;
  const ids = new Map<string, number>();
  items.forEach((it, i) => { if (it.id) { if (ids.has(it.id)) throw Error(`Two figure items share the id “${it.id}”.`); ids.set(it.id, i); } });
  const cache = new Map<string, Compiled>(), names = new Set<string>();
  const expr = (src: string, extra: string[] = []) => {
    const key = src + '|' + extra.join(',');
    let f = cache.get(key);
    if (!f) { try { f = numeric(src, [...allowed, 't', ...extra]); } catch (e) { throw Error(`could not read the formula “${src.slice(0, 60)}”: ${(e as Error).message}`); } cache.set(key, f); f.names.forEach(x => names.add(x)); }
    return f;
  };
  const W0 = spec.width ?? 760;

  function render(values: Vars, t: number, opts: { focus?: Set<string> | null; idPrefix?: string; background?: string } = {}) {
    const vars: Vars = { ...defaults, ...values, t }, pre = opts.idPrefix ?? 'fg';
    const geoms = new Map<number, Geom>(), building = new Set<number>();
    let current = -1;
    const label = (i: number) => `item ${i + 1} (${items[i].type}${items[i].id ? ` “${items[i].id}”` : ''})`;
    const fail = (msg: string): never => { throw Error(`${label(current)}: ${msg}`); };
    const ctx: Ctx = {
      N(v, what, fallback) {
        if (v === undefined || v === null || v === '') { if (fallback !== undefined) return fallback; return fail(`needs “${what}”`); }
        const x = typeof v === 'number' ? v : typeof v === 'string' ? safeEval(expr(v), vars) : NaN;
        if (!Number.isFinite(x)) fail(`“${what}” is not a finite number`);
        return x;
      },
      P(v, what, fallback) {
        if (v === undefined || v === null) { if (fallback) return fallback; return fail(`needs the point “${what}”`); }
        if (Array.isArray(v) && v.length === 2) return [ctx.N(v[0], what + '[0]'), ctx.N(v[1], what + '[1]')];
        if (typeof v === 'object' && 'x' in (v as object)) return [ctx.N((v as any).x, what + '.x'), ctx.N((v as any).y, what + '.y')];
        // An offset from another point: {"at":"block1.right","dir":30,"length":1.5} or {"at":[0,2],"dx":1,"dy":0}.
        if (typeof v === 'object' && 'at' in (v as object)) {
          const o = v as Record<string, unknown>, base = ctx.P(o.at, what + '.at');
          return o.dir !== undefined ? add(base, polar(ctx.N(o.dir, what + '.dir'), ctx.N(o.length, what + '.length', 1))) : add(base, [ctx.N(o.dx, what + '.dx', 0), ctx.N(o.dy, what + '.dy', 0)]);
        }
        if (typeof v === 'string') {
          const m = /^([A-Za-z][\w-]*?)(?:\.([A-Za-z]+)|@(.+))?$/.exec(v.trim());
          if (!m || !ids.has(m[1])) return fail(`“${what}” refers to “${v}”, but no item has the id “${m?.[1] ?? v}”`);
          const g = ctx.geom(m[1]);
          if (m[3] !== undefined) { if (!g.along) fail(`“${m[1]}” has no length to place “@” along`); return g.along!(ctx.N(m[3], what)); }
          const a = m[2] ?? 'center';
          if (!g.anchors[a]) fail(`“${m[1]}” has no anchor “${a}” (it has ${Object.keys(g.anchors).join(', ')})`);
          return g.anchors[a];
        }
        return fail(`“${what}” must be [x, y] or an anchor such as “block1.top”`);
      },
      F(src, name) {
        if (typeof src === 'number') return () => src;
        if (typeof src !== 'string') return fail(`needs a formula in ${name}`);
        const f = expr(src, [name]);
        return (v: number) => safeEval(f, { ...vars, [name]: v });
      },
      geom(gid) {
        const i = ids.get(gid)!;
        if (geoms.has(i)) return geoms.get(i)!;
        if (building.has(i)) fail(`“${gid}” is placed relative to itself`);
        building.add(i); const was = current; current = i;
        const g = layout(items[i], ctx); geoms.set(i, g); current = was; building.delete(i);
        return g;
      },
    };
    items.forEach((it, i) => { if (!geoms.has(i)) { current = i; geoms.set(i, layout(it, ctx)); } });

    // View: given, or fitted around everything that has a size.
    const boxes = [...geoms.entries()].filter(([i]) => !(items[i].type === 'ground' || items[i].type === 'ceiling' || items[i].type === 'wall') || items[i].from).map(([, g]) => g.box);
    let x0 = Math.min(...boxes.map(b => b[0])), y0 = Math.min(...boxes.map(b => b[1])), x1 = Math.max(...boxes.map(b => b[2])), y1 = Math.max(...boxes.map(b => b[3]));
    if (!Number.isFinite(x0)) { x0 = -1; y0 = -1; x1 = 1; y1 = 1; }
    const mx = Math.max((x1 - x0) * 0.1, 0.3), my = Math.max((y1 - y0) * 0.1, 0.3);
    if (spec.view?.x) { current = -1; [x0, x1] = [ctx.N(spec.view.x[0], 'view.x'), ctx.N(spec.view.x[1], 'view.x')]; } else { x0 -= mx; x1 += mx; }
    if (spec.view?.y) { [y0, y1] = [ctx.N(spec.view.y[0], 'view.y'), ctx.N(spec.view.y[1], 'view.y')]; } else { y0 -= my; y1 += my; }
    if (x1 - x0 < 1e-9) x1 = x0 + 1; if (y1 - y0 < 1e-9) y1 = y0 + 1;
    // Equal scale on both axes; a very tall or very flat scene widens the other axis instead of distorting.
    let ratio = (y1 - y0) / (x1 - x0);
    if (ratio > 1.1) { const want = (y1 - y0) / 1.1, c = (x0 + x1) / 2; x0 = c - want / 2; x1 = c + want / 2; ratio = 1.1; }
    if (ratio < 0.36) { const want = (x1 - x0) * 0.36, c = (y0 + y1) / 2; y0 = c - want / 2; y1 = c + want / 2; ratio = 0.36; }
    const pad = 18, Wpx = W0, s = (Wpx - 2 * pad) / (x1 - x0), Hpx = Math.round((y1 - y0) * s + 2 * pad);
    const X = (p: V): V => [pad + (p[0] - x0) * s, pad + (y1 - p[1]) * s];
    const view: [number, number, number, number] = [x0, y0, x1, y1];

    const layers: string[][] = [[], [], [], [], [], []], defs: string[] = [];
    let gid = 0;
    const gradient = (stops: [number, string][], from: V, to: V) => { const g = `${pre}g${gid++}`; defs.push(`<linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="${n(from[0])}" y1="${n(from[1])}" x2="${n(to[0])}" y2="${n(to[1])}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`); return `url(#${g})`; };
    const radial = (c: V, r: number, color: string) => { const g = `${pre}g${gid++}`; defs.push(`<radialGradient id="${g}" gradientUnits="userSpaceOnUse" cx="${n(c[0])}" cy="${n(c[1])}" r="${n(r * 1.08)}" fx="${n(c[0] - r * 0.38)}" fy="${n(c[1] - r * 0.42)}"><stop offset="0" stop-color="${light(color, 0.75)}"/><stop offset="0.35" stop-color="${light(color, 0.18)}"/><stop offset="0.8" stop-color="${color}"/><stop offset="1" stop-color="${dark(color, 0.32)}"/></radialGradient>`); return `url(#${g})`; };
    const path = (pts: V[], closed = false) => 'M' + pts.map(p => `${n(p[0])} ${n(p[1])}`).join('L') + (closed ? 'Z' : '');
    const pathW = (pts: V[], closed = false) => path(pts.map(X), closed);

    type Lab = { text: string; at: V; cands: V[]; o: TextOpts; fixed?: boolean; layer: number };
    const labels: Lab[] = [], obstacles: [number, number, number, number][] = [];
    const pxBox = (b: [number, number, number, number]): [number, number, number, number] => { const a = X([b[0], b[3]]), c = X([b[2], b[1]]); return [a[0], a[1], c[0], c[1]]; };
    const ring = (d: number): V[] => [[0, -d], [d, 0], [0, d], [-d, 0], [d * 0.8, -d * 0.8], [d * 0.8, d * 0.8], [-d * 0.8, d * 0.8], [-d * 0.8, -d * 0.8]];
    const addLabel = (text: unknown, at: V, prefer: V[], o: TextOpts = {}, fixed = false) => { if (typeof text === 'string' && text.trim()) labels.push({ text: text.trim(), at: X(at), cands: prefer, o, fixed, layer: 5 }); };
    const arrowHead = (tip: V, dirPx: V, size: number, color: string, opacity = 1) => {
      const u = unit(dirPx), nn = left(u), b = sub(tip, mul(u, size));
      return `<path d="${path([tip, add(b, mul(nn, size * 0.42)), sub(b, mul(u, -size * 0.12)), sub(b, mul(nn, size * 0.42))], true)}" fill="${color}"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`;
    };
    const arrowPx = (a: V, b: V, color: string, width: number, head: number, opts: { dash?: boolean; both?: boolean; opacity?: number } = {}) => {
      const d = sub(b, a), L = len(d); if (L < 2) return '';
      const u = unit(d), h = Math.min(head, L * 0.45), s1 = opts.both ? add(a, mul(u, h * 0.8)) : a, s2 = sub(b, mul(u, h * 0.8));
      return `<path d="${path([s1, s2])}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="butt"${opts.dash ? ' stroke-dasharray="7 5"' : ''}${opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : ''}/>` + arrowHead(b, u, h, color, opts.opacity) + (opts.both ? arrowHead(a, mul(u, -1), h, color, opts.opacity) : '');
    };
    const hatch = (a: V, b: V, side: V, spacing = 9, depth = 9) => {
      const A = X(a), B = X(b), d = sub(B, A), L = len(d), u = unit(d), sd = unit([side[0], -side[1]]), slant = add(mul(sd, depth), mul(u, -depth * 0.7));
      let out = `<path d="${path([A, B])}" stroke="${INK}" stroke-width="2.2" fill="none"/>`, h = '';
      for (let k = spacing / 2; k < L; k += spacing) { const p = add(A, mul(u, k)); h += `M${n(p[0])} ${n(p[1])}l${n(slant[0])} ${n(slant[1])}`; }
      return out + `<path d="${h}" stroke="${HATCH}" stroke-width="1.1" fill="none"/>`;
    };
    const signGlyph = (c: V, size: number, q: number) => {
      const color = q > 0 ? named.positive : named.negative, h = `M${n(c[0] - size)} ${n(c[1])}h${n(2 * size)}`;
      return `<path d="${h}${q > 0 ? `M${n(c[0])} ${n(c[1] - size)}v${n(2 * size)}` : ''}" stroke="${color}" stroke-width="${n(Math.max(1.6, size * 0.42))}" stroke-linecap="round" fill="none"/>`;
    };

    const draw = (it: Item, g: Geom): [Layer, string] => {
      const L = layerOf[it.type] ?? 5, col = (fb: string) => colorOf(it.color, fb);
      switch (it.type) {
        case 'ground': case 'ceiling': case 'wall': case 'surface': {
          const a = g.anchors.start, b = g.anchors.end, side = g.anchors._side;
          const fill = it.fill ? `<path d="${pathW([a, b, add(b, mul(side, 12 / s)), add(a, mul(side, 12 / s))], true)}" fill="${light(colorOf(it.fill === true ? 'gray' : it.fill, 'gray'), 0.6)}"/>` : '';
          addLabel(it.label, lerp(a, b, 0.5), [[0, 14], [0, -14]], { size: 16, italic: false });
          return [L, fill + hatch(a, b, side)];
        }
        case 'incline': case 'table': {
          const pts = (it.type === 'incline' ? [g.anchors.bottom, g.anchors.corner, g.anchors.top] : [g.anchors.bottomLeft, g.anchors.bottomRight, g.anchors.topRight, g.anchors.topLeft]).map(X);
          const base = col(it.type === 'incline' ? 'incline' : 'sand'), top = X(g.anchors.top ?? g.anchors.topLeft), bot = X(g.anchors.corner ?? g.anchors.bottomLeft);
          let out = `<path d="${path(pts, true)}" fill="${gradient([[0, light(base, 0.35)], [1, base]], top, bot)}" stroke="${dark(base, 0.45)}" stroke-width="1.4" stroke-linejoin="round"/>`;
          if (it.type === 'incline' && it.showAngle !== false) {
            const A = X(g.anchors.bottom), r = Math.max(26, Math.min(60, len(sub(X(g.anchors.corner), A)) * 0.2)), ang = g.tangentDeg!(0), right = g.anchors.corner[0] > g.anchors.bottom[0];
            const a0 = right ? 0 : 180 - ang, a1 = right ? ang : 180, arc: V[] = [];
            for (let k = 0; k <= 24; k++) { const a = (a0 + (a1 - a0) * k / 24) * Math.PI / 180; arc.push([A[0] + r * Math.cos(a), A[1] - r * Math.sin(a)]); }
            out += `<path d="${path(arc)}" stroke="${INK}" stroke-width="1.2" fill="none"/>`;
            const mid = ((a0 + a1) / 2) * Math.PI / 180, lab = typeof it.angleLabel === 'string' ? it.angleLabel : 'θ';
            labels.push({ text: lab, at: [A[0] + (r + 12) * Math.cos(mid), A[1] - (r + 12) * Math.sin(mid)], cands: [[0, 0]], o: { size: 19 }, fixed: true, layer: 5 });
          }
          if (it.ground !== false && it.type === 'incline') { const xs = [g.anchors.bottom[0], g.anchors.corner[0]]; const ext = g.anchors._w[0] * 0.08; out += hatch([Math.min(...xs) - ext, g.anchors.bottom[1]], [Math.max(...xs) + ext, g.anchors.bottom[1]], [0, -1]); }
          if (it.type === 'table') { const bl = X(g.anchors.bottomLeft), br = X(g.anchors.bottomRight); out += `<path d="${path([[bl[0] - 14, bl[1]], [br[0] + 14, br[1]]])}" stroke="${INK}" stroke-width="2"/>`; }
          addLabel(it.label, g.anchors.center, [[0, 0]], { size: 18 }, true);
          return [L, out];
        }
        case 'block': {
          const c = g.anchors.center, ang = g.tangentDeg!(0), w = g.anchors._w[0], h = g.anchors._w[1], u = polar(ang), nn = left(u);
          const corner = (i: number, j: number) => add(c, add(mul(u, i * w / 2), mul(nn, j * h / 2)));
          const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].map(X), base = col('orange');
          const out = `<path d="${path(pts, true)}" fill="${gradient([[0, light(base, 0.32)], [0.55, base], [1, dark(base, 0.12)]], X(corner(0, 1)), X(corner(0, -1)))}" stroke="${dark(base, 0.38)}" stroke-width="1.3" stroke-linejoin="round"/>` +
            `<path d="${path([X(corner(-0.94, 0.9)), X(corner(0.94, 0.9))])}" stroke="${light(base, 0.55)}" stroke-width="1.4" opacity="0.8"/>` + chargeGlyphs(it, g);
          const where = it.labelPosition ?? (Math.min(w, h) * s > 34 ? 'inside' : 'left');
          // Arrows drawn from the block's centre would cross a centred label, so it moves to the upper-left corner then.
          const crowded = where === 'inside' && items.some((f, k) => (f.type === 'force' || f.type === 'fbd') && len(sub(geoms.get(k)!.anchors.tail ?? geoms.get(k)!.anchors.center, c)) < Math.min(w, h) / 2);
          const spot = crowded ? add(c, add(mul(u, -w * 0.27), mul(nn, h * 0.24))) : c;
          addLabel(it.label, spot, where === 'inside' ? [[0, 0]] : [[-(w * s / 2 + 16), 0], [w * s / 2 + 16, 0], [0, -(h * s / 2 + 14)], [0, h * s / 2 + 14]], { size: crowded ? 18 : 21 }, where === 'inside');
          return [L, out];
        }
        case 'ball': {
          const { c, r } = g.circle!, C = X(c), R = r * s, base = col('orange');
          const out = `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(R)}" fill="${radial(C, R, base)}" stroke="${dark(base, 0.42)}" stroke-width="1.1"/>` + chargeGlyphs(it, g);
          const where = it.labelPosition ?? 'below';
          const cand: Record<string, V> = { below: [0, R + 15], above: [0, -R - 15], left: [-R - 15, 0], right: [R + 15, 0], inside: [0, 0] };
          addLabel(it.label, c, [cand[where] ?? cand.below, cand.below, cand.left, cand.right, cand.above], { size: 21 }, where === 'inside');
          return [L, out];
        }
        case 'pulley': case 'wheel': {
          const { c, r } = g.circle!, C = X(c), R = r * s;
          let out = '';
          if (it.type === 'pulley' && it.support !== undefined) {
            const S = X(ctx.P(it.support, 'support')), d = unit(sub(S, C)), nn = left(d), w = Math.max(4, R * 0.32);
            out += `<path d="${path([add(C, mul(nn, w * 0.55)), add(S, mul(nn, w * 0.4)), sub(S, mul(nn, w * 0.4)), sub(C, mul(nn, w * 0.55))], true)}" fill="${gradient([[0, '#d9dde1'], [0.5, '#a4abb2'], [1, '#6f767d']], add(C, mul(nn, w)), sub(C, mul(nn, w)))}" stroke="#555b61" stroke-width="0.9"/>` + `<circle cx="${n(S[0])}" cy="${n(S[1])}" r="${n(w * 0.45)}" fill="#6f767d"/>`;
          }
          if (it.type === 'pulley') {
            const base = col('steel');
            out += `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(R)}" fill="${radial(C, R, base)}" stroke="${dark(base, 0.5)}" stroke-width="1.3"/>` +
              `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(R * 0.8)}" fill="none" stroke="${dark(base, 0.35)}" stroke-width="${n(Math.max(1, R * 0.06))}" opacity="0.7"/>` +
              `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(R * 0.3)}" fill="${dark(base, 0.25)}" stroke="${dark(base, 0.55)}" stroke-width="1"/>` +
              `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(Math.max(1.6, R * 0.1))}" fill="${light(base, 0.6)}"/>`;
          } else {
            const tire = col('rubber'), T = Math.max(3, R * 0.24);
            out += `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(R - T / 2)}" fill="none" stroke="${tire}" stroke-width="${n(T)}"/>` +
              `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(R - T)}" fill="${radial(C, R - T, '#c3c8cd')}" stroke="#6f767d" stroke-width="0.9"/>` +
              `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(Math.max(2, R * 0.16))}" fill="#7a8187" stroke="#4f555a" stroke-width="0.8"/>`;
          }
          addLabel(it.label, c, [[0, -R - 14], [R + 16, 0], [-R - 16, 0], [0, R + 14]], { size: 18 });
          return [L, out];
        }
        case 'rope': {
          const pts = g.anchors._pts as unknown as V[];
          addLabel(it.label, pts[Math.floor(pts.length / 2)], ring(14), { size: 18 });
          return [L, `<path d="${pathW(pts)}" stroke="${col('#3b3530')}" stroke-width="${n(it.width ?? 1.7)}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`];
        }
        case 'spring': {
          const a = g.anchors.a, b = g.anchors.b, d = sub(b, a), Lw = len(d), u = unit(d), nn = left(u), coils = Math.round(ctx.N(it.coils, 'coils', 8)), w = ctx.N(it.width, 'width', Math.min(Lw * 0.14, 0.35));
          const pts: V[] = [a, add(a, mul(u, Lw * 0.12))];
          for (let k = 0; k < coils * 2; k++) pts.push(add(add(a, mul(u, Lw * (0.12 + 0.76 * (k + 0.5) / (coils * 2)))), mul(nn, (k % 2 ? -1 : 1) * w / 2)));
          pts.push(add(a, mul(u, Lw * 0.88)), b);
          addLabel(it.label, lerp(a, b, 0.5), [mul(unit([nn[0], -nn[1]]), w * s / 2 + 16), mul(unit([nn[0], -nn[1]]), -(w * s / 2 + 16))], { size: 18 });
          return [L, `<path d="${pathW(pts)}" stroke="${col('#4a4f55')}" stroke-width="1.8" fill="none" stroke-linejoin="round"/>`];
        }
        case 'scale': {
          // A spring balance: ring, metal barrel with a scale, pointer and hook, lying along from → to.
          const A = X(g.anchors.a), B = X(g.anchors.b), d = sub(B, A), Lp = len(d), u = unit(d), nn = left(u), w = Math.max(9, Math.min(26, Lp * 0.17));
          const s0 = add(A, mul(u, Lp * 0.2)), s1 = add(A, mul(u, Lp * 0.78)), base = col('steel');
          const body = [add(s0, mul(nn, w / 2)), add(s1, mul(nn, w / 2)), sub(s1, mul(nn, w / 2)), sub(s0, mul(nn, w / 2))];
          let out = `<path d="${path([A, add(A, mul(u, Lp * 0.1))])}" stroke="#3b3530" stroke-width="1.7"/><circle cx="${n(A[0] + u[0] * Lp * 0.13)}" cy="${n(A[1] + u[1] * Lp * 0.13)}" r="${n(Math.min(5, Lp * 0.035))}" fill="none" stroke="#4f555a" stroke-width="1.6"/>`;
          out += `<path d="${path([add(A, mul(u, Lp * 0.16)), s0])}" stroke="#4f555a" stroke-width="2"/><path d="${path(body, true)}" fill="${gradient([[0, light(base, 0.55)], [0.45, base], [1, dark(base, 0.35)]], add(s0, mul(nn, w / 2)), sub(s0, mul(nn, w / 2)))}" stroke="${dark(base, 0.5)}" stroke-width="1"/>`;
          let ticks = '';
          for (let k = 0; k <= 10; k++) { const p = add(lerp(s0, s1, 0.08 + 0.84 * k / 10), mul(nn, w * 0.42)); ticks += `M${n(p[0])} ${n(p[1])}l${n(-nn[0] * w * (k % 5 ? 0.22 : 0.4))} ${n(-nn[1] * w * (k % 5 ? 0.22 : 0.4))}`; }
          const ptr = lerp(s0, s1, 0.08 + 0.84 * Math.max(0, Math.min(1, ctx.N(it.reading, 'reading', 0.55))));
          out += `<path d="${ticks}" stroke="#2d3135" stroke-width="0.9"/><path d="${path([add(ptr, mul(nn, w * 0.5)), sub(ptr, mul(nn, w * 0.15))])}" stroke="${named.red}" stroke-width="1.8"/>`;
          const hk = add(A, mul(u, Lp * 0.86)), hr = Math.min(5, Lp * 0.04);
          out += `<path d="${path([s1, add(A, mul(u, Lp * 0.84))])}" stroke="#4f555a" stroke-width="2"/><path d="M${n(hk[0] - nn[0] * hr)} ${n(hk[1] - nn[1] * hr)}A${n(hr)} ${n(hr)} 0 1 1 ${n(hk[0] + u[0] * hr * 2)} ${n(hk[1] + u[1] * hr * 2)}" stroke="#4f555a" stroke-width="1.7" fill="none"/><path d="${path([add(hk, mul(u, hr * 2)), B])}" stroke="#3b3530" stroke-width="1.7"/>`;
          const outward = mul(unit([nn[0], nn[1]]), w / 2 + 15);
          addLabel(it.label, g.anchors.center, [outward, mul(outward, -1)], { size: 18 });
          return [L, out];
        }
        case 'rod': case 'wire': {
          const A = X(g.anchors.a), B = X(g.anchors.b), u = unit(sub(B, A)), nn = left(u), T = g.anchors._w[0] * s, base = col(it.type === 'wire' ? 'copper' : 'steel');
          const pts = [add(A, mul(nn, T / 2)), add(B, mul(nn, T / 2)), sub(B, mul(nn, T / 2)), sub(A, mul(nn, T / 2))];
          const fill = gradient([[0, light(base, 0.55)], [0.35, light(base, 0.15)], [0.7, base], [1, dark(base, 0.35)]], add(A, mul(nn, T / 2)), sub(A, mul(nn, T / 2)));
          const cap = (C: V, sgn: number) => it.ends === 'flat' ? '' : `<ellipse cx="${n(C[0])}" cy="${n(C[1])}" rx="${n(T * 0.18)}" ry="${n(T / 2)}" transform="rotate(${n(Math.atan2(u[1], u[0]) * 180 / Math.PI)} ${n(C[0])} ${n(C[1])})" fill="${sgn > 0 ? light(base, 0.25) : dark(base, 0.15)}" stroke="${dark(base, 0.45)}" stroke-width="0.8"/>`;
          const out = `<path d="${path(pts, true)}" fill="${fill}" stroke="${dark(base, 0.45)}" stroke-width="0.9" stroke-linejoin="round"/>` + cap(B, 1) + chargeGlyphs(it, g);
          const out2 = mul([nn[0], nn[1]], T / 2 + 16);
          addLabel(it.label, g.anchors.center, [out2, mul(out2, -1)], { size: 18, italic: false });
          return [L, out];
        }
        case 'pivot': {
          const C = X(g.anchors.center), z = ctx.N(it.size, 'size', 0.5) * s;
          if (it.style === 'pin') return [L, `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(Math.max(4, z * 0.3))}" fill="${radial(C, Math.max(4, z * 0.3), colorOf(it.color, 'steel'))}" stroke="#3d4247" stroke-width="1.2"/><circle cx="${n(C[0])}" cy="${n(C[1])}" r="1.8" fill="#2b2b2b"/>`];
          const tri: V[] = [C, [C[0] + z * 0.55, C[1] + z], [C[0] - z * 0.55, C[1] + z]], base = colorOf(it.color, 'gray');
          addLabel(it.label, g.anchors.center, [[0, z + 26], [z + 12, z / 2]], { size: 18 });
          return [L, `<path d="${path(tri, true)}" fill="${gradient([[0, light(base, 0.4)], [1, dark(base, 0.15)]], C, [C[0], C[1] + z])}" stroke="${dark(base, 0.5)}" stroke-width="1.2" stroke-linejoin="round"/>` + hatch(g.anchors.baseL, g.anchors.baseR, [0, -1], 8, 7)];
        }
        case 'container': {
          const bl = g.anchors.bottomLeft, br = g.anchors.bottomRight, tl = g.anchors.topLeft, tr = g.anchors.topRight, liq = g.anchors._liquid as unknown as V[];
          const clip = `${pre}c${gid++}`, base = colorOf(it.liquid, 'water');
          let out = '';
          if (liq.length > 2) {
            const lp = liq.map(X), top = Math.min(...lp.map(p => p[1])), bottom = Math.max(...lp.map(p => p[1]));
            defs.push(`<clipPath id="${clip}"><path d="${path(lp, true)}"/></clipPath>`);
            let lines = ''; for (let y = top + 3; y < bottom; y += 4.5) lines += `M${n(Math.min(...lp.map(p => p[0])))} ${n(y)}H${n(Math.max(...lp.map(p => p[0])))}`;
            out += `<path d="${path(lp, true)}" fill="${light(base, 0.35)}"/><path d="${lines}" stroke="${dark(base, 0.35)}" stroke-width="0.7" clip-path="url(#${clip})" opacity="0.75"/>`;
            out += `<path d="${path(lp.slice(0, lp.length - 2))}" stroke="${dark(base, 0.55)}" stroke-width="1.4" fill="none"/>`;
          }
          const wall = [tl, bl, br, tr].map(X), th = 3.2;
          out += `<path d="${path(wall)}" stroke="${INK}" stroke-width="${th}" fill="none" stroke-linejoin="miter"/><path d="${path(wall.map((p, k) => [p[0] + (k < 2 ? -6 : 6), p[1] + (k === 1 || k === 2 ? 6 : 0)] as V))}" stroke="${INK}" stroke-width="1.2" fill="none"/>`;
          addLabel(it.label, g.anchors.bottom, [[0, 22]], { size: 18 });
          return [L, out];
        }
        case 'force': {
          const a = g.anchors.tail, b = g.anchors.tip, A = X(a), B = X(b), kind = it.style ?? 'solid', color = colorOf(it.color, kind === 'light' ? 'force2' : 'force');
          const width = it.thin ? 1.6 : 3.4, head = it.thin ? 10 : 15;
          const u = unit(sub(B, A)), nn = left(u), off = 16;
          // The label goes at the arrow's free end: the tip, or the tail when the arrow ends at the point it acts on.
          const into = it.pointing === 'into' || it.head === 'at', end = into ? a : b, out = into ? mul(u, -1) : u;
          addLabel(it.label, end, [mul(out, off), mul(nn, off), mul(nn, -off), add(mul(out, off), mul(nn, off)), add(mul(out, off), mul(nn, -off))], { size: 20, bold: it.vector !== false, italic: false, color: it.labelColor ? colorOf(it.labelColor, INK) : INK });
          return [L, arrowPx(A, B, color, width, head, { dash: kind === 'dashed' })];
        }
        case 'dimension': {
          const a = ctx.P(it.from, 'from'), b = ctx.P(it.to, 'to'), d = sub(b, a), u = unit(d), off = ctx.N(it.offset, 'offset', 0), nn = left(u);
          const a2 = add(a, mul(nn, off)), b2 = add(b, mul(nn, off)), A = X(a), B = X(b), A2 = X(a2), B2 = X(b2), ext = unit(sub(A2, A)), e = off ? 6 : 0;
          let out = off ? `<path d="${path([A, add(A2, mul(ext, e))])}M${n(B[0])} ${n(B[1])}L${n(B2[0] + ext[0] * e)} ${n(B2[1] + ext[1] * e)}" stroke="${INK}" stroke-width="0.9" stroke-dasharray="4 3" fill="none"/>` : '';
          out += arrowPx(A2, B2, INK, 1.3, 10, { both: true });
          const mid = lerp(A2, B2, 0.5), text = typeof it.label === 'string' ? it.label : '';
          if (text) {
            const w = measure(text, 18) + 12;
            if (w < len(sub(B2, A2)) - 24) out += `<rect x="${n(mid[0] - w / 2)}" y="${n(mid[1] - 13)}" width="${n(w)}" height="26" fill="${opts.background ?? PAPER}"/>` + richText(text, mid[0], mid[1], { size: 18, halo: false });
            else { const side = mul(unit(left(sub(B2, A2))), -16); labels.push({ text, at: add(mid, side), cands: [[0, 0], mul(side, -2)], o: { size: 18 }, layer: 5 }); }
          }
          return [L, out];
        }
        case 'angle': {
          const at = ctx.P(it.at, 'at'), A = X(at), r = ctx.N(it.r, 'r', 0.6) * s;
          let a0: number, a1: number;
          if (it.a !== undefined && it.b !== undefined) { const pa = ctx.P(it.a, 'a'), pb = ctx.P(it.b, 'b'); a0 = Math.atan2(pa[1] - at[1], pa[0] - at[0]) * 180 / Math.PI; a1 = Math.atan2(pb[1] - at[1], pb[0] - at[0]) * 180 / Math.PI; }
          else { a0 = ctx.N(it.from, 'from'); a1 = ctx.N(it.to, 'to'); }
          let sweep = ((a1 - a0) % 360 + 360) % 360; if (sweep > 180 && it.reflex !== true) { [a0, a1] = [a1, a0]; sweep = 360 - sweep; }
          const arc: V[] = []; for (let k = 0; k <= 30; k++) { const a = (a0 + sweep * k / 30) * Math.PI / 180; arc.push([A[0] + r * Math.cos(a), A[1] - r * Math.sin(a)]); }
          const mid = (a0 + sweep / 2) * Math.PI / 180;
          labels.push({ text: typeof it.label === 'string' ? it.label : 'θ', at: [A[0] + (r + 13) * Math.cos(mid), A[1] - (r + 13) * Math.sin(mid)], cands: [[0, 0]], o: { size: 19 }, fixed: true, layer: 5 });
          return [L, `<path d="${path(arc)}" stroke="${colorOf(it.color, INK)}" stroke-width="1.2" fill="none"/>`];
        }
        case 'line': case 'curve': case 'polygon': {
          const pts = (g.anchors._pts as unknown as V[]).map(X), color = col(it.type === 'polygon' ? 'gray' : INK), closed = it.type === 'polygon' || !!it.closed;
          const fill = it.type === 'polygon' || it.fill ? (it.fill === false ? 'none' : light(colorOf(typeof it.fill === 'string' ? it.fill : it.color, 'gray'), it.type === 'polygon' && !it.fill ? 0.55 : 0.15)) : 'none';
          let out = `<path d="${path(pts, closed)}" fill="${fill}" stroke="${it.type === 'polygon' ? dark(colorOf(typeof it.fill === 'string' ? it.fill : it.color, 'gray'), 0.4) : color}" stroke-width="${n(ctx.N(it.width, 'width', it.type === 'polygon' ? 1.3 : 1.5))}"${it.dash ? ' stroke-dasharray="7 5"' : ''} stroke-linejoin="round"/>`;
          if (pts.length >= 2 && (it.arrow === 'end' || it.arrow === 'both')) out += arrowHead(pts[pts.length - 1], sub(pts[pts.length - 1], pts[pts.length - 2]), 10, color);
          if (pts.length >= 2 && (it.arrow === 'start' || it.arrow === 'both')) out += arrowHead(pts[0], sub(pts[0], pts[1]), 10, color);
          const wp = g.anchors._pts as unknown as V[];
          addLabel(it.label, it.type === 'polygon' ? g.anchors.center : wp[wp.length - 1], it.type === 'polygon' ? [[0, 0]] : ring(14), { size: 18 }, it.type === 'polygon');
          return [L, out];
        }
        case 'rect': {
          const c = g.anchors.center, w = g.anchors._w[0], h = g.anchors._w[1], tl = X([c[0] - w / 2, c[1] + h / 2]), base = colorOf(typeof it.fill === 'string' ? it.fill : it.color, 'gray');
          const out = `<rect x="${n(tl[0])}" y="${n(tl[1])}" width="${n(w * s)}" height="${n(h * s)}" fill="${it.fill === false ? 'none' : gradient([[0, light(base, 0.45)], [1, light(base, 0.1)]], tl, [tl[0], tl[1] + h * s])}" stroke="${dark(base, 0.45)}" stroke-width="1.3"${it.dash ? ' stroke-dasharray="7 5"' : ''}/>` + chargeGlyphs(it, g);
          addLabel(it.label, c, [[0, 0]], { size: 18, italic: false }, true);
          return [L, out];
        }
        case 'ellipse': {
          const C = X(g.anchors.center), rx = g.anchors._w[0] * s, ry = g.anchors._w[1] * s, color = col(INK);
          const out = `<ellipse cx="${n(C[0])}" cy="${n(C[1])}" rx="${n(rx)}" ry="${n(ry)}" fill="${it.fill ? light(colorOf(typeof it.fill === 'string' ? it.fill : it.color, 'gray'), 0.55) : 'none'}" stroke="${color}" stroke-width="${n(ctx.N(it.width, 'width', 1.5))}"${it.dash ? ' stroke-dasharray="7 5"' : ''}/>`;
          addLabel(it.label, g.anchors.top, [[0, -14]], { size: 18 });
          return [L, out];
        }
        case 'text': {
          labels.push({ text: String(it.text ?? it.label ?? '').slice(0, 120), at: X(g.anchors.center), cands: [[0, 0]], o: { size: ctx.N(it.size, 'size', 19), color: colorOf(it.color, INK), anchor: it.anchor === 'start' || it.anchor === 'end' ? it.anchor : 'middle', italic: it.italic, bold: it.bold }, fixed: true, layer: 5 });
          return [L, ''];
        }
        case 'point': {
          const C = X(g.anchors.center);
          addLabel(it.label, g.anchors.center, ring(12), { size: 19 });
          return [L, `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(ctx.N(it.size, 'size', 3.5))}" fill="${col(INK)}"/>`];
        }
        case 'charge': {
          const C = X(g.anchors.center), R = Math.max(7, g.circle!.r * s), q = g.source?.q ?? 1, color = q > 0 ? named.positive : named.negative;
          addLabel(it.label, g.anchors.center, [[0, -R - 14], [R + 14, 0], [0, R + 14]], { size: 18 });
          return [L, `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="${n(R)}" fill="${light(color, 0.86)}" stroke="${color}" stroke-width="1.4"/>` + signGlyph(C, R * 0.5, q)];
        }
        case 'fieldLines': {
          const sources = [...geoms.values()].map(x => x.source).filter((x): x is Source => !!x && !!x.q);
          if (!sources.length) fail('there are no charged items (give a ball, rod, wire or charge a “q”)');
          const lines = traceFieldLines(sources, view, Math.round(ctx.N(it.lines, 'lines', 14))), color = col('field');
          let out = '';
          for (const l of lines) {
            const pts = l.pts.map(X);
            out += `<path d="${path(pts)}" stroke="${color}" stroke-width="1.1" fill="none" opacity="0.85"/>`;
            if (it.arrows !== false && pts.length > 8) {
              const k = Math.max(2, Math.min(pts.length - 2, Math.floor(pts.length * (l.reversed ? 0.55 : 0.4)))), a = pts[k - 1], b = pts[k + 1];
              out += arrowHead(pts[k], l.reversed ? sub(a, b) : sub(b, a), 8, color);
            }
          }
          return [L, out];
        }
        case 'fbd': {
          const c = g.anchors.center, C = X(c), sc = ctx.N(it.scale, 'scale', 1.2);
          let out = `<circle cx="${n(C[0])}" cy="${n(C[1])}" r="4" fill="#8b1d2c"/>`;
          const forces = Array.isArray(it.forces) ? it.forces.slice(0, 12) : fail('needs “forces”: [{"label":"N","dir":90,"length":1}]');
          const dirs = forces.map((f: any) => ctx.N(f.dir, 'forces.dir'));
          for (const [k, f] of forces.entries()) {
            const same = dirs.map((d: number, j: number) => [d, j] as const).filter(([d]) => Math.abs(((d - dirs[k]) % 360 + 540) % 360 - 180) < 8).map(([, j]) => j);
            const shift = same.length > 1 ? (same.indexOf(k) - (same.length - 1) / 2) * 12 : 0, side = mul(left(polar(dirs[k])), 1);
            const C2 = add(C, [side[0] * shift, -side[1] * shift]);
            const tip = add(c, polar(dirs[k], sc * ctx.N(f.length, 'forces.length', 1))), T = add(X(tip), sub(C2, C));
            out += arrowPx(C2, T, colorOf(f.color, INK), 1.6, 10);
            const u = unit(sub(T, C2)), nn = left(u);
            if (typeof f.label === 'string') labels.push({ text: f.label, at: T, cands: [mul(u, 15), add(mul(nn, shift < 0 ? 15 : -15), mul(u, -10)), mul(nn, 15), mul(nn, -15)], o: { size: 18, bold: true, italic: false }, layer: 5 });
          }
          if (it.label !== false) labels.push({ text: typeof it.label === 'string' ? it.label : 'Free-body diagram', at: [C[0], C[1] - sc * s * 1.25 - 18], cands: [[0, 0]], o: { size: 14, italic: false, color: '#444' }, fixed: true, layer: 5 });
          return [L, out];
        }
      }
      return [L, ''];
    };
    const chargeGlyphs = (it: Item, g: Geom) => {
      const q = g.source?.q ?? (it.charge === '+' ? 1 : it.charge === '-' || it.charge === '−' ? -1 : 0);
      if (!q || it.signs === false) return '';
      const count = Math.round(ctx.N(typeof it.signs === 'number' ? it.signs : undefined, 'signs', 0));
      let out = '';
      if (g.circle && it.type !== 'charge') {
        const C = X(g.circle.c), R = g.circle.r * s, k = count || Math.max(6, Math.min(14, Math.round(R / 5))), size = Math.max(2.6, Math.min(6, R * 0.13));
        for (let i = 0; i < k; i++) { const a = (i + 0.5) * Math.PI * 2 / k; out += signGlyph([C[0] + Math.cos(a) * R * 0.7, C[1] + Math.sin(a) * R * 0.7], size, q); }
        return out;
      }
      const a = g.anchors.a ?? g.anchors.left, b = g.anchors.b ?? g.anchors.right;
      const A = X(a), B = X(b), Lp = len(sub(B, A)), T = (g.anchors.a ? g.anchors._w[0] : g.anchors._w[1]) * s, size = Math.max(2.6, Math.min(5.5, T * 0.3)), k = count || Math.max(3, Math.min(16, Math.floor(Lp / Math.max(14, size * 4))));
      for (let i = 0; i < k; i++) out += signGlyph(lerp(A, B, (i + 0.5) / k), size, q);
      return out;
    };

    const focus = opts.focus ?? null;
    items.forEach((it, i) => {
      current = i;
      const [L, svg] = draw(it, geoms.get(i)!);
      if (!svg) return;
      const dim = focus && !(it.id && focus.has(it.id)) ? ' opacity="0.22"' : '';
      layers[L].push(dim ? `<g${dim}>${svg}</g>` : svg);
      if (['block', 'ball', 'pulley', 'wheel', 'scale', 'rod', 'wire', 'incline', 'container'].includes(it.type)) obstacles.push(pxBox(geoms.get(i)!.box));
    });
    // Labels last: fixed ones where they belong, the rest at the first nearby spot that overlaps nothing already placed.
    const placed: [number, number, number, number][] = [];
    const overlap = (a: number[], b: number[]) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const labelSvg: string[] = [], bg = opts.background ?? (typeof spec.background === 'string' ? colorOf(spec.background, PAPER) : PAPER);
    for (const l of labels.sort((a, b) => Number(!!b.fixed) - Number(!!a.fixed))) {
      const size = l.o.size ?? 19, w = measure(l.text, size) + 4, h = size * 1.15, anchor = l.o.anchor ?? 'middle';
      const boxAt = (p: V): [number, number, number, number] => { const x = anchor === 'start' ? p[0] : anchor === 'end' ? p[0] - w : p[0] - w / 2; return [x, p[1] - h / 2, x + w, p[1] + h / 2]; };
      let best = add(l.at, l.cands[0]), bestCost = Infinity;
      if (!l.fixed) for (const [k, c] of [...l.cands, ...ring(26), ...ring(38)].entries()) {
        const p = add(l.at, c), b = boxAt(p);
        const cost = placed.reduce((a, q) => a + overlap(b, q) * 3, 0) + obstacles.reduce((a, q) => a + overlap(b, q), 0) + k * 4 + (b[0] < 0 || b[2] > Wpx || b[1] < 0 || b[3] > Hpx ? 5000 : 0);
        if (cost < bestCost) { bestCost = cost; best = p; }
        if (cost <= k * 4) break;
      }
      placed.push(boxAt(best));
      labelSvg.push(richText(l.text, best[0], best[1], { halo: bg, ...l.o }));
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Wpx} ${Hpx}" width="${Wpx}" height="${Hpx}"><defs>${defs.join('')}</defs><rect width="${Wpx}" height="${Hpx}" fill="${bg}"/>${layers.map(l => l.join('')).join('')}${labelSvg.join('')}</svg>`;
  }

  // Validate once at the starting values, so a bad figure fails before it is shown and its names are known.
  const first = render(defaults, 0);
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(first);
  return { render, usesTime: names.has('t'), aspect: m ? +m[2] / +m[1] : 0.6 };
}

/** Geometry of one item: where it is, its named anchors and its extent. */
function layout(it: Item, ctx: Ctx): Geom {
  const box = (pts: V[], pad = 0): Geom['box'] => [Math.min(...pts.map(p => p[0])) - pad, Math.min(...pts.map(p => p[1])) - pad, Math.max(...pts.map(p => p[0])) + pad, Math.max(...pts.map(p => p[1])) + pad];
  const chargeOf = () => it.q !== undefined ? ctx.N(it.q, 'q') : it.charge === '+' ? 1 : it.charge === '-' || it.charge === '−' ? -1 : 0;
  switch (it.type) {
    case 'ground': case 'ceiling': case 'wall': case 'surface': {
      let a: V, b: V;
      if (it.from !== undefined || it.to !== undefined) { a = ctx.P(it.from, 'from'); b = ctx.P(it.to, 'to'); }
      else if (it.type === 'wall') { const x = ctx.N(it.x, 'x'), y0 = ctx.N(it.y1 ?? it.bottom, 'bottom', 0), y1 = ctx.N(it.y2 ?? it.top, 'top', 3); a = [x, y0]; b = [x, y1]; }
      else { const y = ctx.N(it.y, 'y', 0), x0 = ctx.N(it.x1 ?? it.left, 'left', -4), x1 = ctx.N(it.x2 ?? it.right, 'right', 4); a = [x0, y]; b = [x1, y]; }
      const d = unit(sub(b, a)), ln = left(d);
      const want: V = it.side === 'above' || it.side === 'up' ? [0, 1] : it.side === 'below' || it.side === 'down' ? [0, -1] : it.side === 'left' ? [-1, 0] : it.side === 'right' ? [1, 0] : it.type === 'ceiling' ? [0, 1] : it.type === 'wall' ? [1, 0] : [0, -1];
      const side: V = dot(ln, want) >= 0 ? ln : mul(ln, -1);
      return { anchors: { start: a, end: b, center: lerp(a, b, 0.5), _side: side }, along: f => lerp(a, b, f), normal: () => mul(side, -1), tangentDeg: () => Math.atan2(d[1], d[0]) * 180 / Math.PI, box: box([a, b], 0.15) };
    }
    case 'incline': {
      const x = ctx.N(it.x, 'x', 0), y = ctx.N(it.y, 'y', 0), base = ctx.N(it.base, 'base', 4), ang = ctx.N(it.angle, 'angle', 30);
      if (!(base > 0) || !(ang > 0 && ang < 89)) throw Error('an incline needs base > 0 and an angle between 0 and 89 degrees');
      const h = base * Math.tan(ang * Math.PI / 180), right = it.facing !== 'left';
      const A: V = right ? [x, y] : [x + base, y], B: V = right ? [x + base, y] : [x, y], C: V = [B[0], y + h];
      const d = unit(sub(C, A)), up = right ? left(d) : mul(left(d), -1);
      return { anchors: { bottom: A, corner: B, top: C, center: [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3], _w: [base, h] as V }, along: f => lerp(A, C, f), normal: () => up, tangentDeg: () => Math.atan2(d[1], d[0]) * 180 / Math.PI, box: box([A, B, C], 0.1) };
    }
    case 'table': case 'rect': case 'block': {
      const w = ctx.N(it.w, 'w', it.type === 'block' ? 1 : 2), h = ctx.N(it.h, 'h', it.type === 'block' ? 1 : it.type === 'table' ? 1.6 : 1);
      let c: V, ang = 0;
      if (it.on !== undefined) {
        const host = ctx.geom(String(it.on));
        if (!host.along || !host.normal) throw Error(`“${it.on}” is not a surface or incline a block can sit on`);
        const f = ctx.N(it.at, 'at', 0.5), p = host.along(f), up = host.normal(f);
        ang = host.tangentDeg!(f); if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
        c = add(add(p, mul(up, h / 2 + ctx.N(it.gap, 'gap', 0))), mul(polar(ang), ctx.N(it.shift, 'shift', 0)));
      } else { c = [ctx.N(it.x, 'x'), ctx.N(it.y, 'y')]; ang = ctx.N(it.angle, 'angle', 0); }
      const u = polar(ang), nn = left(u), at = (i: number, j: number) => add(c, add(mul(u, i * w / 2), mul(nn, j * h / 2)));
      const anchors: Record<string, V> = { center: c, top: at(0, 1), bottom: at(0, -1), left: at(-1, 0), right: at(1, 0), topLeft: at(-1, 1), topRight: at(1, 1), bottomLeft: at(-1, -1), bottomRight: at(1, -1), _w: [w, h] };
      const q = chargeOf();
      return { anchors, along: f => lerp(at(-1, 1), at(1, 1), f), normal: () => nn, tangentDeg: () => ang, box: box([at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)]), source: q ? { kind: 'line', a: at(-1, 0), b: at(1, 0), q, r: Math.min(w, h) / 2 } : undefined };
    }
    case 'ball': case 'pulley': case 'wheel': case 'charge': {
      const r = ctx.N(it.r, 'r', it.type === 'charge' ? 0.18 : 0.5);
      if (!(r > 0)) throw Error('needs a radius r > 0');
      let c: V;
      if (it.on !== undefined) { const host = ctx.geom(String(it.on)); if (!host.along || !host.normal) throw Error(`“${it.on}” is not a surface to rest on`); const f = ctx.N(it.at, 'at', 0.5); c = add(host.along(f), mul(host.normal(f), r)); }
      else if (it.at !== undefined && it.x === undefined) c = ctx.P(it.at, 'at');
      else c = [ctx.N(it.x, 'x'), ctx.N(it.y, 'y')];
      const q = it.type === 'pulley' || it.type === 'wheel' ? 0 : it.type === 'charge' ? (it.q !== undefined ? ctx.N(it.q, 'q') : it.sign === '-' || it.sign === '−' || it.charge === '-' ? -1 : 1) : chargeOf();
      return { anchors: { center: c, top: add(c, [0, r]), bottom: add(c, [0, -r]), left: add(c, [-r, 0]), right: add(c, [r, 0]) }, circle: { c, r }, box: box([c], r), source: q ? { kind: 'point', c, q, r } : undefined };
    }
    case 'rod': case 'wire': case 'spring': case 'scale': {
      const a = ctx.P(it.from, 'from'), b = ctx.P(it.to, 'to');
      if (len(sub(b, a)) < 1e-9) throw Error('from and to are the same point');
      const T = ctx.N(it.thickness, 'thickness', it.type === 'wire' ? len(sub(b, a)) * 0.025 : len(sub(b, a)) * 0.05), q = it.type === 'rod' || it.type === 'wire' ? chargeOf() : 0;
      return { anchors: { a, b, from: a, to: b, center: lerp(a, b, 0.5), _w: [T, 0] }, along: f => lerp(a, b, f), normal: () => left(unit(sub(b, a))), tangentDeg: () => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, box: box([a, b], T / 2 + 0.05), source: q ? { kind: 'line', a, b, q, r: T / 2 } : undefined };
    }
    case 'pivot': {
      const c = it.at !== undefined ? ctx.P(it.at, 'at') : [ctx.N(it.x, 'x'), ctx.N(it.y, 'y')] as V, z = ctx.N(it.size, 'size', 0.5);
      return { anchors: { center: c, top: c, base: add(c, [0, -z]), baseL: add(c, [-z * 0.75, -z]), baseR: add(c, [z * 0.75, -z]) }, box: box([c, add(c, [0, -z])], z * 0.6) };
    }
    case 'container': {
      const x = ctx.N(it.x, 'x', 0), y = ctx.N(it.y, 'y', 0), w = ctx.N(it.w, 'w', 3), h = ctx.N(it.h, 'h', 4), level = ctx.N(it.level, 'level', h * 0.6);
      const bl: V = [x - w / 2, y], br: V = [x + w / 2, y], tl: V = [x - w / 2, y + h], tr: V = [x + w / 2, y + h], liquid: V[] = [];
      if (level > 0) {
        const surface = typeof it.surface === 'string' ? ctx.F(it.surface, 'x') : null;
        for (let k = 0; k <= 60; k++) {
          const dx = -w / 2 + w * k / 60, top = level + (surface ? surface(dx) : 0);
          liquid.push([x + dx, y + Math.max(0, Math.min(h, Number.isFinite(top) ? top : level))]);
        }
        liquid.push(br, bl);
      }
      return { anchors: { center: [x, y + h / 2], bottom: [x, y], top: [x, y + h], surface: liquid[30] ?? [x, y + level], bottomLeft: bl, bottomRight: br, topLeft: tl, topRight: tr, _liquid: liquid as unknown as V }, box: box([bl, tr], 0.1) };
    }
    case 'force': {
      const tailAt = ctx.P(it.at, 'at');
      let vec: V;
      if (it.to !== undefined) vec = sub(ctx.P(it.to, 'to'), tailAt);
      else if (it.dx !== undefined || it.dy !== undefined) vec = [ctx.N(it.dx, 'dx', 0), ctx.N(it.dy, 'dy', 0)];
      else vec = polar(ctx.N(it.dir ?? it.angle, 'dir'), ctx.N(it.length, 'length', 1));
      // "into": the arrow ends at the point (a push, a support force, a normal force drawn from below).
      const [a, b] = it.pointing === 'into' || it.head === 'at' ? [sub(tailAt, vec), tailAt] : [tailAt, add(tailAt, vec)];
      return { anchors: { tail: a, tip: b, center: lerp(a, b, 0.5) }, box: box([a, b], 0.2) };
    }
    case 'dimension': { const a = ctx.P(it.from, 'from'), b = ctx.P(it.to, 'to'), off = ctx.N(it.offset, 'offset', 0), nn = left(unit(sub(b, a))); return { anchors: { center: lerp(a, b, 0.5) }, box: box([a, b, add(a, mul(nn, off)), add(b, mul(nn, off))], 0.2) }; }
    case 'angle': { const c = ctx.P(it.at, 'at'), r = ctx.N(it.r, 'r', 0.6); return { anchors: { center: c }, box: box([c], r) }; }
    case 'line': case 'polygon': {
      const raw = Array.isArray(it.points) ? it.points : null;
      if (!raw || raw.length < 2 || raw.length > 200) throw Error('needs “points”: a list of 2 to 200 points');
      const pts = raw.map((p: unknown, k: number) => ctx.P(p, `points[${k}]`));
      return { anchors: { center: pts.reduce((a: V, p: V) => add(a, mul(p, 1 / pts.length)), [0, 0] as V), start: pts[0], end: pts[pts.length - 1], _pts: pts as unknown as V }, along: f => polyAt(pts, f), box: box(pts) };
    }
    case 'curve': {
      const from = ctx.N(it.from, 'from'), to = ctx.N(it.to, 'to'), pts: V[] = [], param = it.x !== undefined;
      const fx = param ? ctx.F(it.x, 's') : null, fy = ctx.F(param ? it.y : it.y ?? it.expr, param ? 's' : 'x');
      for (let k = 0; k <= 160; k++) {
        const v = from + (to - from) * k / 160;
        const p: V = fx ? [fx(v), fy(v)] : [v, fy(v)];
        if (p.every(Number.isFinite)) pts.push(p);
      }
      if (pts.length < 2) throw Error('the curve has no finite points in its range');
      return { anchors: { center: pts[Math.floor(pts.length / 2)], start: pts[0], end: pts[pts.length - 1], _pts: pts as unknown as V }, along: f => polyAt(pts, f), box: box(pts) };
    }
    case 'ellipse': {
      const c = it.at !== undefined ? ctx.P(it.at, 'at') : [ctx.N(it.x, 'x'), ctx.N(it.y, 'y')] as V, rx = ctx.N(it.rx ?? it.r, 'rx'), ry = ctx.N(it.ry ?? it.r, 'ry');
      return { anchors: { center: c, top: add(c, [0, ry]), bottom: add(c, [0, -ry]), left: add(c, [-rx, 0]), right: add(c, [rx, 0]), _w: [rx, ry] }, along: f => add(c, [rx * Math.cos(f * Math.PI * 2), ry * Math.sin(f * Math.PI * 2)]), box: [c[0] - rx, c[1] - ry, c[0] + rx, c[1] + ry] };
    }
    case 'text': case 'point': { const c = ctx.P(it.at ?? (it.x !== undefined ? [it.x, it.y] : undefined), 'at'); return { anchors: { center: c }, box: box([c], 0.25) }; }
    case 'rope': return ropeLayout(it, ctx);
    case 'fieldLines': return { anchors: { center: [0, 0] }, box: [Infinity, Infinity, -Infinity, -Infinity] };
    case 'fbd': { const c = it.at !== undefined ? ctx.P(it.at, 'at') : [ctx.N(it.x, 'x'), ctx.N(it.y, 'y')] as V, sc = ctx.N(it.scale, 'scale', 1.2); return { anchors: { center: c }, box: [c[0] - sc * 1.1, c[1] - sc * 1.1, c[0] + sc * 1.1, c[1] + sc * 1.5] }; }
  }
  return { anchors: { center: [0, 0] }, box: [0, 0, 0, 0] };
}
function polyAt(pts: V[], f: number): V {
  const segs = pts.slice(1).map((p, i) => len(sub(p, pts[i]))), total = segs.reduce((a, b) => a + b, 0);
  let d = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < segs.length; i++) { if (d <= segs[i] || i === segs.length - 1) return lerp(pts[i], pts[i + 1], segs[i] ? d / segs[i] : 0); d -= segs[i]; }
  return pts[pts.length - 1];
}

/**
 * A rope through points and around pulleys. Each pulley is {"around":"p1","side":"over"|"under"|"left"|"right"} (or
 * "turn":"cw"|"ccw"). Between two stops the rope follows their common tangent; around a pulley it follows the rim.
 */
function ropeLayout(it: Item, ctx: Ctx): Geom {
  const path = Array.isArray(it.path) ? it.path : null;
  if (!path || path.length < 2 || path.length > 24) throw Error('needs “path”: 2 to 24 stops (points, anchors or {"around":"pulleyId"})');
  type Stop = { c: V; r: number; turn: number; around?: string; side?: string };
  const stops: Stop[] = path.map((p: any, k: number) => {
    if (p && typeof p === 'object' && !Array.isArray(p) && p.around !== undefined) {
      const g = ctx.geom(String(p.around));
      if (!g.circle) throw Error(`stop ${k + 1}: “${p.around}” is not a pulley or wheel`);
      const turn = p.turn === 'ccw' ? 1 : p.turn === 'cw' ? -1 : 0;
      return { c: g.circle.c, r: g.circle.r, turn, around: String(p.around), side: String(p.side ?? p.over ?? 'over') };
    }
    return { c: ctx.P(p, `path[${k}]`), r: 0, turn: 0 };
  });
  if (stops[0].r || stops[stops.length - 1].r) throw Error('a rope must start and end at a point or anchor, not on a pulley');
  // Choose each pulley's wrap direction from the side asked for, judging against its neighbours' centres.
  const tangent = (a: { c: V; s: number }, b: { c: V; s: number }): [V, V] => {
    const D = sub(b.c, a.c), d = len(D), ds = b.s - a.s;
    if (d <= Math.abs(ds) + 1e-9) throw Error('two stops overlap, so the rope between them has no tangent (a point is inside a pulley, or two pulleys touch)');
    const L = Math.sqrt(d * d - ds * ds), ang = Math.atan2(D[1], D[0]) - Math.atan2(ds, L), u: V = [Math.cos(ang), Math.sin(ang)], nn = left(u);
    return [sub(a.c, mul(nn, a.s)), sub(b.c, mul(nn, b.s))];
  };
  const sweep = (c: V, from: V, to: V, turn: number) => { const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]), a1 = Math.atan2(to[1] - c[1], to[0] - c[0]); const tau = Math.PI * 2; let d = turn > 0 ? ((a1 - a0) % tau + tau) % tau : -(((a0 - a1) % tau + tau) % tau); return { a0, d }; };
  stops.forEach((st, k) => {
    if (!st.r || st.turn) return;
    const prev = { c: stops[k - 1].c, s: 0 }, next = { c: stops[k + 1].c, s: 0 };
    // The wrap must cover the side asked for (the top of the wheel for "over"); of the wraps that do, the shorter one.
    const want = st.side === 'under' ? -Math.PI / 2 : st.side === 'left' ? Math.PI : st.side === 'right' ? 0 : Math.PI / 2, tau = Math.PI * 2;
    let best = 1, score = -Infinity;
    for (const turn of [1, -1]) {
      try {
        const tin = tangent(prev, { c: st.c, s: turn * st.r })[1], tout = tangent({ c: st.c, s: turn * st.r }, next)[0], { a0, d } = sweep(st.c, tin, tout, turn);
        const reach = turn > 0 ? ((want - a0) % tau + tau) % tau : ((a0 - want) % tau + tau) % tau, covers = reach <= Math.abs(d) + 1e-6;
        const val = (covers ? 10 : Math.cos(Math.min(reach, tau - reach + Math.abs(d)))) - Math.abs(d) / tau;
        if (val > score) { score = val; best = turn; }
      } catch { /* this direction has no tangent */ }
    }
    st.turn = best;
  });
  const pts: V[] = [];
  let enter: V | null = null;
  for (let k = 0; k < stops.length - 1; k++) {
    const a = stops[k], b = stops[k + 1];
    const [ta, tb] = tangent({ c: a.c, s: a.turn * a.r }, { c: b.c, s: b.turn * b.r });
    if (a.r && enter) { const { a0, d } = sweep(a.c, enter, ta, a.turn), steps = Math.max(2, Math.ceil(Math.abs(d) / 0.12)); for (let i = 0; i <= steps; i++) { const ang = a0 + d * i / steps; pts.push([a.c[0] + a.r * Math.cos(ang), a.c[1] + a.r * Math.sin(ang)]); } }
    else pts.push(ta);
    pts.push(tb);
    enter = tb;
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { anchors: { start: pts[0], end: pts[pts.length - 1], center: polyAt(pts, 0.5), _pts: pts as unknown as V }, along: f => polyAt(pts, f), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/** Kinetra entry point for PDFs: {title?, items, view?, width?} → SVG on white paper. */
export function renderIllustration(spec: unknown) {
  // Ids come from the content, so the same figure always gives the same SVG and two figures in one page never clash.
  let h = 5381; for (const ch of JSON.stringify(spec)) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return compileFigure(spec).render({}, 0, { background: '#ffffff', idPrefix: 'k' + h.toString(36) });
}
