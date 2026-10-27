/**
 * Plots: Cartesian axes (linear or log, ticks, units, grid, a second y axis,
 * box or crossing frames), polar axes, series from expressions, parametric
 * expressions or data, shaded areas, markers, guide lines and asymptotes,
 * slope triangles, intercepts and phasors. Series and annotations name their
 * axes and may touch them. Axis styling follows Scene2D's axes (#777, grid #eee).
 *
 * Plot expressions use the data variable x (series), t (parametric) or theta
 * (polar, radians) as plain numbers; trigonometry needs an angle, so write
 * sin(x rad). An expression whose value is an angle is plotted in degrees.
 */
import { fail } from "../errors.js";
import { ANGLE, DIMLESS, evalQuantity, mapScope, qdimEqual, dimLabel } from "../expr.js";
import type { PartDefinition } from "../parts.js";
import { pointSegDist } from "../geometry.js";
import { formatLabelMarkup, formatLabelText } from "../text_metrics.js";
import type { NumLike } from "../types.js";
import {
  ABOVE_FIRST, AROUND, DEG, P, add, addSample, angleOf, arc, arcSamples, between, boolProp, circle, colorProp, definePart, dist, dot, enumProp, head,
  idProp, lengthProp, lerp, line, listProp, mul, numProp, pickOf, polar, poly, propPath, px, shape, sizeProp, strokeWidthProp, sub, text, textProp, textPx,
  unit, v, vector, angleProp,
} from "./kit.js";
import type { ElementSpec, LinkLookup, PartContext, PartInstance, Prim, Vec2 } from "./kit.js";
import { outwardCandidates, trimNum } from "./general.js";

const AXIS = "#777", GRID = "#eee", TICK_TEXT = "#333";

// --- expressions -----------------------------------------------------------------------------

/** Evaluate a plot expression in one data variable; angle results come back in degrees. */
export function plotFn(expr: unknown, varName: string, s: ElementSpec, key: string, ctx: PartContext): (x: number) => number {
  if (typeof expr !== "string" && typeof expr !== "number") fail("E_SCHEMA", [s.id], `"${key}" of "${s.id}" must be an expression in ${varName}`, { path: propPath(s, key) });
  return (x: number) => {
    const q = evalQuantity(expr as NumLike, mapScope(new Map([[varName, { value: x, dim: DIMLESS }]]), ctx.scope), propPath(s, key), [s.id]);
    if (qdimEqual(q.dim, ANGLE)) return q.value / DEG;
    if (!qdimEqual(q.dim, DIMLESS)) fail("E_UNIT_MISMATCH", [s.id], `"${key}" of "${s.id}" must give a plain number (or an angle), got ${dimLabel(q.dim)}`, { path: propPath(s, key), suggestion: "Plot values in the axis unit: divide by the unit, e.g. \"v/(1 m/s)\"." });
    return q.value;
  };
}

// --- axis model ------------------------------------------------------------------------------

interface AxisSpec { min: number; max: number; scale: "linear" | "log"; ticks: number[]; label?: string; grid: boolean; decimals?: number; minor: number[] }
interface AxesProps { w: number; h: number; x: AxisSpec; y: AxisSpec; y2?: AxisSpec; frame: "axes" | "box" | "cross"; textSize: number }

const niceStep = (span: number, target: number) => {
  const raw = span / target, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
};
export function autoTicks(min: number, max: number, scale: "linear" | "log", target = 5): number[] {
  if (scale === "log") { const out: number[] = []; for (let k = Math.ceil(Math.log10(min) - 1e-9); k <= Math.floor(Math.log10(max) + 1e-9); k++) out.push(10 ** k); return out; }
  const step = niceStep(max - min, target), out: number[] = [];
  for (let t = Math.ceil(min / step - 1e-9) * step; t <= max + step * 1e-9; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : Number(t.toPrecision(12)));
  return out;
}
export function tickText(t: number, a: AxisSpec): string {
  if (a.scale === "log") {
    const k = Math.round(Math.log10(t));
    if (Math.abs(10 ** k - t) < 1e-9 * t) return k >= 0 && k <= 3 ? String(10 ** k) : k < 0 && k >= -2 ? String(Number((10 ** k).toFixed(-k))) : formatLabelText(`10^{${k}}`, []);
    return trimNum(t, 4);
  }
  if (a.decimals !== undefined) return t.toFixed(a.decimals);
  // The fewest decimals that show every tick of the axis exactly.
  let dec = 0;
  while (dec < 6 && a.ticks.some(x => Math.abs(Number(x.toFixed(dec)) - x) > 1e-9 * Math.max(1, Math.abs(x)))) dec++;
  return t.toFixed(dec).replace(/^-0(\.0+)?$/, "0").replace("-", "−");
}

function axisProp(s: ElementSpec, key: string, ctx: PartContext, required: boolean): AxisSpec | undefined {
  const raw = s[key];
  if (raw === undefined) { if (required) fail("E_SCHEMA", [s.id], `axes "${s.id}" needs "${key}": {"min": ..., "max": ...}`, { path: propPath(s, key) }); return undefined; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("E_SCHEMA", [s.id], `"${key}" of "${s.id}" must be an object {min, max, scale?, ticks?, label?, unit?, grid?}`, { path: propPath(s, key) });
  const o = raw as Record<string, unknown>;
  const allowed = ["min", "max", "scale", "ticks", "label", "unit", "grid", "decimals", "minor"];
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail("E_SCHEMA", [s.id], `"${key}.${k}" is not an axis option of "${s.id}"`, { path: `${propPath(s, key)}.${k}`, suggestion: `Axis options: ${allowed.join(", ")}.` });
  const fake = { ...s, ...Object.fromEntries(Object.entries(o).map(([k, val]) => [`${key}_${k}`, val])) } as ElementSpec;
  const min = numProp(fake, `${key}_min`, ctx), max = numProp(fake, `${key}_max`, ctx);
  const scale = enumProp(fake, `${key}_scale`, ["linear", "log"] as const, "linear");
  if (!(max > min)) fail("E_INVALID_VALUE", [s.id], `${key}.max of "${s.id}" must exceed ${key}.min`, { path: `${propPath(s, key)}`, measured: { min, max } });
  if (scale === "log" && !(min > 0)) fail("E_INVALID_VALUE", [s.id], `A log ${key} axis of "${s.id}" needs min > 0`, { path: `${propPath(s, key)}.min`, measured: { min } });
  let ticks: number[];
  if (o.ticks === undefined || typeof o.ticks === "number") ticks = autoTicks(min, max, scale, typeof o.ticks === "number" ? o.ticks : 5);
  else if (Array.isArray(o.ticks)) ticks = o.ticks.map((t, k) => numProp({ ...s, [`t${k}`]: t } as ElementSpec, `t${k}`, ctx));
  else return fail("E_SCHEMA", [s.id], `${key}.ticks of "${s.id}" must be a count or a list of values`, { path: `${propPath(s, key)}.ticks` });
  ticks = ticks.filter(t => t >= min - 1e-12 * Math.abs(max - min) && t <= max + 1e-12 * Math.abs(max - min));
  const label = o.label === undefined ? undefined : typeof o.label === "string" && o.label !== "" ? o.label : fail("E_SCHEMA", [s.id], `${key}.label of "${s.id}" must be a non-empty string`, { path: `${propPath(s, key)}.label` });
  const unitS = o.unit === undefined ? undefined : String(o.unit);
  const minor = scale === "log" && o.minor === true ? autoTicks(min, max, "log").flatMap(d => [2, 3, 4, 5, 6, 7, 8, 9].map(m => d * m)).filter(t => t > min && t < max) : [];
  return { min, max, scale, ticks, label: label === undefined ? undefined : formatLabelMarkup(unitS ? `${label} (${unitS})` : label, [s.id]), grid: o.grid === true, decimals: o.decimals === undefined ? undefined : numProp(fake, `${key}_decimals`, ctx, { min: 0, max: 8, integer: true }), minor };
}

/** Data -> world mapping of an axes instance. */
export interface AxesMap { X(x: number): number; Y(y: number, which?: "y" | "y2"): number; inX(x: number): boolean; inY(y: number, which?: "y" | "y2"): boolean; box: { x0: number; y0: number; x1: number; y1: number }; axis(which: "x" | "y" | "y2"): AxisSpec | undefined }
export function axesMap(inst: PartInstance<AxesProps>): AxesMap {
  const p = inst.props, o = inst.origin;
  const f = (a: AxisSpec, val: number) => a.scale === "log" ? (Math.log10(val) - Math.log10(a.min)) / (Math.log10(a.max) - Math.log10(a.min)) : (val - a.min) / (a.max - a.min);
  const ax = (w: "y" | "y2") => w === "y2" ? p.y2 ?? fail("E_SCHEMA", [inst.id], `axes "${inst.id}" has no y2 axis`, { suggestion: "Add \"y2\": {\"min\": ..., \"max\": ...} to the axes." }) : p.y;
  const inR = (a: AxisSpec, val: number) => Number.isFinite(val) && (a.scale !== "log" || val > 0) && val >= a.min - 1e-9 * (a.max - a.min) && val <= a.max + 1e-9 * (a.max - a.min);
  return {
    X: x => o.x + p.w * f(p.x, x), Y: (y, w = "y") => o.y + p.h * f(ax(w), y),
    inX: x => inR(p.x, x), inY: (y, w = "y") => inR(ax(w), y),
    box: { x0: o.x, y0: o.y, x1: o.x + p.w, y1: o.y + p.h },
    axis: w => w === "x" ? p.x : w === "y" ? p.y : p.y2,
  };
}

definePart<AxesProps>({
  type: "axes", aliases: ["plot", "chartAxes"], category: "plots",
  description: "Cartesian plot axes. The origin is the bottom-left corner of the plot area (w x h world units). Each axis: {min, max, scale: linear|log, ticks: count or list, label, unit, grid, decimals, minor (log)}. Optional y2 (right axis). frame: axes (left and bottom), box, or cross (axes through data zero with arrowheads). Series, shades, points and annotations name these axes.",
  options: { w: "plot width (world)", h: "plot height (world)", x: "axis spec", y: "axis spec", y2: "optional right axis spec", frame: "axes (default) | box | cross", textSize: "tick text 11-13 (default 11)" },
  positioning: "placed",
  propKeys: ["w", "h", "x", "y", "y2", "frame", "textSize"],
  labels: false,
  props: (s, ctx) => {
    const p: AxesProps = { w: lengthProp(s, "w", ctx, { positive: true }), h: lengthProp(s, "h", ctx, { positive: true }), x: axisProp(s, "x", ctx, true)!, y: axisProp(s, "y", ctx, true)!, y2: axisProp(s, "y2", ctx, false), frame: enumProp(s, "frame", ["axes", "box", "cross"] as const, "axes"), textSize: sizeProp(s, "textSize", 11) };
    if (p.frame === "cross" && (p.x.grid || p.y.grid)) fail("E_INVALID_VALUE", [s.id], `Grid lines would cross the tick labels of a "cross" frame on "${s.id}"`, { path: propPath(s, "frame"), suggestion: "Use frame \"axes\" or \"box\" with grid, or drop the grid." });
    if (p.frame === "cross" && p.y2) fail("E_INVALID_VALUE", [s.id], `A "cross" frame on "${s.id}" cannot carry a y2 axis`, { path: propPath(s, "y2") });
    if (p.frame === "cross" && (p.x.scale === "log" || p.y.scale === "log")) fail("E_INVALID_VALUE", [s.id], `A "cross" frame on "${s.id}" needs linear axes`, { path: propPath(s, "frame") });
    return p;
  },
  anchors: ["origin", "bottomLeft", "topLeft", "topRight", "bottomRight", "center", "zero", "x(v)", "y(v)", "y2(v)"], anchorArgs: { x: "number", y: "number", y2: "number" },
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const p = i.props, m = axesMap(i), { x0, y0, x1, y1 } = m.box, sz = p.textSize;
    const prims: Prim[] = [];
    const tk = px(ctx, 4), gap = px(ctx, 3);
    const cross = p.frame === "cross";
    const xAxisY = cross ? Math.min(Math.max(m.Y(0), y0), y1) : y0, yAxisX = cross ? Math.min(Math.max(m.X(0), x0), x1) : x0;
    // Grid first, so the axes draw over it.
    if (p.x.grid) for (const t of p.x.ticks) { const X = m.X(t); if (X > x0 + 1e-9 && X < x1 - 1e-9) prims.push(line(v(X, y0), v(X, y1), GRID, 1)); }
    if (p.y.grid) for (const t of p.y.ticks) { const Y = m.Y(t); if (Y > y0 + 1e-9 && Y < y1 - 1e-9) prims.push(line(v(x0, Y), v(x1, Y), GRID, 1)); }
    if (cross) {
      const over = px(ctx, 10);
      prims.push(...arrowLine(v(x0, xAxisY), v(x1 + over, xAxisY), ctx), ...arrowLine(v(yAxisX, y0), v(yAxisX, y1 + over), ctx));
    } else {
      prims.push(line(v(x0, y0), v(x1, y0), AXIS, 1), line(v(x0, y0), v(x0, y1), AXIS, 1));
      if (p.frame === "box") prims.push(line(v(x0, y1), v(x1, y1), AXIS, 1), line(v(x1, y0), v(x1, y1), AXIS, 1));
      if (p.y2 && p.frame !== "box") prims.push(line(v(x1, y0), v(x1, y1), AXIS, 1));
    }
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const placeText = (at: Vec2, t: string, anchor: "start" | "middle" | "end", what: string) => {
      const tp = textPx(t, sz), w = px(ctx, tp.w), h = px(ctx, tp.h);
      const bx = anchor === "middle" ? { x0: at.x - w / 2, x1: at.x + w / 2 } : anchor === "start" ? { x0: at.x, x1: at.x + w } : { x0: at.x - w, x1: at.x };
      const b = { ...bx, y0: at.y - h / 2, y1: at.y + h / 2 };
      const pad = px(ctx, 1);
      if (boxes.some(o => b.x0 < o.x1 + pad && o.x0 < b.x1 + pad && b.y0 < o.y1 + pad && o.y0 < b.y1 + pad)) fail("E_INVALID_VALUE", [i.id], `Tick labels of "${i.id}" overlap (${what})`, { measured: { text: t }, suggestion: "Use fewer ticks (a smaller count or a shorter list), a wider plot, or textSize 11." });
      boxes.push(b);
      prims.push(text(at, t, sz, TICK_TEXT, anchor));
    };
    const th = px(ctx, textPx("0", sz).h);
    for (const t of p.x.ticks) {
      const X = m.X(t);
      if (cross && Math.abs(t) < 1e-12) continue;
      prims.push(line(v(X, xAxisY), v(X, xAxisY - tk), AXIS, 1));
      // x labels sit a little lower than y labels are wide apart, so the two labels at the corner never meet.
      placeText(v(X, xAxisY - tk - px(ctx, 6) - th / 2), tickText(t, p.x), "middle", "x axis");
    }
    for (const t of p.x.minor) { const X = m.X(t); prims.push(line(v(X, xAxisY), v(X, xAxisY - tk * 0.6), AXIS, 0.8)); }
    for (const t of p.y.ticks) {
      const Y = m.Y(t);
      if (cross && Math.abs(t) < 1e-12) continue;
      prims.push(line(v(yAxisX, Y), v(yAxisX - tk, Y), AXIS, 1));
      placeText(v(yAxisX - tk - gap, Y), tickText(t, p.y), "end", "y axis");
    }
    for (const t of p.y.minor) { const Y = m.Y(t); prims.push(line(v(yAxisX, Y), v(yAxisX - tk * 0.6, Y), AXIS, 0.8)); }
    if (p.y2) for (const t of p.y2.ticks) { const Y = m.Y(t, "y2"); prims.push(line(v(x1, Y), v(x1 + tk, Y), AXIS, 1)); placeText(v(x1 + tk + gap, Y), tickText(t, p.y2), "start", "y2 axis"); }
    if (cross) placeText(v(yAxisX - gap, xAxisY - gap - th / 2), "0", "end", "origin");
    // Axis titles: x centred below the tick labels (cross: at the arrow end), y and y2 above their axes.
    const lowest = boxes.length ? Math.min(y0, ...boxes.map(b => b.y0)) : y0;
    if (p.x.label) cross ? placeText(v(x1 + px(ctx, 12), xAxisY - gap - th / 2), p.x.label, "start", "x title") : placeText(v((x0 + x1) / 2, lowest - gap - th / 2), p.x.label, "middle", "x title");
    // y titles sit above the top tick label (which is centred on y1).
    const topTick = (a: AxisSpec | undefined) => a && a.ticks.some(t => Math.abs(t - a.max) <= 1e-9 * Math.abs(a.max - a.min)) ? th / 2 : 0;
    if (p.y.label) placeText(v(yAxisX, y1 + (cross ? px(ctx, 12) : topTick(p.y)) + gap + th / 2), p.y.label, cross ? "start" : "middle", "y title");
    if (p.y2?.label) placeText(v(x1, y1 + topTick(p.y2) + gap + th / 2), p.y2.label, "middle", "y2 title");
    const anchors: Record<string, Vec2> = { origin: i.origin, bottomLeft: v(x0, y0), topLeft: v(x0, y1), topRight: v(x1, y1), bottomRight: v(x1, y0), center: v((x0 + x1) / 2, (y0 + y1) / 2) };
    if (m.inX(0) && m.inY(0)) anchors.zero = v(m.X(0), m.Y(0));
    return { prims, outline: [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)], anchors, argAnchors: { x: d => m.inX(d) ? v(m.X(d), y0) : undefined, y: d => m.inY(d) ? v(x0, m.Y(d)) : undefined, y2: d => p.y2 && m.inY(d, "y2") ? v(x1, m.Y(d, "y2")) : undefined } };
  },
});
const arrowLine = (a: Vec2, b: Vec2, ctx: PartContext): Prim[] => { const u = unit(sub(b, a)); return [line(a, sub(b, mul(u, px(ctx, 3))), AXIS, 1), head(b, angleOf(u), AXIS)]; };

/** Common plumbing for parts drawn on axes: link to them, map data to world, may touch them. */
function linkAxes<T extends { axes: string; map?: AxesMap; polar?: PolarMap }>(i: PartInstance<T>, get: LinkLookup, allowPolar = false) {
  const o = get(i.props.axes);
  if (o.inst.type === "polarAxes" && allowPolar) { i.props.polar = polarMap(o.inst as PartInstance<PolarProps>); }
  else if (getTypeIs(o.inst.type, "axes")) i.props.map = axesMap(o.inst as PartInstance<AxesProps>);
  else fail("E_SCHEMA", [i.id, o.inst.id], `"${i.id}" names "${o.inst.id}" (${o.inst.type}) as its axes; it must be an axes${allowPolar ? " or polarAxes" : ""} element`, { path: propPath(i.spec, "axes") });
  i.touches = [...new Set([...(i.touches ?? []), i.props.axes])];
}
const getTypeIs = (t: string, base: string) => t === base || (base === "axes" && (t === "plot" || t === "chartAxes"));

// --- clipping --------------------------------------------------------------------------------------

/** Clip a world polyline to a box, returning the visible runs (Liang-Barsky per segment). */
export function clipPolyline(pts: (Vec2 | undefined)[], b: { x0: number; y0: number; x1: number; y1: number }): Vec2[][] {
  const runs: Vec2[][] = [];
  let cur: Vec2[] = [];
  const flush = () => { if (cur.length >= 2) runs.push(cur); cur = []; };
  const eps = 1e-12;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], c = pts[k];
    if (!a || !c) { flush(); continue; }
    let t0 = 0, t1 = 1;
    const d = sub(c, a);
    const clip = (pp: number, q: number) => { if (Math.abs(pp) < eps) return q >= -eps; const r = q / pp; if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
    if (!(clip(-d.x, a.x - b.x0) && clip(d.x, b.x1 - a.x) && clip(-d.y, a.y - b.y0) && clip(d.y, b.y1 - a.y))) { flush(); continue; }
    const p0 = add(a, mul(d, t0)), p1 = add(a, mul(d, t1));
    if (cur.length && dist(cur[cur.length - 1]!, p0) > 1e-9) flush();
    if (!cur.length) cur.push(p0);
    cur.push(p1);
    if (t1 < 1) flush();
  }
  flush();
  return runs;
}

// --- markers ---------------------------------------------------------------------------------------

export type MarkerKind = "dot" | "circle" | "square" | "triangle" | "cross" | "x" | "none";
const MARKERS: MarkerKind[] = ["dot", "circle", "square", "triangle", "cross", "x", "none"];
export function markerPrims(c: Vec2, kind: MarkerKind, color: string, ctx: PartContext): Prim[] {
  const s = px(ctx, 3.5);
  switch (kind) {
    case "dot": return [dot(c, color)];
    case "circle": return [circle(c, s, "#fff", color)];
    case "square": return [shape([add(c, v(-s, -s)), add(c, v(s, -s)), add(c, v(s, s)), add(c, v(-s, s))], "#fff", color)];
    case "triangle": return [shape([add(c, v(0, s * 1.2)), add(c, v(-s, -s * 0.8)), add(c, v(s, -s * 0.8))], "#fff", color)];
    case "cross": return [line(add(c, v(-s, 0)), add(c, v(s, 0)), color, 1.4), line(add(c, v(0, -s)), add(c, v(0, s)), color, 1.4)];
    case "x": return [line(add(c, v(-s, -s)), add(c, v(s, s)), color, 1.4), line(add(c, v(-s, s)), add(c, v(s, -s)), color, 1.4)];
    default: return [];
  }
}

// --- series ----------------------------------------------------------------------------------------

interface SeriesProps { axes: string; which: "y" | "y2"; color: string; width: number; dashed: boolean; style: "line" | "markers" | "both"; marker: MarkerKind; samples: number; source: { kind: "fn"; f: (x: number) => number; domain?: [number, number] } | { kind: "data"; pts: [number, number][] } | { kind: "param"; fx: (t: number) => number; fy: (t: number) => number; t: [number, number] } | { kind: "polar"; f: (th: number) => number; domain: [number, number] }; map?: AxesMap; polar?: PolarMap; world?: (Vec2 | undefined)[]; data?: [number, number][]; evalAt?: (x: number) => number }
const range2 = (s: ElementSpec, key: string, ctx: PartContext): [number, number] => {
  const r = s[key];
  if (!Array.isArray(r) || r.length !== 2) fail("E_SCHEMA", [s.id], `"${key}" of "${s.id}" must be [start, end]`, { path: propPath(s, key) });
  const a = numProp({ ...s, _a: r[0] } as ElementSpec, "_a", ctx), b = numProp({ ...s, _b: r[1] } as ElementSpec, "_b", ctx);
  if (!(b > a)) fail("E_INVALID_VALUE", [s.id], `"${key}" of "${s.id}" must be increasing`, { path: propPath(s, key), measured: { start: a, end: b } });
  return [a, b];
};
definePart<SeriesProps>({
  type: "series", aliases: ["dataSeries", "graph"], category: "plots",
  description: "A data series on an axes (or polarAxes) element: y = fn(x) over `domain` (default the x range), parametric {x, y} over `t`, polar r = fn(theta) (theta in radians; domain in degrees), or `data` [[x, y], ...]. Drawn as a line, markers or both, clipped to the plot area; points off a log axis are skipped. It may touch its axes.",
  options: { axes: "axes id", fn: "expression in x", domain: "[x0, x1]", x: "parametric x(t)", y: "parametric y(t)", t: "[t0, t1]", data: "[[x, y], ...]", style: "line | markers | both (default line; data: both)", marker: "dot | circle | square | triangle | cross | x", axis: "y (default) | y2", samples: "2-2000 (default 200)", color: "palette colour", width: "px (default 1.6)", dashed: "boolean" },
  positioning: "points", pointProps: [],
  propKeys: ["axes", "fn", "domain", "x", "y", "t", "data", "style", "marker", "axis", "samples", "width", "dashed"],
  props: (s, ctx) => {
    const axes = idProp(s, "axes");
    let source: SeriesProps["source"];
    if (s.data !== undefined) {
      const pts = listProp<unknown>(s, "data", { min: 1, max: 5000 }).map((p, k) => {
        if (!Array.isArray(p) || p.length !== 2) fail("E_SCHEMA", [s.id], `data[${k}] of "${s.id}" must be [x, y]`, { path: `${propPath(s, "data")}[${k}]` });
        return [numProp({ ...s, _x: p[0] } as ElementSpec, "_x", ctx), numProp({ ...s, _y: p[1] } as ElementSpec, "_y", ctx)] as [number, number];
      });
      source = { kind: "data", pts };
    } else if (s.fn !== undefined) source = { kind: "fn", f: plotFn(s.fn, "x", s, "fn", ctx), domain: s.domain === undefined ? undefined : range2(s, "domain", ctx) };
    else if (s.x !== undefined && s.y !== undefined) source = { kind: "param", fx: plotFn(s.x, "t", s, "x", ctx), fy: plotFn(s.y, "t", s, "y", ctx), t: range2(s, "t", ctx) };
    else return fail("E_SCHEMA", [s.id], `series "${s.id}" needs "fn", "data", or "x" and "y" with "t"`, { path: propPath(s, "fn"), suggestion: "Example: {\"type\": \"series\", \"axes\": \"ax\", \"fn\": \"x^2\"}." });
    const style = enumProp(s, "style", ["line", "markers", "both"] as const, source.kind === "data" ? "both" : "line");
    return { axes, which: enumProp(s, "axis", ["y", "y2"] as const, "y"), color: colorProp(s, "color", "#2679a0"), width: strokeWidthProp(s, "width", 1.6), dashed: boolProp(s, "dashed"), style, marker: enumProp(s, "marker", MARKERS, "dot"), samples: numProp(s, "samples", ctx, { default: 200, min: 2, max: 2000, integer: true }), source };
  },
  elementRefs: s => typeof s.axes === "string" ? [s.axes] : [],
  link: (i, get) => {
    linkAxes(i, get, true);
    const p = i.props, src = p.source;
    if (p.polar) {
      if (src.kind !== "fn" && src.kind !== "data") fail("E_SCHEMA", [i.id], `A series on polar axes takes "fn" (r in theta) or "data" [[theta deg, r], ...]`, { path: propPath(i.spec, "fn") });
      const pm = p.polar;
      const dom = src.kind === "fn" ? (src.domain ?? [0, 360]) : [0, 0];
      const raw: [number, number][] = src.kind === "fn" ? Array.from({ length: p.samples }, (_, k) => { const th = dom[0]! + (dom[1]! - dom[0]!) * k / (p.samples - 1); return [th, src.f(th * DEG)] as [number, number]; }) : src.pts;
      p.data = raw;
      p.world = raw.map(([th, r]) => Number.isFinite(r) && r >= 0 && r <= pm.rMax * (1 + 1e-9) ? pm.at(r, th * DEG) : undefined);
      return;
    }
    const m = p.map!, ax = m.axis("x")!;
    let raw: [number, number][];
    if (src.kind === "data") raw = src.pts;
    else if (src.kind === "fn") {
      const [a, b] = src.domain ?? [ax.min, ax.max];
      const xs = Array.from({ length: p.samples }, (_, k) => ax.scale === "log" ? 10 ** (Math.log10(a) + (Math.log10(b) - Math.log10(a)) * k / (p.samples - 1)) : a + (b - a) * k / (p.samples - 1));
      if (ax.scale === "log" && !(a > 0)) fail("E_INVALID_VALUE", [i.id], `The domain of "${i.id}" must be positive on a log x axis`, { path: propPath(i.spec, "domain") });
      raw = xs.map(x => [x, src.f(x)]);
      p.evalAt = src.f;
    } else { const ps = src as Extract<SeriesProps["source"], { kind: "param" }>; raw = Array.from({ length: p.samples }, (_, k) => { const t = ps.t[0] + (ps.t[1] - ps.t[0]) * k / (p.samples - 1); return [ps.fx(t), ps.fy(t)] as [number, number]; }); }
    p.data = raw;
    p.world = raw.map(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (ax.scale !== "log" || x > 0) && (m.axis(p.which)!.scale !== "log" || y > 0) ? v(m.X(x), m.Y(y, p.which)) : undefined);
    if (src.kind === "data") p.evalAt = (x: number) => { const d = [...src.pts].sort((u, w) => u[0] - w[0]); for (let k = 1; k < d.length; k++) if (x >= d[k - 1]![0] && x <= d[k]![0]) return d[k - 1]![1] + (d[k]![1] - d[k - 1]![1]) * (x - d[k - 1]![0]) / ((d[k]![0] - d[k - 1]![0]) || 1); return NaN; };
  },
  anchors: ["start", "end", "max", "min", "at(x)", "point(k)"], anchorArgs: { at: "number", point: "number" },
  hooks: ["curve"],
  geometry: (i, ctx) => {
    const p = i.props, box = p.map?.box ?? p.polar!.box;
    const inBox = (q: Vec2) => q.x >= box.x0 - 1e-9 && q.x <= box.x1 + 1e-9 && q.y >= box.y0 - 1e-9 && q.y <= box.y1 + 1e-9 && (!p.polar || dist(q, p.polar.c) <= p.polar.R * (1 + 1e-9));
    const runs = clipPolyline(p.world!, box);
    const prims: Prim[] = [];
    if (p.style !== "markers") for (const r of runs) prims.push(poly(r, p.color, p.width, false, p.dashed));
    const visible = p.world!.filter((q): q is Vec2 => !!q && inBox(q));
    if (p.style !== "line") { const markPts = p.source.kind === "data" ? visible : visible.filter((_, k) => k % Math.max(1, Math.round(visible.length / 12)) === 0); for (const q of markPts) prims.push(...markerPrims(q, p.marker, p.color, ctx)); }
    if (!prims.length) fail("E_INVALID_VALUE", [i.id], `Series "${i.id}" has no visible point inside its axes`, { suggestion: "Check the axis ranges against the data, the domain, or the log scales." });
    const flat = runs.flat().length ? runs.flat() : visible;
    const byY = [...visible].sort((a, b) => a.y - b.y);
    const end = flat[flat.length - 1]!;
    const m = p.map, f = p.evalAt, ax = m?.axis("x");
    // Exact residual for function series: invert the x mapping, evaluate, compare in world units.
    const residual = m && f && p.source.kind === "fn" && ax ? (q: Vec2) => {
      const t = (q.x - m.box.x0) / (m.box.x1 - m.box.x0);
      const xd = ax.scale === "log" ? 10 ** (Math.log10(ax.min) + t * (Math.log10(ax.max) - Math.log10(ax.min))) : ax.min + t * (ax.max - ax.min);
      if (t < -1e-12 || t > 1 + 1e-12) return Infinity;
      const y = f(xd);
      return Number.isFinite(y) && m.inY(y, p.which) ? Math.abs(q.y - m.Y(y, p.which)) : Infinity;
    } : undefined;
    return {
      prims, curve: flat, residual,
      anchors: { start: flat[0]!, end, max: byY[byY.length - 1]!, min: byY[0]! },
      argAnchors: { at: x => { if (!p.map || !p.evalAt) return undefined; const y = p.evalAt(x); return p.map.inX(x) && p.map.inY(y, p.which) ? v(p.map.X(x), p.map.Y(y, p.which)) : undefined; }, point: k => Number.isInteger(k) && p.data![k] && p.world![k] ? p.world![k] : undefined },
      label: { at: end, candidates: ["right", "above-right", "below-right", "above", "below", "above-left", "left", "below-left"] },
    };
  },
});

// --- shaded area -------------------------------------------------------------------------------------

interface ShadeProps { axes: string; upper: unknown; lower: unknown; series?: string; lowerSeries?: string; from?: number; to?: number; fill: string; which: "y" | "y2"; map?: AxesMap; polygon?: Vec2[]; inner?: Vec2; area?: number; edgeRun?: Vec2[]; edgeColor?: string; edgeWidth?: number }
definePart<ShadeProps>({
  type: "shade", aliases: ["area", "fillBetween"], category: "plots",
  description: "Shaded region on an axes between an upper bound (`upper` expression in x or number, or `series` id) and a lower bound (`lower`, default 0, or `lowerSeries` id) for x from `from` to `to`. Clamped to the plot area; its `area` (data units, trapezoidal) is exposed to checks. Declare it before the series it sits under; when bounded by `series`, that series' edge is redrawn on top.",
  options: { axes: "axes id", upper: "expression in x or number", series: "upper bound from a series id", lower: "expression or number (default 0)", lowerSeries: "lower bound from a series id", from: "x start (default x min)", to: "x end (default x max)", fill: "palette colour (default bodyFill)", axis: "y | y2" },
  positioning: "points", pointProps: [],
  propKeys: ["axes", "upper", "series", "lower", "lowerSeries", "from", "to", "fill", "axis"],
  props: (s, ctx) => {
    if ((s.upper === undefined) === (s.series === undefined)) fail("E_SCHEMA", [s.id], `shade "${s.id}" needs exactly one of "upper" or "series"`, { path: propPath(s, "upper") });
    if (s.lower !== undefined && s.lowerSeries !== undefined) fail("E_SCHEMA", [s.id], `shade "${s.id}" takes "lower" or "lowerSeries", not both`, { path: propPath(s, "lower") });
    return { axes: idProp(s, "axes"), upper: s.upper, series: s.series === undefined ? undefined : idProp(s, "series"), lower: s.lower ?? 0, lowerSeries: s.lowerSeries === undefined ? undefined : idProp(s, "lowerSeries"), from: s.from === undefined ? undefined : numProp(s, "from", ctx), to: s.to === undefined ? undefined : numProp(s, "to", ctx), fill: colorProp(s, "fill", "#cfe4ff"), which: enumProp(s, "axis", ["y", "y2"] as const, "y") };
  },
  elementRefs: s => [s.axes, s.series, s.lowerSeries].filter((x): x is string => typeof x === "string"),
  link: (i, get, ctx) => {
    linkAxes(i, get);
    const p = i.props, m = p.map!, ax = m.axis("x")!, ya = m.axis(p.which)!;
    const fromSeries = (id: string, key: string, upper: boolean): ((x: number) => number) => {
      const o = get(id), sp = o.inst.props as SeriesProps;
      if (!["series", "dataSeries", "graph"].includes(o.inst.type) || !sp.evalAt) fail("E_SCHEMA", [i.id, id], `"${key}" of shade "${i.id}" must name a Cartesian fn or data series; "${id}" is ${o.inst.type}`, { path: propPath(i.spec, key) });
      i.touches = [...new Set([...(i.touches ?? []), id])];
      if (upper) { p.edgeColor = sp.color; p.edgeWidth = sp.width; }
      return sp.evalAt;
    };
    const fnOf = (val: unknown, key: string) => typeof val === "number" ? () => val : plotFn(val, "x", i.spec, key, ctx);
    const fu = p.series ? fromSeries(p.series, "series", true) : fnOf(p.upper, "upper");
    const fl = p.lowerSeries ? fromSeries(p.lowerSeries, "lowerSeries", false) : fnOf(p.lower, "lower");
    const a = Math.max(p.from ?? ax.min, ax.min), b = Math.min(p.to ?? ax.max, ax.max);
    if (!(b > a)) fail("E_INVALID_VALUE", [i.id], `Shade "${i.id}" has an empty x range inside the axes`, { measured: { from: a, to: b } });
    const N = 160, xs = Array.from({ length: N + 1 }, (_, k) => ax.scale === "log" ? 10 ** (Math.log10(a) + (Math.log10(b) - Math.log10(a)) * k / N) : a + (b - a) * k / N);
    const clampY = (y: number) => Math.min(Math.max(y, ya.min), ya.max);
    const U = xs.map(x => fu(x)), L = xs.map(x => fl(x));
    if ([...U, ...L].some(y => !Number.isFinite(y))) fail("E_NON_FINITE", [i.id], `The bounds of shade "${i.id}" are not finite over [${a}, ${b}]`, { measured: { from: a, to: b } });
    p.area = xs.slice(1).reduce((sum, x, k) => sum + (x - xs[k]!) * ((U[k + 1]! - L[k + 1]!) + (U[k]! - L[k]!)) / 2, 0);
    const up = xs.map((x, k) => v(m.X(x), m.Y(clampY(U[k]!), p.which))), lo = xs.map((x, k) => v(m.X(x), m.Y(clampY(L[k]!), p.which)));
    p.polygon = [...up, ...lo.reverse()];
    if (p.edgeColor) p.edgeRun = up;
    // An interior point for the centre label: mid-range x, halfway between the bounds.
    const xm = ax.scale === "log" ? Math.sqrt(a * b) : (a + b) / 2;
    p.inner = v(m.X(xm), m.Y((clampY(fu(xm)) + clampY(fl(xm))) / 2, p.which));
  },
  anchors: ["center", "start", "end"],
  hooks: ["outline"],
  geometry: (i) => {
    const p = i.props, poly0 = p.polygon!;
    const prims: Prim[] = [shape(poly0, p.fill, "none")];
    if (p.edgeRun) prims.push(poly(p.edgeRun, p.edgeColor!, p.edgeWidth!));
    return { prims, outline: poly0, anchors: { center: p.inner!, start: poly0[0]!, end: poly0[Math.floor(poly0.length / 2) - 1]! }, label: { at: p.inner!, candidates: ["center"] }, refs: { area: { value: p.area!, dim: DIMLESS } } };
  },
});

// --- plot point ------------------------------------------------------------------------------------

interface PPointProps { axes: string; x: number; y?: number; series?: string; which: "y" | "y2"; marker: MarkerKind; color: string; guides: boolean; map?: AxesMap; polar?: PolarMap }
definePart<PPointProps>({
  type: "plotPoint", aliases: ["dataPoint", "marker"], category: "plots",
  description: "A marked point at data coordinates (x, y) on an axes (on polarAxes: x = angle in degrees, y = radius), optionally with dashed guides to both axes. With `series`, the point sits on that series (y defaults to its value at x) and may touch it. It may touch its axes. Refs: dataX, dataY.",
  options: { axes: "axes id", x: "data x (polar: angle deg)", y: "data y (polar: r); optional with series", series: "series id the point lies on", marker: "dot (default) | circle | square | triangle | cross | x", guides: "dashed lines to the axes (default false)", axis: "y | y2", color: "palette colour" },
  positioning: "points", pointProps: [],
  propKeys: ["axes", "x", "y", "series", "marker", "guides", "axis"],
  props: (s, ctx) => {
    if (s.y === undefined && s.series === undefined) fail("E_SCHEMA", [s.id], `plotPoint "${s.id}" needs "y" (or "series" to take y from)`, { path: propPath(s, "y") });
    return { axes: idProp(s, "axes"), x: numProp(s, "x", ctx), y: s.y === undefined ? undefined : numProp(s, "y", ctx), series: s.series === undefined ? undefined : idProp(s, "series"), which: enumProp(s, "axis", ["y", "y2"] as const, "y"), marker: enumProp(s, "marker", MARKERS.filter(k => k !== "none"), "dot"), color: colorProp(s, "color", "#222"), guides: boolProp(s, "guides") };
  },
  elementRefs: s => [s.axes, s.series].filter((x): x is string => typeof x === "string"),
  link: (i, get) => {
    linkAxes(i, get, true);
    const p = i.props;
    if (p.series) {
      const o = get(p.series), sp = o.inst.props as SeriesProps;
      if (!["series", "dataSeries", "graph"].includes(o.inst.type) || !sp.evalAt) fail("E_SCHEMA", [i.id, p.series], `"series" of plotPoint "${i.id}" must name a Cartesian fn or data series`, { path: propPath(i.spec, "series") });
      p.y ??= sp.evalAt(p.x);
      p.which = sp.which;
      i.touches = [...new Set([...(i.touches ?? []), p.series])];
    }
    const y = p.y!;
    if (p.polar) { if (!(y >= 0 && y <= p.polar.rMax)) fail("E_INVALID_VALUE", [i.id], `plotPoint "${i.id}" radius ${y} is outside [0, ${p.polar.rMax}]`, { measured: { r: y } }); i.origin = p.polar.at(y, p.x * DEG); return; }
    if (!p.map!.inX(p.x) || !p.map!.inY(y, p.which)) fail("E_INVALID_VALUE", [i.id], `plotPoint "${i.id}" (${p.x}, ${y}) is outside its axes`, { measured: { x: p.x, y }, suggestion: "Widen the axis ranges or move the point." });
    i.origin = v(p.map!.X(p.x), p.map!.Y(y, p.which));
  },
  anchors: ["center"],
  geometry: (i, ctx) => {
    const p = i.props, c = i.origin, prims: Prim[] = [];
    if (p.guides && p.map) { const b = p.map.box, g = px(ctx, 5); if (c.y - b.y0 > g) prims.push(line(v(c.x, b.y0), v(c.x, c.y - g), "#aaa", 1, true)); if (c.x - b.x0 > g) prims.push(line(v(b.x0, c.y), v(c.x - g, c.y), "#aaa", 1, true)); }
    prims.push(...markerPrims(c, p.marker, p.color, ctx));
    return { prims, anchors: { center: c }, label: { at: c, candidates: AROUND }, refs: { dataX: { value: p.x, dim: DIMLESS }, dataY: { value: p.y!, dim: DIMLESS } } };
  },
});

// --- guide lines / asymptotes ----------------------------------------------------------------------

interface GuideProps { axes: string; x?: number; y?: number; which: "y" | "y2"; dashed: boolean; color: string; width: number; map?: AxesMap }
definePart<GuideProps>({
  type: "guideLine", aliases: ["asymptote", "hline", "vline", "refLine"], category: "plots",
  description: "Line across an axes at data x = value (vertical) or y = value (horizontal): asymptotes, thresholds, reference levels. Dashed by default.",
  options: { axes: "axes id", x: "vertical line at this x", y: "horizontal line at this y", axis: "y | y2", dashed: "default true", color: "palette colour (default constraint #666)", width: "px (default 1)" },
  positioning: "points", pointProps: [],
  propKeys: ["axes", "x", "y", "axis", "dashed", "width"],
  props: (s, ctx) => {
    if ((s.x === undefined) === (s.y === undefined)) fail("E_SCHEMA", [s.id], `guideLine "${s.id}" needs exactly one of "x" or "y"`, { path: propPath(s, "x") });
    return { axes: idProp(s, "axes"), x: s.x === undefined ? undefined : numProp(s, "x", ctx), y: s.y === undefined ? undefined : numProp(s, "y", ctx), which: enumProp(s, "axis", ["y", "y2"] as const, "y"), dashed: boolProp(s, "dashed", true), color: colorProp(s, "color", "#666"), width: strokeWidthProp(s, "width", 1) };
  },
  elementRefs: s => typeof s.axes === "string" ? [s.axes] : [],
  link: (i, get) => {
    linkAxes(i, get);
    const p = i.props, m = p.map!;
    if (p.x !== undefined && !m.inX(p.x)) fail("E_INVALID_VALUE", [i.id], `guideLine "${i.id}" x = ${p.x} is outside its axes`, { measured: { x: p.x } });
    if (p.y !== undefined && !m.inY(p.y, p.which)) fail("E_INVALID_VALUE", [i.id], `guideLine "${i.id}" y = ${p.y} is outside its axes`, { measured: { y: p.y } });
    i.origin = p.x !== undefined ? v(m.X(p.x), m.box.y0) : v(m.box.x0, m.Y(p.y!, p.which));
  },
  anchors: ["start", "end", "mid"],
  geometry: (i) => {
    const p = i.props, b = p.map!.box;
    const [a, c] = p.x !== undefined ? [v(i.origin.x, b.y0), v(i.origin.x, b.y1)] : [v(b.x0, i.origin.y), v(b.x1, i.origin.y)];
    return { prims: [line(a, c, p.color, p.width, p.dashed)], anchors: { start: a, end: c, mid: lerp(a, c, 0.5) }, label: { at: c, candidates: p.x !== undefined ? ["right", "left", "below-right", "below-left"] : ["above-left", "below-left", "above", "below"] } };
  },
});

// --- slope triangle and intercepts ---------------------------------------------------------------------

interface SlopeProps { axes: string; series: string; x: number; run: number; color: string; slope?: number; pts?: [Vec2, Vec2, Vec2]; map?: AxesMap; which: "y" | "y2" }
definePart<SlopeProps>({
  type: "slopeTriangle", aliases: ["slope", "riseRun"], category: "plots",
  description: "Rise-over-run triangle on a series between data x and x + run (dashed legs below the secant). Its `slope` (data units) is exposed to checks.",
  options: { series: "series id (fn or data)", x: "start x", run: "run in x", color: "palette colour (default constraint #666)" },
  positioning: "points", pointProps: [],
  propKeys: ["series", "x", "run"],
  props: (s, ctx) => ({ axes: "", series: idProp(s, "series"), x: numProp(s, "x", ctx), run: numProp(s, "run", ctx), color: colorProp(s, "color", "#666"), which: "y" }),
  elementRefs: s => typeof s.series === "string" ? [s.series] : [],
  link: (i, get) => {
    const o = get(i.props.series), sp = o.inst.props as SeriesProps;
    if (!sp.evalAt || !sp.map) fail("E_SCHEMA", [i.id, o.inst.id], `slopeTriangle "${i.id}" needs a Cartesian fn or data series; "${o.inst.id}" is ${o.inst.type}`, { path: propPath(i.spec, "series") });
    const p = i.props, m = sp.map; p.map = m; p.which = sp.which; p.axes = sp.axes;
    const x0 = p.x, x1 = p.x + p.run, y0 = sp.evalAt(x0), y1 = sp.evalAt(x1);
    if (![y0, y1].every(Number.isFinite) || !m.inX(x0) || !m.inX(x1) || !m.inY(y0, p.which) || !m.inY(y1, p.which)) fail("E_INVALID_VALUE", [i.id], `slopeTriangle "${i.id}" leaves the axes or the series' range`, { measured: { x0, x1, y0, y1 } });
    p.slope = (y1 - y0) / p.run;
    const A = v(m.X(x0), m.Y(y0, p.which)), B = v(m.X(x1), m.Y(y0, p.which)), C = v(m.X(x1), m.Y(y1, p.which));
    p.pts = [A, B, C];
    i.touches = [o.inst.id, sp.axes];
    i.origin = A;
  },
  anchors: ["start", "corner", "end", "runMid", "riseMid"],
  geometry: (i, ctx) => {
    const [A, B, C] = i.props.pts!;
    if (dist(A, B) * ctx.view.scale < 10 || dist(B, C) * ctx.view.scale < 4) fail("E_INVALID_VALUE", [i.id], `slopeTriangle "${i.id}" is too small to read`, { measured: { runPx: dist(A, B) * ctx.view.scale, risePx: dist(B, C) * ctx.view.scale } });
    return { prims: [line(A, B, i.props.color, 1, true), line(B, C, i.props.color, 1, true)], anchors: { start: A, corner: B, end: C, runMid: lerp(A, B, 0.5), riseMid: lerp(B, C, 0.5) }, label: { at: lerp(B, C, 0.5), candidates: ["right", "left", "below-right", "above-right"] }, refs: { slope: { value: i.props.slope!, dim: DIMLESS } } };
  },
});

interface InterceptProps { series: string; axis: "x" | "y"; near?: number; marker: MarkerKind; color: string; value?: number; map?: AxesMap }
definePart<InterceptProps>({
  type: "intercept", aliases: ["root", "zeroCrossing"], category: "plots",
  description: "Marks where a series crosses y = 0 (axis x: the root nearest `near`, by bisection on a sign change) or x = 0 (axis y). Its `value` is exposed to checks.",
  options: { series: "series id (fn or data)", axis: "x (root, default) | y (value at x = 0)", near: "x to search near (default: first sign change)", marker: "default circle", color: "palette colour" },
  positioning: "points", pointProps: [],
  propKeys: ["series", "axis", "near", "marker"],
  props: (s, ctx) => ({ series: idProp(s, "series"), axis: enumProp(s, "axis", ["x", "y"] as const, "x"), near: s.near === undefined ? undefined : numProp(s, "near", ctx), marker: enumProp(s, "marker", MARKERS.filter(k => k !== "none"), "circle"), color: colorProp(s, "color", "#222") }),
  elementRefs: s => typeof s.series === "string" ? [s.series] : [],
  link: (i, get) => {
    const o = get(i.props.series), sp = o.inst.props as SeriesProps;
    if (!sp.evalAt || !sp.map) fail("E_SCHEMA", [i.id, o.inst.id], `intercept "${i.id}" needs a Cartesian fn or data series`, { path: propPath(i.spec, "series") });
    const m = sp.map, ax = m.axis("x")!, f = sp.evalAt, p = i.props;
    i.touches = [o.inst.id, sp.axes];
    if (p.axis === "y") {
      const y = f(0);
      if (!m.inX(0) || !m.inY(y, sp.which)) fail("E_INVALID_VALUE", [i.id], `The y intercept of "${o.inst.id}" is outside the axes`, { measured: { y } });
      p.value = y; i.origin = v(m.X(0), m.Y(y, sp.which)); p.map = m; return;
    }
    const N = 400, xs = Array.from({ length: N + 1 }, (_, k) => ax.min + (ax.max - ax.min) * k / N);
    const roots: number[] = [];
    for (let k = 1; k <= N; k++) {
      let a = xs[k - 1]!, b = xs[k]!, fa = f(a), fb = f(b);
      if (!Number.isFinite(fa) || !Number.isFinite(fb)) continue;
      if (fa === 0) { roots.push(a); continue; }
      if (fa * fb > 0) continue;
      for (let it = 0; it < 80; it++) { const c = (a + b) / 2, fc = f(c); if (fa * fc <= 0) { b = c; fb = fc; } else { a = c; fa = fc; } }
      roots.push((a + b) / 2);
    }
    if (!roots.length) fail("E_INVALID_VALUE", [i.id], `Series "${o.inst.id}" does not cross y = 0 inside the axes`, { suggestion: "Use axis \"y\", or widen the x range." });
    const r = p.near === undefined ? roots[0]! : roots.reduce((best, x) => Math.abs(x - p.near!) < Math.abs(best - p.near!) ? x : best);
    if (!m.inY(0, sp.which)) fail("E_INVALID_VALUE", [i.id], `y = 0 is outside the axes of "${o.inst.id}"`, {});
    p.value = r; p.map = m; i.origin = v(m.X(r), m.Y(0, sp.which));
  },
  anchors: ["center"],
  geometry: (i, ctx) => ({ prims: markerPrims(i.origin, i.props.marker, i.props.color, ctx), anchors: { center: i.origin }, label: { at: i.origin, candidates: ["above-right", "below-right", "above-left", "below-left", "above", "below"] }, refs: { value: { value: i.props.value!, dim: DIMLESS } } }),
});

// --- polar axes and phasors ----------------------------------------------------------------------------

interface PolarProps { r: number; rMax: number; rings: number; spokes: number; labels: boolean; ringLabels: boolean; textSize: number }
export interface PolarMap { c: Vec2; R: number; rMax: number; at(r: number, theta: number): Vec2; box: { x0: number; y0: number; x1: number; y1: number } }
export function polarMap(inst: PartInstance<PolarProps>): PolarMap {
  const c = inst.origin, R = inst.props.r, rMax = inst.props.rMax;
  return { c, R, rMax, at: (r, th) => polar(c, R * r / rMax, th), box: { x0: c.x - R, y0: c.y - R, x1: c.x + R, y1: c.y + R } };
}
definePart<PolarProps>({
  type: "polarAxes", aliases: ["polarPlot", "phasorDiagram"], category: "plots",
  description: "Polar axes centred on the origin: radius r (world) for data radius rMax, `rings` grid circles with radius labels, spokes every `spokes` degrees with angle labels outside the rim. Series (r = fn(theta)), plotPoints and phasors name it.",
  options: { r: "outer radius (world)", rMax: "data radius at the rim (default 1)", rings: "grid circles (default 4)", spokes: "degrees between spokes (default 30; 0 for none)", labels: "angle labels (default true)", ringLabels: "radius labels between the first two spokes; a ring whose label would touch a grid line is left unlabelled (default true)", textSize: "11-13 (default 11)" },
  positioning: "placed",
  propKeys: ["r", "rMax", "rings", "spokes", "labels", "ringLabels", "textSize"],
  labels: false,
  props: (s, ctx) => ({ r: lengthProp(s, "r", ctx, { positive: true }), rMax: numProp(s, "rMax", ctx, { default: 1 }), rings: numProp(s, "rings", ctx, { default: 4, min: 0, max: 12, integer: true }), spokes: numProp(s, "spokes", ctx, { default: 30, min: 0, max: 180 }), labels: boolProp(s, "labels", true), ringLabels: boolProp(s, "ringLabels", true), textSize: sizeProp(s, "textSize", 11) }),
  anchors: ["center", "rim(angle)", "at(angle)"], anchorArgs: { rim: "angle", at: "angle" },
  hooks: ["outline", "radius"],
  geometry: (i, ctx) => {
    const p = i.props, c = i.origin, R = p.r, sz = p.textSize;
    if (!(p.rMax > 0)) fail("E_INVALID_VALUE", [i.id], `rMax of "${i.id}" must be positive`, { measured: { rMax: p.rMax } });
    const prims: Prim[] = [];
    const n = p.spokes > 0 ? Math.round(360 / p.spokes) : 0;
    for (let k = 0; k < n; k++) { const a = k * p.spokes * DEG; prims.push(line(c, polar(c, R, a), GRID, 1)); }
    for (let k = 1; k < p.rings; k++) prims.push(circle(c, R * k / p.rings, "none", GRID));
    prims.push(circle(c, R, "none", AXIS));
    if (p.labels) for (let k = 0; k < n; k++) {
      const a = k * p.spokes * DEG, t = `${trimNum(k * p.spokes, 2)}°`, tp = textPx(t, sz);
      const reach = Math.abs(Math.cos(a)) * tp.w / 2 + Math.abs(Math.sin(a)) * tp.h / 2 + 4;
      prims.push(text(polar(c, R + px(ctx, reach), a), t, sz, TICK_TEXT));
    }
    if (p.ringLabels && p.rings > 0) {
      // Radius labels sit between the first two spokes so no grid line runs through them.
      const la = (p.spokes > 0 ? p.spokes / 2 : 15) * DEG;
      // Inner rings whose label would touch a spoke or another ring are left unlabelled.
      const spokes = Array.from({ length: n }, (_, k) => k * p.spokes * DEG);
      for (let k = p.rings; k >= 1; k--) {
        const t = trimNum(p.rMax * k / p.rings, 3), tp = textPx(t, sz), rr = R * k / p.rings, q = polar(c, rr - px(ctx, tp.w / 2 + 3), la);
        const half = px(ctx, Math.hypot(tp.w, tp.h) / 2 + 1.5);
        const clearSpokes = spokes.every(a => Math.abs(Math.sin(angleOf(sub(q, c)) - a)) * dist(q, c) > half || Math.cos(angleOf(sub(q, c)) - a) < 0);
        const clearRings = Array.from({ length: p.rings }, (_, j) => R * (j + 1) / p.rings).every(r0 => Math.abs(dist(q, c) - r0) > half);
        if (clearSpokes && clearRings) prims.push(text(q, t, sz, TICK_TEXT));
      }
    }
    return { prims, radius: R, outline: arcSamples(c, R, 0, 2 * Math.PI).slice(0, -1), anchors: { center: c }, argAnchors: { rim: a => polar(c, R, a), at: a => polar(c, R, a) } };
  },
});

interface PhasorProps { axes: string; magnitude: number; angle: number; color: string; dashed: boolean; polar?: PolarMap; tail?: Vec2; tip?: Vec2; from?: string }
definePart<PhasorProps>({
  type: "phasor", aliases: ["polarVector"], category: "plots",
  description: "Phasor on polarAxes: an arrow of data length `magnitude` at `angle`, from the centre or from the tip of another phasor (`from`, for phasor sums; it may touch that phasor). Exposes magnitude, angle, re and im. Phasors that both start at the centre may touch there automatically (no mayTouch), as long as each tip stays clear of the other phasor.",
  options: { axes: "polarAxes id", magnitude: "data radius units", angle: "degrees", from: "phasor id to start at its tip", color: "palette colour (default force)", dashed: "boolean" },
  positioning: "points", pointProps: [],
  propKeys: ["axes", "magnitude", "angle", "from", "dashed"],
  props: (s, ctx) => ({ axes: idProp(s, "axes"), magnitude: numProp(s, "magnitude", ctx, { min: 0 }), angle: angleProp(s, "angle", ctx), color: colorProp(s, "color", "#c0392b"), dashed: boolProp(s, "dashed"), from: s.from === undefined ? undefined : idProp(s, "from") }),
  elementRefs: s => [s.axes, s.from].filter((x): x is string => typeof x === "string"),
  link: (i, get) => {
    const o = get(i.props.axes);
    if (o.inst.type !== "polarAxes" && o.inst.type !== "polarPlot" && o.inst.type !== "phasorDiagram") fail("E_SCHEMA", [i.id, o.inst.id], `phasor "${i.id}" needs polarAxes; "${o.inst.id}" is ${o.inst.type}`, { path: propPath(i.spec, "axes") });
    const pm = polarMap(o.inst as PartInstance<PolarProps>), p = i.props;
    p.polar = pm;
    let tail = pm.c;
    if (p.from) { const f = get(p.from); if (f.inst.type !== "phasor" && f.inst.type !== "polarVector") fail("E_SCHEMA", [i.id, p.from], `"from" of phasor "${i.id}" must be another phasor`, { path: propPath(i.spec, "from") }); tail = (f.inst.props as PhasorProps).tip!; i.touches = [p.from]; }
    p.tail = tail; p.tip = add(tail, mul(v(Math.cos(p.angle), Math.sin(p.angle)), pm.R * p.magnitude / pm.rMax));
    i.touches = [...new Set([...(i.touches ?? []), p.axes])];
    i.origin = tail;
  },
  contactWith: (i, o, ctx) => {
    if (o.type !== "phasor" && o.type !== "polarVector") return undefined;
    const p = i.props, q = o.props as PhasorProps;
    if (p.from || q.from || p.axes !== q.axes || dist(p.tail!, q.tail!) > 1e-9) return undefined;
    // Only the shared tail may touch: each tip (and its head) must clear the other shaft.
    const V = ctx.view.toView, segD = (x: Vec2, a: Vec2, b: Vec2) => pointSegDist(V(x), V(a), V(b));
    if (segD(p.tip!, q.tail!, q.tip!) < 6 || segD(q.tip!, p.tail!, p.tip!) < 6 || dist(V(p.tip!), V(q.tip!)) < 8) return undefined;
    return "phasors share the polar origin";
  },
  anchors: ["tail", "tip", "mid"],
  geometry: (i, ctx) => {
    const p = i.props;
    if (dist(p.tail!, p.tip!) * ctx.view.scale < 12) fail("E_ARROW_TOO_SHORT", [i.id], `Phasor "${i.id}" is ${(dist(p.tail!, p.tip!) * ctx.view.scale).toFixed(1)} px long; at least 12 px is needed`, { measured: { lengthPx: dist(p.tail!, p.tip!) * ctx.view.scale } });
    return { prims: [vector(p.tail!, p.tip!, p.color, p.dashed)], anchors: { tail: p.tail!, tip: p.tip!, mid: lerp(p.tail!, p.tip!, 0.5) }, label: { at: p.tip!, candidates: outwardCandidates(sub(p.tip!, p.tail!)) }, refs: { magnitude: { value: p.magnitude, dim: DIMLESS }, angle: { value: p.angle, dim: ANGLE }, re: { value: p.magnitude * Math.cos(p.angle), dim: DIMLESS }, im: { value: p.magnitude * Math.sin(p.angle), dim: DIMLESS } } };
  },
});

// --- samples ----------------------------------------------------------------------------------------------

const axesAt = (id: string, c: Vec2, x: Record<string, unknown>, y: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, type: "axes", at: P(c.x - 1.15, c.y - 0.55), w: 2.6, h: 1.45, x, y, ...extra });
addSample("axes", (id, c, r) => [axesAt(id, c, { min: 0, max: 4, ticks: 4, label: "t", unit: "s", grid: true }, { min: 0, max: 2, ticks: 2, grid: true }, { frame: pickOf(r, ["axes", "box"]) })]);
addSample("series", (id, c, r) => [
  { id, type: "series", axes: `${id}_ax`, fn: pickOf(r, ["1 - exp(-x)", "exp(-x/2)*cos(3*x rad)"]) },
  axesAt(`${id}_ax`, c, { min: 0, max: 6, ticks: 3 }, { min: -1, max: 1, ticks: 2 }),
]);
addSample("shade", (id, c) => [
  { id, type: "shade", axes: `${id}_ax`, series: `${id}_s`, from: 0.8, to: 2.6, fill: "bodyFill", label: { text: "W", size: 11 } },
  axesAt(`${id}_ax`, c, { min: 0.5, max: 4, ticks: [1, 2, 3, 4], label: "V" }, { min: 0, max: 2, ticks: [0, 1, 2], label: "P" }),
  { id: `${id}_s`, type: "series", axes: `${id}_ax`, fn: "1.2/x", domain: [0.62, 4], color: "ink" },
]);
addSample("plotPoint", (id, c) => [
  { id, type: "plotPoint", axes: `${id}_ax`, x: 2, y: 1.2, guides: true, marker: "circle" },
  axesAt(`${id}_ax`, c, { min: 0, max: 4, ticks: 2 }, { min: 0, max: 2, ticks: 2 }),
]);
addSample("guideLine", (id, c) => [
  { id, type: "guideLine", axes: `${id}_ax`, y: 1 },
  axesAt(`${id}_ax`, c, { min: 0, max: 5, ticks: 5 }, { min: 0, max: 1.5, ticks: [0, 0.5, 1, 1.5] }),
  { id: `${id}_s`, type: "series", axes: `${id}_ax`, fn: "1 - exp(-x)", mayTouch: [id] },
]);
addSample("slopeTriangle", (id, c) => [
  { id, type: "slopeTriangle", series: `${id}_s`, x: 1, run: 2 },
  axesAt(`${id}_ax`, c, { min: 0, max: 4, ticks: 4 }, { min: 0, max: 3, ticks: 3 }),
  { id: `${id}_s`, type: "series", axes: `${id}_ax`, fn: "0.6*x + 0.2" },
]);
addSample("intercept", (id, c) => [
  { id, type: "intercept", series: `${id}_s`, axis: "x" },
  axesAt(`${id}_ax`, c, { min: -2, max: 2, ticks: [-2, 2] }, { min: -2, max: 2, ticks: [-2, 2] }, { frame: "cross" }),
  { id: `${id}_s`, type: "series", axes: `${id}_ax`, fn: "x/2 + 0.5", domain: [-1.6, 1.8] },
]);
addSample("polarAxes", (id, c) => [{ id, type: "polarAxes", at: P(c.x, c.y), r: 0.85, rMax: 2, rings: 2, spokes: 45 }]);
addSample("phasor", (id, c, r) => [
  { id, type: "phasor", axes: `${id}_ax`, magnitude: 1.2, angle: between(r, 25, 50) },
  { id: `${id}_b`, type: "phasor", axes: `${id}_ax`, magnitude: 0.7, angle: 120, color: "rayAlt", mayTouch: [id] },
  { id: `${id}_ax`, type: "polarAxes", at: P(c.x, c.y), r: 1.05, rMax: 2, rings: 1, spokes: 90, labels: false, ringLabels: false },
]);

export type { PartDefinition };
