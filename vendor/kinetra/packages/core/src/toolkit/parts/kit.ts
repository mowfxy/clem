/**
 * Part kit: the shared machinery behind the part library. A part builds a
 * list of world-space primitives (`Prim`) once per instance; draw(),
 * collide(), box() and the outline are all derived from that one list, so the
 * collision shapes always cover exactly what is painted and every shape goes
 * through Scene2D in the style contract. See docs/toolkit/parts.md.
 */
import type { Scene2DShape } from "../../diagram/scene2d.js";
import type { Vec2 } from "../../diagram/primitives.js";
import { fail } from "../errors.js";
import { ANGLE, LENGTH, evalNumber } from "../expr.js";
import type { TkQuantity } from "../expr.js";
import type { CollisionShape } from "../geometry.js";
import { pointInPolygon, pointPolylineDist } from "../geometry.js";
import { ARROW_HEAD, angleProp, textBox, boolProp, colorProp, lengthProp, propPath, registerPart, strokeWidthProp, textBaselineOffset, textBoxPolygon } from "../parts.js";
import type { ArrowQuantity, LinkLookup, PartContext, PartDefinition, PartInstance } from "../parts.js";
import { TOOLKIT_TEXT } from "../style.js";
import { formatLabelMarkup } from "../text_metrics.js";
import type { ElementSpec, LabelPosition, NumLike } from "../types.js";

// --- vectors -------------------------------------------------------------------

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const unit = (a: Vec2): Vec2 => { const l = len(a); return l === 0 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l }; };
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const rot = (p: Vec2, a: number): Vec2 => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const polar = (c: Vec2, r: number, a: number): Vec2 => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const DEG = Math.PI / 180;

/** A local frame: origin, rotation and uniform scale (world units per local unit). */
export interface Frame { o: Vec2; rot: number; s: number; flip?: boolean }
/** Local point -> world point. */
export const fp = (f: Frame, x: number, y: number): Vec2 => add(f.o, rot({ x: x * f.s, y: (f.flip ? -y : y) * f.s }, f.rot));
/** Local direction angle -> world angle. */
export const fa = (f: Frame, a: number): number => (f.flip ? -a : a) + f.rot;

// --- primitives ------------------------------------------------------------------

/** World-space drawing primitives. Widths are px; text sizes 11-13. */
export type Prim =
  | { k: "line"; a: Vec2; b: Vec2; w: number; color: string; dashed?: boolean }
  | { k: "poly"; pts: Vec2[]; w: number; color: string; dashed?: boolean; closed?: boolean }
  | { k: "shape"; pts: Vec2[]; fill: string; stroke: string }
  | { k: "circle"; c: Vec2; r: number; fill: string; stroke: string }
  | { k: "arc"; c: Vec2; r: number; from: number; to: number; w: number; color: string }
  | { k: "text"; at: Vec2; text: string; size: number; color: string; anchor?: "start" | "middle" | "end" }
  | { k: "vector"; a: Vec2; b: Vec2; color: string; dashed?: boolean }
  | { k: "head"; tip: Vec2; dir: number; color: string }
  | { k: "dot"; c: Vec2; color: string }
  | { k: "rect"; c: Vec2; w: number; h: number; rxPx: number; fill: string; stroke: string };

export const line = (a: Vec2, b: Vec2, color = "#222", w = 1.4, dashed = false): Prim => ({ k: "line", a, b, w, color, dashed });
export const poly = (pts: Vec2[], color = "#222", w = 1.4, closed = false, dashed = false): Prim => ({ k: "poly", pts, w, color, closed, dashed });
export const shape = (pts: Vec2[], fill: string, stroke = "#222"): Prim => ({ k: "shape", pts, fill, stroke });
export const circle = (c: Vec2, r: number, fill = "none", stroke = "#222"): Prim => ({ k: "circle", c, r, fill, stroke });
export const arc = (c: Vec2, r: number, from: number, to: number, color = "#222", w = 1.4): Prim => ({ k: "arc", c, r, from, to, w, color });
/** Text whose box is vertically centred on `at`; `anchor` says which x it starts, centres or ends at. */
export const text = (at: Vec2, t: string, size = 12, color = "#222", anchor: "start" | "middle" | "end" = "middle"): Prim => ({ k: "text", at, text: t, size, color, anchor });
export const vector = (a: Vec2, b: Vec2, color = "#222", dashed = false): Prim => ({ k: "vector", a, b, color, dashed });
export const head = (tip: Vec2, dir: number, color = "#222"): Prim => ({ k: "head", tip, dir, color });
export const dot = (c: Vec2, color = "#222"): Prim => ({ k: "dot", c, color });

/** Same sampling as Scene2D arcs (3 degree steps). Angles in radians. */
export function arcSamples(c: Vec2, r: number, from: number, to: number): Vec2[] {
  const fromDeg = from / DEG, toDeg = to / DEG;
  const steps = Math.max(2, Math.ceil(Math.abs(toDeg - fromDeg) / 3));
  return Array.from({ length: steps + 1 }, (_, k) => { const a = (fromDeg + (toDeg - fromDeg) * k / steps) * DEG; return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }; });
}

const circlePoly = (c: Vec2, r: number, n: number) => Array.from({ length: n }, (_, k) => ({ x: c.x + r * Math.cos(2 * Math.PI * k / n), y: c.y + r * Math.sin(2 * Math.PI * k / n) }));

/** Rounded-rectangle outline (view or world), corners sampled every 15 degrees. */
export function roundedRectPoints(c: Vec2, w: number, h: number, r: number, step = 5): Vec2[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return [v(c.x - w / 2, c.y - h / 2), v(c.x + w / 2, c.y - h / 2), v(c.x + w / 2, c.y + h / 2), v(c.x - w / 2, c.y + h / 2)];
  const out: Vec2[] = [];
  const corners: [number, number, number][] = [[w / 2 - rr, h / 2 - rr, 0], [-(w / 2 - rr), h / 2 - rr, 90], [-(w / 2 - rr), -(h / 2 - rr), 180], [w / 2 - rr, -(h / 2 - rr), 270]];
  for (const [x, y, a0] of corners) for (let d = 0; d <= 90; d += step) out.push(v(c.x + x + rr * Math.cos((a0 + d) * DEG), c.y + y + rr * Math.sin((a0 + d) * DEG)));
  return out;
}

/** The marker triangle Scene2D draws at a vector tip, in view px. */
function headView(tip: Vec2, u: Vec2): Vec2[] {
  const n = perp(u), base = sub(tip, mul(u, ARROW_HEAD.back));
  return [add(tip, mul(u, ARROW_HEAD.forward)), add(base, mul(n, ARROW_HEAD.halfWidth)), sub(base, mul(n, ARROW_HEAD.halfWidth))];
}

/** World direction (radians) -> view unit vector (view y points down). */
const viewDir = (dir: number): Vec2 => ({ x: Math.cos(dir), y: -Math.sin(dir) });

export function drawPrims(prims: Prim[], ctx: PartContext): Scene2DShape[] {
  const out: Scene2DShape[] = [];
  const W = (p: Vec2) => ctx.view.toWorld(p);
  for (const p of prims) {
    switch (p.k) {
      case "line": out.push({ kind: "segment", from: p.a, to: p.b, color: p.color, width: p.w, dashed: !!p.dashed }); break;
      case "poly": { const pts = p.closed ? [...p.pts, p.pts[0]!] : p.pts; for (let i = 1; i < pts.length; i++) out.push({ kind: "segment", from: pts[i - 1]!, to: pts[i]!, color: p.color, width: p.w, dashed: !!p.dashed }); break; }
      case "shape": out.push({ kind: "polygon", points: p.pts, fill: p.fill, stroke: p.stroke }); break;
      case "circle": out.push({ kind: "circle", center: p.c, r: p.r, fill: p.fill, stroke: p.stroke }); break;
      case "arc": out.push({ kind: "arc", center: p.c, r: p.r, fromDeg: p.from / DEG, toDeg: p.to / DEG, color: p.color, width: p.w }); break;
      case "text": { const c = ctx.view.toView(p.at); out.push({ kind: "label", at: W({ x: c.x, y: c.y + textBaselineOffset(p.size) }), text: p.text, color: p.color, size: p.size, anchor: p.anchor ?? "middle" }); break; }
      case "vector": out.push({ kind: "vector", at: p.a, v: sub(p.b, p.a), color: p.color, dashed: !!p.dashed }); break;
      case "head": { const t = ctx.view.toView(p.tip); out.push({ kind: "polygon", points: headView(t, viewDir(p.dir)).map(W), fill: p.color, stroke: "none" }); break; }
      case "dot": out.push({ kind: "point", at: p.c, color: p.color }); break;
      case "rect": out.push({ kind: "rect", origin: { x: p.c.x - p.w / 2, y: p.c.y - p.h / 2 }, size: { w: p.w, h: p.h }, fill: p.fill, stroke: p.stroke, rx: p.rxPx }); break;
    }
  }
  return out;
}

/** Grid-colour strokes (#eee) are low priority: labels may sit over them behind a halo. */
export const GRID_COLOR = "#eee";
const soft = (color: string): { soft?: true } => color === GRID_COLOR ? { soft: true } : {};

export function collidePrims(prims: Prim[], ctx: PartContext): CollisionShape[] {
  const out: CollisionShape[] = [];
  const V = (p: Vec2) => ctx.view.toView(p);
  const closed = (pts: Vec2[], fill: string, stroke: string) => {
    if (fill !== "none") out.push({ kind: "area", points: pts });
    if (stroke !== "none") out.push({ kind: "stroke", points: pts, r: 0.5, closed: true });
  };
  for (const p of prims) {
    switch (p.k) {
      case "line": out.push({ kind: "stroke", points: [V(p.a), V(p.b)], r: p.w / 2, ...soft(p.color) }); break;
      case "poly": out.push({ kind: "stroke", points: p.pts.map(V), r: p.w / 2, closed: !!p.closed, ...soft(p.color) }); break;
      case "shape": closed(p.pts.map(V), p.fill, p.stroke); break;
      case "circle": {
        const c = V(p.c), r = p.r * ctx.view.scale;
        if (p.fill !== "none") out.push({ kind: "disc", c, r: r + (p.stroke !== "none" ? 0.5 : 0) });
        else out.push({ kind: "stroke", points: circlePoly(c, r, 96), r: 0.5 + r * (1 - Math.cos(Math.PI / 96)), closed: true, ...soft(p.stroke) });
        break;
      }
      case "arc": out.push({ kind: "stroke", points: arcSamples(p.c, p.r, p.from, p.to).map(V), r: p.w / 2, ...soft(p.color) }); break;
      case "text": { const c = V(p.at); out.push({ kind: "area", points: textBoxPolygon(c.x, c.y + textBaselineOffset(p.size), p.text, p.size, p.anchor ?? "middle"), strict: true }); break; }
      case "vector": {
        const a = V(p.a), b = V(p.b), l = dist(a, b);
        if (l === 0) { out.push({ kind: "disc", c: a, r: 0.8 }); break; }
        const u = unit(sub(b, a));
        out.push({ kind: "stroke", points: [a, b], r: 0.8 }, { kind: "area", points: headView(b, u) });
        break;
      }
      case "head": out.push({ kind: "area", points: headView(V(p.tip), viewDir(p.dir)) }); break;
      case "dot": out.push({ kind: "disc", c: V(p.c), r: 3 }); break;
      case "rect": {
        // Chords of the 5-degree sampled corners lie inside the true arc by at most rx(1 - cos 2.5deg).
        const pts = roundedRectPoints(p.c, p.w, p.h, p.rxPx / ctx.view.scale).map(V);
        if (p.fill !== "none") out.push({ kind: "area", points: pts });
        if (p.stroke !== "none") out.push({ kind: "stroke", points: pts, r: 0.5 + p.rxPx * (1 - Math.cos(2.5 * DEG)), closed: true });
        break;
      }
    }
  }
  return out;
}

/** World bounding box of the primitives (text measured at the view scale). */
export function boxPrims(prims: Prim[], ctx: PartContext) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (p: Vec2) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
  for (const s of collidePrims(prims, ctx)) {
    if (s.kind === "disc") { const c = ctx.view.toWorld(s.c), r = s.r / ctx.view.scale; grow(v(c.x - r, c.y - r)); grow(v(c.x + r, c.y + r)); continue; }
    const r = s.kind === "stroke" ? s.r / ctx.view.scale : 0;
    for (const q of s.points) { const w = ctx.view.toWorld(q); grow(v(w.x - r, w.y - r)); grow(v(w.x + r, w.y + r)); }
  }
  return { x0, y0, x1, y1 };
}

// --- geometry built by a part ------------------------------------------------------

export interface Geo {
  prims: Prim[];
  /** Named anchors (no argument). */
  anchors: Record<string, Vec2>;
  /** Anchors with an argument, e.g. rim(angle), at(t). */
  argAnchors?: Record<string, (arg: number) => Vec2 | undefined>;
  /** Closed outline (world) for inside relations and centre labels. */
  outline?: Vec2[];
  /** Label anchor (world) and candidate order. */
  label?: { at: Vec2; candidates: LabelPosition[] };
  radius?: number;
  segment?: [Vec2, Vec2];
  curve?: Vec2[];
  /** Exact distance (world) from a point to the curve, for onCurve checks. */
  residual?: (p: Vec2) => number | undefined;
  refs?: Record<string, TkQuantity>;
  /** Internal text that must fit inside a frame (px clearance checked in the gate). */
  fits?: { text: Prim & { k: "text" }; frame: Vec2[] }[];
}

export const AROUND: LabelPosition[] = ["above-right", "right", "above", "below-right", "below", "left", "above-left", "below-left"];
export const CLOSED: LabelPosition[] = ["center", "above", "below", "right", "left", "above-right", "below-right", "above-left", "below-left"];
export const ABOVE_FIRST: LabelPosition[] = ["above", "below", "above-right", "above-left", "below-right", "below-left", "right", "left"];
export const SIDE_FIRST: LabelPosition[] = ["right", "left", "above-right", "below-right", "above-left", "below-left", "above", "below"];

const ctxKey = Symbol("toolkit.ctx");
const cache = new WeakMap<object, { key: string; geo: Geo }>();

export interface KitDef<P> {
  type: string;
  aliases?: string[];
  category: Category;
  description: string;
  positioning: "placed" | "points";
  pointProps?: { name: string; list?: boolean; optional?: boolean; min?: number }[];
  propKeys: string[];
  props(spec: ElementSpec, ctx: PartContext): P;
  /** Documented anchors; "name(arg)" for argument anchors. */
  anchors: string[];
  anchorArgs?: Record<string, "angle" | "number" | "length">;
  geometry(inst: PartInstance<P>, ctx: PartContext): Geo;
  quantity?(inst: PartInstance<P>, ctx: PartContext): ArrowQuantity | undefined;
  gate?(inst: PartInstance<P>, ctx: PartContext, geo: Geo): void;
  elementRefs?(spec: ElementSpec): string[];
  link?(inst: PartInstance<P>, get: LinkLookup, ctx: PartContext): void;
  /** Built-in contact rule; see PartDefinition.contactWith. */
  contactWith?(inst: PartInstance<P>, other: PartInstance, ctx: PartContext): string | undefined;
  /** Point props whose referenced elements this part may touch (e.g. a leader's target). */
  touchRefs?: string[];
  /** Placed parts that sit on what they are attached to (supports, pivots, hinges): may touch the elements named by their `at`/`attach` relations. */
  touchPlacement?: boolean;
  /** Accepts a label (default true). */
  labels?: boolean;
  /** Engine hooks this part supports: outline (closed), radius (round, tangentTo), segment (straight, tangentTo), curve (onCurve). */
  hooks?: ("outline" | "radius" | "segment" | "curve")[];
  /** Short option docs for the catalogue: key -> meaning. */
  options?: Record<string, string>;
}

export type Category = "general" | "mechanics" | "fields" | "fluids" | "circuits" | "logic" | "plots";

/** Catalogue metadata for every kit part, in registration order. */
export const KIT_PARTS: { type: string; aliases: string[]; category: Category; description: string; anchors: string[]; options: Record<string, string>; positioning: "placed" | "points" }[] = [];

function ctxOf(inst: PartInstance, fallback?: PartContext): PartContext {
  const c = (inst.props as Record<symbol, PartContext> | undefined)?.[ctxKey] ?? fallback;
  if (!c) throw new Error(`toolkit: no context for ${inst.id}`);
  return c;
}

/** Geometry for an instance, cached by origin and points. */
export function geoOf<P>(def: KitDef<P>, inst: PartInstance<P>, ctx?: PartContext): Geo {
  const c = ctxOf(inst, ctx);
  const key = `${inst.origin.x},${inst.origin.y}|${JSON.stringify(inst.points)}|${(inst.props as Record<string, unknown>).__linkVersion ?? 0}`;
  const hit = cache.get(inst);
  if (hit && hit.key === key) return hit.geo;
  const geo = def.geometry(inst, c);
  cache.set(inst, { key, geo });
  return geo;
}

/** Register a kit part: derives the full PartDefinition from its geometry. */
export function definePart<P extends object>(d: KitDef<P>): PartDefinition<P> {
  const def: PartDefinition<P> = {
    type: d.type, aliases: d.aliases, description: d.description,
    positioning: d.positioning, pointProps: d.pointProps, propKeys: d.propKeys,
    props: (spec, ctx) => { const p = d.props(spec, ctx); Object.defineProperty(p, ctxKey, { value: ctx, enumerable: false }); return p; },
    anchorNames: d.anchors, anchorArgs: d.anchorArgs,
    anchor: (inst, name, arg, ctx) => {
      const g = geoOf(d, inst, ctx);
      if (name === "origin") return g.anchors.origin ?? inst.origin;
      if (arg !== undefined) return g.argAnchors?.[name]?.(arg);
      return g.anchors[name];
    },
    box: (inst, ctx) => boxPrims(geoOf(d, inst, ctx).prims, ctx),
    draw: (inst, ctx) => drawPrims(geoOf(d, inst, ctx).prims, ctx),
    collide: (inst, ctx) => collidePrims(geoOf(d, inst, ctx).prims, ctx),
    refs: (inst, ctx) => ({ ...posRefs(inst, ctx, d.positioning), ...(geoOf(d, inst, ctx).refs ?? {}) }),
    gate: (inst, ctx) => { const g = geoOf(d, inst, ctx); checkFits(inst, g, ctx); checkOwnText(inst, g, ctx); d.gate?.(inst, ctx, g); },
  };
  if (d.labels !== false) def.label = (inst, ctx) => { const g = geoOf(d, inst, ctx); return { anchor: g.label?.at ?? inst.origin, candidates: g.label?.candidates ?? AROUND }; };
  // Optional hooks exist only for parts that declare them, so the engine's
  // "is it round / straight / closed / a curve" tests stay meaningful.
  if (d.hooks?.includes("outline")) def.outline = inst => geoOf(d, inst).outline ?? [];
  if (d.hooks?.includes("radius")) def.radius = inst => geoOf(d, inst).radius ?? 0;
  if (d.hooks?.includes("segment")) def.segment = inst => geoOf(d, inst).segment ?? [inst.origin, inst.origin];
  if (d.hooks?.includes("curve")) { def.curve = (inst, ctx) => geoOf(d, inst, ctx).curve ?? []; def.curveResidual = (inst, p) => geoOf(d, inst).residual?.(p); }
  if (d.quantity) def.quantity = inst => d.quantity!(inst, ctxOf(inst));
  if (d.elementRefs) def.elementRefs = d.elementRefs;
  if (d.contactWith) def.contactWith = d.contactWith;
  if (d.link || d.touchRefs || d.touchPlacement) def.link = (inst, get, ctx) => {
    if (d.touchPlacement) {
      const rels = [inst.spec.at === undefined ? [] : [{ at: inst.spec.at }], inst.spec.place === undefined ? [] : Array.isArray(inst.spec.place) ? inst.spec.place : [inst.spec.place]].flat() as Record<string, unknown>[];
      const ids = rels.flatMap(r => [r.at, r.to].map(refElement)).filter((x): x is string => !!x);
      inst.touches = [...new Set([...(inst.touches ?? []), ...ids])];
    }
    if (d.touchRefs) inst.touches = [...new Set([...(inst.touches ?? []), ...d.touchRefs.flatMap(k => { const val = inst.spec[k]; return (Array.isArray(val) ? val : [val]).map(refElement).filter((x): x is string => !!x); })])];
    d.link?.(inst, get, ctx); (inst.props as Record<string, unknown>).__linkVersion = ((inst.props as Record<string, number>).__linkVersion ?? 0) + 1; };
  registerPart(def as PartDefinition);
  KIT_PARTS.push({ type: d.type, aliases: d.aliases ?? [], category: d.category, description: d.description, anchors: d.anchors, options: d.options ?? {}, positioning: d.positioning });
  return def;
}

/** Element id named by a point reference ("id", "id.anchor", {ref}). */
export const refElement = (r: unknown): string | undefined => typeof r === "string" ? /^([A-Za-z_][A-Za-z0-9_-]*)/.exec(r.trim())?.[1] : r && typeof r === "object" && typeof (r as { ref?: unknown }).ref === "string" ? refElement((r as { ref: string }).ref) : undefined;

function posRefs(inst: PartInstance, ctx: PartContext, positioning: string): Record<string, TkQuantity> {
  if (positioning !== "placed") return {};
  return { x: { value: inst.origin.x * ctx.worldUnitSI, dim: LENGTH }, y: { value: inst.origin.y * ctx.worldUnitSI, dim: LENGTH } };
}

/** Internal text must clear its frame by 1 px on every side. */
function checkFits(inst: PartInstance, g: Geo, ctx: PartContext): void {
  for (const f of g.fits ?? []) {
    const c = ctx.view.toView(f.text.at);
    const box = textBoxPolygon(c.x, c.y + textBaselineOffset(f.text.size), f.text.text, f.text.size, f.text.anchor ?? "middle");
    const frame = f.frame.map(p => ctx.view.toView(p));
    const inside = box.every(p => pointInPolygon(p, frame) && pointPolylineDist(p, [...frame, frame[0]!]) >= 1);
    if (!inside) {
      const w = box[1]!.x - box[0]!.x, h = box[2]!.y - box[0]!.y;
      fail("E_INVALID_VALUE", [inst.id], `Text "${f.text.text}" of ${inst.type} "${inst.id}" does not fit inside its symbol at this zoom (${w.toFixed(1)} x ${h.toFixed(1)} px of text)`, { measured: { textWidthPx: w, textHeightPx: h, pxPerWorldUnit: ctx.view.scale }, suggestion: `Increase "size" (or "scale") of "${inst.id}", or zoom the world bounds in.` });
    }
  }
}

/**
 * A part's own text must clear its own lines and outlines by 1 px and must not
 * overlap its other text (the gate only compares different elements).
 */
function checkOwnText(inst: PartInstance, g: Geo, ctx: PartContext): void {
  const texts = g.prims.filter((p): p is Prim & { k: "text" } => p.k === "text");
  if (!texts.length) return;
  const strokes = collidePrims(g.prims.filter(p => p.k !== "text"), ctx).filter(sh => sh.kind === "stroke");
  const boxes = texts.map(t => collidePrims([t], ctx)[0] as CollisionShape & { kind: "area" });
  boxes.forEach((b, k) => {
    for (const sh of strokes) {
      const pts = sh.closed ? [...sh.points, sh.points[0]!] : sh.points;
      const inside = b.points.some(q => pointPolylineDist(q, pts) < sh.r + 1) || pts.some(q => pointInPolygon(q, b.points)) || edgesCross(b.points, pts);
      if (inside) fail("E_INVALID_VALUE", [inst.id], `A line of ${inst.type} "${inst.id}" runs through its own text "${texts[k]!.text}"`, { measured: { text: texts[k]!.text, pxPerWorldUnit: ctx.view.scale }, suggestion: "Enlarge the part, use fewer ticks/rings/entries, or a smaller text size." });
    }
    for (let j = 0; j < k; j++) {
      const o = boxes[j]!, A = boxBounds(b.points), B = boxBounds(o.points);
      if (A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1) fail("E_INVALID_VALUE", [inst.id], `Texts "${texts[j]!.text}" and "${texts[k]!.text}" of ${inst.type} "${inst.id}" overlap`, { measured: { pxPerWorldUnit: ctx.view.scale }, suggestion: "Enlarge the part or use a smaller text size." });
    }
  });
}
const boxBounds = (pts: Vec2[]) => ({ x0: Math.min(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), x1: Math.max(...pts.map(p => p.x)), y1: Math.max(...pts.map(p => p.y)) });
function edgesCross(poly: Vec2[], line: Vec2[]): boolean {
  const c = (a: Vec2, b: Vec2, d: Vec2) => (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    for (let k = 1; k < line.length; k++) {
      const p = line[k - 1]!, q = line[k]!, d1 = c(a, b, p), d2 = c(a, b, q), d3 = c(p, q, a), d4 = c(p, q, b);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

// --- property helpers ------------------------------------------------------------------

export { angleProp, boolProp, colorProp, lengthProp, propPath, strokeWidthProp };

export function numProp(spec: ElementSpec, key: string, ctx: PartContext, opts: { default?: number; min?: number; max?: number; integer?: boolean } = {}): number {
  const val = spec[key];
  if (val === undefined) {
    if (opts.default !== undefined) return opts.default;
    fail("E_SCHEMA", [spec.id], `${spec.type} "${spec.id}" needs "${key}"`, { path: propPath(spec, key) });
  }
  const n = evalNumber(val as NumLike, ctx, propPath(spec, key), [spec.id]);
  if (opts.integer && !Number.isInteger(n)) fail("E_INVALID_VALUE", [spec.id], `"${key}" of "${spec.id}" must be a whole number`, { path: propPath(spec, key), measured: { [key]: n } });
  if ((opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) fail("E_INVALID_VALUE", [spec.id], `"${key}" of "${spec.id}" must be in [${opts.min ?? "-inf"}, ${opts.max ?? "inf"}]`, { path: propPath(spec, key), measured: { [key]: n } });
  return n;
}

export function enumProp<T extends string>(spec: ElementSpec, key: string, values: readonly T[], def: T): T {
  const val = spec[key];
  if (val === undefined) return def;
  if (typeof val !== "string" || !(values as readonly string[]).includes(val)) fail("E_SCHEMA", [spec.id], `"${key}" of "${spec.id}" must be one of ${values.join(", ")}`, { path: propPath(spec, key), measured: { [key]: val } });
  return val as T;
}

export function textProp(spec: ElementSpec, key: string, def?: string): string | undefined {
  const val = spec[key];
  if (val === undefined) return def === undefined ? undefined : formatLabelMarkup(def, [spec.id]);
  if (typeof val !== "string" || val === "") fail("E_SCHEMA", [spec.id], `"${key}" of "${spec.id}" must be a non-empty string`, { path: propPath(spec, key) });
  return formatLabelMarkup(val, [spec.id]);
}

export function sizeProp(spec: ElementSpec, key = "textSize", def: number = TOOLKIT_TEXT.defaultLabelSize): number {
  const val = spec[key];
  if (val === undefined) return def;
  if (!(TOOLKIT_TEXT.labelSizes as readonly unknown[]).includes(val)) fail("E_STYLE", [spec.id], `Font size ${JSON.stringify(val)} on "${spec.id}" is not in the style contract`, { path: propPath(spec, key), suggestion: "Use 11, 12 or 13." });
  return val as number;
}

export function listProp<T>(spec: ElementSpec, key: string, opts: { min?: number; max?: number; optional?: boolean } = {}): T[] {
  const val = spec[key];
  if (val === undefined && opts.optional) return [];
  if (!Array.isArray(val)) fail("E_SCHEMA", [spec.id], `"${key}" of "${spec.id}" must be a list`, { path: propPath(spec, key) });
  if ((opts.min !== undefined && val.length < opts.min) || (opts.max !== undefined && val.length > opts.max)) fail("E_INVALID_VALUE", [spec.id], `"${key}" of "${spec.id}" must have ${opts.min ?? 0}-${opts.max ?? "any"} entries`, { path: propPath(spec, key), measured: { count: val.length } });
  return val as T[];
}

export function idProp(spec: ElementSpec, key: string, optional = false): string {
  const val = spec[key];
  if (val === undefined && optional) return "";
  if (typeof val !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(val)) fail("E_SCHEMA", [spec.id], `"${key}" of "${spec.id}" must be an element id`, { path: propPath(spec, key) });
  return val;
}

export const lengthQ = (worldLen: number, ctx: PartContext): TkQuantity => ({ value: worldLen * ctx.worldUnitSI, dim: LENGTH });
export const angleQ = (a: number): TkQuantity => ({ value: a, dim: ANGLE });
export const ptsOf = (inst: PartInstance, name: string) => inst.points[name] as Vec2;
export const listOf = (inst: PartInstance, name: string) => inst.points[name] as Vec2[];

/** Common size/orientation props for placed symbols. */
export function frameProps(spec: ElementSpec, ctx: PartContext, defScale = 1) {
  return { rotation: angleProp(spec, "rotation", ctx, 0), scale: numProp(spec, "scale", ctx, { default: defScale, min: 0.1, max: 20 }), flip: boolProp(spec, "flip") };
}
export const frameOf = (inst: PartInstance<{ rotation: number; scale: number; flip: boolean }>): Frame => ({ o: inst.origin, rot: inst.props.rotation, s: inst.props.scale, flip: inst.props.flip });

/** Px length in world units. */
export const px = (ctx: PartContext, n: number) => n / ctx.view.scale;

/** Arrow-shaft polyline with a head at its last point; the shaft stops under the head. */
export function arrowPath(pts: Vec2[], ctx: PartContext, color: string, w = 1.6, dashed = false, startHead = false): Prim[] {
  const out: Prim[] = [];
  const trim = px(ctx, 3);
  const shaft = pts.map(p => ({ ...p }));
  const endDir = (a: Vec2, b: Vec2) => angleOf(sub(b, a));
  const n = shaft.length;
  if (n < 2) return out;
  const de = endDir(shaft[n - 2]!, shaft[n - 1]!), tipE = shaft[n - 1]!;
  shaft[n - 1] = sub(tipE, mul(v(Math.cos(de), Math.sin(de)), trim));
  let tipS: Vec2 | undefined, ds = 0;
  if (startHead) { ds = endDir(shaft[1]!, shaft[0]!); tipS = shaft[0]!; shaft[0] = sub(tipS, mul(v(Math.cos(ds), Math.sin(ds)), trim)); }
  out.push(poly(shaft, color, w, false, dashed));
  out.push(head(tipE, de, color));
  if (tipS) out.push(head(tipS, ds, color));
  return out;
}

/** Point at fraction t of a polyline's length, with the local direction. */
export function alongPolyline(pts: Vec2[], t: number): { p: Vec2; dir: Vec2 } {
  const lens = pts.slice(1).map((q, k) => dist(q, pts[k]!));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let k = 0; k < lens.length; k++) {
    if (d <= lens[k]! || k === lens.length - 1) { const f = lens[k]! === 0 ? 0 : Math.min(1, d / lens[k]!); return { p: lerp(pts[k]!, pts[k + 1]!, f), dir: unit(sub(pts[k + 1]!, pts[k]!)) }; }
    d -= lens[k]!;
  }
  return { p: pts[0]!, dir: v(1, 0) };
}
export const polylineLen = (pts: Vec2[]) => pts.slice(1).reduce((s, q, k) => s + dist(q, pts[k]!), 0);

/** Label candidates beside a line with direction `dir` (world). */
export const besideLine = (dir: Vec2): LabelPosition[] => Math.abs(dir.x) >= Math.abs(dir.y) ? ABOVE_FIRST : SIDE_FIRST;

/** Rendered text size in px (union of glyph box and Scene2D backdrop). */
export function textPx(t: string, size: number): { w: number; h: number } {
  const b = textBox(0, 0, t, size, "middle");
  return { w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

/** A centred text primitive that must fit inside `frame` (checked by the gate). */
export function fittedText(geoFits: NonNullable<Geo["fits"]>, at: Vec2, t: string, size: number, color: string, frame: Vec2[]): Prim {
  const p = text(at, t, size, color) as Prim & { k: "text" };
  geoFits.push({ text: p, frame });
  return p;
}

export function mkQuantity(name: string, value: TkQuantity, angle: number, tail: Vec2): ArrowQuantity {
  return { quantity: name, value, components: { x: value.value * Math.cos(angle), y: value.value * Math.sin(angle) }, tail };
}

export { pointInPolygon, pointPolylineDist };
export type { PartContext, PartInstance, Vec2, ElementSpec, TkQuantity, LabelPosition, LinkLookup };

// --- samples ----------------------------------------------------------------------------

/**
 * A sample composition fragment for a part: the part itself (id `id`, listed
 * first) plus any helpers it needs, centred at `c` inside a 4 x 3 world-unit
 * cell. `r` gives seeded variation. Samples drive the catalogue, the contact
 * sheet, the per-part tests and the fuzz generator.
 */
export type Sample = (id: string, c: Vec2, r: () => number) => ElementSpec[];
export const PART_SAMPLES = new Map<string, Sample>();
export function addSample(type: string, fn: Sample): void {
  if (PART_SAMPLES.has(type)) throw new Error(`duplicate sample for ${type}`);
  PART_SAMPLES.set(type, fn);
}
/** Rounded literal helpers for samples. */
export const rr = (x: number) => Math.round(x * 1000) / 1000;
export const P = (x: number, y: number) => ({ x: rr(x), y: rr(y) });
export const between = (r: () => number, a: number, b: number) => rr(a + (b - a) * r());
export const pickOf = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
