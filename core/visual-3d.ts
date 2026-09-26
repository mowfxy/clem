import { z } from 'zod';
import { safeEval, type Compiled, type Vars } from './expr.ts';
import type { P, Pen, Style } from './visual-spec.ts';

/** Model-authored 3D scenes. Like the 2D visuals, a spec only *describes* objects: every coordinate is a checked
 *  expression, compiled once and evaluated per frame into plain primitives in data coordinates. The Three.js view
 *  (src/visuals/Spec3D.tsx) and the projected drawing used for SVG, PDF and thumbnails both draw those primitives. */

export type Vec = [number, number, number];
type Base = { color: string; opacity: number; dim: number };
export type Prim =
  | Base & { k: 'mesh'; rows: number; cols: number; pos: Float32Array; colormap: boolean; wire: boolean }
  | Base & { k: 'line'; pts: Vec[]; width: number; dash: boolean }
  | Base & { k: 'point'; p: Vec; size: number }
  | Base & { k: 'arrow'; from: Vec; to: Vec }
  | Base & { k: 'sphere'; c: Vec; r: number }
  | Base & { k: 'box'; c: Vec; s: Vec }
  | Base & { k: 'cyl'; a: Vec; b: Vec; r: number; cone: boolean }
  | Base & { k: 'poly'; pts: Vec[] }
  | Base & { k: 'text'; p: Vec; text: string; size: number };

/* ── Schema ── */
const num = z.union([z.number(), z.string().max(600)]);
const text = (max = 80) => z.string().trim().max(max);
const color = z.string().max(20).optional();
const range = z.tuple([num, num]);
const common = { id: z.string().max(40).optional(), color, label: text(40).optional(), opacity: z.number().min(0.05).max(1).optional() };
const atom = z.object({ el: z.string().regex(/^[A-Z][a-z]?$/), x: z.number(), y: z.number(), z: z.number(), label: text(20).optional() });
export const object3dSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('surface'), expr: z.string().max(600), x: range.optional(), y: range.optional(), colormap: z.boolean().optional(), wireframe: z.boolean().optional(), resolution: z.number().int().min(8).max(90).optional(), ...common }),
  z.object({ type: z.literal('parametricSurface'), x: z.string().max(600), y: z.string().max(600), z: z.string().max(600), u: range, v: range, colormap: z.boolean().optional(), wireframe: z.boolean().optional(), resolution: z.number().int().min(8).max(90).optional(), ...common }),
  z.object({ type: z.literal('curve'), x: num, y: num, z: num, from: num, to: num, width: z.number().min(0.5).max(6).optional(), dash: z.boolean().optional(), ...common }),
  z.object({ type: z.literal('point'), x: num, y: num, z: num, size: z.number().min(1).max(14).optional(), ...common }),
  z.object({ type: z.literal('vector'), x: num, y: num, z: num, dx: num, dy: num, dz: num, ...common }),
  z.object({ type: z.literal('segment'), x1: num, y1: num, z1: num, x2: num, y2: num, z2: num, dash: z.boolean().optional(), ...common }),
  z.object({ type: z.literal('sphere'), x: num, y: num, z: num, r: num, ...common }),
  z.object({ type: z.literal('box'), x: num, y: num, z: num, w: num, d: num, h: num, ...common }),
  z.object({ type: z.enum(['cylinder', 'cone']), x: num, y: num, z: num, r: num, h: num, axis: z.enum(['x', 'y', 'z']).optional(), ...common }),
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
  const E = (f: Compiled, v: Vars) => safeEval(f, v);
  const V3 = (f: readonly [Compiled, Compiled, Compiled], v: Vars): Vec => [E(f[0], v), E(f[1], v), E(f[2], v)];
  const fin = (p: Vec) => p.every(Number.isFinite);

  type Build = (v: Vars, b: Bounds, out: Prim[], base: Base) => void;
  const builds: { id?: string; build: Build; base: (dim: number) => Base; label?: string }[] = objects.map((o): { id?: string; build: Build; base: (dim: number) => Base; label?: string } => {
    const shaded = o.type === 'surface' || o.type === 'parametricSurface' || o.type === 'curve' || o.type === 'field';
    const col = tone(o.color, shaded ? palette[auto++ % palette.length] : o.type === 'point' || o.type === 'vector' ? 'coral' : 'soft');
    const op = 'opacity' in o && o.opacity !== undefined ? o.opacity : o.type === 'surface' || o.type === 'parametricSurface' ? (marked ? 0.62 : 0.92) : o.type === 'box' || o.type === 'cylinder' || o.type === 'cone' || o.type === 'polygon' ? 0.55 : 1;
    const base = (dim: number): Base => ({ color: col, opacity: op, dim });
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
        return { id, base, label, build: (v, _b, out, bs) => { const p = V3(f, v), rr = E(r, v); if (!fin(p) || !(rr > 0)) return; out.push({ ...bs, k: 'sphere', c: p, r: rr }); if (label) out.push({ ...bs, k: 'text', p: [p[0], p[1], p[2] + rr], text: label, size: 12, opacity: 1 }); } };
      }
      case 'box': {
        const f = [c(o.x), c(o.y), c(o.z)] as const, s = [c(o.w), c(o.d), c(o.h)] as const;
        return { id, base, label, build: (v, _b, out, bs) => { const p = V3(f, v), sz = V3(s, v); if (!fin(p) || !fin(sz)) return; out.push({ ...bs, k: 'box', c: p, s: sz.map(Math.abs) as Vec }); if (label) out.push({ ...bs, k: 'text', p: [p[0], p[1], p[2] + Math.abs(sz[2]) / 2], text: label, size: 12, opacity: 1 }); } };
      }
      case 'cylinder': case 'cone': {
        const f = [c(o.x), c(o.y), c(o.z)] as const, r = c(o.r), h = c(o.h), axis = o.axis ?? 'z';
        return { id, base, label, build: (v, _b, out, bs) => {
          const p = V3(f, v), rr = E(r, v), hh = E(h, v);
          if (!fin(p) || !(rr > 0) || !Number.isFinite(hh)) return;
          const top: Vec = [p[0] + (axis === 'x' ? hh : 0), p[1] + (axis === 'y' ? hh : 0), p[2] + (axis === 'z' ? hh : 0)];
          out.push({ ...bs, k: 'cyl', a: p, b: top, r: rr, cone: o.type === 'cone' });
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
  // Axes the spec leaves open are measured once from the scene at its starting values, so the camera does not jump.
  const measured = (() => {
    const start = fromAxes({ ...defaults, t: 0 }), guess: Bounds = { x: start.x ?? [-5, 5], y: start.y ?? [-5, 5], z: start.z ?? [-5, 5] };
    if (start.x && start.y && start.z) return guess;
    const out: Prim[] = [];
    for (const b of builds) try { b.build({ ...defaults, t: 0 }, guess, out, b.base(1)); } catch { /* skip */ }
    const lo: Vec = [Infinity, Infinity, Infinity], hi: Vec = [-Infinity, -Infinity, -Infinity];
    const add = (p: Vec, pad = 0) => { for (let i = 0; i < 3; i++) if (Number.isFinite(p[i])) { lo[i] = Math.min(lo[i], p[i] - pad); hi[i] = Math.max(hi[i], p[i] + pad); } };
    for (const p of out) {
      if (p.k === 'mesh') for (let i = 0; i < p.pos.length; i += 3) add([p.pos[i], p.pos[i + 1], p.pos[i + 2]]);
      else if (p.k === 'line' || p.k === 'poly') p.pts.forEach(q => add(q));
      else if (p.k === 'point' || p.k === 'text') add(p.p);
      else if (p.k === 'arrow') { add(p.from); add(p.to); }
      else if (p.k === 'sphere') add(p.c, p.r);
      else if (p.k === 'box') { add([p.c[0] - p.s[0] / 2, p.c[1] - p.s[1] / 2, p.c[2] - p.s[2] / 2]); add([p.c[0] + p.s[0] / 2, p.c[1] + p.s[1] / 2, p.c[2] + p.s[2] / 2]); }
      else if (p.k === 'cyl') { add(p.a, p.r); add(p.b, p.r); }
    }
    const pick = (i: number, given?: [number, number]): [number, number] => {
      if (given) return given;
      if (!(hi[i] >= lo[i])) return [-1, 1];
      const span = hi[i] - lo[i], pad = Math.max(span * 0.08, 0.5);
      return [lo[i] - pad, hi[i] + pad];
    };
    return { x: pick(0, start.x), y: pick(1, start.y), z: pick(2, start.z) } as Bounds;
  })();
  const anyAxis = !!(axX || axY || axZ), onlyShapes = objects.every(o => ['molecule', 'sphere', 'box', 'cylinder', 'cone', 'text', 'polygon'].includes(o.type));

  return {
    equal: spec.equal ?? (!anyAxis || onlyShapes),
    axes: spec.axes ?? !objects.every(o => o.type === 'molecule' || o.type === 'text'),
    labels: { x: spec.x?.label, y: spec.y?.label, z: spec.z?.label },
    camera: { azimuth: spec.camera?.azimuth ?? 38, elevation: spec.camera?.elevation ?? 24, zoom: spec.camera?.zoom ?? 1 },
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
    : p.k === 'line' || p.k === 'poly' ? project(p.pts[Math.floor(p.pts.length / 2)] || [0, 0, 0])[2] : p.k === 'arrow' ? project(p.from)[2] : p.k === 'sphere' || p.k === 'box' ? project(p.c)[2] : p.k === 'cyl' ? project([(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2])[2] : project(p.p)[2];
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
  }
}
