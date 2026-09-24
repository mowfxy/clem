import { z } from 'zod';
import { compile, numeric, safeEval, type Compiled, type Vars } from './expr.ts';

/** Model-authored visuals. A model describes *what* to draw in a small JSON language;
 *  Mowr validates it, compiles every expression safely and draws it with the same pen
 *  as the built-in models. No code from the model ever runs. */

/* ── Drawing surface, shared with src/visuals/pen.ts ── */
export type P = [number, number];
export type Style = { stroke?: string; fill?: string; width?: number; dash?: number[]; alpha?: number };
export type TextStyle = { size?: number; color?: string; align?: 'start' | 'middle' | 'end'; serif?: boolean; weight?: number; alpha?: number };
export interface Pen { readonly w: number; readonly h: number; path(points: P[], style: Style, closed?: boolean): void; circle(x: number, y: number, r: number, style: Style): void; text(x: number, y: number, value: string, style?: TextStyle): void }
export const W = 800, H = 440;
export const palette = { bg: '#161615', panel: '#1d1d1b', grid: '#242422', axis: '#4a4a45', ink: '#f0efeb', soft: '#a3a3a0', faint: '#6f6e68', blue: '#8197e2', coral: '#d87968', green: '#8fbf98', amber: '#d9b36c', violet: '#b49ddb' };
const tones = ['ink', 'blue', 'coral', 'green', 'amber', 'violet', 'soft'] as const;
type Tone = typeof tones[number];
const tone = (value: unknown, fallback: Tone = 'ink') => palette[(tones as readonly string[]).includes(value as string) ? value as Tone : fallback];
const series = ['blue', 'coral', 'green', 'amber', 'violet'] as const;

/* ── Schema ── */
const num = z.union([z.number(), z.string().max(600)]);
const text = (max = 80) => z.string().trim().max(max);
const color = z.string().max(20).optional();
const param = z.object({ key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,23}$/), label: text(40), min: z.number(), max: z.number(), step: z.number().positive().optional(), value: z.number(), unit: text(12).optional() });
const layer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('function'), expr: z.string().max(600), color, label: text(40).optional(), dash: z.boolean().optional(), width: z.number().min(0.5).max(5).optional(), from: num.optional(), to: num.optional() }),
  z.object({ type: z.literal('parametric'), x: z.string().max(600), y: z.string().max(600), from: num, to: num, color, label: text(40).optional(), dash: z.boolean().optional(), width: z.number().min(0.5).max(5).optional() }),
  z.object({ type: z.literal('area'), expr: z.string().max(600), from: num, to: num, base: num.optional(), color, label: text(40).optional() }),
  z.object({ type: z.literal('point'), x: num, y: num, color, label: text(40).optional(), size: z.number().min(1).max(14).optional() }),
  z.object({ type: z.literal('vector'), x: num, y: num, dx: num, dy: num, color, label: text(40).optional() }),
  z.object({ type: z.literal('segment'), x1: num, y1: num, x2: num, y2: num, color, dash: z.boolean().optional(), label: text(40).optional() }),
  z.object({ type: z.literal('circle'), x: num, y: num, r: num, color, fill: z.boolean().optional() }),
  z.object({ type: z.literal('polygon'), points: z.array(z.tuple([num, num])).min(2).max(60), color, fill: z.boolean().optional(), closed: z.boolean().optional() }),
  z.object({ type: z.literal('text'), x: num, y: num, text: text(120), color, size: z.number().min(8).max(26).optional() }),
]);
const axis = z.object({ min: num, max: num, label: text(40).optional() });
const node = z.object({ id: z.string().max(40), label: text(60), x: z.number().min(0).max(100).optional(), y: z.number().min(0).max(100).optional(), shape: z.enum(['box', 'pill', 'circle']).optional(), color, detail: text(160).optional() });
const edge = z.object({ from: z.string().max(40), to: z.string().max(40), label: text(40).optional(), dashed: z.boolean().optional(), flow: z.boolean().optional() });
export const visualSpecSchema = z.object({
  kind: z.enum(['plot', 'diagram', 'chart']),
  title: text(80).min(1),
  subject: text(40).optional(),
  caption: text(240).optional(),
  equation: text(160).optional(),
  params: z.array(param).max(6).optional(),
  animate: z.object({ duration: z.number().min(0.5).max(120), loop: z.boolean().optional() }).optional(),
  readouts: z.array(z.object({ label: text(40), expr: z.string().max(600), unit: text(12).optional(), digits: z.number().int().min(0).max(6).optional() })).max(6).optional(),
  x: axis.optional(), y: axis.optional(), grid: z.boolean().optional(), equal: z.boolean().optional(),
  layers: z.array(layer).max(40).optional(),
  nodes: z.array(node).max(24).optional(), edges: z.array(edge).max(40).optional(), direction: z.enum(['right', 'down']).optional(),
  steps: z.array(z.object({ title: text(80), text: text(400).optional(), focus: z.array(z.string().max(40)).max(24).optional() })).max(12).optional(),
  chart: z.object({ type: z.enum(['bar', 'line']), labels: z.array(text(30)).min(1).max(24), series: z.array(z.object({ name: text(40), values: z.array(num).max(24), color })).min(1).max(5), yLabel: text(40).optional(), xLabel: text(40).optional(), unit: text(12).optional() }).optional(),
});
export type VisualSpec = z.infer<typeof visualSpecSchema>;

export type SpecParam = { key: string; label: string; min: number; max: number; step: number; unit: string; value: number };
export type CompiledVisual = {
  spec: VisualSpec;
  params: SpecParam[];
  /** Loop length in seconds; Infinity when the picture does not move. */
  period: number;
  moving: boolean;
  steps: NonNullable<VisualSpec['steps']>;
  draw(pen: Pen, values: Vars, t: number, step?: number): void;
  readouts(values: Vars, t: number): [string, string][];
  describe(): string;
};

const fmt = (v: number, digits = 2) => !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e6 || (Math.abs(v) > 0 && Math.abs(v) < 1e-3) ? v.toExponential(Math.max(1, digits)) : (Math.abs(v) < 1e-9 ? 0 : v).toFixed(digits);
function niceStep(span: number, ticks = 6) { const raw = Math.abs(span) / ticks || 1, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag; }
function arrow(pen: Pen, x1: number, y1: number, x2: number, y2: number, style: Style, head = 9) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len, size = Math.min(head, len * 0.6);
  pen.path([[x1, y1], [x2 - ux * size * 0.7, y2 - uy * size * 0.7]], { ...style, fill: undefined });
  pen.path([[x2, y2], [x2 - ux * size - uy * size * 0.5, y2 - uy * size + ux * size * 0.5], [x2 - ux * size + uy * size * 0.5, y2 - uy * size - ux * size * 0.5]], { fill: style.stroke, alpha: style.alpha }, true);
}
function roundRect(x: number, y: number, w: number, h: number, r: number): P[] {
  r = Math.min(r, w / 2, h / 2);
  const pts: P[] = [], corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 6; i++) { const a = a0 + (Math.PI / 2) * i / 6; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return pts;
}
/** Wraps a label into at most `lines` lines of roughly `width` characters. */
export function wrap(label: string, width = 18, lines = 2) {
  const words = label.split(/\s+/), out: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word; else if ((line + ' ' + word).length <= width) line += ' ' + word; else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  if (out.length > lines) { const kept = out.slice(0, lines); kept[lines - 1] = kept[lines - 1].replace(/.{0,1}$/, '…'); return kept; }
  return out;
}
const textWidth = (s: string, size: number) => s.length * size * 0.56;

/** Validate and compile a spec. Throws an Error with a short, human reason. */
export function compileVisual(raw: unknown): CompiledVisual {
  const parsed = visualSpecSchema.safeParse(raw);
  if (!parsed.success) { const issue = parsed.error.issues[0]; throw Error(`The visual description is incomplete (${issue.path.join('.') || 'root'}: ${issue.message}).`); }
  const spec = parsed.data;
  const params: SpecParam[] = (spec.params || []).map(p => {
    const min = Math.min(p.min, p.max), max = Math.max(p.min, p.max);
    return { key: p.key, label: p.label, min, max, step: p.step && p.step <= max - min ? p.step : niceStep(max - min, 100), unit: p.unit || '', value: Math.max(min, Math.min(max, p.value)) };
  });
  if (new Set(params.map(p => p.key)).size !== params.length) throw Error('Two sliders share the same name.');
  const base = [...params.map(p => p.key), 't'];
  const exprs: Compiled[] = [];
  const c = (v: number | string, extra: string[] = []) => { let f: Compiled; try { f = numeric(v, [...base, ...extra]); } catch (e) { throw Error(`A formula in the visual could not be read: ${(e as Error).message} in “${String(v).slice(0, 60)}”.`); } exprs.push(f); return f; };
  const readouts = (spec.readouts || []).map(r => ({ ...r, fn: c(r.expr) }));
  let draw: CompiledVisual['draw'];
  let hasFlow = false;

  if (spec.kind === 'plot') {
    if (!spec.x || !spec.y) throw Error('A plot needs x and y ranges.');
    const xmin = c(spec.x.min), xmax = c(spec.x.max), ymin = c(spec.y.min), ymax = c(spec.y.max);
    const layers = (spec.layers || []).map(l => {
      switch (l.type) {
        case 'function': return { l, f: c(l.expr, ['x']), from: l.from !== undefined ? c(l.from) : null, to: l.to !== undefined ? c(l.to) : null };
        case 'parametric': return { l, fx: c(l.x, ['s']), fy: c(l.y, ['s']), from: c(l.from), to: c(l.to) };
        case 'area': return { l, f: c(l.expr, ['x']), from: c(l.from), to: c(l.to), base: l.base !== undefined ? c(l.base, ['x']) : null };
        case 'point': return { l, x: c(l.x), y: c(l.y) };
        case 'vector': return { l, x: c(l.x), y: c(l.y), dx: c(l.dx), dy: c(l.dy) };
        case 'segment': return { l, x1: c(l.x1), y1: c(l.y1), x2: c(l.x2), y2: c(l.y2) };
        case 'circle': return { l, x: c(l.x), y: c(l.y), r: c(l.r) };
        case 'polygon': return { l, pts: l.points.map(([x, y]) => [c(x), c(y)] as const) };
        case 'text': return { l, x: c(l.x), y: c(l.y) };
      }
    });
    draw = (pen, values, t) => {
      const v = { ...values, t };
      let x0 = safeEval(xmin, v), x1 = safeEval(xmax, v), y0 = safeEval(ymin, v), y1 = safeEval(ymax, v);
      if (!(x1 > x0)) [x0, x1] = [Math.min(x0, x1) || 0, Math.max(x0, x1) || 1];
      if (!(y1 > y0)) [y0, y1] = [Math.min(y0, y1) || 0, Math.max(y0, y1) || 1];
      if (!(x1 > x0)) x1 = x0 + 1;
      if (!(y1 > y0)) y1 = y0 + 1;
      const b = { l: 66, r: W - 26, t: 30, b: H - 50 };
      let sx = (b.r - b.l) / (x1 - x0), sy = (b.b - b.t) / (y1 - y0);
      if (spec.equal) { const s = Math.min(sx, sy); b.r = b.l + s * (x1 - x0); b.t = b.b - s * (y1 - y0); sx = sy = s; const dx = (W - 26 - b.r) / 2; b.l += dx; b.r += dx; }
      const X = (x: number) => b.l + (x - x0) * sx, Y = (y: number) => b.b - (y - y0) * sy;
      const inside = (y: number) => y > b.t - 400 && y < b.b + 400;
      // Grid and axes
      const stepX = niceStep(x1 - x0, 8), stepY = niceStep(y1 - y0, 6), dX = Math.max(0, -Math.floor(Math.log10(stepX))), dY = Math.max(0, -Math.floor(Math.log10(stepY)));
      for (let x = Math.ceil(x0 / stepX) * stepX; x <= x1 + stepX * 1e-6; x += stepX) {
        if (spec.grid !== false) pen.path([[X(x), b.t], [X(x), b.b]], { stroke: palette.grid, width: 1 });
        pen.text(X(x), b.b + 18, fmt(x, dX), { size: 10.5, color: palette.faint, align: 'middle' });
      }
      for (let y = Math.ceil(y0 / stepY) * stepY; y <= y1 + stepY * 1e-6; y += stepY) {
        if (spec.grid !== false) pen.path([[b.l, Y(y)], [b.r, Y(y)]], { stroke: palette.grid, width: 1 });
        pen.text(b.l - 9, Y(y) + 4, fmt(y, dY), { size: 10.5, color: palette.faint, align: 'end' });
      }
      const ax = x0 <= 0 && x1 >= 0 ? X(0) : b.l, ay = y0 <= 0 && y1 >= 0 ? Y(0) : b.b;
      pen.path([[b.l, ay], [b.r, ay]], { stroke: palette.axis, width: 1.4 });
      pen.path([[ax, b.t], [ax, b.b]], { stroke: palette.axis, width: 1.4 });
      if (spec.x?.label) pen.text(b.r, b.b + 38, spec.x.label, { size: 11, color: palette.faint, align: 'end' });
      if (spec.y?.label) pen.text(b.l - 9, b.t - 14, spec.y.label, { size: 11, color: palette.faint });
      const clipY = (y: number) => Math.max(b.t - 2, Math.min(b.b + 2, y));
      let legend = 0;
      const tag = (label: string | undefined, px: number, py: number, col: string) => { if (label) pen.text(Math.min(px + 8, b.r - 4), Math.max(b.t + 12, Math.min(b.b - 6, py - 8)), label, { size: 12, color: col, align: px + 8 > b.r - 60 ? 'end' : 'start' }); };
      for (const item of layers) {
        const l = item.l, col = tone(l.color, l.type === 'function' || l.type === 'parametric' ? series[legend % series.length] as Tone : 'ink');
        if (item.l.type === 'function' && 'f' in item && item.f) {
          legend++;
          const fl = item as { f: Compiled; from: Compiled | null; to: Compiled | null; l: Extract<typeof l, { type: 'function' }> };
          const a = Math.max(x0, fl.from ? safeEval(fl.from, v) : x0), z1 = Math.min(x1, fl.to ? safeEval(fl.to, v) : x1);
          let run: P[] = [], last: P | null = null;
          const flush = () => { if (run.length > 1) pen.path(run, { stroke: col, width: fl.l.width ?? 2.2, dash: fl.l.dash ? [5, 6] : undefined }); run = []; };
          for (let i = 0; i <= 400; i++) {
            const x = a + (z1 - a) * i / 400, y = safeEval(fl.f, { ...v, x });
            if (!Number.isFinite(y) || !inside(Y(y))) { flush(); continue; }
            const pt: P = [X(x), clipY(Y(y))];
            if (run.length && Math.abs(pt[1] - run[run.length - 1][1]) > (b.b - b.t) * 0.9) flush();
            run.push(pt); last = pt;
          }
          flush();
          if (last) tag(fl.l.label, last[0], last[1], col);
        } else if (l.type === 'parametric') {
          legend++;
          const pl = item as { fx: Compiled; fy: Compiled; from: Compiled; to: Compiled };
          const a = safeEval(pl.from, v), z1 = safeEval(pl.to, v), pts: P[] = [];
          for (let i = 0; i <= 400 && Number.isFinite(a) && Number.isFinite(z1); i++) {
            const s = a + (z1 - a) * i / 400, x = safeEval(pl.fx, { ...v, s }), y = safeEval(pl.fy, { ...v, s });
            if (Number.isFinite(x) && Number.isFinite(y) && inside(Y(y))) pts.push([X(x), clipY(Y(y))]);
          }
          pen.path(pts, { stroke: col, width: l.width ?? 2.2, dash: l.dash ? [5, 6] : undefined });
          if (pts.length) tag(l.label, pts[pts.length - 1][0], pts[pts.length - 1][1], col);
        } else if (l.type === 'area') {
          const al = item as { f: Compiled; from: Compiled; to: Compiled; base: Compiled | null };
          const a = Math.max(x0, safeEval(al.from, v)), z1 = Math.min(x1, safeEval(al.to, v));
          if (Number.isFinite(a) && Number.isFinite(z1) && z1 > a) {
            const top: P[] = [], bottom: P[] = [];
            for (let i = 0; i <= 200; i++) {
              const x = a + (z1 - a) * i / 200, y = safeEval(al.f, { ...v, x }), y2 = al.base ? safeEval(al.base, { ...v, x }) : 0;
              if (Number.isFinite(y) && Number.isFinite(y2)) { top.push([X(x), clipY(Y(y))]); bottom.unshift([X(x), clipY(Y(y2))]); }
            }
            pen.path([...top, ...bottom], { fill: tone(l.color, 'blue'), alpha: 0.18 }, true);
            if (l.label && top.length) pen.text((top[0][0] + top[top.length - 1][0]) / 2, (top[Math.floor(top.length / 2)][1] + bottom[Math.floor(bottom.length / 2)][1]) / 2, l.label, { size: 12, color: tone(l.color, 'blue'), align: 'middle' });
          }
        } else if (l.type === 'point') {
          const pl = item as { x: Compiled; y: Compiled }, px = safeEval(pl.x, v), py = safeEval(pl.y, v);
          if (Number.isFinite(px) && Number.isFinite(py)) {
            const r = l.size ?? 6, cc = tone(l.color, 'coral');
            pen.circle(X(px), Y(py), r * 2.2, { fill: cc, alpha: 0.13 }); pen.circle(X(px), Y(py), r, { fill: cc });
            tag(l.label, X(px) + 4, Y(py), cc);
          }
        } else if (l.type === 'vector') {
          const vl = item as { x: Compiled; y: Compiled; dx: Compiled; dy: Compiled }, px = safeEval(vl.x, v), py = safeEval(vl.y, v), dx = safeEval(vl.dx, v), dy = safeEval(vl.dy, v);
          if ([px, py, dx, dy].every(Number.isFinite)) { const cc = tone(l.color, 'blue'); arrow(pen, X(px), Y(py), X(px + dx), Y(py + dy), { stroke: cc, width: 2.2 }, 10); if (l.label) pen.text(X(px + dx) + 7, Y(py + dy) - 4, l.label, { size: 13, color: cc, serif: true }); }
        } else if (l.type === 'segment') {
          const sl = item as { x1: Compiled; y1: Compiled; x2: Compiled; y2: Compiled }, a = [safeEval(sl.x1, v), safeEval(sl.y1, v), safeEval(sl.x2, v), safeEval(sl.y2, v)];
          if (a.every(Number.isFinite)) { const cc = tone(l.color, 'soft'); pen.path([[X(a[0]), Y(a[1])], [X(a[2]), Y(a[3])]], { stroke: cc, width: 1.5, dash: l.dash ? [4, 5] : undefined }); if (l.label) pen.text((X(a[0]) + X(a[2])) / 2 + 6, (Y(a[1]) + Y(a[3])) / 2 - 6, l.label, { size: 11.5, color: cc }); }
        } else if (l.type === 'circle') {
          const cl = item as { x: Compiled; y: Compiled; r: Compiled }, px = safeEval(cl.x, v), py = safeEval(cl.y, v), r = safeEval(cl.r, v);
          if ([px, py, r].every(Number.isFinite)) { const cc = tone(l.color, 'soft'), pts: P[] = []; for (let i = 0; i <= 90; i++) { const a = Math.PI * 2 * i / 90; pts.push([X(px + r * Math.cos(a)), Y(py + r * Math.sin(a))]); } pen.path(pts, l.fill ? { fill: cc, alpha: 0.2 } : { stroke: cc, width: 1.6 }, true); }
        } else if (l.type === 'polygon') {
          const gl = item as { pts: (readonly [Compiled, Compiled])[] }, pts = gl.pts.map(([a, bb]) => [X(safeEval(a, v)), Y(safeEval(bb, v))] as P).filter(p => p.every(Number.isFinite));
          const cc = tone(l.color, 'soft');
          if (l.fill) pen.path(pts, { fill: cc, alpha: 0.18 }, true);
          pen.path(pts, { stroke: cc, width: 1.6 }, l.closed ?? !!l.fill);
        } else if (l.type === 'text') {
          const tl = item as { x: Compiled; y: Compiled }, px = safeEval(tl.x, v), py = safeEval(tl.y, v);
          if (Number.isFinite(px) && Number.isFinite(py)) pen.text(X(px), Y(py), l.text, { size: l.size ?? 12.5, color: tone(l.color, 'soft') });
        }
      }
    };
  } else if (spec.kind === 'diagram') {
    const nodes = spec.nodes || [];
    if (!nodes.length) throw Error('A diagram needs at least one node.');
    const ids = new Set(nodes.map(n => n.id));
    if (ids.size !== nodes.length) throw Error('Two diagram nodes share an id.');
    const edges = (spec.edges || []).filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
    hasFlow = edges.some(e => e.flow);
    for (const s of spec.steps || []) for (const f of s.focus || []) if (!ids.has(f)) throw Error(`A step highlights an unknown node “${f}”.`);
    const layout = layoutDiagram(nodes, edges, spec.direction || 'right');
    draw = (pen, _values, t, step) => {
      const focus = step !== undefined && spec.steps?.[step]?.focus ? new Set(spec.steps[step].focus) : null;
      const dim = (id: string) => (focus && !focus.has(id) ? 0.32 : 1);
      edges.forEach((e, i) => {
        const a = layout.get(e.from)!, b = layout.get(e.to)!;
        const [p1, p2] = clipEdge(a, b), alpha = Math.min(dim(e.from), dim(e.to));
        const hot = focus && focus.has(e.from) && focus.has(e.to);
        arrow(pen, p1[0], p1[1], p2[0], p2[1], { stroke: hot ? palette.ink : palette.soft, width: hot ? 1.8 : 1.4, dash: e.dashed ? [5, 5] : undefined, alpha: alpha * (hot ? 1 : 0.8) }, 8);
        if (e.flow && alpha === 1) {
          for (const k of [0, 0.5]) { const f = ((t * 0.45 + k + i * 0.137) % 1 + 1) % 1; const x = p1[0] + (p2[0] - p1[0]) * f, y = p1[1] + (p2[1] - p1[1]) * f; pen.circle(x, y, 7, { fill: palette.coral, alpha: 0.14 }); pen.circle(x, y, 3.2, { fill: palette.coral }); }
        }
        if (e.label) {
          const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2, w = textWidth(e.label, 11) + 12;
          pen.path(roundRect(mx - w / 2, my - 10, w, 19, 6), { fill: palette.bg, alpha: 0.92 * alpha }, true);
          pen.text(mx, my + 4, e.label, { size: 11, color: palette.soft, align: 'middle', alpha });
        }
      });
      for (const n of nodes) {
        const box = layout.get(n.id)!, alpha = dim(n.id), hot = focus?.has(n.id), accent = n.color ? tone(n.color, 'ink') : null;
        const outline = n.shape === 'circle' ? circlePoints(box.x, box.y, box.r) : roundRect(box.x - box.w / 2, box.y - box.h / 2, box.w, box.h, n.shape === 'pill' ? box.h / 2 : 11);
        pen.path(outline, { fill: hot ? '#262624' : palette.panel, alpha }, true);
        pen.path(outline, { stroke: hot ? palette.ink : accent || palette.axis, width: hot ? 1.8 : 1.3, alpha }, true);
        const lines = box.lines, size = 12.5, top = box.y - (lines.length - 1) * 8 + 4;
        lines.forEach((line, i) => pen.text(box.x, top + i * 16, line, { size, color: hot || !focus ? palette.ink : palette.soft, align: 'middle', alpha, weight: 500 }));
      }
    };
  } else {
    const chart = spec.chart;
    if (!chart) throw Error('A chart needs labels and series.');
    const values = chart.series.map(s => ({ ...s, fns: chart.labels.map((_, i) => (s.values[i] !== undefined ? c(s.values[i]) : null)) }));
    draw = (pen, vals, t) => {
      const v = { ...vals, t }, grow = Math.min(1, t / 0.7), ease = 1 - Math.pow(1 - grow, 3);
      const data = values.map(s => s.fns.map(f => (f ? safeEval(f, v) : NaN)));
      const flat = data.flat().filter(Number.isFinite);
      let lo = Math.min(0, ...flat), hi = Math.max(0, ...flat);
      if (hi === lo) hi = lo + 1;
      const step = niceStep(hi - lo, 5); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
      const b = { l: 70, r: W - 24, t: chart.series.length > 1 ? 44 : 28, b: H - 58 }, Y = (y: number) => b.b - (y - lo) / (hi - lo) * (b.b - b.t);
      const d = Math.max(0, -Math.floor(Math.log10(step)));
      for (let y = lo; y <= hi + step * 1e-6; y += step) { pen.path([[b.l, Y(y)], [b.r, Y(y)]], { stroke: palette.grid, width: 1 }); pen.text(b.l - 10, Y(y) + 4, fmt(y, d), { size: 10.5, color: palette.faint, align: 'end' }); }
      pen.path([[b.l, Y(0)], [b.r, Y(0)]], { stroke: palette.axis, width: 1.4 });
      const n = chart.labels.length, slot = (b.r - b.l) / n;
      chart.labels.forEach((label, i) => pen.text(b.l + slot * (i + 0.5), b.b + 20, label.length > Math.max(4, slot / 6.2) ? label.slice(0, Math.max(3, Math.floor(slot / 6.2) - 1)) + '…' : label, { size: 11, color: palette.soft, align: 'middle' }));
      if (chart.yLabel) pen.text(b.l - 10, b.t - 14, chart.yLabel + (chart.unit ? ` (${chart.unit})` : ''), { size: 11, color: palette.faint });
      if (chart.xLabel) pen.text(b.r, b.b + 44, chart.xLabel, { size: 11, color: palette.faint, align: 'end' });
      if (chart.series.length > 1) { let lx = b.r; for (let s = chart.series.length - 1; s >= 0; s--) { const name = chart.series[s].name, w = textWidth(name, 11.5) + 22; lx -= w; pen.circle(lx + 5, 17, 4.5, { fill: tone(chart.series[s].color, series[s % series.length]) }); pen.text(lx + 14, 21, name, { size: 11.5, color: palette.soft }); } }
      if (chart.type === 'bar') {
        const group = slot * 0.72, bw = group / chart.series.length;
        data.forEach((row, s) => row.forEach((y, i) => {
          if (!Number.isFinite(y)) return;
          const x = b.l + slot * i + (slot - group) / 2 + bw * s, top = Y(0 + (y - 0) * ease), base = Y(0);
          pen.path(roundRect(x + 2, Math.min(top, base), Math.max(1, bw - 4), Math.max(1, Math.abs(base - top)), Math.min(5, (bw - 4) / 2)), { fill: tone(chart.series[s].color, series[s % series.length]), alpha: 0.9 }, true);
          if (chart.series.length === 1 && n <= 12 && grow === 1) pen.text(x + bw / 2, Math.min(top, base) - 7, fmt(y, Math.abs(y) < 10 && y !== Math.round(y) ? 2 : 0), { size: 11, color: palette.soft, align: 'middle' });
        }));
      } else {
        data.forEach((row, s) => {
          const col = tone(chart.series[s].color, series[s % series.length]), pts: P[] = [];
          row.forEach((y, i) => { if (Number.isFinite(y)) pts.push([b.l + slot * (i + 0.5), Y(y)]); });
          const shown = Math.max(2, Math.ceil(pts.length * ease));
          pen.path(pts.slice(0, shown), { stroke: col, width: 2.2 });
          pts.slice(0, shown).forEach(p => pen.circle(p[0], p[1], 3.4, { fill: col }));
        });
      }
    };
  }

  const usesTime = exprs.some(f => f.names.includes('t')) || hasFlow;
  // Timed specs loop over their duration; open-ended motion (waves, flows) runs continuously.
  const period = spec.animate ? spec.animate.duration : Infinity;
  return {
    spec, params, period, moving: usesTime || !!spec.animate, steps: spec.steps || [],
    draw,
    readouts(values, t) { return readouts.map(r => { const v = safeEval(r.fn, { ...values, t }); return [r.label, `${fmt(v, r.digits ?? 2)}${r.unit ? ' ' + r.unit : ''}`]; }); },
    describe() { return `${spec.title}. ${spec.caption || ''}`.trim(); },
  };
}

type Box = { x: number; y: number; w: number; h: number; r: number; lines: string[]; shape: 'box' | 'pill' | 'circle' };
function circlePoints(x: number, y: number, r: number): P[] { return Array.from({ length: 49 }, (_, i) => { const a = Math.PI * 2 * i / 48; return [x + r * Math.cos(a), y + r * Math.sin(a)] as P; }); }
function clipEdge(a: Box, b: Box): [P, P] {
  const cut = (from: Box, to: Box): P => {
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
    if (from.shape === 'circle') return [from.x + dx / len * (from.r + 3), from.y + dy / len * (from.r + 3)];
    const sx = Math.abs(dx) > 1e-9 ? (from.w / 2 + 4) / Math.abs(dx) : Infinity, sy = Math.abs(dy) > 1e-9 ? (from.h / 2 + 4) / Math.abs(dy) : Infinity, s = Math.min(sx, sy);
    return [from.x + dx * s, from.y + dy * s];
  };
  return [cut(a, b), cut(b, a)];
}
/** Places nodes: explicit 0–100 coordinates when every node has them, otherwise layered by dependency. */
function layoutDiagram(nodes: NonNullable<VisualSpec['nodes']>, edges: NonNullable<VisualSpec['edges']>, direction: 'right' | 'down') {
  const size = (n: (typeof nodes)[number]): Box => {
    const lines = wrap(n.label, n.shape === 'circle' ? 12 : 18), longest = Math.max(...lines.map(l => l.length));
    const w = Math.max(88, Math.min(176, longest * 7.4 + 34)), h = lines.length > 1 ? 56 : 42;
    return { x: 0, y: 0, w, h, r: Math.max(34, Math.min(52, longest * 3.9 + 12)), lines, shape: n.shape || 'box' };
  };
  const out = new Map<string, Box>();
  const pad = { l: 40, r: 40, t: 34, b: 34 };
  if (nodes.every(n => n.x !== undefined && n.y !== undefined)) {
    for (const n of nodes) { const box = size(n); box.x = pad.l + (W - pad.l - pad.r) * n.x! / 100; box.y = pad.t + (H - pad.t - pad.b) * n.y! / 100; out.set(n.id, box); }
    return out;
  }
  // Longest-path ranks over the graph with cycle-closing (back) edges removed.
  const order = nodes.map(n => n.id), out_ = new Map(order.map(id => [id, [] as string[]])), incoming = new Map(order.map(id => [id, 0]));
  for (const e of edges) { out_.get(e.from)!.push(e.to); incoming.set(e.to, incoming.get(e.to)! + 1); }
  const state = new Map<string, 1 | 2>(), forward: [string, string][] = [];
  const visit = (id: string) => { state.set(id, 1); for (const to of out_.get(id)!) { if (state.get(to) === 1) continue; forward.push([id, to]); if (!state.has(to)) visit(to); } state.set(id, 2); };
  for (const id of order) if (!incoming.get(id)) if (!state.has(id)) visit(id);
  for (const id of order) if (!state.has(id)) visit(id);
  const rank = new Map(order.map(id => [id, 0]));
  for (let pass = 0; pass < order.length; pass++) { let changed = false; for (const [a, b] of forward) if (rank.get(a)! + 1 > rank.get(b)!) { rank.set(b, rank.get(a)! + 1); changed = true; } if (!changed) break; }
  const layers: string[][] = [];
  for (const id of order) (layers[rank.get(id)!] ||= []).push(id);
  const cols = layers.filter(Boolean), across = direction === 'right';
  cols.forEach((col, i) => col.forEach((id, j) => {
    const box = size(nodes.find(n => n.id === id)!);
    const main = cols.length === 1 ? 0.5 : i / (cols.length - 1), cross = (j + 0.5) / col.length;
    box.x = across ? pad.l + 60 + (W - pad.l - pad.r - 120) * main : pad.l + (W - pad.l - pad.r) * cross;
    box.y = across ? pad.t + (H - pad.t - pad.b) * cross : pad.t + 30 + (H - pad.t - pad.b - 60) * main;
    out.set(id, box);
  }));
  return out;
}

/** Extract the JSON inside a ```visual block body and compile it. */
export function parseVisual(body: string): CompiledVisual {
  let data: unknown;
  try { data = JSON.parse(body.trim()); } catch { throw Error('The visual description is not valid JSON.'); }
  return compileVisual(data);
}
export function defaultValues(v: CompiledVisual): Vars { return Object.fromEntries(v.params.map(p => [p.key, p.value])); }
export { compile };
