/**
 * Mechanics and structures: beams, supports, hinges, hatched ground, ropes
 * with exact pulley tangency, pulleys, springs, dampers, masses, pivots,
 * wheels, inclines, trusses, cables, gears, loads, moments and coordinate
 * triads. Colours follow the pulley and free-body templates.
 */
import { fail } from "../errors.js";
import { DIMLESS, dimLabel, evalQuantity, qdimEqual } from "../expr.js";
import { resolvePoint } from "../resolver.js";
import type { PartInstance as PI } from "../parts.js";
import type { PointRef, NumLike } from "../types.js";
import {
  ABOVE_FIRST, AROUND, CLOSED, DEG, P, add, addSample, alongPolyline, angleOf, angleProp, angleQ, arc, arcSamples, between, boolProp, circle, colorProp,
  definePart, dist, dot, enumProp, fittedText, frameOf, frameProps, fp, head, lengthProp, lengthQ, lerp, line, listOf, listProp, mkQuantity, mul, numProp,
  perp, pickOf, polar, poly, polylineLen, propPath, ptsOf, px, refElement, rot, shape, sizeProp, strokeWidthProp, sub, text, textProp, textPx, unit, v, vector,
} from "./kit.js";
import type { Geo, PartContext, PartInstance, Prim, Vec2, ElementSpec } from "./kit.js";
import { arcArrowPrims, outwardCandidates } from "./general.js";

const HATCH = "#666";

/** Hatch marks on the `side` of a->b (left normal when side = 1). */
export function hatch(a: Vec2, b: Vec2, side: 1 | -1, ctx: PartContext, color = HATCH, spacingPx = 8, depthPx = 7): Prim[] {
  const L = dist(a, b) * ctx.view.scale, u = unit(sub(b, a)), n = mul(perp(u), side);
  const count = Math.max(2, Math.floor(L / spacingPx));
  const out: Prim[] = [];
  const back = mul(u, -px(ctx, depthPx * 0.7)), down = mul(n, px(ctx, depthPx));
  for (let k = 0; k < count; k++) {
    const p = lerp(a, b, (k + 0.5) / count);
    out.push(line(add(p, mul(n, px(ctx, 1))), add(add(p, down), back), color, 1));
  }
  return out;
}

// --- beam -----------------------------------------------------------------------------

interface BeamProps { depth: number; fill: string; stroke: string }
definePart<BeamProps>({
  type: "beam", aliases: ["bar"], category: "mechanics",
  description: "Beam drawn as a bar of the given depth centred on the line from `from` to `to`. Load and support parts attach to its anchors.",
  options: { from: "point", to: "point", depth: "bar depth (world, default 0.2)", fill: "palette colour (default mechanismFill)", stroke: "palette colour (default mechanismMid)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }],
  propKeys: ["from", "to", "depth", "fill", "stroke"],
  props: (s, ctx) => ({ depth: lengthProp(s, "depth", ctx, { default: 0.2, positive: true }), fill: colorProp(s, "fill", "#d6e1e6"), stroke: colorProp(s, "stroke", "#586d78") }),
  anchors: ["start", "end", "mid", "at(t)", "atDistance(d)", "top(t)", "bottom(t)", "topStart", "topEnd", "bottomStart", "bottomEnd"],
  anchorArgs: { at: "number", atDistance: "length", top: "number", bottom: "number" },
  hooks: ["outline", "segment", "curve"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), L = dist(a, b);
    if (L * ctx.view.scale < 10) fail("E_INVALID_VALUE", [i.id], `Beam "${i.id}" is too short to draw`, { measured: { lengthPx: L * ctx.view.scale } });
    const u = unit(sub(b, a)), n = perp(u), h = i.props.depth / 2;
    const corners = [add(a, mul(n, -h)), add(b, mul(n, -h)), add(b, mul(n, h)), add(a, mul(n, h))];
    const t01 = (g: (t: number) => Vec2) => (t: number) => t >= 0 && t <= 1 ? g(t) : undefined;
    return {
      prims: [shape(corners, i.props.fill, i.props.stroke)], outline: corners, segment: [corners[3]!, corners[2]!], curve: [a, b],
      anchors: { start: a, end: b, mid: lerp(a, b, 0.5), center: lerp(a, b, 0.5), topStart: corners[3]!, topEnd: corners[2]!, bottomStart: corners[0]!, bottomEnd: corners[1]! },
      argAnchors: { at: t01(t => lerp(a, b, t)), atDistance: d => d >= 0 && d <= L + 1e-12 ? add(a, mul(u, d)) : undefined, top: t01(t => lerp(corners[3]!, corners[2]!, t)), bottom: t01(t => lerp(corners[0]!, corners[1]!, t)) },
      label: { at: lerp(a, b, 0.5), candidates: ["center", ...ABOVE_FIRST] }, refs: { length: lengthQ(L, ctx), depth: lengthQ(i.props.depth, ctx) },
    };
  },
});
addSample("beam", (id, c) => [
  { id, type: "beam", from: P(c.x - 1.5, c.y), to: P(c.x + 1.5, c.y) },
  { id: `${id}_s1`, type: "pinSupport", place: { attach: "top", to: `${id}.bottom(0)` } },
  { id: `${id}_s2`, type: "rollerSupport", place: { attach: "top", to: `${id}.bottom(1)` } },
  { id: `${id}_F`, type: "pointLoad", tip: `${id}.top(0.4)`, length: 0.7 },
]);

// --- supports -----------------------------------------------------------------------------

interface SupportProps { rotation: number; scale: number; flip: boolean; fill: string }
const supportBase = (kind: "pin" | "roller" | "fixed", i: PartInstance<SupportProps>, ctx: PartContext): Geo => {
  const f = frameOf(i), P2 = (x: number, y: number) => fp(f, x, y);
  const s = 0.3, prims: Prim[] = [];
  let base: [Vec2, Vec2];
  const anchors: Record<string, Vec2> = { top: P2(0, 0), contact: P2(0, 0) };
  if (kind === "fixed") {
    // Wall face along local x through the origin, hatch below it.
    base = [P2(-s, 0), P2(s, 0)];
    prims.push(line(base[0], base[1], "#222", 2));
    prims.push(...hatch(base[1], base[0], 1, ctx));
    anchors.base = P2(0, -0.12);
    anchors.left = base[0]; anchors.right = base[1];
  } else {
    const h = 0.26, w = 0.2;
    const tri = [P2(0, 0), P2(w, -h), P2(-w, -h)];
    prims.push(shape(tri, i.props.fill, "#526873"));
    prims.push(circle(P2(0, 0), 0.045 * f.s, "#fff", "#526873"));
    let gy = -h;
    if (kind === "roller") {
      const rr = 0.05;
      for (const x of [-0.11, 0.11]) prims.push(circle(P2(x, -h - rr), rr * f.s, "#fff", "#526873"));
      gy = -h - 2 * rr;
    }
    base = [P2(-0.3, gy - 0.01), P2(0.3, gy - 0.01)];
    prims.push(line(base[0], base[1], "#222", 1.4));
    prims.push(...hatch(base[1], base[0], 1, ctx));
    anchors.base = lerp(base[0], base[1], 0.5);
    anchors.left = base[0]; anchors.right = base[1];
  }
  anchors.center = anchors.top!;
  return { prims, anchors, label: { at: anchors.base!, candidates: ["below", "below-right", "below-left", "right", "left"] } };
};
for (const kind of ["pin", "roller", "fixed"] as const) {
  definePart<SupportProps>({
    type: `${kind}Support`, aliases: kind === "fixed" ? ["clamp"] : [], category: "mechanics",
    description: kind === "pin" ? "Pin support: a triangle with its pin at the origin, on hatched ground." : kind === "roller" ? "Roller support: pin triangle on two rollers, on hatched ground." : "Fixed (clamped) support: a wall face through the origin with hatching behind it. Rotate 90 deg for a side wall.",
    options: { rotation: "degrees; 0 = ground below, the support pushes +y", scale: "size factor (default 1)", fill: "triangle fill (default mechanismFill)" },
    positioning: "placed", touchPlacement: true,
    propKeys: ["rotation", "scale", "flip", "fill"],
    props: (s, ctx) => ({ ...frameProps(s, ctx), fill: colorProp(s, "fill", "#d6e1e6") }),
    anchors: ["top", "contact", "base", "left", "right"],
    geometry: (i, ctx) => supportBase(kind, i, ctx),
  });
}
addSample("pinSupport", (id, c) => [{ id, type: "pinSupport", at: P(c.x, c.y + 0.3), scale: 1.6 }]);
addSample("rollerSupport", (id, c) => [{ id, type: "rollerSupport", at: P(c.x, c.y + 0.3), scale: 1.6 }]);
addSample("fixedSupport", (id, c, r) => [{ id, type: "fixedSupport", at: P(c.x, c.y), rotation: pickOf(r, [0, 90, -90]), scale: 1.6 }]);

// --- hinge ---------------------------------------------------------------------------------

interface HingeProps { r: number }
definePart<HingeProps>({
  type: "hinge", aliases: ["pin", "joint"], category: "mechanics",
  description: "Internal hinge or pin joint: a small open circle (white fill) at the origin. It may sit on the members it joins (list them in mayTouch).",
  options: { r: "radius (world, default 0.07)" },
  positioning: "placed", touchPlacement: true,
  propKeys: ["r"],
  props: (s, ctx) => ({ r: lengthProp(s, "r", ctx, { default: 0.07, positive: true }) }),
  anchors: ["center", "rim(angle)"], anchorArgs: { rim: "angle" },
  hooks: ["radius", "outline"],
  geometry: (i, ctx) => ({ prims: [circle(i.origin, i.props.r, "#fff", "#222")], radius: i.props.r, outline: arcSamples(i.origin, i.props.r, 0, 2 * Math.PI).slice(0, -1), anchors: { center: i.origin }, argAnchors: { rim: a => polar(i.origin, i.props.r, a) }, label: { at: i.origin, candidates: AROUND } }),
});
addSample("hinge", (id, c) => [
  { id: `${id}_a`, type: "beam", from: P(c.x - 1.4, c.y), to: P(c.x - 0.05, c.y), depth: 0.16 },
  { id: `${id}_b`, type: "beam", from: P(c.x + 0.05, c.y), to: P(c.x + 1.4, c.y - 0.3), depth: 0.16 },
  { id, type: "hinge", at: P(c.x, c.y), r: 0.12, mayTouch: [`${id}_a`, `${id}_b`] },
].sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0)));

// --- ground / wall / ceiling -----------------------------------------------------------------

interface GroundProps { side: 1 | -1; color: string; width: number }
definePart<GroundProps>({
  type: "ground", aliases: ["wall", "ceiling", "hatch", "surface"], category: "mechanics",
  description: "Hatched surface from `from` to `to`. Hatching goes on the `side` of the direction of travel; defaults: ground/surface/hatch right (below a left-to-right line), ceiling left (above), wall left (behind an upward line). Its surface is straight, so round parts can be tangentTo it.",
  options: { from: "point", to: "point", side: "left | right of from->to", width: "surface line px (default 1.5)", color: "palette colour (default ink)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }],
  propKeys: ["from", "to", "side", "width"],
  props: s => {
    const def = s.type === "ceiling" || s.type === "wall" ? "left" : "right";
    return { side: enumProp(s, "side", ["left", "right"] as const, def) === "left" ? 1 : -1, color: colorProp(s, "color", "#222"), width: strokeWidthProp(s, "width", 1.5) };
  },
  anchors: ["start", "end", "mid", "at(t)"], anchorArgs: { at: "number" },
  hooks: ["segment", "curve"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to");
    if (dist(a, b) * ctx.view.scale < 16) fail("E_INVALID_VALUE", [i.id], `Surface "${i.id}" is only ${(dist(a, b) * ctx.view.scale).toFixed(1)} px long`, { measured: { lengthPx: dist(a, b) * ctx.view.scale, minPx: 16 } });
    const n = mul(perp(unit(sub(b, a))), i.props.side);
    return { prims: [line(a, b, i.props.color, i.props.width), ...hatch(a, b, i.props.side, ctx)], segment: [a, b], curve: [a, b], anchors: { start: a, end: b, mid: lerp(a, b, 0.5) }, argAnchors: { at: t => t >= 0 && t <= 1 ? lerp(a, b, t) : undefined }, label: { at: lerp(a, b, 0.5), candidates: outwardCandidates(mul(n, -1)) }, refs: { length: lengthQ(dist(a, b), ctx) } };
  },
});
addSample("ground", (id, c, r) => [{ id, type: pickOf(r, ["ground", "ceiling"]), from: P(c.x - 1.5, c.y), to: P(c.x + 1.5, c.y) }]);

// --- pulley ----------------------------------------------------------------------------------

interface PulleyProps { r: number; fill: string; stroke: string; hanger: boolean }
definePart<PulleyProps>({
  type: "pulley", aliases: ["sheave"], category: "mechanics",
  description: "Pulley wheel with its axle; origin at the centre. Ropes wrap it with exact tangency (rope `route` items {around: id}).",
  options: { r: "radius", fill: "palette colour (default surfaceFill)", stroke: "palette colour (default mechanismLight)" },
  positioning: "placed",
  propKeys: ["r", "fill", "stroke"],
  props: (s, ctx) => ({ r: lengthProp(s, "r", ctx, { positive: true }), fill: colorProp(s, "fill", "#e8edef"), stroke: colorProp(s, "stroke", "#65757d"), hanger: false }),
  anchors: ["center", "axle", "top", "bottom", "left", "right", "rim(angle)"], anchorArgs: { rim: "angle" },
  hooks: ["radius", "outline"],
  geometry: (i, ctx) => {
    const c = i.origin, r = i.props.r;
    const prims: Prim[] = [circle(c, r, i.props.fill, i.props.stroke), circle(c, Math.min(r * 0.22, px(ctx, 5)), "#65757d", "#65757d")];
    return { prims, radius: r, outline: arcSamples(c, r, 0, 2 * Math.PI).slice(0, -1), anchors: { center: c, axle: c, top: polar(c, r, Math.PI / 2), bottom: polar(c, r, -Math.PI / 2), left: polar(c, r, Math.PI), right: polar(c, r, 0) }, argAnchors: { rim: a => polar(c, r, a) }, label: { at: c, candidates: ["right", "left", "above-right", "above-left", "below-right", "below-left"] }, refs: { r: lengthQ(r, ctx) } };
  },
});
addSample("pulley", (id, c) => [{ id, type: "pulley", at: P(c.x, c.y), r: 0.6 }]);

// --- rope -------------------------------------------------------------------------------------

type RouteItem = { kind: "point"; ref: PointRef } | { kind: "around"; id: string; dir: "cw" | "ccw" };
interface RopeProps { route: RouteItem[]; color: string; width: number; path?: Vec2[]; contacts?: Vec2[]; segments?: [Vec2, Vec2][]; arcs?: { c: Vec2; r: number; a0: number; a1: number }[] }

/** Tangent from circle (c1, signed radius p1) to circle (c2, p2); a point is a circle of radius 0. Signed radius: +R clockwise wrap, -R counter-clockwise. */
export function beltTangent(c1: Vec2, p1: number, c2: Vec2, p2: number): [Vec2, Vec2] | undefined {
  const D = sub(c2, c1), d = Math.hypot(D.x, D.y);
  if (d < 1e-12) return undefined;
  const k = -(p2 - p1) / d;
  if (Math.abs(k) > 1) return undefined;
  const Dh = mul(D, 1 / d), s = Math.sqrt(1 - k * k);
  for (const sig of [1, -1]) {
    const n = add(mul(Dh, k), mul(perp(Dh), sig * s));
    const u = v(n.y, -n.x); // travel direction: n is the left normal of u
    if (D.x * u.x + D.y * u.y > 0) return [add(c1, mul(n, p1)), add(c2, mul(n, p2))];
  }
  return undefined;
}

definePart<RopeProps>({
  type: "rope", aliases: ["string", "belt"], category: "mechanics",
  description: "Rope along `route`: point references and {around: pulleyId, dir: cw|ccw} items. Straight runs are exact common tangents of the wrapped wheels and the rope follows each rim between its contact points. It may touch the wheels it wraps and the parts its end points name.",
  options: { route: "[point, {around: id, dir: \"cw\"|\"ccw\"}, ..., point]", color: "palette colour (default dimension #444)", width: "px (default 1.5)" },
  positioning: "points", pointProps: [],
  propKeys: ["route", "width"],
  props: s => {
    const raw = listProp<unknown>(s, "route", { min: 2, max: 40 });
    const route: RouteItem[] = raw.map((it, k) => {
      if (it && typeof it === "object" && "around" in (it as object)) {
        const o = it as { around: unknown; dir?: unknown };
        if (typeof o.around !== "string") fail("E_SCHEMA", [s.id], `route[${k}].around of "${s.id}" must be an element id`, { path: `${propPath(s, "route")}[${k}]` });
        const dir = o.dir === undefined ? "cw" : o.dir;
        if (dir !== "cw" && dir !== "ccw") fail("E_SCHEMA", [s.id], `route[${k}].dir of "${s.id}" must be cw or ccw`, { path: `${propPath(s, "route")}[${k}].dir` });
        return { kind: "around", id: o.around, dir };
      }
      return { kind: "point", ref: it as PointRef };
    });
    if (route[0]!.kind !== "point" || route[route.length - 1]!.kind !== "point") fail("E_SCHEMA", [s.id], `The route of rope "${s.id}" must start and end at points`, { path: propPath(s, "route"), suggestion: "Start and end with point references such as \"ceiling.at(0.3)\" or \"mass.top\"." });
    return { route, color: colorProp(s, "color", "#444"), width: strokeWidthProp(s, "width", 1.5) };
  },
  elementRefs: s => Array.isArray(s.route) ? (s.route as unknown[]).flatMap(it => it && typeof it === "object" && "around" in (it as object) ? [String((it as { around: unknown }).around)] : [refElement(it)].filter((x): x is string => !!x)) : [],
  link: (i, get, ctx) => {
    const p = i.props;
    const need = new Map<string, PI>();
    for (const id of (i.spec.route as unknown[]).flatMap(it => it && typeof it === "object" && "around" in (it as object) ? [String((it as { around: unknown }).around)] : [refElement(it)].filter((x): x is string => !!x))) need.set(id, get(id).inst);
    const circles = p.route.map((it, k) => {
      if (it.kind === "point") return { c: resolvePoint(it.ref, need, ctx, [i.id], `${propPath(i.spec, "route")}[${k}]`), rho: 0, dir: 1 };
      const o = get(it.id);
      if (!o.def.radius) fail("E_SCHEMA", [i.id, it.id], `Rope "${i.id}" wraps "${it.id}" (${o.inst.type}), which is not round`, { path: `${propPath(i.spec, "route")}[${k}]` });
      const R = o.def.radius(o.inst), c = o.def.anchor(o.inst, "center", undefined, ctx) ?? o.inst.origin;
      return { c, rho: it.dir === "cw" ? R : -R, dir: it.dir === "cw" ? -1 : 1 };
    });
    const segs: [Vec2, Vec2][] = [];
    for (let k = 1; k < circles.length; k++) {
      const t = beltTangent(circles[k - 1]!.c, circles[k - 1]!.rho, circles[k]!.c, circles[k]!.rho);
      if (!t) fail("E_CONTRADICTORY", [i.id], `Rope "${i.id}" has no tangent between route items ${k - 1} and ${k} (they overlap or a point lies inside a wheel)`, { path: `${propPath(i.spec, "route")}[${k}]`, suggestion: "Move the wheels apart, or end the rope outside the wheel." });
      segs.push(t);
    }
    const path: Vec2[] = [segs[0]![0]];
    const contacts: Vec2[] = [];
    const arcs: NonNullable<RopeProps["arcs"]> = [];
    for (let k = 0; k < segs.length; k++) {
      path.push(segs[k]![1]);
      const nx = circles[k + 1]!;
      if (k + 1 < segs.length && nx.rho !== 0) {
        const a0 = angleOf(sub(segs[k]![1], nx.c)); let a1 = angleOf(sub(segs[k + 1]![0], nx.c));
        if (nx.dir > 0) { while (a1 < a0) a1 += 2 * Math.PI; } else { while (a1 > a0) a1 -= 2 * Math.PI; }
        contacts.push(segs[k]![1], segs[k + 1]![0]);
        arcs.push({ c: nx.c, r: Math.abs(nx.rho), a0, a1 });
        path.push(...arcSamples(nx.c, Math.abs(nx.rho), a0, a1).slice(1));
      }
    }
    p.path = path; p.contacts = contacts; p.segments = segs; p.arcs = arcs;
    i.touches = [...need.keys()];
    i.origin = path[0]!;
  },
  anchors: ["start", "end", "mid", "at(t)", "contact(k)"], anchorArgs: { at: "number", contact: "number" },
  hooks: ["curve"],
  geometry: (i, ctx) => {
    const pts = i.props.path!;
    const prims: Prim[] = [];
    // Straight runs as segments, wrapped portions as arcs (so they render like the pulley template).
    for (const [a, b] of i.props.segments!) prims.push(line(a, b, i.props.color, i.props.width));
    const cs = i.props.contacts!;
    for (const w of i.props.arcs!) if (Math.abs(w.a1 - w.a0) > 1e-9) prims.push(arc(w.c, w.r, w.a0, w.a1, i.props.color, i.props.width));
    const t = (x: number) => x >= 0 && x <= 1 ? alongPolyline(pts, x).p : undefined;
    const mid = alongPolyline(pts, 0.5);
    return { prims, curve: pts, anchors: { start: pts[0]!, end: pts[pts.length - 1]!, mid: mid.p }, argAnchors: { at: t, contact: n => Number.isInteger(n) ? cs[n] : undefined }, label: { at: mid.p, candidates: Math.abs(mid.dir.x) > Math.abs(mid.dir.y) ? ABOVE_FIRST : ["right", "left", "above-right", "below-right", "above-left", "below-left", "above", "below"] }, refs: { length: lengthQ(polylineLen(pts), ctx) } };
  },
});
addSample("rope", (id, c) => [
  { id, type: "rope", route: [`${id}_m1.top`, { around: `${id}_p`, dir: "cw" }, `${id}_m2.top`] },
  { id: `${id}_p`, type: "pulley", at: P(c.x, c.y + 0.7), r: 0.5 },
  { id: `${id}_m1`, type: "mass", at: P(c.x - 0.5, c.y - 0.6), w: 0.5, h: 0.4, text: "m₁" },
  { id: `${id}_m2`, type: "mass", at: P(c.x + 0.5, c.y - 0.4), w: 0.5, h: 0.4, text: "m₂" },
]);

// --- spring ----------------------------------------------------------------------------------

interface SpringProps { coils?: number; amplitude?: number; lead: number; color: string; width: number }
definePart<SpringProps>({
  type: "coilSpring", aliases: ["zigzagSpring"], category: "mechanics",
  description: "Zig-zag spring from `from` to `to`. The coil count adapts to the length (about one coil per 12 px) unless `coils` is given; the gate rejects a pitch under 5 px.",
  options: { from: "point", to: "point", coils: "number of coils (default adaptive)", amplitude: "half-width (world, default 7 px)", lead: "straight end fraction (default 0.15)", color: "palette colour", width: "px (default 1.4)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }], touchRefs: ["from", "to"],
  propKeys: ["from", "to", "coils", "amplitude", "lead", "width"],
  props: (s, ctx) => ({ coils: s.coils === undefined ? undefined : numProp(s, "coils", ctx, { min: 1, max: 60, integer: true }), amplitude: s.amplitude === undefined ? undefined : lengthProp(s, "amplitude", ctx, { positive: true }), lead: numProp(s, "lead", ctx, { default: 0.15, min: 0, max: 0.4 }), color: colorProp(s, "color", "#222"), width: strokeWidthProp(s, "width", 1.4) }),
  anchors: ["start", "end", "mid"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), L = dist(a, b), Lpx = L * ctx.view.scale;
    const u = unit(sub(b, a)), n = perp(u);
    const lead = i.props.lead, body = L * (1 - 2 * lead);
    const coils = i.props.coils ?? Math.max(3, Math.round(body * ctx.view.scale / 12));
    const pitchPx = body * ctx.view.scale / coils;
    if (pitchPx < 5) fail("E_INVALID_VALUE", [i.id], `Spring "${i.id}" has a coil pitch of ${pitchPx.toFixed(1)} px; at least 5 px is needed`, { measured: { pitchPx, coils, lengthPx: Lpx }, suggestion: `Use at most ${Math.max(1, Math.floor(body * ctx.view.scale / 5))} coils or lengthen the spring.` });
    const amp = i.props.amplitude ?? px(ctx, 7);
    const s0 = add(a, mul(u, L * lead));
    const pts: Vec2[] = [a, s0];
    for (let k = 0; k < coils; k++) for (const [f, side] of [[0.25, 1], [0.75, -1]] as const) pts.push(add(add(s0, mul(u, body * (k + f) / coils)), mul(n, side * amp)));
    pts.push(add(a, mul(u, L * (1 - lead))), b);
    return { prims: [poly(pts, i.props.color, i.props.width)], anchors: { start: a, end: b, mid: lerp(a, b, 0.5) }, label: { at: add(lerp(a, b, 0.5), mul(n, amp)), candidates: Math.abs(u.x) >= Math.abs(u.y) ? ABOVE_FIRST : ["right", "left", "above-right", "below-right", "above-left", "below-left", "above", "below"] }, refs: { length: lengthQ(L, ctx), coils: { value: coils, dim: DIMLESS } } };
  },
});
addSample("coilSpring", (id, c, r) => [
  { id, type: "coilSpring", from: `${id}_w.mid`, to: `${id}_m.left` },
  { id: `${id}_w`, type: "wall", from: P(c.x - 1.5, c.y - 0.6), to: P(c.x - 1.5, c.y + 0.6) },
  { id: `${id}_m`, type: "mass", at: P(c.x + between(r, 0.8, 1.1), c.y), w: 0.6, h: 0.6 },
]);

// --- damper ----------------------------------------------------------------------------------

interface DamperProps { color: string; width: number; bodyWidth?: number }
definePart<DamperProps>({
  type: "damper", aliases: ["dashpot"], category: "mechanics",
  description: "Viscous damper (dashpot) from `from` to `to`: a cylinder on the `from` side and a piston on a rod from `to`.",
  options: { from: "point", to: "point", bodyWidth: "cylinder width (world, default 14 px)", color: "palette colour", width: "px (default 1.4)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }], touchRefs: ["from", "to"],
  propKeys: ["from", "to", "bodyWidth", "width"],
  props: (s, ctx) => ({ color: colorProp(s, "color", "#222"), width: strokeWidthProp(s, "width", 1.4), bodyWidth: s.bodyWidth === undefined ? undefined : lengthProp(s, "bodyWidth", ctx, { positive: true }) }),
  anchors: ["start", "end", "mid"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), L = dist(a, b);
    if (L * ctx.view.scale < 30) fail("E_INVALID_VALUE", [i.id], `Damper "${i.id}" is only ${(L * ctx.view.scale).toFixed(1)} px long; at least 30 px is needed`, { measured: { lengthPx: L * ctx.view.scale } });
    const u = unit(sub(b, a)), n = perp(u), w = (i.props.bodyWidth ?? px(ctx, 14)) / 2;
    const Q = (t: number, s: number) => add(add(a, mul(u, L * t)), mul(n, s));
    const col = i.props.color, wd = i.props.width;
    const prims: Prim[] = [
      line(a, Q(0.3, 0), col, wd),
      poly([Q(0.72, w), Q(0.3, w), Q(0.3, -w), Q(0.72, -w)], col, wd),
      line(Q(0.55, w * 0.75), Q(0.55, -w * 0.75), col, 2),
      line(Q(0.55, 0), b, col, wd),
    ];
    return { prims, anchors: { start: a, end: b, mid: lerp(a, b, 0.5) }, label: { at: Q(0.5, w), candidates: Math.abs(u.x) >= Math.abs(u.y) ? ABOVE_FIRST : ["right", "left", "above", "below"] }, refs: { length: lengthQ(L, ctx) } };
  },
});
addSample("damper", (id, c) => [
  { id, type: "damper", from: `${id}_w.mid`, to: `${id}_m.left` },
  { id: `${id}_w`, type: "wall", from: P(c.x - 1.5, c.y - 0.6), to: P(c.x - 1.5, c.y + 0.6) },
  { id: `${id}_m`, type: "mass", at: P(c.x + 1, c.y), w: 0.6, h: 0.6 },
]);

// --- mass -------------------------------------------------------------------------------------

interface MassProps { w: number; h: number; rotation: number; text?: string; shape: "box" | "ball"; fill: string; stroke: string; textSize: number }
definePart<MassProps>({
  type: "mass", aliases: ["weight", "load"], category: "mechanics",
  description: "A mass: a box (or a ball) in the pulley template's colours with centred text (default \"m\"). Origin at its centre; anchors include `hook` on top.",
  options: { w: "width (box) / diameter (ball)", h: "height (box, default w)", shape: "box | ball", rotation: "degrees", text: "centred text (default m; \"\" for none)", fill: "palette colour", stroke: "palette colour", textSize: "11-13" },
  positioning: "placed",
  propKeys: ["w", "h", "shape", "rotation", "text", "fill", "stroke", "textSize"],
  props: (s, ctx) => {
    const w = lengthProp(s, "w", ctx, { positive: true });
    return { w, h: s.h === undefined ? w : lengthProp(s, "h", ctx, { positive: true }), rotation: angleProp(s, "rotation", ctx, 0), text: s.text === "" ? undefined : textProp(s, "text", "m"), shape: enumProp(s, "shape", ["box", "ball"] as const, "box"), fill: colorProp(s, "fill", "#d6e1e6"), stroke: colorProp(s, "stroke", "#586d78"), textSize: sizeProp(s) };
  },
  anchors: ["center", "top", "bottom", "left", "right", "hook", "topLeft", "topRight", "bottomLeft", "bottomRight"],
  hooks: ["outline", "radius"],
  geometry: (i, ctx): Geo => {
    const p = i.props, c = i.origin, fits: NonNullable<Geo["fits"]> = [];
    if (p.shape === "ball") {
      const r = p.w / 2, outline = arcSamples(c, r, 0, 2 * Math.PI).slice(0, -1);
      const prims: Prim[] = [circle(c, r, p.fill, p.stroke)];
      if (p.text) prims.push(fittedText(fits, c, p.text, p.textSize, "#222", outline));
      return { prims, fits, outline, radius: r, anchors: { center: c, top: polar(c, r, Math.PI / 2), hook: polar(c, r, Math.PI / 2), bottom: polar(c, r, -Math.PI / 2), left: polar(c, r, Math.PI), right: polar(c, r, 0) }, label: { at: c, candidates: AROUND } };
    }
    const f = (x: number, y: number) => add(c, rot(v(x * p.w / 2, y * p.h / 2), p.rotation));
    const outline = [f(-1, -1), f(1, -1), f(1, 1), f(-1, 1)];
    const prims: Prim[] = [p.rotation === 0 ? { k: "rect", c, w: p.w, h: p.h, rxPx: 0, fill: p.fill, stroke: p.stroke } : shape(outline, p.fill, p.stroke)];
    if (p.text) prims.push(fittedText(fits, c, p.text, p.textSize, "#222", outline));
    return { prims, fits, outline, radius: Math.min(p.w, p.h) / 2, anchors: { center: c, top: f(0, 1), hook: f(0, 1), bottom: f(0, -1), left: f(-1, 0), right: f(1, 0), topLeft: f(-1, 1), topRight: f(1, 1), bottomLeft: f(-1, -1), bottomRight: f(1, -1) }, label: { at: c, candidates: AROUND }, refs: { w: lengthQ(p.w, ctx), h: lengthQ(p.h, ctx) } };
  },
});
addSample("mass", (id, c, r) => [{ id, type: "mass", at: P(c.x, c.y), w: 0.9, h: 0.7, shape: pickOf(r, ["box", "ball"] as const), text: "M" }]);

// --- pivot -------------------------------------------------------------------------------------

interface PivotProps { rotation: number; scale: number; flip: boolean; fill: string }
definePart<PivotProps>({
  type: "pivot", aliases: ["fulcrum"], category: "mechanics",
  description: "Fulcrum: a triangle with its apex at the origin standing on hatched ground (rotate for other orientations).",
  options: { rotation: "degrees", scale: "size factor", fill: "palette colour (default surfaceFill)" },
  positioning: "placed", touchPlacement: true,
  propKeys: ["rotation", "scale", "flip", "fill"],
  props: (s, ctx) => ({ ...frameProps(s, ctx), fill: colorProp(s, "fill", "#e8edef") }),
  anchors: ["apex", "base", "left", "right"],
  geometry: (i, ctx) => {
    const f = frameOf(i), Q = (x: number, y: number) => fp(f, x, y);
    const tri = [Q(0, 0), Q(0.22, -0.32), Q(-0.22, -0.32)];
    const g0 = Q(-0.34, -0.33), g1 = Q(0.34, -0.33);
    return { prims: [shape(tri, i.props.fill, "#526873"), line(g0, g1, "#222", 1.4), ...hatch(g1, g0, 1, ctx)], anchors: { apex: Q(0, 0), center: Q(0, 0), base: Q(0, -0.33), left: g0, right: g1 }, label: { at: Q(0, -0.33), candidates: ["below", "below-right", "below-left", "right", "left"] } };
  },
});
addSample("pivot", (id, c) => [{ id, type: "pivot", at: P(c.x, c.y + 0.3), scale: 1.8 }]);

// --- spoked wheel ---------------------------------------------------------------------------------

interface WheelProps { r: number; spokes: number; fill: string; stroke: string }
definePart<WheelProps>({
  type: "spokedWheel", aliases: ["cartWheel", "roller"], category: "mechanics",
  description: "Wheel with a hub and spokes; origin at the centre. Round, so it can be tangentTo a ground, incline or another wheel.",
  options: { r: "radius", spokes: "0-12 (default 6)", fill: "palette colour (default surfaceFill)", stroke: "palette colour (default mechanismLight)" },
  positioning: "placed",
  propKeys: ["r", "spokes", "fill", "stroke"],
  props: (s, ctx) => ({ r: lengthProp(s, "r", ctx, { positive: true }), spokes: numProp(s, "spokes", ctx, { default: 6, min: 0, max: 12, integer: true }), fill: colorProp(s, "fill", "#e8edef"), stroke: colorProp(s, "stroke", "#65757d") }),
  anchors: ["center", "hub", "top", "bottom", "left", "right", "contact", "rim(angle)"], anchorArgs: { rim: "angle" },
  hooks: ["radius", "outline"],
  geometry: (i, ctx) => {
    const c = i.origin, r = i.props.r, hub = Math.min(r * 0.18, px(ctx, 5));
    const prims: Prim[] = [circle(c, r, i.props.fill, i.props.stroke)];
    for (let k = 0; k < i.props.spokes; k++) { const a = k * 2 * Math.PI / i.props.spokes + Math.PI / 2; prims.push(line(polar(c, hub, a), polar(c, r - px(ctx, 1), a), "#65757d", 1)); }
    prims.push(circle(c, hub, "#65757d", "#65757d"));
    return { prims, radius: r, outline: arcSamples(c, r, 0, 2 * Math.PI).slice(0, -1), anchors: { center: c, hub: c, top: polar(c, r, Math.PI / 2), bottom: polar(c, r, -Math.PI / 2), contact: polar(c, r, -Math.PI / 2), left: polar(c, r, Math.PI), right: polar(c, r, 0) }, argAnchors: { rim: a => polar(c, r, a) }, label: { at: c, candidates: ["above-right", "above-left", "right", "left", "above", "below-right", "below-left"] }, refs: { r: lengthQ(r, ctx) } };
  },
});
addSample("spokedWheel", (id, c) => [
  { id, type: "spokedWheel", r: 0.6, place: [{ tangentTo: `${id}_g`, side: "above" }, { x: c.x }] },
  { id: `${id}_g`, type: "ground", from: P(c.x - 1.5, c.y - 0.8), to: P(c.x + 1.5, c.y - 0.8) },
].map(e => e.id === id ? { ...e, mayTouch: [`${id}_g`] } : e) as ElementSpec[]);

// --- incline ------------------------------------------------------------------------------------

interface InclineProps { base: number; angle: number; rises: "right" | "left"; fill: string; stroke: string; mark: boolean; markText?: string }
definePart<InclineProps>({
  type: "incline", aliases: ["wedge", "ramp"], category: "mechanics",
  description: "Right-triangle incline with its toe (the low corner where the slope starts) at the origin; base length and angle set the shape. The slope is a straight surface (tangentTo, surface(t)). An optional angle mark sits at the toe.",
  options: { base: "base length", angle: "slope angle (default 30)", rises: "right (default) | left", mark: "draw the angle mark (default true)", markText: "mark text (default \\theta)", fill: "palette colour (default surfaceFill)", stroke: "palette colour" },
  positioning: "placed",
  propKeys: ["base", "angle", "rises", "mark", "markText", "fill", "stroke"],
  props: (s, ctx) => {
    const angle = angleProp(s, "angle", ctx, 30 * DEG);
    if (!(angle > 2 * DEG && angle < 80 * DEG)) fail("E_INVALID_VALUE", [s.id], `Incline angle of "${s.id}" must be between 2 and 80 degrees`, { path: propPath(s, "angle"), measured: { degrees: angle / DEG } });
    return { base: lengthProp(s, "base", ctx, { positive: true }), angle, rises: enumProp(s, "rises", ["right", "left"] as const, "right"), fill: colorProp(s, "fill", "#e8edef"), stroke: colorProp(s, "stroke", "#526873"), mark: boolProp(s, "mark", true), markText: s.markText === "" ? undefined : textProp(s, "markText", "\\theta") };
  },
  anchors: ["toe", "top", "corner", "surfaceMid", "baseMid", "centroid", "surface(t)", "surfaceAt(d)"], anchorArgs: { surface: "number", surfaceAt: "length" },
  hooks: ["outline", "segment"],
  geometry: (i, ctx) => {
    const p = i.props, sx = p.rises === "right" ? 1 : -1, toe = i.origin;
    const corner = add(toe, v(sx * p.base, 0)), top = add(corner, v(0, p.base * Math.tan(p.angle)));
    const tri = [toe, corner, top];
    const prims: Prim[] = [shape(tri, p.fill, p.stroke)];
    const a0 = sx > 0 ? 0 : Math.PI - p.angle, a1 = sx > 0 ? p.angle : Math.PI;
    if (p.mark) {
      const r = Math.min(p.base * 0.3, px(ctx, 34));
      prims.push(arc(toe, r, a0, a1, "#444", 1));
      if (p.markText) {
        // On the bisector, beyond the arc, far enough in that the text clears both edges.
        const mid = (a0 + a1) / 2, tp = textPx(p.markText, 12), half = px(ctx, Math.hypot(tp.w, tp.h) / 2 + 2);
        const d = Math.max(r + half, half / Math.sin(p.angle / 2));
        if (d + half > p.base * 0.9) fail("E_INVALID_VALUE", [i.id], `The angle text of incline "${i.id}" does not fit inside it at this zoom`, { measured: { baseWorld: p.base, needWorld: d + half }, suggestion: "Make the incline larger, zoom in, or set \"markText\" to \"\" or \"mark\": false and label the angle with an angleArc." });
        prims.push(text(polar(toe, d, mid), p.markText, 12, "#333"));
      }
    }
    const L = dist(toe, top), u = unit(sub(top, toe));
    return { prims, outline: tri, segment: [toe, top], anchors: { toe, top, corner, surfaceMid: lerp(toe, top, 0.5), baseMid: lerp(toe, corner, 0.5), centroid: v((toe.x + corner.x + top.x) / 3, (toe.y + corner.y + top.y) / 3), center: v((toe.x + corner.x + top.x) / 3, (toe.y + corner.y + top.y) / 3) }, argAnchors: { surface: t => t >= 0 && t <= 1 ? lerp(toe, top, t) : undefined, surfaceAt: d => d >= 0 && d <= L ? add(toe, mul(u, d)) : undefined }, label: { at: v((toe.x + corner.x + top.x) / 3, (toe.y + corner.y + top.y) / 3), candidates: ["below", "right", "left"] }, refs: { angle: angleQ(p.angle), length: lengthQ(L, ctx), height: lengthQ(top.y - toe.y, ctx), base: lengthQ(p.base, ctx) } };
  },
});
addSample("incline", (id, c, r) => {
  const ang = between(r, 25, 35);
  return [
    { id, type: "incline", at: P(c.x - 1.5, c.y - 0.9), base: 3, angle: ang },
    { id: `${id}_b`, type: "block", w: 0.6, h: 0.4, rotation: ang, place: { attach: "bottom", to: `${id}.surface(0.6)` }, mayTouch: [id] },
  ];
});

// --- truss --------------------------------------------------------------------------------------

interface TrussProps { members: [number, number][]; color: string; width: number; jointR: number }
definePart<TrussProps>({
  type: "truss", aliases: ["frame"], category: "mechanics",
  description: "Pin-jointed truss: `joints` (points) and `members` (index pairs). Members are drawn as bars, joints as pins. Exposes joint(k) and member(k) anchors and joints/members counts for checks (e.g. m + r = 2j).",
  options: { joints: "list of points", members: "list of [i, j] joint index pairs", width: "member px (default 2.5)", color: "palette colour (default mechanism)", jointR: "pin radius px (default 3.5)" },
  positioning: "points", pointProps: [{ name: "joints", list: true }],
  propKeys: ["joints", "members", "width", "jointR"],
  props: (s, ctx) => {
    const n = Array.isArray(s.joints) ? s.joints.length : 0;
    const members = listProp<unknown>(s, "members", { min: 1, max: 200 }).map((m, k) => {
      if (!Array.isArray(m) || m.length !== 2 || !m.every(j => Number.isInteger(j) && (j as number) >= 0 && (j as number) < n) || m[0] === m[1]) fail("E_SCHEMA", [s.id], `members[${k}] of "${s.id}" must be two different joint indices in [0, ${n - 1}]`, { path: `${propPath(s, "members")}[${k}]`, measured: { member: m } });
      return [m[0] as number, m[1] as number] as [number, number];
    });
    const seen = new Set<string>();
    for (const [a, b] of members) { const k = `${Math.min(a, b)}-${Math.max(a, b)}`; if (seen.has(k)) fail("E_SCHEMA", [s.id], `Member ${k} of "${s.id}" is listed twice`, { path: propPath(s, "members") }); seen.add(k); }
    return { members, color: colorProp(s, "color", "#526873"), width: strokeWidthProp(s, "width", 2.5), jointR: numProp(s, "jointR", ctx, { default: 3.5, min: 2, max: 8 }) };
  },
  anchors: ["joint(k)", "member(k)", "centroid"], anchorArgs: { joint: "number", member: "number" },
  geometry: (i, ctx) => {
    const J = listOf(i, "joints"), p = i.props;
    const prims: Prim[] = [];
    for (const [a, b] of p.members) {
      const A = J[a]!, B = J[b]!;
      if (dist(A, B) * ctx.view.scale < 2 * p.jointR + 6) fail("E_INVALID_VALUE", [i.id], `Truss member ${a}-${b} of "${i.id}" is too short to draw`, { measured: { lengthPx: dist(A, B) * ctx.view.scale } });
      prims.push(line(A, B, p.color, p.width));
    }
    for (const q of J) prims.push(circle(q, px(ctx, p.jointR), "#fff", "#222"));
    const cen = v(J.reduce((s, q) => s + q.x, 0) / J.length, J.reduce((s, q) => s + q.y, 0) / J.length);
    return { prims, anchors: { centroid: cen, center: cen }, argAnchors: { joint: k => Number.isInteger(k) ? J[k] : undefined, member: k => Number.isInteger(k) && p.members[k] ? lerp(J[p.members[k]![0]]!, J[p.members[k]![1]]!, 0.5) : undefined }, label: { at: cen, candidates: ["above", "below", "right", "left"] }, refs: { joints: { value: J.length, dim: DIMLESS }, members: { value: p.members.length, dim: DIMLESS } } };
  },
});
addSample("truss", (id, c) => [{ id, type: "truss", joints: [P(c.x - 1.4, c.y - 0.6), P(c.x, c.y - 0.6), P(c.x + 1.4, c.y - 0.6), P(c.x - 0.7, c.y + 0.6), P(c.x + 0.7, c.y + 0.6)], members: [[0, 1], [1, 2], [0, 3], [3, 1], [1, 4], [4, 2], [3, 4]] }]);

// --- cable --------------------------------------------------------------------------------------

interface CableProps { sag: number; color: string; width: number }
definePart<CableProps>({
  type: "cable", aliases: ["catenary"], category: "mechanics",
  description: "Hanging cable from `from` to `to` that sags `sag` below the chord at mid-span (parabolic profile, exact for a uniform load per horizontal length). Exposes the lowest point.",
  options: { from: "point", to: "point", sag: "mid-span sag below the chord (world, default 15% of the span)", color: "palette colour (default steel)", width: "px (default 1.6)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }], touchRefs: ["from", "to"],
  propKeys: ["from", "to", "sag", "width"],
  props: (s, ctx) => ({ sag: s.sag === undefined ? NaN : lengthProp(s, "sag", ctx, { min: 0 }), color: colorProp(s, "color", "#8a969c"), width: strokeWidthProp(s, "width", 1.6) }),
  anchors: ["start", "end", "mid", "lowest", "at(t)"], anchorArgs: { at: "number" },
  hooks: ["curve"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to");
    if (Math.abs(b.x - a.x) * ctx.view.scale < 12) fail("E_INVALID_VALUE", [i.id], `Cable "${i.id}" needs a horizontal span of at least 12 px`, { measured: { spanPx: Math.abs(b.x - a.x) * ctx.view.scale } });
    const sag = Number.isNaN(i.props.sag) ? 0.15 * Math.abs(b.x - a.x) : i.props.sag;
    const y = (t: number) => a.y + (b.y - a.y) * t - 4 * sag * t * (1 - t);
    const pts = Array.from({ length: 49 }, (_, k) => { const t = k / 48; return v(a.x + (b.x - a.x) * t, y(t)); });
    // Lowest point of the parabola, clamped to the span.
    const A = 4 * sag, B = (b.y - a.y) - 4 * sag;
    const tLow = A > 0 ? Math.max(0, Math.min(1, -B / (2 * A))) : (b.y < a.y ? 1 : 0);
    const low = v(a.x + (b.x - a.x) * tLow, y(tLow));
    return { prims: [poly(pts, i.props.color, i.props.width)], curve: pts, anchors: { start: a, end: b, mid: v((a.x + b.x) / 2, y(0.5)), lowest: low }, argAnchors: { at: t => t >= 0 && t <= 1 ? v(a.x + (b.x - a.x) * t, y(t)) : undefined }, label: { at: low, candidates: ["below", "below-right", "below-left", "above"] }, refs: { sag: lengthQ(sag, ctx), length: lengthQ(polylineLen(pts), ctx) } };
  },
});
addSample("cable", (id, c, r) => [{ id, type: "cable", from: P(c.x - 1.5, c.y + 0.6), to: P(c.x + 1.5, c.y + between(r, 0.2, 0.7)), sag: 0.9 }]);

// --- gear ---------------------------------------------------------------------------------------

interface GearProps { r: number; teeth: number; depth?: number; fill: string; stroke: string; phase: number }
definePart<GearProps>({
  type: "gear", aliases: ["spurGear"], category: "mechanics",
  description: "Symbolic spur gear: a toothed outline around the pitch circle (dashed) with a hub; origin at the centre. Its radius is the pitch radius, so two gears placed tangentTo each other mesh at the pitch point (they need mayTouch).",
  options: { r: "pitch radius", teeth: "6-80 (default from size)", depth: "tooth depth (world, default 8% of r)", phase: "rotation of the teeth (degrees)", fill: "palette colour (default mechanismFill)", stroke: "palette colour (default mechanism)" },
  positioning: "placed",
  propKeys: ["r", "teeth", "depth", "phase", "fill", "stroke"],
  props: (s, ctx) => ({ r: lengthProp(s, "r", ctx, { positive: true }), teeth: s.teeth === undefined ? 0 : numProp(s, "teeth", ctx, { min: 6, max: 80, integer: true }), depth: s.depth === undefined ? undefined : lengthProp(s, "depth", ctx, { positive: true }), phase: angleProp(s, "phase", ctx, 0), fill: colorProp(s, "fill", "#d6e1e6"), stroke: colorProp(s, "stroke", "#526873") }),
  anchors: ["center", "top", "bottom", "left", "right", "pitch(angle)"], anchorArgs: { pitch: "angle" },
  hooks: ["radius", "outline"],
  geometry: (i, ctx) => {
    const c = i.origin, r = i.props.r, d = i.props.depth ?? r * 0.12;
    const teeth = i.props.teeth || Math.max(8, Math.min(60, Math.round(2 * Math.PI * r * ctx.view.scale / 14)));
    const pitchPx = 2 * Math.PI * r * ctx.view.scale / teeth;
    if (pitchPx < 6) fail("E_INVALID_VALUE", [i.id], `Gear "${i.id}" tooth pitch is ${pitchPx.toFixed(1)} px; at least 6 px is needed`, { measured: { pitchPx, teeth }, suggestion: `Use at most ${Math.floor(2 * Math.PI * r * ctx.view.scale / 6)} teeth.` });
    const pts: Vec2[] = [];
    for (let k = 0; k < teeth; k++) {
      const a = i.props.phase + k * 2 * Math.PI / teeth, w = Math.PI / teeth;
      for (const [da, rr] of [[-w * 0.5, r - d / 2], [-w * 0.3, r + d / 2], [w * 0.3, r + d / 2], [w * 0.5, r - d / 2]] as const) pts.push(polar(c, rr, a + da));
    }
    const prims: Prim[] = [shape(pts, i.props.fill, i.props.stroke), circle(c, Math.max(r * 0.18, px(ctx, 3)), "#fff", i.props.stroke)];
    return { prims, radius: r, outline: pts, anchors: { center: c, top: polar(c, r, Math.PI / 2), bottom: polar(c, r, -Math.PI / 2), left: polar(c, r, Math.PI), right: polar(c, r, 0) }, argAnchors: { pitch: a => polar(c, r, a) }, label: { at: c, candidates: AROUND }, refs: { r: lengthQ(r, ctx), teeth: { value: teeth, dim: DIMLESS } } };
  },
});
addSample("gear", (id, c) => [
  { id, type: "gear", at: P(c.x - 0.55, c.y), r: 0.75, teeth: 18 },
  { id: `${id}_b`, type: "gear", r: 0.45, teeth: 11, phase: 16.4, place: [{ tangentTo: id }, { y: c.y }], prefer: "right", mayTouch: [id] },
]);

// --- loads -------------------------------------------------------------------------------------

interface LoadProps { angle: number; length: number; color: string; quantity?: { name: string; value: import("../expr.js").TkQuantity } }
function loadProps(s: ElementSpec, ctx: PartContext): LoadProps {
  const angle = angleProp(s, "angle", ctx, -90 * DEG), color = colorProp(s, "color", "#c0392b");
  if ((s.length === undefined) === (s.magnitude === undefined)) fail("E_SCHEMA", [s.id], `pointLoad "${s.id}" needs exactly one of "length" or "magnitude"`, { path: propPath(s, "length"), suggestion: "Use length (world units) for a drawn arrow, or magnitude with a declared scale." });
  if (s.length !== undefined) return { angle, length: lengthProp(s, "length", ctx, { positive: true }), color };
  const value = evalQuantity(s.magnitude as NumLike, ctx.scope, propPath(s, "magnitude"), [s.id]);
  if (!(value.value > 0)) fail("E_INVALID_VALUE", [s.id], `Magnitude of "${s.id}" must be positive`, { path: propPath(s, "magnitude") });
  const name = typeof s.quantity === "string" ? s.quantity : "force";
  const scale = ctx.scales.get(name);
  if (!scale) fail("E_SCALE_MISSING", [s.id], `No scale declared for quantity "${name}" used by "${s.id}"`, { path: "scales", suggestion: `Add "scales": {"${name}": {"per": "10 N"}}.` });
  if (!qdimEqual(scale.per.dim, value.dim)) fail("E_UNIT_MISMATCH", [s.id], `Scale for "${name}" is ${dimLabel(scale.per.dim)} but "${s.id}" has ${dimLabel(value.dim)}`, { path: `scales.${name}.per` });
  return { angle, length: value.value / scale.per.value, color, quantity: { name, value } };
}
definePart<LoadProps>({
  type: "pointLoad", aliases: ["load_arrow", "concentratedLoad"], category: "mechanics",
  description: "Point load: an arrow whose TIP is at `tip`, pointing along `angle` (default -90 = downward). Give `length` (world) or `magnitude` (a quantity at the declared scale; quantity defaults to force, so it counts in vectorSum/momentSum).",
  options: { tip: "point the load acts on", angle: "direction of the force (default -90)", length: "drawn length (world)", magnitude: "quantity, e.g. \"12 kN\"", quantity: "scale name (default force)", color: "palette colour (default force)" },
  positioning: "points", pointProps: [{ name: "tip" }], touchRefs: ["tip"],
  propKeys: ["tip", "angle", "length", "magnitude", "quantity"],
  props: loadProps,
  anchors: ["tip", "tail", "mid"],
  geometry: (i, ctx) => {
    const tip = ptsOf(i, "tip"), tail = sub(tip, mul(v(Math.cos(i.props.angle), Math.sin(i.props.angle)), i.props.length));
    if (i.props.length * ctx.view.scale < 12) fail("E_ARROW_TOO_SHORT", [i.id], `Load "${i.id}" is ${(i.props.length * ctx.view.scale).toFixed(1)} px long; at least 12 px is needed`, { measured: { lengthPx: i.props.length * ctx.view.scale } });
    return { prims: [vector(tail, tip, i.props.color)], anchors: { tip, tail, mid: lerp(tail, tip, 0.5) }, label: { at: tail, candidates: outwardCandidates(sub(tail, tip)) }, refs: { magnitude: i.props.quantity?.value ?? lengthQ(i.props.length, ctx), angle: angleQ(i.props.angle) } };
  },
  quantity: (i) => {
    const q = i.props.quantity;
    if (!q) return undefined;
    const tip = ptsOf(i, "tip"), tail = sub(tip, mul(v(Math.cos(i.props.angle), Math.sin(i.props.angle)), i.props.length));
    return mkQuantity(q.name, q.value, i.props.angle, tail);
  },
});
addSample("pointLoad", (id, c) => [
  { id, type: "pointLoad", tip: `${id}_b.top(0.5)`, length: 0.9 },
  { id: `${id}_b`, type: "beam", from: P(c.x - 1.4, c.y - 0.4), to: P(c.x + 1.4, c.y - 0.4) },
]);

interface DistProps { h0: number; h1: number; spacingPx: number; color: string; side: 1 | -1 }
definePart<DistProps>({
  type: "distributedLoad", aliases: ["udl", "pressureLoad"], category: "mechanics",
  description: "Distributed load on the line from `from` to `to`: arrows pointing onto the line from its `side`, with heights varying linearly from `height` to `endHeight` (uniform when equal, triangular when one is 0) and an envelope line. Exposes `resultant` (the centroid of the load diagram on the line).",
  options: { from: "point", to: "point", height: "arrow length at from (world)", endHeight: "arrow length at to (default = height)", side: "left (default, above a left-to-right beam) | right", spacing: "px between arrows (default 22)", color: "palette colour (default force)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }], touchRefs: ["from", "to"],
  propKeys: ["from", "to", "height", "endHeight", "side", "spacing"],
  props: (s, ctx) => {
    const h0 = lengthProp(s, "height", ctx, { min: 0 }), h1 = s.endHeight === undefined ? h0 : lengthProp(s, "endHeight", ctx, { min: 0 });
    if (h0 === 0 && h1 === 0) fail("E_INVALID_VALUE", [s.id], `Distributed load "${s.id}" has zero height everywhere`, { path: propPath(s, "height") });
    return { h0, h1, spacingPx: numProp(s, "spacing", ctx, { default: 22, min: 8, max: 200 }), color: colorProp(s, "color", "#c0392b"), side: enumProp(s, "side", ["left", "right"] as const, "left") === "left" ? 1 : -1 };
  },
  anchors: ["start", "end", "mid", "resultant", "topStart", "topEnd"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), L = dist(a, b), u = unit(sub(b, a)), n = mul(perp(u), i.props.side);
    const { h0, h1 } = i.props;
    const count = Math.max(2, Math.floor(L * ctx.view.scale / i.props.spacingPx) + 1);
    const prims: Prim[] = [];
    const gap = px(ctx, 1.5);
    for (let k = 0; k < count; k++) {
      const t = k / (count - 1), h = h0 + (h1 - h0) * t;
      if (h * ctx.view.scale < 12) continue;
      const base = lerp(a, b, t);
      prims.push(vector(add(base, mul(n, h)), add(base, mul(n, gap)), i.props.color));
    }
    const ta = add(a, mul(n, h0)), tb = add(b, mul(n, h1));
    prims.push(line(ta, tb, i.props.color, 1.2));
    // Centroid of the trapezoid measured from `a`.
    const xc = h0 + h1 > 0 ? L * (h0 + 2 * h1) / (3 * (h0 + h1)) : L / 2;
    const res = add(a, mul(u, xc));
    return { prims, anchors: { start: a, end: b, mid: lerp(a, b, 0.5), resultant: res, topStart: ta, topEnd: tb }, label: { at: lerp(ta, tb, 0.5), candidates: outwardCandidates(n) }, refs: { length: lengthQ(L, ctx), resultantDistance: lengthQ(xc, ctx) } };
  },
});
addSample("distributedLoad", (id, c, r) => [
  { id, type: "distributedLoad", from: `${id}_b.topStart`, to: `${id}_b.topEnd`, height: 0.7, endHeight: pickOf(r, [0.7, 0.3, 0]) },
  { id: `${id}_b`, type: "beam", from: P(c.x - 1.4, c.y - 0.5), to: P(c.x + 1.4, c.y - 0.5) },
]);

// --- moment arc ------------------------------------------------------------------------------------

interface MomentProps { r: number; direction: "cw" | "ccw"; start: number; sweep: number; color: string; width: number }
definePart<MomentProps>({
  type: "moment", aliases: ["momentArc", "couple", "torque"], category: "mechanics",
  description: "Applied moment: a curved arrow around the origin, counter-clockwise or clockwise. Origin at the centre (attach it to a beam point).",
  options: { r: "radius (world, default 0.35)", direction: "ccw (default) | cw", start: "start angle (default -60)", sweep: "degrees (default 270)", color: "palette colour (default force)", width: "px (default 1.6)" },
  positioning: "placed", touchPlacement: true,
  propKeys: ["r", "direction", "start", "sweep", "width"],
  props: (s, ctx) => ({ r: lengthProp(s, "r", ctx, { default: 0.35, positive: true }), direction: enumProp(s, "direction", ["ccw", "cw"] as const, "ccw"), start: angleProp(s, "start", ctx, -60 * DEG), sweep: angleProp(s, "sweep", ctx, 270 * DEG), color: colorProp(s, "color", "#c0392b"), width: strokeWidthProp(s, "width", 1.6) }),
  anchors: ["center", "start", "end"],
  geometry: (i, ctx) => {
    const p = i.props, c = i.origin, sgn = p.direction === "ccw" ? 1 : -1;
    if (!(p.sweep > 20 * DEG && p.sweep < 350 * DEG)) fail("E_INVALID_VALUE", [i.id], `Moment sweep of "${i.id}" must be between 20 and 350 degrees`, { measured: { degrees: p.sweep / DEG } });
    if (p.r * ctx.view.scale < 8) fail("E_INVALID_VALUE", [i.id], `Moment "${i.id}" radius is ${(p.r * ctx.view.scale).toFixed(1)} px; at least 8 px is needed`, { measured: { radiusPx: p.r * ctx.view.scale } });
    const a0 = sgn > 0 ? p.start : p.start + p.sweep, a1 = sgn > 0 ? p.start + p.sweep : p.start;
    const prims = arcArrowPrims(c, p.r, a0, a1, ctx, p.color, p.width, false);
    const mid = (a0 + a1) / 2;
    return { prims, anchors: { center: c, start: polar(c, p.r, a0), end: polar(c, p.r, a1) }, label: { at: polar(c, p.r, mid), candidates: outwardCandidates(v(Math.cos(mid), Math.sin(mid))) } };
  },
});
addSample("moment", (id, c, r) => [{ id, type: "moment", at: P(c.x, c.y), r: 0.6, direction: pickOf(r, ["ccw", "cw"] as const), label: "M₀" }]);

// --- coordinate triad -------------------------------------------------------------------------------

interface TriadProps { length: number; rotation: number; x: string; y: string; z: "none" | "out" | "in"; zText: string; color: string }
definePart<TriadProps>({
  type: "triad", aliases: ["axesTriad", "coordinateFrame"], category: "mechanics",
  description: "Coordinate triad at the origin: x and y arrows (rotatable) with their names, and optionally a z axis out of the page (dot in circle) or into it (cross in circle).",
  options: { length: "arrow length (world, default 0.8)", rotation: "degrees", x: "x-axis name (default x)", y: "y-axis name (default y)", z: "none (default) | out | in", zText: "z-axis name (default z)", color: "palette colour (default frame)" },
  positioning: "placed",
  propKeys: ["length", "rotation", "x", "y", "z", "zText"],
  labels: false,
  props: (s, ctx) => ({ length: lengthProp(s, "length", ctx, { default: 0.8, positive: true }), rotation: angleProp(s, "rotation", ctx, 0), x: textProp(s, "x", "x")!, y: textProp(s, "y", "y")!, z: enumProp(s, "z", ["none", "out", "in"] as const, "none"), zText: textProp(s, "zText", "z")!, color: colorProp(s, "color", "#66717a") }),
  anchors: ["origin", "xTip", "yTip"],
  geometry: (i, ctx) => {
    const p = i.props, o = i.origin, ex = v(Math.cos(p.rotation), Math.sin(p.rotation)), ey = perp(ex);
    const xt = add(o, mul(ex, p.length)), yt = add(o, mul(ey, p.length));
    const prims: Prim[] = [vector(o, xt, p.color), vector(o, yt, p.color)];
    const off = (d: Vec2, t: string) => { const tp = textPxOf(t); return px(ctx, Math.abs(d.x) * tp.w / 2 + Math.abs(d.y) * tp.h / 2 + 4); };
    prims.push(text(add(xt, mul(ex, off(ex, p.x))), p.x, 12, p.color), text(add(yt, mul(ey, off(ey, p.y))), p.y, 12, p.color));
    if (p.z !== "none") {
      const zr = px(ctx, 6), zc = add(o, mul(add(mul(ex, -1), mul(ey, -1)), px(ctx, 13)));
      prims.push(circle(zc, zr, "#fff", p.color));
      if (p.z === "out") prims.push(circle(zc, zr * 0.3, p.color, p.color));
      else { const d = zr * 0.62; prims.push(line(add(zc, v(-d, -d)), add(zc, v(d, d)), p.color, 1.2), line(add(zc, v(-d, d)), add(zc, v(d, -d)), p.color, 1.2)); }
      prims.push(text(add(zc, v(-px(ctx, 6 + textPxOf(p.zText).w / 2 + 3), 0)), p.zText, 12, p.color));
    }
    return { prims, anchors: { origin: o, center: o, xTip: xt, yTip: yt } };
  },
});
const textPxOf = (t: string) => textPx(t, 12);
addSample("triad", (id, c, r) => [{ id, type: "triad", at: P(c.x - 0.4, c.y - 0.5), length: 1.1, rotation: pickOf(r, [0, 20, 30]), z: pickOf(r, ["none", "out", "in"] as const) }]);

