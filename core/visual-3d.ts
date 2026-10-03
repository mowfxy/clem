import { z } from 'zod';
import { safeEval, type Compiled, type Vars } from './expr.ts';
import type { P, Pen, Style } from './visual-spec.ts';

/** Model-authored 3D scenes. Like the 2D visuals, a spec only *describes* objects: every coordinate is a checked
 *  expression, compiled once and evaluated per frame into plain primitives in data coordinates. The Three.js view
 *  (src/visuals/Spec3D.tsx) and the projected drawing used for SVG, PDF and thumbnails both draw those primitives. */

export type Vec = [number, number, number];
type Base = { color: string; opacity: number; dim: number; mat?: Material };
export const materials = ['metal', 'copper', 'gold', 'glass', 'plastic', 'rubber', 'wood', 'matte'] as const;
export type Material = typeof materials[number];
export type Prim =
  | Base & { k: 'mesh'; rows: number; cols: number; pos: Float32Array; colormap: boolean; wire: boolean }
  | Base & { k: 'line'; pts: Vec[]; width: number; dash: boolean }
  | Base & { k: 'point'; p: Vec; size: number }
  | Base & { k: 'arrow'; from: Vec; to: Vec }
  | Base & { k: 'sphere'; c: Vec; r: number }
  | Base & { k: 'box'; c: Vec; s: Vec }
  | Base & { k: 'cyl'; a: Vec; b: Vec; r: number; cone: boolean }
  | Base & { k: 'poly'; pts: Vec[] }
  | Base & { k: 'text'; p: Vec; text: string; size: number }
  /** A + or − printed on a charged surface: lies in the surface at p, facing along n, its bar along t. */
  | Base & { k: 'glyph'; p: Vec; n: Vec; t: Vec; sign: 1 | -1; size: number };

/* ── Schema ── */
const num = z.union([z.number(), z.string().max(600)]);
const text = (max = 80) => z.string().trim().max(max);
const color = z.string().max(20).optional();
const range = z.tuple([num, num]);
const common = { id: z.string().max(40).optional(), color, label: text(40).optional(), opacity: z.number().min(0.05).max(1).optional(), material: z.enum(materials).optional() };
const charge = { q: num.optional(), signs: z.boolean().optional() };
const atom = z.object({ el: z.string().regex(/^[A-Z][a-z]?$/), x: z.number(), y: z.number(), z: z.number(), label: text(20).optional() });
export const object3dSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('surface'), expr: z.string().max(600), x: range.optional(), y: range.optional(), colormap: z.boolean().optional(), wireframe: z.boolean().optional(), resolution: z.number().int().min(8).max(90).optional(), ...common }),
  z.object({ type: z.literal('parametricSurface'), x: z.string().max(600), y: z.string().max(600), z: z.string().max(600), u: range, v: range, colormap: z.boolean().optional(), wireframe: z.boolean().optional(), resolution: z.number().int().min(8).max(90).optional(), ...common }),
  z.object({ type: z.literal('curve'), x: num, y: num, z: num, from: num, to: num, width: z.number().min(0.5).max(6).optional(), dash: z.boolean().optional(), ...common }),
  z.object({ type: z.literal('point'), x: num, y: num, z: num, size: z.number().min(1).max(14).optional(), ...common }),
  z.object({ type: z.literal('vector'), x: num, y: num, z: num, dx: num, dy: num, dz: num, ...common }),
  z.object({ type: z.literal('segment'), x1: num, y1: num, z1: num, x2: num, y2: num, z2: num, dash: z.boolean().optional(), ...common }),
  z.object({ type: z.literal('sphere'), x: num, y: num, z: num, r: num, ...charge, ...common }),
  z.object({ type: z.literal('box'), x: num, y: num, z: num, w: num, d: num, h: num, ...charge, ...common }),
  z.object({ type: z.enum(['cylinder', 'cone']), x: num, y: num, z: num, r: num, h: num, axis: z.enum(['x', 'y', 'z']).optional(), ...charge, ...common }),
  z.object({ type: z.literal('fieldLines'), lines: z.number().int().min(4).max(80).optional(), arrows: z.boolean().optional(), color, id: z.string().max(40).optional(), opacity: z.number().min(0.05).max(1).optional() }),
  z.object({ type: z.literal('polygon'), points: z.array(z.tuple([num, num, num])).min(3).max(60), ...common }),
  z.object({ type: z.literal('field'), dx: z.string().max(600), dy: z.string().max(600), dz: z.string().max(600), density: z.number().int().min(2).max(8).optional(), ...common }),
  z.object({ type: z.literal('text'), x: num, y: num, z: num, text: text(120), size: z.number().min(8).max(24).optional(), color }),
  z.object({ type: z.literal('molecule'), atoms: z.array(atom).min(1).max(120), bonds: z.array(z.union([z.tuple([z.number().int(), z.number().int()]), z.tuple([z.number().int(), z.number().int(), z.number().int().min(1).max(3)])])).max(200).optional(), labels: z.boolean().optional(), ...common }),
]);
export type Object3D = z.infer<typeof object3dSchema>;
export const camera3dSchema = z.object({ azimuth: z.number().min(-360).max(360).optional(), elevation: z.number().min(-89).max(89).optional(), zoom: z.number().min(0.3).max(3).optional() });

/* ── Chemistry: CPK-style colours tuned for the dark stage, covalent radii in Å ── */
const elements: Record<string, [string, number]> = {
  H: ['#f0efeb', 0.31], C: ['#8a8a85', 0.76], N: ['#8197e2', 0.71], O: ['#d87968', 0.66], F: ['#8fbf98', 0.57], Cl: ['#8fbf98', 1.02], Br: ['#b0715a', 1.2], I: ['#b49ddb', 1.39],
  S: ['#d9b36c', 1.05], P: ['#e39a5b', 1.07], Na: ['#b49ddb', 1.66], K: ['#b49ddb', 2.03], Mg: ['#9fcf8f', 1.41], Ca: ['#a3a3a0', 1.76], Fe: ['#d08a5a', 1.32], Cu: ['#d08a5a', 1.32], Zn: ['#9aa3c9', 1.22], Si: ['#d9c49a', 1.11], B: ['#e2b3a0', 0.84], Li: ['#b49ddb', 1.28],
};
export const elementColor = (el: string) => elements[el]?.[0] ?? '#b8b7b2';
const materialColor: Record<Material, string> = { metal: '#b9c0c8', copper: '#c97b45', gold: '#d9b04c', glass: '#cfe9f2', plastic: '#e9e3d6', rubber: '#4a4e54', wood: '#b98a56', matte: '#a3a3a0' };
export const POSITIVE = '#e0483e', NEGATIVE = '#4f86e8';

/* ── Electrostatics: charged spheres (point charges), cylinders (uniform line charges) and boxes (charged plates) ── */
type Source3 = { kind: 'point'; c: Vec; q: number; r: number } | { kind: 'line'; a: Vec; b: Vec; q: number; r: number } | { kind: 'plate'; pts: Vec[]; q: number; c: Vec; half: Vec };
const v3 = { add: (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul: (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k], dot: (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len: (a: Vec) => Math.hypot(a[0], a[1], a[2]) };
const norm = (a: Vec): Vec => v3.mul(a, 1 / (v3.len(a) || 1));
const crossV = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Electric field (k = 1): q r̂/r² for points, the exact finite-segment integral for line charges, a grid of points for plates. */
export function field3(sources: Source3[], p: Vec): Vec {
  let e: Vec = [0, 0, 0];
  const point = (c: Vec, q: number) => { const d = v3.sub(p, c), r2 = Math.max(v3.dot(d, d), 1e-9); e = v3.add(e, v3.mul(d, q / (r2 * Math.sqrt(r2)))); };
  for (const s of sources) {
    if (s.kind === 'point') point(s.c, s.q);
    else if (s.kind === 'plate') for (const c of s.pts) point(c, s.q / s.pts.length);
    else {
      const L = v3.len(v3.sub(s.b, s.a)); if (L < 1e-9) continue;
      const u = norm(v3.sub(s.b, s.a)), lam = s.q / L, x1 = v3.dot(v3.sub(s.a, p), u), x2 = v3.dot(v3.sub(s.b, p), u);
      const perp = v3.sub(p, v3.add(s.a, v3.mul(u, v3.dot(v3.sub(p, s.a), u)))), h = Math.max(v3.len(perp), 1e-6), n = v3.mul(perp, 1 / h);
      const r1 = Math.hypot(x1, h), r2 = Math.hypot(x2, h);
      e = v3.add(e, v3.add(v3.mul(u, lam * (1 / r2 - 1 / r1)), v3.mul(n, lam / h * (x2 / r2 - x1 / r1))));
    }
  }
  return e;
}
const inside3 = (s: Source3, p: Vec, grow = 1) => {
  if (s.kind === 'point') return v3.len(v3.sub(p, s.c)) < s.r * grow;
  if (s.kind === 'plate') return [0, 1, 2].every(i => Math.abs(p[i] - s.c[i]) < s.half[i] * grow + 1e-9);
  const u = norm(v3.sub(s.b, s.a)), t = Math.max(0, Math.min(v3.len(v3.sub(s.b, s.a)), v3.dot(v3.sub(p, s.a), u)));
  return v3.len(v3.sub(p, v3.add(s.a, v3.mul(u, t)))) < s.r * grow;
};
/** Even points on a unit sphere (Fibonacci lattice). */
const fib = (n: number): Vec[] => Array.from({ length: n }, (_, i) => { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5)); return [Math.cos(a) * r, Math.sin(a) * r, y] as Vec; });
/** Field lines in 3D, seeded evenly on each charged body in proportion to |q| and traced with RK4 until they end on a body or leave the scene. */
export function traceField3(sources: Source3[], b: Bounds, density = 24) {
  const maxQ = Math.max(...sources.map(s => Math.abs(s.q)), 1e-12), size = Math.hypot(b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0]), ds = size / 300;
  const lo: Vec = [b.x[0], b.y[0], b.z[0]], hi: Vec = [b.x[1], b.y[1], b.z[1]], pad = v3.mul(v3.sub(hi, lo), 0.5);
  const out: { pts: Vec[]; reversed: boolean }[] = [];
  const dir = (p: Vec, sign: number): Vec | null => { const e = field3(sources, p), m = v3.len(e); return m > 1e-14 ? v3.mul(e, sign / m) : null; };
  for (const src of sources) {
    const sign = src.q > 0 ? 1 : -1, count = Math.max(6, Math.round(density * Math.abs(src.q) / maxQ)), seeds: Vec[] = [];
    if (src.kind === 'point') fib(count).forEach(d => seeds.push(v3.add(src.c, v3.mul(d, src.r * 1.04))));
    else if (src.kind === 'plate') {
      const flat = [0, 1, 2].reduce((m, i) => (src.half[i] < src.half[m] ? i : m), 0), axes = [0, 1, 2].filter(k => k !== flat), side = Math.max(2, Math.round(Math.sqrt(count / 2)));
      for (const f of [-1, 1]) for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) { const p: Vec = [...src.c] as Vec; p[axes[0]] += src.half[axes[0]] * (-0.8 + 1.6 * (i + 0.5) / side); p[axes[1]] += src.half[axes[1]] * (-0.8 + 1.6 * (j + 0.5) / side); p[flat] += f * src.half[flat] * 1.05; seeds.push(p); }
    } else {
      const u = norm(v3.sub(src.b, src.a)), e1 = norm(Math.abs(u[2]) < 0.9 ? crossV(u, [0, 0, 1]) : crossV(u, [1, 0, 0])), e2 = crossV(u, e1), around = 8, along = Math.max(1, Math.round(count / around));
      for (let i = 0; i < along; i++) for (let k = 0; k < around; k++) { const a = (k + (i % 2) * 0.5) * Math.PI * 2 / around, c = v3.add(src.a, v3.mul(v3.sub(src.b, src.a), (i + 0.5) / along)); seeds.push(v3.add(c, v3.add(v3.mul(e1, Math.cos(a) * src.r * 1.05), v3.mul(e2, Math.sin(a) * src.r * 1.05)))); }
    }
    for (const seed of seeds) {
      const pts: Vec[] = [seed];
      let p = seed, ended: Source3 | null = null;
      for (let k = 0; k < 1400; k++) {
        const k1 = dir(p, sign); if (!k1) break;
        const k2 = dir(v3.add(p, v3.mul(k1, ds / 2)), sign); if (!k2) break;
        const k3 = dir(v3.add(p, v3.mul(k2, ds / 2)), sign); if (!k3) break;
        const k4 = dir(v3.add(p, v3.mul(k3, ds)), sign); if (!k4) break;
        p = v3.add(p, v3.mul(v3.add(v3.add(k1, v3.mul(k2, 2)), v3.add(v3.mul(k3, 2), k4)), ds / 6));
        pts.push(p);
        const hit = sources.find(s => s !== src && inside3(s, p)); if (hit) { ended = hit; break; }
        if (k > 4 && inside3(src, p, 0.98)) break;
        if ([0, 1, 2].some(i => p[i] < lo[i] - pad[i] || p[i] > hi[i] + pad[i])) break;
      }
      // A line traced back from a negative charge that ends on a positive one repeats a line drawn from that positive.
      if (sign < 0 && ended && ended.q > 0) continue;
      if (pts.length > 3) out.push({ pts, reversed: sign < 0 });
    }
  }
  return out;
}
const covalent = (el: string) => elements[el]?.[1] ?? 1;

export type Bounds = { x: [number, number]; y: [number, number]; z: [number, number] };
export type Compiled3D = {
  primitives(values: Vars, t: number, step?: number): Prim[];
  bounds(values: Vars, t: number): Bounds;
  equal: boolean;
  axes: boolean;
  labels: { x?: string; y?: string; z?: string };
  camera: { azimuth: number; elevation: number; zoom: number };
  autoRotate: boolean;
};

type Axis = { min: number | string; max: number | string; label?: string } | undefined;
type Spec3D = { x?: Axis; y?: Axis; z?: Axis; equal?: boolean; axes?: boolean; objects?: Object3D[]; camera?: z.infer<typeof camera3dSchema>; autoRotate?: boolean; steps?: { focus?: string[] }[] };
type C = (v: number | string, extra?: string[]) => Compiled;

/** Compiles the objects of a 3D spec. `c` compiles an expression against the spec's names (plus `extra`). */
export function compile3d(spec: Spec3D, c: C, tone: (value: unknown, fallback: string) => string, defaults: Vars): Compiled3D {
  const objects = spec.objects || [];
  if (!objects.length) throw Error('A 3D visual needs at least one object.');
  const ids = new Set(objects.map(o => ('id' in o ? o.id : undefined)).filter(Boolean));
  for (const s of spec.steps || []) for (const f of s.focus || []) if (!ids.has(f)) throw Error(`A step highlights an unknown object “${f}”.`);
  const ax = (a: Axis) => (a ? [c(a.min), c(a.max)] as const : null);
  const axX = ax(spec.x), axY = ax(spec.y), axZ = ax(spec.z);
  const palette = ['blue', 'coral', 'green', 'amber', 'violet'];
  let auto = 0;
  // Surfaces thin out when something is drawn on them, so points, slopes and slices beneath stay visible.
  const marked = objects.some(o => ['point', 'vector', 'curve', 'segment', 'field'].includes(o.type));
  // Charged objects, evaluated per frame, are the sources a fieldLines object traces.
  const charges: ((v: Vars) => Source3 | null)[] = [];
  const E = (f: Compiled, v: Vars) => safeEval(f, v);
  const V3 = (f: readonly [Compiled, Compiled, Compiled], v: Vars): Vec => [E(f[0], v), E(f[1], v), E(f[2], v)];
  const fin = (p: Vec) => p.every(Number.isFinite);

  type Build = (v: Vars, b: Bounds, out: Prim[], base: Base) => void;
  type Item = { id?: string; build: Build; base: (dim: number) => Base; label?: string; measure?: boolean };
  const builds: Item[] = objects.map((o): Item => {
    const shaded = o.type === 'surface' || o.type === 'parametricSurface' || o.type === 'curve' || o.type === 'field';
    const mat = 'material' in o ? o.material : undefined;
    const col = mat && !o.color ? materialColor[mat] : tone(o.color, shaded ? palette[auto++ % palette.length] : o.type === 'point' || o.type === 'vector' ? 'coral' : 'soft');
    // Solids given a material or a charge are real objects, so they are opaque unless asked otherwise.
    const solid = !!mat || ('q' in o && o.q !== undefined);
    const op = 'opacity' in o && o.opacity !== undefined ? o.opacity : o.type === 'surface' || o.type === 'parametricSurface' ? (marked ? 0.62 : 0.92) : (o.type === 'box' || o.type === 'cylinder' || o.type === 'cone' || o.type === 'polygon') && !solid ? 0.55 : 1;
    const base = (dim: number): Base => ({ color: col, opacity: op, dim, mat });
    const qf = 'q' in o && o.q !== undefined ? c(o.q) : null, signs = !('signs' in o) || o.signs !== false;
    const id = 'id' in o ? o.id : undefined, label = 'label' in o ? o.label : undefined;
    switch (o.type) {
      case 'surface': {
        const f = c(o.expr, ['x', 'y']), xr = o.x ? [c(o.x[0]), c(o.x[1])] as const : axX, yr = o.y ? [c(o.y[0]), c(o.y[1])] as const : axY;
        if (!xr || !yr) throw Error('A surface needs x and y ranges (on the surface or the axes).');
        const n = o.resolution ?? 48;
        return { id, base, label, build: (v, b, out, bs) => {
          const x0 = E(xr[0], v), x1 = E(xr[1], v), y0 = E(yr[0], v), y1 = E(yr[1], v), pos = new Float32Array((n + 1) * (n + 1) * 3);
          const zlo = b.z[0] - (b.z[1] - b.z[0]) * 0.02, zhi = b.z[1] + (b.z[1] - b.z[0]) * 0.02;
          for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
            const x = x0 + (x1 - x0) * j / n, y = y0 + (y1 - y0) * i / n, zz = E(f, { ...v, x, y }), k = (i * (n + 1) + j) * 3;
            pos[k] = x; pos[k + 1] = y; pos[k + 2] = Number.isFinite(zz) ? Math.max(zlo, Math.min(zhi, zz)) : zlo;
          }
          out.push({ ...bs, k: 'mesh', rows: n + 1, cols: n + 1, pos, colormap: o.colormap ?? !o.color, wire: !!o.wireframe });
          if (label) out.push({ ...bs, k: 'text', p: [pos[pos.length - 3], pos[pos.length - 2], pos[pos.length - 1]], text: label, size: 12, opacity: 1 });
        } };
      }
      case 'parametricSurface': {
        const fx = c(o.x, ['u', 'v']), fy = c(o.y, ['u', 'v']), fz = c(o.z, ['u', 'v']), u = [c(o.u[0]), c(o.u[1])], w = [c(o.v[0]), c(o.v[1])], n = o.resolution ?? 48;
        return { id, base, label, build: (v, _b, out, bs) => {
          const u0 = E(u[0], v), u1 = E(u[1], v), v0 = E(w[0], v), v1 = E(w[1], v), pos = new Float32Array((n + 1) * (n + 1) * 3);
          for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
            const vars = { ...v, u: u0 + (u1 - u0) * j / n, v: v0 + (v1 - v0) * i / n }, k = (i * (n + 1) + j) * 3;
            pos[k] = E(fx, vars) || 0; pos[k + 1] = E(fy, vars) || 0; pos[k + 2] = E(fz, vars) || 0;
          }
          out.push({ ...bs, k: 'mesh', rows: n + 1, cols: n + 1, pos, colormap: o.colormap ?? false, wire: !!o.wireframe });
          if (label) out.push({ ...bs, k: 'text', p: [pos[0], pos[1], pos[2]], text: label, size: 12, opacity: 1 });
        } };
      }
      case 'curve': {
        const f = [c(o.x, ['s']), c(o.y, ['s']), c(o.z, ['s'])] as const, a = c(o.from), z1 = c(o.to);
        return { id, base, label, build: (v, _b, out, bs) => {
          const s0 = E(a, v), s1 = E(z1, v), pts: Vec[] = [];
          if (Number.isFinite(s0) && Number.isFinite(s1)) for (let i = 0; i <= 360; i++) { const p = V3(f, { ...v, s: s0 + (s1 - s0) * i / 360 }); if (fin(p)) pts.push(p); }
          out.push({ ...bs, k: 'line', pts, width: o.width ?? 2.4, dash: !!o.dash });
          if (label && pts.length) out.push({ ...bs, k: 'text', p: pts[pts.length - 1], text: label, size: 12, opacity: 1 });
        } };
      }
      case 'point': {
        const f = [c(o.x), c(o.y), c(o.z)] as const;
        return { id, base, label, build: (v, _b, out, bs) => { const p = V3(f, v); if (!fin(p)) return; out.push({ ...bs, k: 'point', p, size: o.size ?? 6 }); if (label) out.push({ ...bs, k: 'text', p, text: label, size: 12 }); } };
      }
      case 'vector': {
        const f = [c(o.x), c(o.y), c(o.z)] as const, d = [c(o.dx), c(o.dy), c(o.dz)] as const;
        return { id, base, label, build: (v, _b, out, bs) => { const p = V3(f, v), q = V3(d, v); if (!fin(p) || !fin(q)) return; const to: Vec = [p[0] + q[0], p[1] + q[1], p[2] + q[2]]; out.push({ ...bs, k: 'arrow', from: p, to }); if (label) out.push({ ...bs, k: 'text', p: to, text: label, size: 13 }); } };
      }
      case 'segment': {
        const a = [c(o.x1), c(o.y1), c(o.z1)] as const, b2 = [c(o.x2), c(o.y2), c(o.z2)] as const;
        return { id, base, label, build: (v, _b, out, bs) => { const p = V3(a, v), q = V3(b2, v); if (!fin(p) || !fin(q)) return; out.push({ ...bs, k: 'line', pts: [p, q], width: 1.8, dash: !!o.dash }); if (label) out.push({ ...bs, k: 'text', p: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], text: label, size: 11.5 }); } };
      }
      case 'sphere': {
        const f = [c(o.x), c(o.y), c(o.z)] as const, r = c(o.r);
        if (qf) charges.push(v => { const p = V3(f, v), rr = E(r, v), q = E(qf, v); return fin(p) && rr > 0 && q ? { kind: 'point', c: p, q, r: rr } : null; });
        return { id, base, label, build: (v, _b, out, bs) => {
          const p = V3(f, v), rr = E(r, v); if (!fin(p) || !(rr > 0)) return; out.push({ ...bs, k: 'sphere', c: p, r: rr });
          const q = qf ? E(qf, v) : 0;
          if (q && signs) for (const d of fib(Math.max(14, Math.min(40, Math.round(18 + 6 * Math.abs(q)))))) { const t = norm(Math.abs(d[2]) < 0.9 ? crossV([0, 0, 1], d) : crossV([1, 0, 0], d)); out.push({ ...bs, opacity: 1, mat: undefined, color: q > 0 ? POSITIVE : NEGATIVE, k: 'glyph', p: v3.add(p, v3.mul(d, rr)), n: d, t, sign: q > 0 ? 1 : -1, size: rr * 0.2 }); }
          if (label) out.push({ ...bs, k: 'text', p: [p[0], p[1], p[2] + rr * 1.25], text: label, size: 12, opacity: 1 });
        } };
      }
      case 'box': {
        const f = [c(o.x), c(o.y), c(o.z)] as const, s = [c(o.w), c(o.d), c(o.h)] as const;
        const flatOf = (half: Vec) => [0, 1, 2].reduce((m, i) => (half[i] < half[m] ? i : m), 0);
        if (qf) charges.push(v => {
          const p = V3(f, v), half = V3(s, v).map(x => Math.abs(x) / 2) as Vec, q = E(qf, v);
          if (!fin(p) || !q) return null;
          const flat = flatOf(half), axes = [0, 1, 2].filter(k => k !== flat), pts: Vec[] = [];
          for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) { const c0: Vec = [...p] as Vec; c0[axes[0]] += half[axes[0]] * (-1 + 2 * (i + 0.5) / 7); c0[axes[1]] += half[axes[1]] * (-1 + 2 * (j + 0.5) / 7); pts.push(c0); }
          return { kind: 'plate', pts, q, c: p, half };
        });
        return { id, base, label, build: (v, _b, out, bs) => {
          const p = V3(f, v), sz = V3(s, v); if (!fin(p) || !fin(sz)) return; out.push({ ...bs, k: 'box', c: p, s: sz.map(Math.abs) as Vec });
          const q = qf ? E(qf, v) : 0;
          if (q && signs) {
            const half = sz.map(x => Math.abs(x) / 2) as Vec, flat = flatOf(half), axes = [0, 1, 2].filter(k => k !== flat), g = 4, size = Math.min(half[axes[0]], half[axes[1]]) * 0.16;
            for (const side of [-1, 1]) for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) {
              const at: Vec = [...p] as Vec, n: Vec = [0, 0, 0], t: Vec = [0, 0, 0];
              at[axes[0]] += half[axes[0]] * (-1 + 2 * (i + 0.5) / g) * 0.85; at[axes[1]] += half[axes[1]] * (-1 + 2 * (j + 0.5) / g) * 0.85; at[flat] += side * half[flat]; n[flat] = side; t[axes[0]] = 1;
              out.push({ ...bs, opacity: 1, mat: undefined, color: q > 0 ? POSITIVE : NEGATIVE, k: 'glyph', p: at, n, t, sign: q > 0 ? 1 : -1, size });
            }
          }
          if (label) out.push({ ...bs, k: 'text', p: [p[0], p[1], p[2] + Math.abs(sz[2]) / 2], text: label, size: 12, opacity: 1 });
        } };
      }
      case 'cylinder': case 'cone': {
        const f = [c(o.x), c(o.y), c(o.z)] as const, r = c(o.r), h = c(o.h), axis = o.axis ?? 'z';
        const ends = (v: Vars): [Vec, Vec] => { const p = V3(f, v), hh = E(h, v); return [p, [p[0] + (axis === 'x' ? hh : 0), p[1] + (axis === 'y' ? hh : 0), p[2] + (axis === 'z' ? hh : 0)]]; };
        if (qf && o.type === 'cylinder') charges.push(v => { const [a, b] = ends(v), rr = E(r, v), q = E(qf, v); return fin(a) && fin(b) && rr > 0 && q ? { kind: 'line', a, b, q, r: rr } : null; });
        return { id, base, label, build: (v, _b, out, bs) => {
          const p = V3(f, v), rr = E(r, v), hh = E(h, v);
          if (!fin(p) || !(rr > 0) || !Number.isFinite(hh)) return;
          const top: Vec = [p[0] + (axis === 'x' ? hh : 0), p[1] + (axis === 'y' ? hh : 0), p[2] + (axis === 'z' ? hh : 0)];
          out.push({ ...bs, k: 'cyl', a: p, b: top, r: rr, cone: o.type === 'cone' });
          const q = qf && o.type === 'cylinder' ? E(qf, v) : 0;
          if (q && signs) {
            const u = norm(v3.sub(top, p)), e1 = norm(Math.abs(u[2]) < 0.9 ? crossV(u, [0, 0, 1]) : crossV(u, [1, 0, 0])), e2 = crossV(u, e1), L = v3.len(v3.sub(top, p)), thin = rr * 12 < L, around = thin ? 4 : rr * 6 > L ? 10 : 6, along = Math.max(2, Math.min(thin ? 22 : 28, Math.round(L / (rr * (thin ? 2.6 : 1.6)))));
            for (let i = 0; i < along; i++) for (let k = 0; k < around; k++) {
              const a = (k + (i % 2) * 0.5) * Math.PI * 2 / around, n = v3.add(v3.mul(e1, Math.cos(a)), v3.mul(e2, Math.sin(a)));
              out.push({ ...bs, opacity: 1, mat: undefined, color: q > 0 ? POSITIVE : NEGATIVE, k: 'glyph', p: v3.add(v3.add(p, v3.mul(u, L * (i + 0.5) / along)), v3.mul(n, rr)), n, t: u, sign: q > 0 ? 1 : -1, size: thin ? rr * 0.8 : Math.min(rr * 0.62, L / along * 0.34) });
            }
          }
          if (label) out.push({ ...bs, k: 'text', p: top, text: label, size: 12, opacity: 1 });
        } };
      }
      case 'polygon': {
        const pts = o.points.map(([x, y, zz]) => [c(x), c(y), c(zz)] as const);
        return { id, base, label, build: (v, _b, out, bs) => { const p = pts.map(q => V3(q, v)).filter(fin); if (p.length >= 3) out.push({ ...bs, k: 'poly', pts: p }); if (label && p.length) out.push({ ...bs, k: 'text', p: p[0], text: label, size: 12, opacity: 1 }); } };
      }
      case 'field': {
        const f = [c(o.dx, ['x', 'y', 'z']), c(o.dy, ['x', 'y', 'z']), c(o.dz, ['x', 'y', 'z'])] as const, n = o.density ?? 5;
        return { id, base, label, build: (v, b, out, bs) => {
          const cell = Math.min(b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0]) / n, arrows: [Vec, Vec, number][] = [];
          let most = 0;
          for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
            const p: Vec = [b.x[0] + (b.x[1] - b.x[0]) * (i + 0.5) / n, b.y[0] + (b.y[1] - b.y[0]) * (j + 0.5) / n, b.z[0] + (b.z[1] - b.z[0]) * (k + 0.5) / n];
            const d = V3(f, { ...v, x: p[0], y: p[1], z: p[2] }), m = Math.hypot(...d);
            if (fin(d) && m > 1e-12) { arrows.push([p, d, m]); most = Math.max(most, m); }
          }
          for (const [p, d, m] of arrows) { const s = cell * 0.8 * (0.35 + 0.65 * m / most) / m; out.push({ ...bs, k: 'arrow', from: p, to: [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s], opacity: 0.45 + 0.55 * m / most }); }
        } };
      }
      case 'text': {
        const f = [c(o.x), c(o.y), c(o.z)] as const;
        return { base: (dim) => ({ color: tone(o.color, 'soft'), opacity: 1, dim }), build: (v, _b, out, bs) => { const p = V3(f, v); if (fin(p)) out.push({ ...bs, k: 'text', p, text: o.text, size: o.size ?? 12.5 }); } };
      }
      case 'fieldLines': {
        const density = o.lines ?? 30;
        return { id, base, measure: false, build: (v, b, out, bs) => {
          const sources = charges.map(f => { try { return f(v); } catch { return null; } }).filter((x): x is Source3 => !!x);
          if (!sources.length) return;
          const span = Math.hypot(b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0]), head = span * 0.016;
          for (const line of traceField3(sources, b, density)) {
            out.push({ ...bs, k: 'line', pts: line.pts, width: 1.4, dash: false, opacity: o.opacity ?? 0.85 });
            if (o.arrows === false || line.pts.length < 10) continue;
            const k = Math.floor(line.pts.length * (line.reversed ? 0.55 : 0.4)), a = line.pts[k - 1], z2 = line.pts[k + 1], d = norm(line.reversed ? v3.sub(a, z2) : v3.sub(z2, a)), tip = line.pts[k];
            out.push({ ...bs, k: 'cyl', a: v3.sub(tip, v3.mul(d, head)), b: tip, r: head * 0.38, cone: true, opacity: 1 });
          }
        } };
      }
      case 'molecule': {
        const atoms = o.atoms, n = atoms.length;
        let bonds = (o.bonds || []).filter(b => b[0] >= 0 && b[1] >= 0 && b[0] < n && b[1] < n && b[0] !== b[1]).map(b => [b[0], b[1], b[2] ?? 1] as [number, number, number]);
        // Without explicit bonds, atoms closer than their covalent radii allow are bonded.
        if (!o.bonds) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const a = atoms[i], b = atoms[j], d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
          if (d > 0.4 && d < 1.2 * (covalent(a.el) + covalent(b.el))) bonds.push([i, j, 1]);
        }
        bonds = bonds.slice(0, 300);
        return { id, base, label, build: (_v, _b, out, bs) => {
          for (const [i, j, order] of bonds) {
            const a = atoms[i], b = atoms[j], d: Vec = [b.x - a.x, b.y - a.y, b.z - a.z], len = Math.hypot(...d) || 1;
            // Offset multiple bonds sideways, perpendicular to the bond.
            const side = Math.abs(d[2] / len) < 0.9 ? [-d[1], d[0], 0] : [0, -d[2], d[1]], sl = Math.hypot(...side) || 1, gap = 0.13;
            for (let m = 0; m < order; m++) {
              const off = (m - (order - 1) / 2) * gap, o3 = side.map(s => s / sl * off);
              out.push({ ...bs, color: '#6f6e68', opacity: 1, k: 'cyl', a: [a.x + o3[0], a.y + o3[1], a.z + o3[2]], b: [b.x + o3[0], b.y + o3[1], b.z + o3[2]], r: order > 1 ? 0.055 : 0.08, cone: false });
            }
          }
          atoms.forEach(a => {
            out.push({ ...bs, color: elementColor(a.el), opacity: 1, k: 'sphere', c: [a.x, a.y, a.z], r: 0.16 + 0.24 * covalent(a.el) });
            if (o.labels || a.label) out.push({ ...bs, color: '#f0efeb', opacity: 1, k: 'text', p: [a.x, a.y, a.z], text: a.label || a.el, size: 11 });
          });
          if (label) { const top = atoms.reduce((m, a) => (a.z > m.z ? a : m), atoms[0]); out.push({ ...bs, opacity: 1, k: 'text', p: [top.x, top.y, top.z + 0.9], text: label, size: 12.5 }); }
        } };
      }
    }
  });

  const fromAxes = (v: Vars): Partial<Bounds> => {
    const r = (a: typeof axX): [number, number] | undefined => { if (!a) return undefined; let lo = E(a[0], v), hi = E(a[1], v); if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined; if (hi < lo) [lo, hi] = [hi, lo]; if (hi - lo < 1e-9) hi = lo + 1; return [lo, hi]; };
    return { x: r(axX), y: r(axY), z: r(axZ) };
  };
  const fieldScene = objects.some(o => o.type === 'fieldLines');
  // Axes the spec leaves open are measured once from the scene at its starting values, so the camera does not jump.
  const measured = (() => {
    const start = fromAxes({ ...defaults, t: 0 }), guess: Bounds = { x: start.x ?? [-5, 5], y: start.y ?? [-5, 5], z: start.z ?? [-5, 5] };
    if (start.x && start.y && start.z) return guess;
    const out: Prim[] = [];
    for (const b of builds) if (b.measure !== false) try { b.build({ ...defaults, t: 0 }, guess, out, b.base(1)); } catch { /* skip */ }
    const lo: Vec = [Infinity, Infinity, Infinity], hi: Vec = [-Infinity, -Infinity, -Infinity];
    const add = (p: Vec, pad = 0) => { for (let i = 0; i < 3; i++) if (Number.isFinite(p[i])) { lo[i] = Math.min(lo[i], p[i] - pad); hi[i] = Math.max(hi[i], p[i] + pad); } };
    for (const p of out) {
      if (p.k === 'mesh') for (let i = 0; i < p.pos.length; i += 3) add([p.pos[i], p.pos[i + 1], p.pos[i + 2]]);
      else if (p.k === 'line' || p.k === 'poly') p.pts.forEach(q => add(q));
      else if (p.k === 'point' || p.k === 'text' || p.k === 'glyph') add(p.p);
      else if (p.k === 'arrow') { add(p.from); add(p.to); }
      else if (p.k === 'sphere') add(p.c, p.r);
      else if (p.k === 'box') { add([p.c[0] - p.s[0] / 2, p.c[1] - p.s[1] / 2, p.c[2] - p.s[2] / 2]); add([p.c[0] + p.s[0] / 2, p.c[1] + p.s[1] / 2, p.c[2] + p.s[2] / 2]); }
      else if (p.k === 'cyl') { add(p.a, p.r); add(p.b, p.r); }
    }
    const pick = (i: number, given?: [number, number]): [number, number] => {
      if (given) return given;
      if (!(hi[i] >= lo[i])) return [-1, 1];
      // Field lines reach well beyond the bodies they leave, so a scene with them gets more room around it.
      const span = hi[i] - lo[i], pad = Math.max(span * (fieldScene ? 0.32 : 0.08), fieldScene ? 1 : 0.5);
      return [lo[i] - pad, hi[i] + pad];
    };
    return { x: pick(0, start.x), y: pick(1, start.y), z: pick(2, start.z) } as Bounds;
  })();
  const anyAxis = !!(axX || axY || axZ), onlyShapes = objects.every(o => ['molecule', 'sphere', 'box', 'cylinder', 'cone', 'text', 'polygon', 'fieldLines'].includes(o.type));

  return {
    equal: spec.equal ?? (!anyAxis || onlyShapes),
    // A model of real objects (molecules, charged bodies, apparatus) with no axis ranges is shown without a grid, like an illustration.
    axes: spec.axes ?? !(objects.every(o => o.type === 'molecule' || o.type === 'text') || (!anyAxis && onlyShapes)),
    labels: { x: spec.x?.label, y: spec.y?.label, z: spec.z?.label },
    camera: { azimuth: spec.camera?.azimuth ?? 38, elevation: spec.camera?.elevation ?? 24, zoom: spec.camera?.zoom ?? (fieldScene ? 1.55 : 1) },
    autoRotate: !!spec.autoRotate,
    bounds(values, t) { const a = fromAxes({ ...values, t }); return { x: a.x ?? measured.x, y: a.y ?? measured.y, z: a.z ?? measured.z }; },
    primitives(values, t, step) {
      const v = { ...values, t }, b = this.bounds(values, t), out: Prim[] = [];
      const focus = step !== undefined && spec.steps?.[step]?.focus ? new Set(spec.steps[step].focus) : null;
      for (const item of builds) {
        const dim = focus && !(item.id && focus.has(item.id)) ? 0.22 : 1;
        try { item.build(v, b, out, item.base(dim)); } catch { /* one failing object leaves the rest of the scene */ }
      }
      return out;
    },
  };
}

/* ── Shared frame: data coordinates → a z-up world about ten units wide ── */
export function worldFrame(b: Bounds, equal: boolean) {
  const span = [b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0]].map(s => s || 1), mid = [(b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, (b.z[0] + b.z[1]) / 2];
  const big = Math.max(...span), scale: Vec = equal ? [10 / big, 10 / big, 10 / big] : [10 / span[0], 10 / span[1], 7 / span[2]];
  return { scale, toWorld: (p: Vec): Vec => [(p[0] - mid[0]) * scale[0], (p[1] - mid[1]) * scale[1], (p[2] - mid[2]) * scale[2]], half: [span[0] * scale[0] / 2, span[1] * scale[1] / 2, span[2] * scale[2] / 2] as Vec };
}

/** Where the camera starts, in the z-up world, `distance` from the centre. */
export function cameraPosition(camera: Compiled3D['camera'], distance: number): Vec {
  const az = camera.azimuth * Math.PI / 180, el = camera.elevation * Math.PI / 180;
  return [distance * Math.cos(el) * Math.sin(az), -distance * Math.cos(el) * Math.cos(az), distance * Math.sin(el)];
}

const fmt = (v: number) => { const a = Math.abs(v); return a >= 1e4 || (a > 0 && a < 1e-2) ? v.toExponential(1) : String(+v.toFixed(a < 10 ? 2 : 1)); };
export const tickLabel = fmt;

/** The 3D scene as a still, projected drawing: for SVG and PDF export, thumbnails and devices without WebGL. */
export function drawProjected(pen: Pen, scene: Compiled3D, values: Vars, t: number, step: number | undefined, palette: { grid: string; axis: string; faint: string; soft: string; bg: string }) {
  const b = scene.bounds(values, t), frame = worldFrame(b, scene.equal), prims = scene.primitives(values, t, step);
  const az = scene.camera.azimuth * Math.PI / 180, el = scene.camera.elevation * Math.PI / 180;
  const ext = Math.hypot(...frame.half) || 1, s = Math.min(pen.w, pen.h) * 0.46 / ext * scene.camera.zoom;
  const cx = pen.w / 2, cy = pen.h / 2 + 8;
  const project = (p: Vec): [number, number, number] => {
    const w = frame.toWorld(p), x1 = w[0] * Math.cos(az) + w[1] * Math.sin(az), y1 = -w[0] * Math.sin(az) + w[1] * Math.cos(az);
    // The camera sits at (0, −D·cos el, D·sin el) in the azimuth-rotated frame (see cameraPosition).
    const depth = y1 * Math.cos(el) - w[2] * Math.sin(el), up = y1 * Math.sin(el) + w[2] * Math.cos(el);
    return [cx + x1 * s, cy - up * s, depth];
  };
  const P2 = (p: Vec): P => { const q = project(p); return [q[0], q[1]]; };
  const st = (p: Base, extra: Style = {}): Style => ({ stroke: p.color, width: 1.6, alpha: p.opacity * p.dim, ...extra });

  if (scene.axes) {
    const [x0, x1] = b.x, [y0, y1] = b.y, [z0, z1] = b.z;
    for (let i = 0; i <= 4; i++) {
      const fx = x0 + (x1 - x0) * i / 4, fy = y0 + (y1 - y0) * i / 4;
      pen.path([P2([fx, y0, z0]), P2([fx, y1, z0])], { stroke: palette.grid, width: 1 });
      pen.path([P2([x0, fy, z0]), P2([x1, fy, z0])], { stroke: palette.grid, width: 1 });
    }
    pen.path([P2([x0, y0, z0]), P2([x1, y0, z0])], { stroke: palette.axis, width: 1.4 });
    pen.path([P2([x0, y0, z0]), P2([x0, y1, z0])], { stroke: palette.axis, width: 1.4 });
    pen.path([P2([x0, y0, z0]), P2([x0, y0, z1])], { stroke: palette.axis, width: 1.4 });
    const tag = (p: Vec, text: string) => { const q = P2(p); pen.text(q[0], q[1], text, { size: 11, color: palette.faint, align: 'middle' }); };
    tag([x1, y0, z0], `${scene.labels.x || 'x'} ${fmt(x1)}`); tag([x0, y1, z0], `${scene.labels.y || 'y'} ${fmt(y1)}`); tag([x0, y0, z1], `${scene.labels.z || 'z'} ${fmt(z1)}`);
  }
  // Painter's order: farther primitives first.
  const depthOf = (p: Prim) => p.k === 'mesh' ? project([p.pos[Math.floor(p.pos.length / 6) * 3], p.pos[Math.floor(p.pos.length / 6) * 3 + 1], p.pos[Math.floor(p.pos.length / 6) * 3 + 2]])[2]
    : p.k === 'line' || p.k === 'poly' ? project(p.pts[Math.floor(p.pts.length / 2)] || [0, 0, 0])[2] : p.k === 'arrow' ? project(p.from)[2] : p.k === 'sphere' || p.k === 'box' ? project(p.c)[2] : p.k === 'cyl' ? project([(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2])[2] : p.k === 'glyph' ? project(p.p)[2] - 1e-3 : project(p.p)[2];
  const order = prims.map((p, i) => ({ p, i, d: p.k === 'text' ? -Infinity : depthOf(p) })).sort((a, b2) => b2.d - a.d || a.i - b2.i);
  for (const { p } of order) {
    if (p.k === 'mesh') {
      const step2 = Math.max(1, Math.round(p.rows / 16));
      for (let i = 0; i < p.rows; i += step2) { const row: P[] = []; for (let j = 0; j < p.cols; j++) { const k = (i * p.cols + j) * 3; row.push(P2([p.pos[k], p.pos[k + 1], p.pos[k + 2]])); } pen.path(row, st(p, { width: 1, alpha: 0.75 * p.dim })); }
      for (let j = 0; j < p.cols; j += step2) { const col: P[] = []; for (let i = 0; i < p.rows; i++) { const k = (i * p.cols + j) * 3; col.push(P2([p.pos[k], p.pos[k + 1], p.pos[k + 2]])); } pen.path(col, st(p, { width: 1, alpha: 0.75 * p.dim })); }
    } else if (p.k === 'line') pen.path(p.pts.map(P2), st(p, { width: p.width, dash: p.dash ? [5, 6] : undefined }));
    else if (p.k === 'poly') { const pts = p.pts.map(P2); pen.path(pts, { fill: p.color, alpha: 0.2 * p.dim }, true); pen.path(pts, st(p), true); }
    else if (p.k === 'point') { const q = P2(p.p); pen.circle(q[0], q[1], p.size * 2.1, { fill: p.color, alpha: 0.14 * p.dim }); pen.circle(q[0], q[1], p.size, { fill: p.color, alpha: p.dim }); }
    else if (p.k === 'arrow') {
      const a = P2(p.from), z2 = P2(p.to), len = Math.hypot(z2[0] - a[0], z2[1] - a[1]);
      if (len >= 1) { const ux = (z2[0] - a[0]) / len, uy = (z2[1] - a[1]) / len, h = Math.min(9, len * 0.5); pen.path([a, [z2[0] - ux * h * 0.7, z2[1] - uy * h * 0.7]], st(p, { width: 2 })); pen.path([z2, [z2[0] - ux * h - uy * h * 0.5, z2[1] - uy * h + ux * h * 0.5], [z2[0] - ux * h + uy * h * 0.5, z2[1] - uy * h - ux * h * 0.5]], { fill: p.color, alpha: p.opacity * p.dim }, true); }
    } else if (p.k === 'sphere') {
      const q = P2(p.c), r = Math.max(2, p.r * Math.max(...frame.scale) * s * (scene.equal ? 1 : 0.8));
      pen.circle(q[0], q[1], r, { fill: p.color, alpha: 0.85 * p.opacity * p.dim }); pen.circle(q[0] - r * 0.3, q[1] - r * 0.3, r * 0.35, { fill: '#ffffff', alpha: 0.18 * p.dim });
    } else if (p.k === 'box') {
      const [x, y, zc] = p.c, [w, d, h] = p.s.map(v => v / 2), cn = (i: number, j: number, k: number): P => P2([x + i * w, y + j * d, zc + k * h]);
      for (const [a1, a2] of [[[-1, -1, -1], [1, -1, -1]], [[1, -1, -1], [1, 1, -1]], [[1, 1, -1], [-1, 1, -1]], [[-1, 1, -1], [-1, -1, -1]], [[-1, -1, 1], [1, -1, 1]], [[1, -1, 1], [1, 1, 1]], [[1, 1, 1], [-1, 1, 1]], [[-1, 1, 1], [-1, -1, 1]], [[-1, -1, -1], [-1, -1, 1]], [[1, -1, -1], [1, -1, 1]], [[1, 1, -1], [1, 1, 1]], [[-1, 1, -1], [-1, 1, 1]]] as const) pen.path([cn(a1[0], a1[1], a1[2]), cn(a2[0], a2[1], a2[2])], st(p, { alpha: p.dim }));
      pen.path([cn(-1, -1, 1), cn(1, -1, 1), cn(1, 1, 1), cn(-1, 1, 1)], { fill: p.color, alpha: 0.18 * p.dim }, true);
    } else if (p.k === 'cyl') {
      const d: Vec = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]], len = Math.hypot(...d) || 1, u = d.map(x => x / len) as Vec;
      const e1n: Vec = Math.abs(u[2]) < 0.9 ? [-u[1], u[0], 0] : [0, -u[2], u[1]], e1l = Math.hypot(...e1n) || 1, e1 = e1n.map(x => x / e1l) as Vec, e2: Vec = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
      const ring = (c0: Vec, r: number) => Array.from({ length: 25 }, (_, i) => { const a = Math.PI * 2 * i / 24; return P2([c0[0] + r * (Math.cos(a) * e1[0] + Math.sin(a) * e2[0]), c0[1] + r * (Math.cos(a) * e1[1] + Math.sin(a) * e2[1]), c0[2] + r * (Math.cos(a) * e1[2] + Math.sin(a) * e2[2])]); });
      if (p.r < 0.12 && !p.cone) pen.path([P2(p.a), P2(p.b)], st(p, { width: 3, alpha: p.dim }));
      else { const bottom = ring(p.a, p.r), top = p.cone ? [P2(p.b)] : ring(p.b, p.r); pen.path(bottom, st(p, { alpha: p.dim }), true); if (!p.cone) pen.path(top, { fill: p.color, alpha: 0.2 * p.dim }, true); for (const i of [0, 6, 12, 18]) pen.path([bottom[i], top[p.cone ? 0 : i]], st(p, { alpha: p.dim })); }
    } else if (p.k === 'text') { const q = P2(p.p); pen.text(q[0] + 6, q[1] - 6, p.text, { size: p.size, color: p.color, alpha: p.dim }); }
    else if (p.k === 'glyph') {
      // Only signs on the side facing the camera are printed.
      const e = 1e-3, near = project([p.p[0] + p.n[0] * e, p.p[1] + p.n[1] * e, p.p[2] + p.n[2] * e])[2] < project(p.p)[2];
      if (!near) continue;
      const q = P2(p.p), a = P2([p.p[0] + p.t[0] * p.size, p.p[1] + p.t[1] * p.size, p.p[2] + p.t[2] * p.size]), dx = a[0] - q[0], dy = a[1] - q[1], k = Math.max(3, Math.hypot(dx, dy)) / (Math.hypot(dx, dy) || 1);
      pen.path([[q[0] - dx * k, q[1] - dy * k], [q[0] + dx * k, q[1] + dy * k]], { stroke: p.color, width: 1.8, alpha: p.dim });
      if (p.sign > 0) pen.path([[q[0] + dy * k, q[1] - dx * k], [q[0] - dy * k, q[1] + dx * k]], { stroke: p.color, width: 1.8, alpha: p.dim });
    }
  }
}
