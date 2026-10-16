import { z } from 'zod';
import { compile, numeric, safeEval, type Compiled, type Vars } from './expr.ts';
import { camera3dSchema, compile3d, drawProjected, object3dSchema, type Compiled3D } from './visual-3d.ts';
import { compileFigure, figureIdPattern, figureItemTypes, type CompiledFigure } from './illustration.ts';
const figureItemSchema = z.object({ type: z.enum(figureItemTypes), id: z.string().regex(figureIdPattern, 'ids start with a letter and use letters, digits, _ or -').optional() }).passthrough();
const figureSpan = z.tuple([z.union([z.number(), z.string().max(200)]), z.union([z.number(), z.string().max(200)])]);
const figureViewSchema = z.object({ x: figureSpan.optional(), y: figureSpan.optional() });

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
  z.object({ type: z.literal('polar'), r: z.string().max(600), from: num.optional(), to: num.optional(), color, label: text(40).optional(), dash: z.boolean().optional(), width: z.number().min(0.5).max(5).optional() }),
  z.object({ type: z.literal('field'), dx: z.string().max(600), dy: z.string().max(600), density: z.number().int().min(6).max(32).optional(), color, label: text(40).optional() }),
  z.object({ type: z.literal('implicit'), expr: z.string().max(600), levels: z.array(num).min(1).max(12).optional(), color, label: text(40).optional(), dash: z.boolean().optional() }),
  z.object({ type: z.literal('points'), points: z.array(z.tuple([num, num])).min(1).max(400), color, label: text(40).optional(), size: z.number().min(1).max(10).optional(), line: z.boolean().optional() }),
]);
const axis = z.object({ min: num, max: num, label: text(40).optional() });
const node = z.object({ id: z.string().max(40), label: text(60), x: z.number().min(0).max(100).optional(), y: z.number().min(0).max(100).optional(), shape: z.enum(['box', 'pill', 'circle']).optional(), color, detail: text(160).optional() });
const edge = z.object({ from: z.string().max(40), to: z.string().max(40), label: text(40).optional(), dashed: z.boolean().optional(), flow: z.boolean().optional() });
export const visualSpecSchema = z.object({
  kind: z.enum(['plot', 'diagram', 'chart', '3d', 'figure']),
  title: text(80).min(1),
  subject: text(40).optional(),
  caption: text(240).optional(),
  equation: text(160).optional(),
  params: z.array(param).max(6).optional(),
  animate: z.object({ duration: z.number().min(0.5).max(120), loop: z.boolean().optional() }).optional(),
  readouts: z.array(z.object({ label: text(40), expr: z.string().max(600), unit: text(12).optional(), digits: z.number().int().min(0).max(6).optional() })).max(6).optional(),
  x: axis.optional(), y: axis.optional(), z: axis.optional(), grid: z.boolean().optional(), equal: z.boolean().optional(),
  objects: z.array(object3dSchema).max(60).optional(), camera: camera3dSchema.optional(), autoRotate: z.boolean().optional(), axes: z.boolean().optional(),
  layers: z.array(layer).max(40).optional(),
  items: z.array(figureItemSchema).max(150).optional(), view: figureViewSchema.optional(),
  nodes: z.array(node).max(24).optional(), edges: z.array(edge).max(40).optional(), direction: z.enum(['right', 'down']).optional(),
  steps: z.array(z.object({ title: text(80), text: text(400).optional(), focus: z.array(z.string().max(40)).max(24).optional() })).max(12).optional(),
  chart: z.object({ type: z.enum(['bar', 'line', 'area', 'pie']), labels: z.array(text(30)).min(1).max(24), series: z.array(z.object({ name: text(40), values: z.array(num).max(24), color })).min(1).max(5), yLabel: text(40).optional(), xLabel: text(40).optional(), unit: text(12).optional() }).optional(),
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
  /** Present for kind "3d": the scene the Three.js view draws; `draw` is its projected still. */
  scene3d?: Compiled3D;
  /** Present for kind "figure": a textbook illustration drawn as SVG (core/illustration.ts); `draw` is unused for it. */
  figure?: CompiledFigure;
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
  let scene3d: Compiled3D | undefined;
  let figure: CompiledFigure | undefined;

  if (spec.kind === 'figure') {
    if (!spec.items?.length) throw Error('A figure needs "items" (see the textbook figure recipes).');
    const ids = new Set(spec.items.map(i => i.id).filter(Boolean));
    for (const s of spec.steps || []) for (const f of s.focus || []) if (!ids.has(f)) throw Error(`A step highlights an unknown item “${f}”.`);
    figure = compileFigure({ items: spec.items, view: spec.view }, params.map(p => p.key), Object.fromEntries(params.map(p => [p.key, p.value])));
    if (figure.usesTime) hasFlow = true;
    draw = () => { /* drawn as SVG by the figure */ };
  } else if (spec.kind === '3d') {
    const scene = compile3d(spec, c, (value, fallback) => tone(value, fallback as Tone), Object.fromEntries(params.map(p => [p.key, p.value])));
    scene3d = scene;
    draw = (pen, values, t, step) => drawProjected(pen, scene, values, t, step, palette);
  } else if (spec.kind === 'plot') {
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
        case 'polar': return { l, r: c(l.r, ['theta', 's']), from: l.from !== undefined ? c(l.from) : null, to: l.to !== undefined ? c(l.to) : null };
        case 'field': return { l, dx: c(l.dx, ['x', 'y']), dy: c(l.dy, ['x', 'y']) };
        case 'implicit': return { l, f: c(l.expr, ['x', 'y']), levels: (l.levels || [0]).map(v2 => c(v2)) };
        case 'points': return { l, pts: l.points.map(([x, y]) => [c(x), c(y)] as const) };
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
      // Tick loops are capped: on a narrow range far from zero (2e18 to 2e18+1024) the step is below the
      // numbers' precision, so `x += step` never moves and an uncapped loop would freeze the page.
      for (let i = 0, x = Math.ceil(x0 / stepX) * stepX; i < 100 && x <= x1 + stepX * 1e-6; i++, x += stepX) {
        if (spec.grid !== false) pen.path([[X(x), b.t], [X(x), b.b]], { stroke: palette.grid, width: 1 });
        pen.text(X(x), b.b + 18, fmt(x, dX), { size: 10.5, color: palette.faint, align: 'middle' });
      }
      for (let i = 0, y = Math.ceil(y0 / stepY) * stepY; i < 100 && y <= y1 + stepY * 1e-6; i++, y += stepY) {
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
      // Curve labels are placed once every curve is drawn, clear of the ink and of each other: a label never sits on a
      // line or on another label. Ink is kept as a set of 4 px cells the strokes pass through.
      const inkCells = new Set<number>(), cell = (x: number, y: number) => Math.floor(x / 4) * 4096 + Math.floor(y / 4);
      const mark = (x: number, y: number) => inkCells.add(cell(x, y));
      const plotPen = pen;
      pen = {
        w: plotPen.w, h: plotPen.h,
        path(points, s, closed) {
          if (s.stroke) for (let k = 1; k < points.length + (closed ? 1 : 0); k++) {
            const [ax2, ay2] = points[k - 1], [bx, by] = points[k % points.length], steps = Math.max(1, Math.ceil(Math.hypot(bx - ax2, by - ay2) / 3));
            for (let m = 0; m <= steps; m++) mark(ax2 + (bx - ax2) * m / steps, ay2 + (by - ay2) * m / steps);
          }
          plotPen.path(points, s, closed);
        },
        circle(x, y, r, s) { for (let dx = -r; dx <= r; dx += 3) for (let dy = -r; dy <= r; dy += 3) if (dx * dx + dy * dy <= r * r) mark(x + dx, y + dy); plotPen.circle(x, y, r, s); },
        text: (x, y, value, s) => plotPen.text(x, y, value, s),
      };
      type Box = [number, number, number, number];
      const placed: Box[] = [], pending: { label: string; anchors: P[]; col: string; along: boolean }[] = [];
      const offsets: [number, number, 'start' | 'end' | 'middle'][] = [[8, -8, 'start'], [8, 17, 'start'], [-8, -8, 'end'], [-8, 17, 'end'], [0, -12, 'middle'], [0, 24, 'middle'], [8, -24, 'start'], [-8, -24, 'end'], [8, 33, 'start'], [-8, 33, 'end']];
      const boxAt = (label: string, px: number, py: number, [dx, dy, align]: typeof offsets[number]) => {
        const w = textWidth(label, 12), x = px + dx, y = py + dy, left = align === 'start' ? x : align === 'end' ? x - w : x - w / 2;
        return { x, y, align, box: [left, y - 12, left + w, y + 4] as Box };
      };
      const fits = (box: Box) => box[0] >= b.l + 2 && box[2] <= b.r - 2 && box[1] >= b.t + 2 && box[3] <= b.b - 2;
      const onLabel = (box: Box) => placed.some(p => Math.min(p[2], box[2]) > Math.max(p[0], box[0]) - 4 && Math.min(p[3], box[3]) > Math.max(p[1], box[1]) - 4);
      const inked = (box: Box) => { let n = 0; for (let x = box[0] - 2; x <= box[2] + 2; x += 4) for (let y = box[1] - 2; y <= box[3] + 2; y += 4) if (inkCells.has(cell(x, y))) n++; return n; };
      const tag = (label: string | undefined, px: number, py: number, col: string) => { if (label) pending.push({ label, anchors: [[px, py]], col, along: false }); };
      /** A label that may sit near any of several points of its curve (its end, or anywhere along a contour). */
      const tagNear = (label: string | undefined, anchors: P[], col: string, along = false) => { if (label && anchors.length) pending.push({ label, anchors, col, along }); };
      const placeLabels = () => {
        for (const p of [...pending.filter(q => !q.along), ...pending.filter(q => q.along)]) {
          let best: ReturnType<typeof boxAt> | undefined, score = -Infinity;
          p.anchors.forEach(([px, py], i) => offsets.forEach((o, k) => {
            const at = boxAt(p.label, px, py, o);
            if (!fits(at.box) || onLabel(at.box)) return;
            const cx = (at.box[0] + at.box[2]) / 2, cy = (at.box[1] + at.box[3]) / 2;
            // Clear of ink first; then near its own point (an end label) or far from the other labels (a contour's).
            const room = Math.min(300, ...placed.map(q => Math.hypot(cx - (q[0] + q[2]) / 2, cy - (q[1] + q[3]) / 2)));
            const sc = -inked(at.box) * 1000 + (p.along ? room : -i * 2 - k);
            if (sc > score) { score = sc; best = at; }
          }));
          if (!best) { const [px, py] = p.anchors[0]; best = boxAt(p.label, Math.min(Math.max(px, b.l + 10), b.r - 10), Math.min(Math.max(py, b.t + 20), b.b - 10), offsets[0]); }
          placed.push(best.box);
          plotPen.text(best.x, best.y, p.label, { size: 12, color: p.col, align: best.align });
        }
      };
      for (const item of layers) {
        const l = item.l, col = tone(l.color, l.type === 'function' || l.type === 'parametric' || l.type === 'polar' || l.type === 'implicit' || l.type === 'points' ? series[legend % series.length] as Tone : 'ink');
        if (item.l.type === 'function' && 'f' in item && item.f) {
          legend++;
          const fl = item as { f: Compiled; from: Compiled | null; to: Compiled | null; l: Extract<typeof l, { type: 'function' }> };
          const a = Math.max(x0, fl.from ? safeEval(fl.from, v) : x0), z1 = Math.min(x1, fl.to ? safeEval(fl.to, v) : x1);
          let run: P[] = [], last: P | null = null;
          const ends: P[] = [];
          const flush = () => { if (run.length > 1) pen.path(run, { stroke: col, width: fl.l.width ?? 2.2, dash: fl.l.dash ? [5, 6] : undefined }); run = []; };
          // A curve that leaves the plot stops at the frame (cut where it crosses), never runs along it.
          let prev: P | null = null;
          const within = (y: number) => y >= b.t && y <= b.b;
          const cut = (p: P, q: P): P => { const edge = within(p[1]) ? (q[1] < b.t ? b.t : b.b) : (p[1] < b.t ? b.t : b.b), f = (edge - p[1]) / (q[1] - p[1]); return [p[0] + (q[0] - p[0]) * f, edge]; };
          for (let i = 0; i <= 400; i++) {
            const x = a + (z1 - a) * i / 400, y = safeEval(fl.f, { ...v, x });
            if (!Number.isFinite(y) || !inside(Y(y))) { flush(); prev = null; continue; }
            const pt: P = [X(x), Y(y)];
            if (run.length && Math.abs(pt[1] - run[run.length - 1][1]) > (b.b - b.t) * 0.9) { flush(); prev = null; }
            if (within(pt[1])) {
              if (!run.length && prev && !within(prev[1])) run.push(cut(prev, pt));
              run.push(pt); ends.push(pt); last = pt;
            } else if (run.length && prev) { run.push(cut(prev, pt)); flush(); }
            prev = pt;
          }
          flush();
          if (last) tagNear(fl.l.label, ends.slice().reverse().filter((_, k) => k % 4 === 0), col);
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
        } else if (l.type === 'polar') {
          legend++;
          const pl = item as { r: Compiled; from: Compiled | null; to: Compiled | null };
          const a = pl.from ? safeEval(pl.from, v) : 0, z1 = pl.to ? safeEval(pl.to, v) : Math.PI * 2, pts: P[] = [];
          for (let i = 0; i <= 720 && Number.isFinite(a) && Number.isFinite(z1); i++) {
            const th = a + (z1 - a) * i / 720, r = safeEval(pl.r, { ...v, theta: th, s: th }), x = r * Math.cos(th), y = r * Math.sin(th);
            if (Number.isFinite(x) && Number.isFinite(y) && inside(Y(y))) pts.push([X(x), clipY(Y(y))]);
          }
          pen.path(pts, { stroke: col, width: l.width ?? 2.2, dash: l.dash ? [5, 6] : undefined });
          if (pts.length) tag(l.label, pts[Math.floor(pts.length * 0.12)][0], pts[Math.floor(pts.length * 0.12)][1], col);
        } else if (l.type === 'field') {
          // Arrows on a grid; length and brightness follow the magnitude, so strong and weak regions read at a glance.
          const fl = item as { dx: Compiled; dy: Compiled }, n = l.density ?? 16, cols = n, rows = Math.max(4, Math.round(n * (b.b - b.t) / (b.r - b.l)));
          const cw = (b.r - b.l) / cols, ch = (b.b - b.t) / rows, cells: [number, number, number, number, number][] = [];
          let most = 0;
          for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
            const px = b.l + cw * (i + 0.5), py = b.t + ch * (j + 0.5), x = x0 + (px - b.l) / sx, y = y0 + (b.b - py) / sy;
            const dx = safeEval(fl.dx, { ...v, x, y }), dy = safeEval(fl.dy, { ...v, x, y }), m = Math.hypot(dx * sx, dy * sy);
            if (Number.isFinite(m) && m > 1e-12) { cells.push([px, py, dx * sx / m, -dy * sy / m, m]); most = Math.max(most, m); }
          }
          const cc = tone(l.color, 'blue'), size = Math.min(cw, ch) * 0.82;
          for (const [px, py, ux, uy, m] of cells) { const k = 0.35 + 0.65 * Math.min(1, m / most), len = size * k; arrow(pen, px - ux * len / 2, py - uy * len / 2, px + ux * len / 2, py + uy * len / 2, { stroke: cc, width: 1.4, alpha: 0.35 + 0.65 * k }, 6.5); }
          if (l.label) pen.text(b.r - 6, b.t + 14, l.label, { size: 12, color: cc, align: 'end' });
        } else if (l.type === 'implicit') {
          // Marching squares: every level of f(x, y) becomes a contour line.
          legend++;
          const il = item as { f: Compiled; levels: Compiled[] }, nx = 160, ny = Math.max(40, Math.round(nx * (b.b - b.t) / (b.r - b.l))), grid = new Float64Array((nx + 1) * (ny + 1));
          for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) grid[j * (nx + 1) + i] = safeEval(il.f, { ...v, x: x0 + (x1 - x0) * i / nx, y: y0 + (y1 - y0) * j / ny });
          const px = (i: number) => b.l + (b.r - b.l) * i / nx, py = (j: number) => b.b - (b.b - b.t) * j / ny;
          il.levels.forEach((lv, li) => {
            const level = safeEval(lv, v);
            if (!Number.isFinite(level)) return;
            const cc = il.levels.length > 1 ? tone(l.color, series[li % series.length] as Tone) : col;
            const along: P[] = [];
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
              const a = grid[j * (nx + 1) + i] - level, b2 = grid[j * (nx + 1) + i + 1] - level, c2 = grid[(j + 1) * (nx + 1) + i + 1] - level, d = grid[(j + 1) * (nx + 1) + i] - level;
              if (![a, b2, c2, d].every(Number.isFinite)) continue;
              const cross: P[] = [];
              const edge = (p: number, q: number, e: (f: number) => P) => { if ((p < 0) !== (q < 0)) cross.push(e(p / (p - q))); };
              edge(a, b2, f => [px(i + f), py(j)]); edge(b2, c2, f => [px(i + 1), py(j + f)]); edge(c2, d, f => [px(i + 1 - f), py(j + 1)]); edge(d, a, f => [px(i), py(j + 1 - f)]);
              // A jump of sign across a pole (1/x) is not a contour.
              if (cross.length >= 2 && Math.max(Math.abs(a), Math.abs(b2), Math.abs(c2), Math.abs(d)) < 1e6) {
                // The curve is drawn in pieces a cell long, so a dash pattern would restart on each and print solid:
                // a dashed curve keeps the pieces on alternate squares of a 7 px checkerboard instead, in any direction.
                const on = (p: P, q: P) => !l.dash || (Math.floor((p[0] + q[0]) / 14) + Math.floor((p[1] + q[1]) / 14)) % 2 === 0;
                // The gaps of a dashed curve still count as ink, so no label is placed across the line.
                const piece = (p: P, q: P) => { if (on(p, q)) pen.path([p, q], { stroke: cc, width: 2 }); else { mark(p[0], p[1]); mark((p[0] + q[0]) / 2, (p[1] + q[1]) / 2); mark(q[0], q[1]); } };
                piece(cross[0], cross[1]);
                if (cross.length === 4) piece(cross[2], cross[3]);
                if ((i + j) % 3 === 0) along.push(cross[0]);
              }
            }
            if (l.label) tagNear(il.levels.length > 1 ? `${l.label} = ${fmt(level, Math.abs(level) < 10 ? 2 : 0).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace(/^-/, '−')}` : l.label, along, cc, true);
          });
        } else if (l.type === 'points') {
          legend++;
          const gl = item as { pts: (readonly [Compiled, Compiled])[] }, pts = gl.pts.map(([a, bb]) => [safeEval(a, v), safeEval(bb, v)]).filter(p => p.every(Number.isFinite)).map(([a, bb]) => [X(a), Y(bb)] as P).filter(p => inside(p[1]));
          if (l.line) pen.path(pts, { stroke: col, width: 1.8 });
          for (const p of pts) { pen.circle(p[0], p[1], (l.size ?? 4) + 2.5, { fill: col, alpha: 0.14 }); pen.circle(p[0], p[1], l.size ?? 4, { fill: col, alpha: 0.95 }); }
          if (l.label && pts.length) tag(l.label, pts[pts.length - 1][0], pts[pts.length - 1][1], col);
        } else if (l.type === 'text') {
          const tl = item as { x: Compiled; y: Compiled }, px = safeEval(tl.x, v), py = safeEval(tl.y, v);
          if (Number.isFinite(px) && Number.isFinite(py)) { const size = l.size ?? 12.5; placed.push([X(px), Y(py) - size, X(px) + textWidth(l.text, size), Y(py) + 4]); pen.text(X(px), Y(py), l.text, { size, color: tone(l.color, 'soft') }); }
        }
      }
      placeLabels();
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
    const routes = routeEdges(layout, edges);
    draw = (pen, _values, t, step) => {
      const focus = step !== undefined && spec.steps?.[step]?.focus ? new Set(spec.steps[step].focus) : null;
      const dim = (id: string) => (focus && !focus.has(id) ? 0.32 : 1);
      edges.forEach((e, i) => {
        const { points, at } = routes[i], alpha = Math.min(dim(e.from), dim(e.to));
        const hot = focus && focus.has(e.from) && focus.has(e.to);
        const style = { stroke: hot ? palette.ink : palette.soft, width: hot ? 1.8 : 1.4, dash: e.dashed ? [5, 5] : undefined, alpha: alpha * (hot ? 1 : 0.8) };
        // A curved edge is drawn as a line up to its last stretch, which carries the arrowhead.
        const tail = Math.max(0, points.length - 4);
        if (tail > 0) pen.path(points.slice(0, tail + 1), { ...style, fill: undefined });
        arrow(pen, points[tail][0], points[tail][1], points[points.length - 1][0], points[points.length - 1][1], style, 8);
        if (e.flow && alpha === 1) {
          for (const k of [0, 0.5]) { const f = ((t * 0.45 + k + i * 0.137) % 1 + 1) % 1; const [x, y] = at(f); pen.circle(x, y, 7, { fill: palette.coral, alpha: 0.14 }); pen.circle(x, y, 3.2, { fill: palette.coral }); }
        }
        if (e.label) {
          const [mx, my] = at(0.5), w = textWidth(e.label, 11) + 12;
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
      if (chart.type === 'pie') {
        // A donut of the first series: slices grow in clockwise from the top, with a legend of values and shares.
        const vals = data[0].map(x => (Number.isFinite(x) ? Math.max(0, x) : 0)), sum = vals.reduce((a, x) => a + x, 0) || 1;
        const cx = W * 0.33, cy = H / 2 + 4, R = 150, r0 = 84, colors = ['blue', 'coral', 'green', 'amber', 'violet', 'soft'] as Tone[];
        let a = -Math.PI / 2;
        vals.forEach((x, i) => {
          const sweep = Math.PI * 2 * x / sum * ease, pts: P[] = [], steps2 = Math.max(2, Math.ceil(sweep / 0.04));
          for (let k = 0; k <= steps2; k++) { const q = a + sweep * k / steps2; pts.push([cx + R * Math.cos(q), cy + R * Math.sin(q)]); }
          for (let k = steps2; k >= 0; k--) { const q = a + sweep * k / steps2; pts.push([cx + r0 * Math.cos(q), cy + r0 * Math.sin(q)]); }
          if (sweep > 0.001) pen.path(pts, { fill: palette[colors[i % colors.length]], alpha: i < colors.length ? 0.92 : 0.6, stroke: palette.bg, width: 2 }, true);
          a += sweep;
        });
        pen.text(cx, cy - 2, fmt(sum, sum < 10 && sum !== Math.round(sum) ? 2 : 0) + (chart.unit ? ' ' + chart.unit : ''), { size: 20, color: palette.ink, align: 'middle', weight: 500 });
        pen.text(cx, cy + 18, chart.series[0].name, { size: 11.5, color: palette.faint, align: 'middle' });
        const rowH = Math.min(30, (H - 60) / Math.max(1, vals.length)), top = cy - rowH * vals.length / 2 + rowH / 2;
        vals.forEach((x, i) => {
          const y = top + rowH * i, lx = W * 0.62;
          pen.circle(lx, y - 4, 5, { fill: palette[colors[i % colors.length]] });
          pen.text(lx + 14, y, chart.labels[i] ?? '', { size: 12.5, color: palette.ink });
          pen.text(W - 30, y, `${fmt(x, x < 10 && x !== Math.round(x) ? 2 : 0)}  ·  ${(x / sum * 100).toFixed(x / sum < 0.1 ? 1 : 0)}%`, { size: 12, color: palette.soft, align: 'end' });
        });
        return;
      }
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
          if (chart.type === 'area' && pts.length > 1) { const run = pts.slice(0, shown); pen.path([...run, [run[run.length - 1][0], Y(0)], [run[0][0], Y(0)]], { fill: col, alpha: 0.16 }, true); }
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
    draw, scene3d, figure,
    readouts(values, t) { return readouts.map(r => { const v = safeEval(r.fn, { ...values, t }); return [r.label, `${fmt(v, r.digits ?? 2)}${r.unit ? ' ' + r.unit : ''}`]; }); },
    describe() { return `${spec.title}. ${spec.caption || ''}`.trim(); },
  };
}

type Box = { x: number; y: number; w: number; h: number; r: number; lines: string[]; shape: 'box' | 'pill' | 'circle' };
export type DiagramBox = Box;
function circlePoints(x: number, y: number, r: number): P[] { return Array.from({ length: 49 }, (_, i) => { const a = Math.PI * 2 * i / 48; return [x + r * Math.cos(a), y + r * Math.sin(a)] as P; }); }
/** Where a line from the middle of `from` towards `to` leaves its outline. */
function cut(from: Box, to: P): P {
  const dx = to[0] - from.x, dy = to[1] - from.y, len = Math.hypot(dx, dy) || 1;
  if (from.shape === 'circle') return [from.x + dx / len * (from.r + 3), from.y + dy / len * (from.r + 3)];
  const sx = Math.abs(dx) > 1e-9 ? (from.w / 2 + 4) / Math.abs(dx) : Infinity, sy = Math.abs(dy) > 1e-9 ? (from.h / 2 + 4) / Math.abs(dy) : Infinity, s = Math.min(sx, sy);
  return [from.x + dx * s, from.y + dy * s];
}
/** Whether the segment p→q passes through a box (with a small margin), tested by sampling along it. */
function crosses(p: P, q: P, box: Box) {
  const hw = (box.shape === 'circle' ? box.r : box.w / 2) + 6, hh = (box.shape === 'circle' ? box.r : box.h / 2) + 6;
  for (let k = 1; k < 24; k++) { const x = p[0] + (q[0] - p[0]) * k / 24, y = p[1] + (q[1] - p[1]) * k / 24; if (Math.abs(x - box.x) < hw && Math.abs(y - box.y) < hh) return true; }
  return false;
}
export type EdgeRoute = { points: P[]; at: (f: number) => P };
/** Each edge's path. Straight when nothing is in the way; an edge that would run through another node, or that has
 *  a twin going the other way, bows to one side (forward edges one way, back edges the other) so every edge shows. */
export function routeEdges(layout: Map<string, DiagramBox>, edges: { from: string; to: string }[]): EdgeRoute[] {
  const pairs = new Set(edges.map(e => JSON.stringify([e.from, e.to])));
  return edges.map(e => {
    const a = layout.get(e.from)!, b = layout.get(e.to)!;
    const blocked = [...layout].some(([id, box]) => id !== e.from && id !== e.to && crosses([a.x, a.y], [b.x, b.y], box));
    const twin = pairs.has(JSON.stringify([e.to, e.from]));
    if (!blocked && !twin) {
      const p1 = cut(a, [b.x, b.y]), p2 = cut(b, [a.x, a.y]);
      return { points: [p1, p2], at: (f: number): P => [p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f] };
    }
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bend = blocked ? Math.max(64, Math.min(150, len * 0.3)) : 26;
    const c: P = [(a.x + b.x) / 2 - dy / len * bend, (a.y + b.y) / 2 + dx / len * bend];
    const p1 = cut(a, c), p2 = cut(b, c);
    const at = (f: number): P => { const u = 1 - f; return [u * u * p1[0] + 2 * u * f * c[0] + f * f * p2[0], u * u * p1[1] + 2 * u * f * c[1] + f * f * p2[1]]; };
    return { points: Array.from({ length: 29 }, (_, k) => at(k / 28)), at };
  });
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
