/**
 * Part interface and registry, plus the basic shapes. A part turns an element
 * spec into resolved properties, named anchors, Scene2D shapes and view-space
 * collision shapes. Agent 2 adds physics/electronics parts through
 * registerPart(); see docs/toolkit/engine.md for the contract.
 */
import type { Scene2DShape } from "../diagram/scene2d.js";
import type { Vec2 } from "../diagram/primitives.js";
import { fail } from "./errors.js";
import { ANGLE, DIMLESS, LENGTH, dimLabel, evalAngle, evalLength, evalNumber, evalQuantity, qdimEqual, mapScope } from "./expr.js";
import type { QDim, TkQuantity, ValueContext } from "./expr.js";
import type { CollisionShape } from "./geometry.js";
import { TOOLKIT_STROKE_WIDTHS, TOOLKIT_TEXT, resolvePaletteColor } from "./style.js";
import { formatLabelMarkup, labelVerticalExtent, labelVerticalExtentFor, measureLabelWidth } from "./text_metrics.js";
import type { ElementSpec, LabelPosition, NumLike } from "./types.js";

/** World-to-view mapping (equal scaling, +y up in world, y down in view). */
export interface ViewMap {
  toView(p: Vec2): Vec2;
  toWorld(p: Vec2): Vec2;
  /** Pixels per world unit. */
  scale: number;
}

export interface PartContext extends ValueContext {
  view: ViewMap;
  /** SI quantity per world unit of arrow length, by quantity name. */
  scales: Map<string, { per: TkQuantity; text: string }>;
  /** Canvas rectangle in world units (set by compose); routers keep paths inside it. */
  canvas?: { x0: number; y0: number; x1: number; y1: number };
}

export interface PartInstance<P = any> {
  id: string;
  type: string;
  spec: ElementSpec;
  props: P;
  /** World position of the origin. For point-defined parts, the first point. */
  origin: Vec2;
  /** Resolved point properties of point-defined parts. */
  points: Record<string, Vec2 | Vec2[]>;
  /** Elements this instance may touch without a `mayTouch` in the model, set by a part's `link` hook (e.g. a plot series and its axes). */
  touches?: string[];
}

/** Read access to already-resolved elements, given to `link` hooks. */
export type LinkLookup = (id: string) => { inst: PartInstance; def: PartDefinition };

/** An arrow that encodes a physical quantity at a declared scale. */
export interface ArrowQuantity {
  quantity: string;
  value: TkQuantity;
  /** SI components of the vector. */
  components: { x: number; y: number };
  tail: Vec2;
}

export interface PartDefinition<P = any> {
  type: string;
  aliases?: string[];
  description: string;
  /** "placed": an origin positioned by relations; "points": geometry from point properties. */
  positioning: "placed" | "points";
  /** Point properties of point-defined parts (PointRef, or PointRef[] when list). */
  pointProps?: { name: string; list?: boolean; optional?: boolean; min?: number }[];
  /** Spec keys this part reads (besides the common ones); unknown keys are rejected. */
  propKeys: string[];
  /** Evaluate and validate properties. Must not depend on position. */
  props(spec: ElementSpec, ctx: PartContext): P;
  /** Documented anchor names; an `(arg)` suffix means the anchor takes an argument. */
  anchorNames: string[];
  /** How an anchor argument is evaluated. */
  anchorArgs?: Record<string, "angle" | "number" | "length">;
  /** Absolute world position of an anchor. For placed parts it must equal origin + f(props). */
  anchor(inst: PartInstance<P>, name: string, arg: number | undefined, ctx: PartContext): Vec2 | undefined;
  /** World bounding box (used by leftOf/rightOf/above/below). */
  box(inst: PartInstance<P>, ctx: PartContext): { x0: number; y0: number; x1: number; y1: number };
  /** Circle-like parts: radius in world units (tangentTo). */
  radius?(inst: PartInstance<P>): number;
  /** Line-like parts: world segment (tangentTo). */
  segment?(inst: PartInstance<P>): [Vec2, Vec2];
  /** Closed parts: world outline polygon (inside relations, inside labels). */
  outline?(inst: PartInstance<P>): Vec2[];
  /** Curve-like parts: world polyline (onCurve checks). */
  curve?(inst: PartInstance<P>, ctx: PartContext): Vec2[];
  /** Exact distance (world units) from a point to the curve, when known analytically. */
  curveResidual?(inst: PartInstance<P>, p: Vec2): number | undefined;
  /** Quantity encoded by an arrow. */
  quantity?(inst: PartInstance<P>): ArrowQuantity | undefined;
  /** Values exposed to checks as `<id>.<name>`. */
  refs?(inst: PartInstance<P>, ctx: PartContext): Record<string, TkQuantity>;
  /** Scene2D shapes in world coordinates. */
  draw(inst: PartInstance<P>, ctx: PartContext): Scene2DShape[];
  /** View-space collision shapes, stroke widths included. */
  collide(inst: PartInstance<P>, ctx: PartContext): CollisionShape[];
  /** Label anchor and default candidate order. */
  label?(inst: PartInstance<P>, ctx: PartContext): { anchor: Vec2; candidates: LabelPosition[] };
  /** Part-specific gate checks (e.g. minimum arrow length). */
  gate?(inst: PartInstance<P>, ctx: PartContext): void;
  /** Element ids this part reads beyond its point references (e.g. the pulleys a rope wraps); they become dependencies. */
  elementRefs?(spec: ElementSpec): string[];
  /** Runs once after the part's own origin and points are resolved; may read the referenced elements and update its props or `touches`. */
  link?(inst: PartInstance<P>, get: LinkLookup, ctx: PartContext): void;
  /**
   * Built-in contact rule (Agent 3): return a reason when this part may touch
   * `other` without a model mayTouch (phasors sharing the polar origin, wires
   * crossing without a junction), else undefined. Called once per pair.
   */
  contactWith?(inst: PartInstance<P>, other: PartInstance, ctx: PartContext): string | undefined;
}

const registry = new Map<string, PartDefinition>();

export function registerPart(def: PartDefinition): void {
  for (const name of [def.type, ...(def.aliases ?? [])]) {
    if (registry.has(name)) throw new Error(`Part type "${name}" is already registered`);
    registry.set(name, def);
  }
}

export function getPart(type: string): PartDefinition | undefined {
  return registry.get(type);
}

export function listParts(): PartDefinition[] {
  return [...new Set(registry.values())];
}

// --- shared helpers for part authors ----------------------------------------

export const COMMON_KEYS = ["id", "type", "place", "at", "prefer", "label", "mayTouch", "color"];

export function propPath(spec: ElementSpec, key: string): string {
  return `elements[${spec.id}].${key}`;
}

export function lengthProp(spec: ElementSpec, key: string, ctx: PartContext, opts: { default?: number; min?: number; positive?: boolean } = {}): number {
  const v = spec[key];
  if (v === undefined) {
    if (opts.default !== undefined) return opts.default;
    fail("E_SCHEMA", [spec.id], `${spec.type} "${spec.id}" needs "${key}"`, { path: propPath(spec, key), suggestion: `Add "${key}": a length such as 2 or "2 m".` });
  }
  const n = evalLength(v as NumLike, ctx, propPath(spec, key), [spec.id]);
  if (opts.positive && !(n > 0)) fail("E_INVALID_VALUE", [spec.id], `"${key}" of "${spec.id}" must be positive`, { path: propPath(spec, key), measured: { [key]: n } });
  if (opts.min !== undefined && n < opts.min) fail("E_INVALID_VALUE", [spec.id], `"${key}" of "${spec.id}" must be at least ${opts.min}`, { path: propPath(spec, key), measured: { [key]: n } });
  return n;
}

export function angleProp(spec: ElementSpec, key: string, ctx: PartContext, def?: number): number {
  const v = spec[key];
  if (v === undefined) {
    if (def !== undefined) return def;
    fail("E_SCHEMA", [spec.id], `${spec.type} "${spec.id}" needs "${key}"`, { path: propPath(spec, key), suggestion: `Add "${key}": degrees as a JSON number, or an expression like "30 deg".` });
  }
  return evalAngle(v as NumLike, ctx, propPath(spec, key), [spec.id]);
}

export function colorProp(spec: ElementSpec, key: string, def: string): string {
  const v = spec[key];
  if (v === undefined) return def;
  if (v === "none") return "none";
  const c = typeof v === "string" ? resolvePaletteColor(v) : undefined;
  if (!c) fail("E_STYLE", [spec.id], `Colour ${JSON.stringify(v)} on "${spec.id}" is not in the Kinetra palette`, { path: propPath(spec, key), suggestion: "Use a palette name such as ink, force, normal, friction, velocity, acceleration, body, bodyFill, guide (docs/toolkit/style-contract.md)." });
  return c;
}

export function strokeWidthProp(spec: ElementSpec, key: string, def: number): number {
  const v = spec[key];
  if (v === undefined) return def;
  if (typeof v !== "number" || !(TOOLKIT_STROKE_WIDTHS as readonly number[]).includes(v)) fail("E_STYLE", [spec.id], `Stroke width ${JSON.stringify(v)} on "${spec.id}" is not in the style contract`, { path: propPath(spec, key), suggestion: `Use one of ${TOOLKIT_STROKE_WIDTHS.join(", ")} px.` });
  return v as number;
}

export function boolProp(spec: ElementSpec, key: string, def = false): boolean {
  const v = spec[key];
  if (v === undefined) return def;
  if (typeof v !== "boolean") fail("E_SCHEMA", [spec.id], `"${key}" of "${spec.id}" must be true or false`, { path: propPath(spec, key) });
  return v as boolean;
}

const rot = (p: Vec2, a: number): Vec2 => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const boxOf = (pts: Vec2[]) => ({ x0: Math.min(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), x1: Math.max(...pts.map(p => p.x)), y1: Math.max(...pts.map(p => p.y)) });
const lengthQ = (worldLen: number, ctx: PartContext): TkQuantity => ({ value: worldLen * ctx.worldUnitSI, dim: LENGTH });
const posRefs = (prefix: string, p: Vec2, ctx: PartContext): Record<string, TkQuantity> => ({ [`${prefix}x`]: lengthQ(p.x, ctx), [`${prefix}y`]: lengthQ(p.y, ctx) });

/** Outline of a stroked closed polygon (stroke-width 1 in Scene2D). */
function closedShapes(world: Vec2[], filled: boolean, ctx: PartContext, strokeR = 0.5): CollisionShape[] {
  const pts = world.map(p => ctx.view.toView(p));
  return filled ? [{ kind: "area", points: pts }, { kind: "stroke", points: pts, r: strokeR, closed: true }] : [{ kind: "stroke", points: pts, r: strokeR, closed: true }];
}

const AROUND: LabelPosition[] = ["above-right", "right", "above", "below-right", "below", "left", "above-left", "below-left"];
const CLOSED: LabelPosition[] = ["center", "above", "below", "right", "left", "above-right", "below-right", "above-left", "below-left"];

// --- point ---------------------------------------------------------------------

registerPart({
  type: "point",
  description: "A dot (3 px radius). Origin: the point.",
  positioning: "placed",
  propKeys: [],
  props: () => ({}),
  anchorNames: ["center"],
  anchor: (i, n) => n === "center" || n === "origin" ? i.origin : undefined,
  box: i => ({ x0: i.origin.x, y0: i.origin.y, x1: i.origin.x, y1: i.origin.y }),
  refs: (i, ctx) => posRefs("", i.origin, ctx),
  draw: i => [{ kind: "point", at: i.origin, color: colorProp(i.spec, "color", "#222") }],
  collide: (i, ctx) => [{ kind: "disc", c: ctx.view.toView(i.origin), r: 3 }],
  label: i => ({ anchor: i.origin, candidates: AROUND }),
});

// --- rect / block ---------------------------------------------------------------

interface RectProps { w: number; h: number; rotation: number; fill: string; stroke: string; background: boolean }
const RECT_ANCHORS: Record<string, [number, number]> = { center: [0, 0], top: [0, 1], bottom: [0, -1], left: [-1, 0], right: [1, 0], topLeft: [-1, 1], topRight: [1, 1], bottomLeft: [-1, -1], bottomRight: [1, -1] };
const rectCorners = (i: PartInstance<RectProps>) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => add(i.origin, rot({ x: x! * i.props.w / 2, y: y! * i.props.h / 2 }, i.props.rotation)));
function rectPart(type: string, aliases: string[], fill: string, stroke: string, description: string): PartDefinition<RectProps> {
  return {
    type, aliases, description,
    positioning: "placed",
    propKeys: ["w", "h", "rotation", "fill", "stroke", "background"],
    props: (s, ctx) => ({ w: lengthProp(s, "w", ctx, { positive: true }), h: lengthProp(s, "h", ctx, { positive: true }), rotation: angleProp(s, "rotation", ctx, 0), fill: colorProp(s, "fill", fill), stroke: colorProp(s, "stroke", stroke), background: boolProp(s, "background") }),
    anchorNames: Object.keys(RECT_ANCHORS),
    anchor: (i, n) => { const a = n === "origin" ? [0, 0] : RECT_ANCHORS[n]; return a ? add(i.origin, rot({ x: a[0]! * i.props.w / 2, y: a[1]! * i.props.h / 2 }, i.props.rotation)) : undefined; },
    box: i => boxOf(rectCorners(i)),
    outline: i => rectCorners(i),
    refs: (i, ctx) => ({ ...posRefs("", i.origin, ctx), w: lengthQ(i.props.w, ctx), h: lengthQ(i.props.h, ctx) }),
    draw: i => i.props.rotation === 0
      ? [{ kind: "rect", origin: { x: i.origin.x - i.props.w / 2, y: i.origin.y - i.props.h / 2 }, size: { w: i.props.w, h: i.props.h }, fill: i.props.fill, stroke: i.props.stroke }]
      : [{ kind: "polygon", points: rectCorners(i), fill: i.props.fill, stroke: i.props.stroke }],
    collide: (i, ctx) => asBackground(closedShapes(rectCorners(i), i.props.fill !== "none", ctx), i.props.background),
    label: i => ({ anchor: i.origin, candidates: CLOSED }),
  };
}
registerPart(rectPart("rect", ["box"], "none", "#222", "Rectangle; origin at its centre. Props: w, h, rotation, fill, stroke, background (a region such as a medium that other elements may be drawn over; list it first)."));
registerPart(rectPart("block", [], "#cfe4ff", "#1f4f8b", "A body in FBD style (filled #cfe4ff, outlined #1f4f8b); origin at its centre. Props: w, h, rotation."));

// --- circle -------------------------------------------------------------------------

interface CircleProps { r: number; fill: string; stroke: string }
const circlePoly = (c: Vec2, r: number, n = 72) => Array.from({ length: n }, (_, k) => ({ x: c.x + r * Math.cos(2 * Math.PI * k / n), y: c.y + r * Math.sin(2 * Math.PI * k / n) }));
registerPart({
  type: "circle", aliases: ["disc", "wheel"],
  description: "Circle; origin at its centre. Props: r, fill, stroke. Anchors include rim(angle).",
  positioning: "placed",
  propKeys: ["r", "fill", "stroke"],
  props: (s, ctx) => ({ r: lengthProp(s, "r", ctx, { positive: true }), fill: colorProp(s, "fill", "none"), stroke: colorProp(s, "stroke", "#222") }),
  anchorNames: ["center", "top", "bottom", "left", "right", "rim(angle)"],
  anchorArgs: { rim: "angle" },
  anchor: (i: PartInstance<CircleProps>, n, arg) => {
    const dirs: Record<string, number> = { right: 0, top: Math.PI / 2, left: Math.PI, bottom: -Math.PI / 2 };
    if (n === "center" || n === "origin") return i.origin;
    const a = n === "rim" ? arg : dirs[n];
    return a === undefined ? undefined : { x: i.origin.x + i.props.r * Math.cos(a), y: i.origin.y + i.props.r * Math.sin(a) };
  },
  box: (i: PartInstance<CircleProps>) => ({ x0: i.origin.x - i.props.r, y0: i.origin.y - i.props.r, x1: i.origin.x + i.props.r, y1: i.origin.y + i.props.r }),
  radius: (i: PartInstance<CircleProps>) => i.props.r,
  outline: (i: PartInstance<CircleProps>) => circlePoly(i.origin, i.props.r),
  refs: (i: PartInstance<CircleProps>, ctx) => ({ ...posRefs("", i.origin, ctx), r: lengthQ(i.props.r, ctx) }),
  draw: (i: PartInstance<CircleProps>) => [{ kind: "circle", center: i.origin, r: i.props.r, fill: i.props.fill, stroke: i.props.stroke }],
  collide: (i: PartInstance<CircleProps>, ctx) => {
    const c = ctx.view.toView(i.origin), r = i.props.r * ctx.view.scale;
    return i.props.fill !== "none" ? [{ kind: "disc", c, r: r + 0.5 }] : [{ kind: "stroke", points: circlePoly(c, r, 96), r: 0.5 + r * (1 - Math.cos(Math.PI / 96)), closed: true }];
  },
  label: (i: PartInstance<CircleProps>) => ({ anchor: i.origin, candidates: CLOSED }),
});

// --- segment / polyline ---------------------------------------------------------------

interface StrokeProps { width: number; dashed: boolean; color: string }
const strokeProps = (s: ElementSpec): StrokeProps => ({ width: strokeWidthProp(s, "width", 1), dashed: boolProp(s, "dashed"), color: colorProp(s, "color", "#222") });
const along = (pts: Vec2[], t: number): Vec2 => {
  const lens = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k]!.x, p.y - pts[k]!.y));
  let d = Math.max(0, Math.min(1, t)) * lens.reduce((a, b) => a + b, 0);
  for (let k = 0; k < lens.length; k++) {
    if (d <= lens[k]! || k === lens.length - 1) { const f = lens[k]! === 0 ? 0 : Math.min(1, d / lens[k]!); return { x: pts[k]!.x + f * (pts[k + 1]!.x - pts[k]!.x), y: pts[k]!.y + f * (pts[k + 1]!.y - pts[k]!.y) }; }
    d -= lens[k]!;
  }
  return pts[0]!;
};
const strokeCollide = (pts: Vec2[], width: number, ctx: PartContext): CollisionShape[] => [{ kind: "stroke", points: pts.map(p => ctx.view.toView(p)), r: width / 2 }];
const lineLabelCandidates = (a: Vec2, b: Vec2): LabelPosition[] => Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
  ? ["above", "below", "above-right", "below-right", "above-left", "below-left", "right", "left"]
  : ["right", "left", "above-right", "below-right", "above-left", "below-left", "above", "below"];

registerPart({
  type: "segment", aliases: ["line"],
  description: "Straight line between two points. Props: from, to, width, dashed, color. Anchors: start, end, mid, at(t).",
  positioning: "points",
  pointProps: [{ name: "from" }, { name: "to" }],
  propKeys: ["from", "to", "width", "dashed"],
  props: s => strokeProps(s),
  anchorNames: ["start", "end", "mid", "at(t)"],
  anchorArgs: { at: "number" },
  anchor: (i, n, arg) => {
    const [a, b] = [i.points.from as Vec2, i.points.to as Vec2];
    if (n === "start" || n === "origin") return a;
    if (n === "end") return b;
    const t = n === "mid" ? 0.5 : n === "at" ? arg : undefined;
    return t === undefined ? undefined : { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  },
  box: i => boxOf([i.points.from as Vec2, i.points.to as Vec2]),
  segment: i => [i.points.from as Vec2, i.points.to as Vec2],
  curve: i => [i.points.from as Vec2, i.points.to as Vec2],
  refs: (i, ctx) => { const [a, b] = [i.points.from as Vec2, i.points.to as Vec2]; return { length: lengthQ(Math.hypot(b.x - a.x, b.y - a.y), ctx), angle: { value: Math.atan2(b.y - a.y, b.x - a.x), dim: ANGLE } }; },
  draw: (i: PartInstance<StrokeProps>) => [{ kind: "segment", from: i.points.from as Vec2, to: i.points.to as Vec2, color: i.props.color, width: i.props.width, dashed: i.props.dashed }],
  collide: (i: PartInstance<StrokeProps>, ctx) => strokeCollide([i.points.from as Vec2, i.points.to as Vec2], i.props.width, ctx),
  label: i => { const [a, b] = [i.points.from as Vec2, i.points.to as Vec2]; return { anchor: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, candidates: lineLabelCandidates(a, b) }; },
});

registerPart({
  type: "polyline",
  description: "Open chain of straight segments. Props: points (list), width, dashed, color. Anchors: start, end, mid, vertex(i), at(t).",
  positioning: "points",
  pointProps: [{ name: "points", list: true }],
  propKeys: ["points", "width", "dashed"],
  props: s => strokeProps(s),
  anchorNames: ["start", "end", "mid", "vertex(i)", "at(t)"],
  anchorArgs: { vertex: "number", at: "number" },
  anchor: (i, n, arg) => {
    const pts = i.points.points as Vec2[];
    if (n === "start" || n === "origin") return pts[0];
    if (n === "end") return pts[pts.length - 1];
    if (n === "vertex") return arg !== undefined && Number.isInteger(arg) ? pts[arg] : undefined;
    if (n === "mid") return along(pts, 0.5);
    return n === "at" && arg !== undefined ? along(pts, arg) : undefined;
  },
  box: i => boxOf(i.points.points as Vec2[]),
  curve: i => i.points.points as Vec2[],
  refs: (i, ctx) => { const p = i.points.points as Vec2[]; return { length: lengthQ(p.slice(1).reduce((s, q, k) => s + Math.hypot(q.x - p[k]!.x, q.y - p[k]!.y), 0), ctx) }; },
  draw: (i: PartInstance<StrokeProps>) => { const p = i.points.points as Vec2[]; return p.slice(1).map((q, k) => ({ kind: "segment" as const, from: p[k]!, to: q, color: i.props.color, width: i.props.width, dashed: i.props.dashed })); },
  collide: (i: PartInstance<StrokeProps>, ctx) => strokeCollide(i.points.points as Vec2[], i.props.width, ctx),
  label: i => { const p = i.points.points as Vec2[]; return { anchor: along(p, 0.5), candidates: AROUND }; },
});

// --- polygon --------------------------------------------------------------------------

interface PolygonProps { fill: string; stroke: string; background: boolean }

/** Background regions (Agent 3): their fill and outline are soft, so other elements may be drawn over them. */
function asBackground(shapes: CollisionShape[], background: boolean): CollisionShape[] {
  return background ? shapes.map(s => s.kind === "disc" ? s : { ...s, soft: true }) : shapes;
}
registerPart({
  type: "polygon",
  description: "Closed polygon (e.g. a wedge or incline). Props: points (list), fill, stroke, background (a region other elements may be drawn over; list it first). Anchors: centroid, vertex(i), edge(i) midpoints.",
  positioning: "points",
  pointProps: [{ name: "points", list: true }],
  propKeys: ["points", "fill", "stroke", "background"],
  props: s => ({ fill: colorProp(s, "fill", "none"), stroke: colorProp(s, "stroke", "#222"), background: boolProp(s, "background") }),
  anchorNames: ["centroid", "vertex(i)", "edge(i)"],
  anchorArgs: { vertex: "number", edge: "number" },
  anchor: (i, n, arg) => {
    const p = i.points.points as Vec2[];
    if (n === "centroid" || n === "center" || n === "origin") return { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length };
    if (arg === undefined || !Number.isInteger(arg) || arg < 0 || arg >= p.length) return undefined;
    if (n === "vertex") return p[arg];
    if (n === "edge") { const a = p[arg]!, b = p[(arg + 1) % p.length]!; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    return undefined;
  },
  box: i => boxOf(i.points.points as Vec2[]),
  outline: i => i.points.points as Vec2[],
  draw: (i: PartInstance<PolygonProps>) => [{ kind: "polygon", points: i.points.points as Vec2[], fill: i.props.fill, stroke: i.props.stroke }],
  collide: (i: PartInstance<PolygonProps>, ctx) => asBackground(closedShapes(i.points.points as Vec2[], i.props.fill !== "none", ctx), i.props.background),
  label: i => { const p = i.points.points as Vec2[]; return { anchor: { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length }, candidates: CLOSED }; },
});

// --- arc --------------------------------------------------------------------------------

interface ArcProps { r: number; from: number; to: number; width: number; color: string }
/** The same sampling renderScene2D uses for `arc` shapes. */
const arcPoints = (c: Vec2, p: ArcProps) => {
  const fromDeg = p.from * 180 / Math.PI, toDeg = p.to * 180 / Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(toDeg - fromDeg) / 3));
  return Array.from({ length: steps + 1 }, (_, k) => { const a = (fromDeg + (toDeg - fromDeg) * k / steps) * Math.PI / 180; return { x: c.x + p.r * Math.cos(a), y: c.y + p.r * Math.sin(a) }; });
};
registerPart({
  type: "arc",
  description: "Circular arc (e.g. an angle mark); origin at its centre. Props: r, from, to (angles), width, color. Anchors: center, start, end, mid, at(angle).",
  positioning: "placed",
  propKeys: ["r", "from", "to", "width"],
  props: (s, ctx) => {
    const p = { r: lengthProp(s, "r", ctx, { positive: true }), from: angleProp(s, "from", ctx), to: angleProp(s, "to", ctx), width: strokeWidthProp(s, "width", 1), color: colorProp(s, "color", "#222") };
    if (p.from === p.to) fail("E_INVALID_VALUE", [s.id], `Arc "${s.id}" has equal start and end angles`, { path: propPath(s, "to") });
    return p;
  },
  anchorNames: ["center", "start", "end", "mid", "at(angle)"],
  anchorArgs: { at: "angle" },
  anchor: (i: PartInstance<ArcProps>, n, arg) => {
    const p = i.props;
    const a = n === "start" ? p.from : n === "end" ? p.to : n === "mid" ? (p.from + p.to) / 2 : n === "at" ? arg : undefined;
    if (n === "center" || n === "origin") return i.origin;
    return a === undefined ? undefined : { x: i.origin.x + p.r * Math.cos(a), y: i.origin.y + p.r * Math.sin(a) };
  },
  box: (i: PartInstance<ArcProps>) => boxOf(arcPoints(i.origin, i.props)),
  curve: (i: PartInstance<ArcProps>) => arcPoints(i.origin, i.props),
  curveResidual: (i: PartInstance<ArcProps>, p) => {
    const a = Math.atan2(p.y - i.origin.y, p.x - i.origin.x), lo = Math.min(i.props.from, i.props.to), hi = Math.max(i.props.from, i.props.to);
    const within = [a - 2 * Math.PI, a, a + 2 * Math.PI].some(x => x >= lo - 1e-12 && x <= hi + 1e-12);
    return within ? Math.abs(Math.hypot(p.x - i.origin.x, p.y - i.origin.y) - i.props.r) : Infinity;
  },
  refs: (i: PartInstance<ArcProps>) => ({ sweep: { value: Math.abs(i.props.to - i.props.from), dim: ANGLE } }),
  draw: (i: PartInstance<ArcProps>) => [{ kind: "arc", center: i.origin, r: i.props.r, fromDeg: i.props.from * 180 / Math.PI, toDeg: i.props.to * 180 / Math.PI, color: i.props.color, width: i.props.width }],
  collide: (i: PartInstance<ArcProps>, ctx) => strokeCollide(arcPoints(i.origin, i.props), i.props.width, ctx),
  label: (i: PartInstance<ArcProps>) => { const m = (i.props.from + i.props.to) / 2; return { anchor: { x: i.origin.x + i.props.r * Math.cos(m), y: i.origin.y + i.props.r * Math.sin(m) }, candidates: m % (2 * Math.PI) < Math.PI ? ["above-right", "right", "above", "above-left", "left"] : ["below-right", "right", "below", "below-left", "left"] }; },
});

// --- arrow ------------------------------------------------------------------------------

interface ArrowProps { dashed: boolean; color: string; mode: "to" | "polar"; length: number; angle: number; quantity?: { name: string; value: TkQuantity; per: TkQuantity } }

/** Default quantity names inferred from a magnitude's dimension. */
const QUANTITY_DIMS: [string, QDim][] = [
  ["force", { base: { kg: 1, m: 1, s: -2, A: 0, K: 0, mol: 0, cd: 0 }, angle: 0 }],
  ["velocity", { base: { kg: 0, m: 1, s: -1, A: 0, K: 0, mol: 0, cd: 0 }, angle: 0 }],
  ["acceleration", { base: { kg: 0, m: 1, s: -2, A: 0, K: 0, mol: 0, cd: 0 }, angle: 0 }],
  ["momentum", { base: { kg: 1, m: 1, s: -1, A: 0, K: 0, mol: 0, cd: 0 }, angle: 0 }],
  ["current", { base: { kg: 0, m: 0, s: 0, A: 1, K: 0, mol: 0, cd: 0 }, angle: 0 }],
  ["electricField", { base: { kg: 1, m: 1, s: -3, A: -1, K: 0, mol: 0, cd: 0 }, angle: 0 }],
  ["magneticField", { base: { kg: 1, m: 0, s: -2, A: -1, K: 0, mol: 0, cd: 0 }, angle: 0 }],
  ["displacement", LENGTH],
];

export const ARROW_HEAD = { back: 6, forward: 1, halfWidth: 3.5, minLength: 12 } as const;

const arrowTip = (i: PartInstance<ArrowProps>): Vec2 => i.props.mode === "to"
  ? i.points.to as Vec2
  : { x: (i.points.from as Vec2).x + i.props.length * Math.cos(i.props.angle), y: (i.points.from as Vec2).y + i.props.length * Math.sin(i.props.angle) };

registerPart({
  type: "arrow", aliases: ["vector", "force"],
  description: "Arrow from a tail point. Give `to`, or `angle` with `length` (world units) or `magnitude` (a quantity drawn at the model's declared scale for its quantity type). Props: from, to, angle, length, magnitude, quantity, dashed, color. Anchors: tail, tip, mid, at(t).",
  positioning: "points",
  pointProps: [{ name: "from" }, { name: "to", optional: true }],
  propKeys: ["from", "to", "angle", "length", "magnitude", "quantity", "dashed"],
  props: (s, ctx) => {
    const base = { dashed: boolProp(s, "dashed"), color: colorProp(s, "color", s.type === "force" ? "#c0392b" : "#222") };
    const has = (k: string) => s[k] !== undefined;
    const modes = [has("to"), has("length"), has("magnitude")].filter(Boolean).length;
    if (modes !== 1) fail("E_SCHEMA", [s.id], `Arrow "${s.id}" needs exactly one of "to", "length" or "magnitude"`, { path: propPath(s, "to"), measured: { to: has("to"), length: has("length"), magnitude: has("magnitude") }, suggestion: "Use {from, to} for geometry, {from, angle, length} for a drawn length, or {from, angle, magnitude} for a quantity at the declared scale." });
    if (has("to")) {
      if (has("angle")) fail("E_SCHEMA", [s.id], `Arrow "${s.id}" gives both "to" and "angle"`, { path: propPath(s, "angle"), suggestion: "Remove one; with \"to\" the direction is implied." });
      return { ...base, mode: "to" as const, length: 0, angle: 0 };
    }
    const angle = angleProp(s, "angle", ctx);
    if (has("length")) return { ...base, mode: "polar" as const, length: lengthProp(s, "length", ctx, { positive: true }), angle };
    const value = evalQuantity(s.magnitude as NumLike, ctx.scope, propPath(s, "magnitude"), [s.id]);
    if (!(value.value > 0)) fail("E_INVALID_VALUE", [s.id], `Magnitude of "${s.id}" must be positive`, { path: propPath(s, "magnitude"), measured: { magnitude: value.value }, suggestion: "Give a positive magnitude and add 180 deg to the angle to reverse the arrow." });
    let name = s.quantity as string | undefined;
    if (name !== undefined && typeof name !== "string") fail("E_SCHEMA", [s.id], `"quantity" of "${s.id}" must be a string`, { path: propPath(s, "quantity") });
    name ??= QUANTITY_DIMS.find(([, d]) => qdimEqual(d, value.dim))?.[0];
    if (!name) fail("E_SCHEMA", [s.id], `Cannot infer the quantity type of "${s.id}" (${dimLabel(value.dim)})`, { path: propPath(s, "quantity"), suggestion: "Add \"quantity\": a name such as \"moment\" and declare scales.<name>." });
    const scale = ctx.scales.get(name);
    if (!scale) fail("E_SCALE_MISSING", [s.id], `No scale declared for quantity "${name}" used by "${s.id}"`, { path: "scales", measured: { quantity: name, magnitude: value.value, dimension: dimLabel(value.dim) }, suggestion: `Add "scales": { "${name}": { "per": "<value> per world unit, e.g. 10 ${dimLabel(value.dim).split(" ")[0]}" } }.` });
    if (!qdimEqual(scale.per.dim, value.dim)) fail("E_UNIT_MISMATCH", [s.id], `Scale for "${name}" is ${dimLabel(scale.per.dim)} but "${s.id}" has ${dimLabel(value.dim)}`, { path: `scales.${name}.per`, measured: { scale: dimLabel(scale.per.dim), magnitude: dimLabel(value.dim) } });
    return { ...base, mode: "polar" as const, length: value.value / scale.per.value, angle, quantity: { name, value, per: scale.per } };
  },
  anchorNames: ["tail", "tip", "mid", "at(t)"],
  anchorArgs: { at: "number" },
  anchor: (i: PartInstance<ArrowProps>, n, arg) => {
    const a = i.points.from as Vec2, b = arrowTip(i);
    if (n === "tail" || n === "start" || n === "origin") return a;
    if (n === "tip" || n === "end") return b;
    const t = n === "mid" ? 0.5 : n === "at" ? arg : undefined;
    return t === undefined ? undefined : { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  },
  box: (i: PartInstance<ArrowProps>) => boxOf([i.points.from as Vec2, arrowTip(i)]),
  segment: (i: PartInstance<ArrowProps>) => [i.points.from as Vec2, arrowTip(i)],
  curve: (i: PartInstance<ArrowProps>) => [i.points.from as Vec2, arrowTip(i)],
  quantity: (i: PartInstance<ArrowProps>) => {
    const q = i.props.quantity;
    if (!q) return undefined;
    return { quantity: q.name, value: q.value, components: { x: q.value.value * Math.cos(i.props.angle), y: q.value.value * Math.sin(i.props.angle) }, tail: i.points.from as Vec2 };
  },
  refs: (i: PartInstance<ArrowProps>, ctx) => {
    const a = i.points.from as Vec2, b = arrowTip(i), len = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    const q = i.props.quantity;
    const mag: TkQuantity = q ? q.value : lengthQ(len, ctx);
    return { length: lengthQ(len, ctx), angle: { value: ang, dim: ANGLE }, magnitude: mag, vx: { value: mag.value * Math.cos(ang), dim: mag.dim }, vy: { value: mag.value * Math.sin(ang), dim: mag.dim } };
  },
  draw: (i: PartInstance<ArrowProps>) => { const a = i.points.from as Vec2, b = arrowTip(i); return [{ kind: "vector", at: a, v: { x: b.x - a.x, y: b.y - a.y }, color: i.props.color, dashed: i.props.dashed }]; },
  collide: (i: PartInstance<ArrowProps>, ctx) => {
    const a = ctx.view.toView(i.points.from as Vec2), b = ctx.view.toView(arrowTip(i));
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) return [{ kind: "disc", c: a, r: 0.8 }];
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, nrm = { x: -u.y, y: u.x };
    const base = { x: b.x - u.x * ARROW_HEAD.back, y: b.y - u.y * ARROW_HEAD.back };
    return [
      { kind: "stroke", points: [a, b], r: 0.8 },
      { kind: "area", points: [{ x: b.x + u.x * ARROW_HEAD.forward, y: b.y + u.y * ARROW_HEAD.forward }, { x: base.x + nrm.x * ARROW_HEAD.halfWidth, y: base.y + nrm.y * ARROW_HEAD.halfWidth }, { x: base.x - nrm.x * ARROW_HEAD.halfWidth, y: base.y - nrm.y * ARROW_HEAD.halfWidth }] },
    ];
  },
  label: (i: PartInstance<ArrowProps>, ctx) => {
    const a = i.points.from as Vec2, b = arrowTip(i);
    return { anchor: b, candidates: arrowCandidates(Math.atan2(b.y - a.y, b.x - a.x)) };
  },
  gate: (i: PartInstance<ArrowProps>, ctx) => {
    const a = ctx.view.toView(i.points.from as Vec2), b = ctx.view.toView(arrowTip(i));
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < ARROW_HEAD.minLength) fail("E_ARROW_TOO_SHORT", [i.id], `Arrow "${i.id}" is ${len.toFixed(1)} px long on screen; at least ${ARROW_HEAD.minLength} px is needed`, { measured: { lengthPx: len, minPx: ARROW_HEAD.minLength }, suggestion: i.props.quantity ? `Decrease scales.${i.props.quantity.name}.per (fewer ${dimLabel(i.props.quantity.value.dim).split(" ")[0]} per world unit) to lengthen every ${i.props.quantity.name} arrow.` : "Make the arrow longer or zoom the world bounds in." });
  },
});

/** Label candidates for an arrow tip: continue past the tip first, then to its sides. */
function arrowCandidates(angle: number): LabelPosition[] {
  const order: LabelPosition[] = ["right", "above-right", "above", "above-left", "left", "below-left", "below", "below-right"];
  const k = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return [0, 1, -1, 2, -2, 3, -3, 4].map(d => order[(k + d + 8) % 8]!);
}

// --- curve --------------------------------------------------------------------------------

interface CurveProps { pts: Vec2[]; width: number; dashed: boolean; color: string; fnAt?: (x: number) => number }
registerPart({
  type: "curve",
  description: "Function graph y = fn(x) over domain [a, b], or parametric {x, y} over t in [t0, t1]; world coordinates. Props: fn, domain, x, y, t, samples, width, dashed, color. Anchors: start, end, mid, at(x).",
  positioning: "points",
  pointProps: [],
  propKeys: ["fn", "domain", "x", "y", "t", "samples", "width", "dashed"],
  props: (s, ctx) => {
    const samples = s.samples === undefined ? 160 : s.samples;
    if (typeof samples !== "number" || !Number.isInteger(samples) || samples < 2 || samples > 2000) fail("E_INVALID_VALUE", [s.id], `"samples" of "${s.id}" must be an integer in [2, 2000]`, { path: propPath(s, "samples") });
    const range = (key: string): [number, number] => {
      const r = s[key];
      if (!Array.isArray(r) || r.length !== 2) fail("E_SCHEMA", [s.id], `"${key}" of "${s.id}" must be [start, end]`, { path: propPath(s, key) });
      return [evalNumber(r[0] as NumLike, ctx, `${propPath(s, key)}[0]`, [s.id]), evalNumber(r[1] as NumLike, ctx, `${propPath(s, key)}[1]`, [s.id])];
    };
    const at = (expr: unknown, name: string, v: number, key: string) => {
      if (typeof expr !== "string" && typeof expr !== "number") fail("E_SCHEMA", [s.id], `"${key}" of "${s.id}" must be an expression in ${name}`, { path: propPath(s, key) });
      return evalLength(expr, { ...ctx, scope: mapScope(new Map([[name, { value: v, dim: DIMLESS }]]), ctx.scope) }, propPath(s, key), [s.id]);
    };
    let pts: Vec2[], fnAt: ((x: number) => number) | undefined;
    if (s.fn !== undefined) {
      const [a, b] = range("domain");
      if (!(b > a)) fail("E_INVALID_VALUE", [s.id], `Domain of "${s.id}" must be increasing`, { path: propPath(s, "domain"), measured: { start: a, end: b } });
      fnAt = (x: number) => at(s.fn, "x", x, "fn");
      pts = Array.from({ length: samples }, (_, k) => { const x = a + (b - a) * k / (samples - 1); return { x, y: fnAt!(x) }; });
    } else if (s.x !== undefined && s.y !== undefined) {
      const [t0, t1] = range("t");
      pts = Array.from({ length: samples }, (_, k) => { const t = t0 + (t1 - t0) * k / (samples - 1); return { x: at(s.x, "t", t, "x"), y: at(s.y, "t", t, "y") }; });
    } else return fail("E_SCHEMA", [s.id], `Curve "${s.id}" needs "fn" with "domain", or "x" and "y" with "t"`, { path: propPath(s, "fn"), suggestion: "Example: {\"fn\": \"x^2/4\", \"domain\": [-2, 2]}." });
    return { pts, fnAt, ...strokeProps(s) };
  },
  anchorNames: ["start", "end", "mid", "at(x)"],
  anchorArgs: { at: "number" },
  anchor: (i: PartInstance<CurveProps>, n, arg) => {
    const p = i.props.pts;
    if (n === "start" || n === "origin") return p[0];
    if (n === "end") return p[p.length - 1];
    if (n === "mid") return along(p, 0.5);
    if (n === "at" && arg !== undefined && i.props.fnAt) return { x: arg, y: i.props.fnAt(arg) };
    return undefined;
  },
  box: (i: PartInstance<CurveProps>) => boxOf(i.props.pts),
  curve: (i: PartInstance<CurveProps>) => i.props.pts,
  curveResidual: (i: PartInstance<CurveProps>, p) => {
    const pts = i.props.pts;
    if (!i.props.fnAt) return undefined;
    if (p.x < pts[0]!.x - 1e-12 || p.x > pts[pts.length - 1]!.x + 1e-12) return Infinity;
    return Math.abs(p.y - i.props.fnAt(p.x));
  },
  draw: (i: PartInstance<CurveProps>) => i.props.pts.slice(1).map((q, k) => ({ kind: "segment" as const, from: i.props.pts[k]!, to: q, color: i.props.color, width: i.props.width, dashed: i.props.dashed })),
  collide: (i: PartInstance<CurveProps>, ctx) => strokeCollide(i.props.pts, i.props.width, ctx),
  label: (i: PartInstance<CurveProps>) => ({ anchor: i.props.pts[i.props.pts.length - 1]!, candidates: AROUND }),
});

// --- text ---------------------------------------------------------------------------------

interface TextProps { text: string; size: number; color: string; wPx: number }
/** Baseline offset from a text box's vertical centre, in px (view y down). */
export function textBaselineOffset(size: number): number {
  const e = labelVerticalExtent(size);
  return (e.above - e.below) / 2;
}
registerPart({
  type: "text",
  description: "A fixed annotation; origin at the centre of its text box. It is never moved. Props: text, size (11-13), color. Anchors: center, left, right, top, bottom.",
  positioning: "placed",
  propKeys: ["text", "size"],
  props: (s, ctx) => {
    if (typeof s.text !== "string" || s.text === "") fail("E_SCHEMA", [s.id], `Text "${s.id}" needs a non-empty "text"`, { path: propPath(s, "text") });
    const size = s.size === undefined ? TOOLKIT_TEXT.defaultLabelSize : s.size;
    if (!(TOOLKIT_TEXT.labelSizes as readonly unknown[]).includes(size)) fail("E_STYLE", [s.id], `Font size ${JSON.stringify(size)} on "${s.id}" is not in the style contract`, { path: propPath(s, "size"), suggestion: "Use 11, 12 or 13." });
    const text = formatLabelMarkup(s.text as string, [s.id]);
    return { text, size: size as number, color: colorProp(s, "color", "#333"), wPx: measureLabelWidth(text, size as number) };
  },
  anchorNames: ["center", "left", "right", "top", "bottom"],
  anchor: (i: PartInstance<TextProps>, n, _a, ctx) => {
    const box = textWorldBox(i, ctx);
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    return ({ center: { x: cx, y: cy }, origin: { x: cx, y: cy }, left: { x: box.x0, y: cy }, right: { x: box.x1, y: cy }, top: { x: cx, y: box.y1 }, bottom: { x: cx, y: box.y0 } } as Record<string, Vec2>)[n];
  },
  box: (i: PartInstance<TextProps>, ctx) => textWorldBox(i, ctx),
  draw: (i: PartInstance<TextProps>, ctx) => {
    const c = ctx.view.toView(i.origin);
    return [{ kind: "label", at: ctx.view.toWorld({ x: c.x, y: c.y + textBaselineOffset(i.props.size) }), text: i.props.text, color: i.props.color, size: i.props.size, anchor: "middle" }];
  },
  collide: (i: PartInstance<TextProps>, ctx) => {
    const c = ctx.view.toView(i.origin);
    return [{ kind: "area", points: textBoxPolygon(c.x, c.y + textBaselineOffset(i.props.size), i.props.text, i.props.size, "middle") }];
  },
});

function textWorldBox(i: PartInstance<TextProps>, ctx: PartContext) {
  const c = ctx.view.toView(i.origin);
  const poly = textBoxPolygon(c.x, c.y + textBaselineOffset(i.props.size), i.props.text, i.props.size, "middle").map(p => ctx.view.toWorld(p));
  return boxOf(poly);
}

/**
 * The footprint of rendered text in view space: the union of the measured
 * glyph box and the opaque white backdrop Scene2D draws behind labels.
 */
export function textBoxPolygon(x: number, baseline: number, text: string, size: number, anchor: "start" | "middle" | "end"): Vec2[] {
  const b = textBox(x, baseline, text, size, anchor);
  return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
}

export function textBox(x: number, baseline: number, text: string, size: number, anchor: "start" | "middle" | "end") {
  const glyphW = measureLabelWidth(text, size);
  const bgW = (text.length || 1) * size * 0.62; // Scene2D backdrop heuristic
  const off = (w: number) => anchor === "middle" ? w / 2 : anchor === "end" ? w : 0;
  const e = labelVerticalExtentFor(text, size);
  const gx0 = x - off(glyphW), bx0 = x - off(bgW) - 1;
  return {
    x0: Math.min(gx0, bx0), x1: Math.max(gx0 + glyphW, bx0 + bgW + 2),
    y0: Math.min(baseline - e.above, baseline - size * 0.85 - 0.5), y1: Math.max(baseline + e.below, baseline - size * 0.85 - 0.5 + size * 1.15 + 1),
  };
}
