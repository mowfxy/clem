/**
 * Fluids and thermodynamics: tanks, pipes, valves, pumps, piston-cylinders,
 * heat-flow arrows, hot and cold reservoirs and wavy liquid surfaces.
 * Liquids use bodyFill (#cfe4ff) with a rayAlt (#2679a0) surface.
 */
import { fail } from "../errors.js";
import {
  ABOVE_FIRST, AROUND, DEG, P, add, addSample, alongPolyline, angleOf, angleProp, arcSamples, between, boolProp, circle, colorProp, definePart, dist,
  enumProp, fittedText, head, lengthProp, lengthQ, lerp, line, listOf, mul, numProp, perp, pickOf, polar, poly, polylineLen, propPath, ptsOf, px, rot, shape,
  sizeProp, strokeWidthProp, sub, text, textProp, unit, v,
} from "./kit.js";
import type { Geo, PartContext, Prim, Vec2 } from "./kit.js";
import { outwardCandidates } from "./general.js";

const WATER = "#cfe4ff", SURFACE = "#2679a0", WALL = "#526873";

/** Wavy line from a to b (world), `waves` periods of amplitude `amp`, sampled finely. */
export function wavy(a: Vec2, b: Vec2, amp: number, waves: number): Vec2[] {
  const u = unit(sub(b, a)), n = perp(u), L = dist(a, b), N = Math.max(8, waves * 12);
  return Array.from({ length: N + 1 }, (_, k) => { const t = k / N; return add(add(a, mul(u, L * t)), mul(n, amp * Math.sin(2 * Math.PI * waves * t))); });
}

/** Free-surface marker: an inverted triangle above the surface and two short lines below it. */
function surfaceMarker(at: Vec2, ctx: PartContext, color: string): Prim[] {
  const s = px(ctx, 5), y = at.y;
  return [shape([v(at.x, y + px(ctx, 2)), v(at.x - s, y + px(ctx, 2) + s * 1.4), v(at.x + s, y + px(ctx, 2) + s * 1.4)], "#fff", color), line(v(at.x - s, y - px(ctx, 4)), v(at.x + s, y - px(ctx, 4)), color, 1), line(v(at.x - s * 0.55, y - px(ctx, 7)), v(at.x + s * 0.55, y - px(ctx, 7)), color, 1)];
}

// --- tank ---------------------------------------------------------------------------------

interface TankProps { w: number; h: number; level: number; open: boolean; wavy: boolean; marker: boolean; liquid: string }
definePart<TankProps>({
  type: "tank", aliases: ["vessel", "container"], category: "fluids",
  description: "Tank with walls, optional lid, and liquid up to `level` (fraction of the height). Origin at the bottom centre. Side and bottom ports via leftAt(t), rightAt(t), bottomAt(t); `surface` is the middle of the free surface.",
  options: { w: "width", h: "height", level: "liquid fraction 0-1 (default 0.6)", open: "no lid (default true)", wavy: "wavy surface (default false)", marker: "free-surface marker (default true)", liquid: "palette colour (default bodyFill)" },
  positioning: "placed",
  propKeys: ["w", "h", "level", "open", "wavy", "marker", "liquid"],
  props: (s, ctx) => ({ w: lengthProp(s, "w", ctx, { positive: true }), h: lengthProp(s, "h", ctx, { positive: true }), level: numProp(s, "level", ctx, { default: 0.6, min: 0, max: 1 }), open: boolProp(s, "open", true), wavy: boolProp(s, "wavy"), marker: boolProp(s, "marker", true), liquid: colorProp(s, "liquid", WATER) }),
  anchors: ["bottom", "top", "center", "surface", "left", "right", "leftAt(t)", "rightAt(t)", "bottomAt(t)", "liquidCenter"], anchorArgs: { leftAt: "number", rightAt: "number", bottomAt: "number" },
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const p = i.props, o = i.origin, W = p.w / 2, H = p.h, lv = p.level * H;
    const bl = add(o, v(-W, 0)), br = add(o, v(W, 0)), tl = add(o, v(-W, H)), tr = add(o, v(W, H));
    const prims: Prim[] = [];
    if (lv > 0) {
      const top = p.wavy ? wavy(add(o, v(W, lv)), add(o, v(-W, lv)), px(ctx, 2.5), Math.max(2, Math.round(p.w * ctx.view.scale / 30))) : [add(o, v(W, lv)), add(o, v(-W, lv))];
      prims.push(shape([bl, br, ...top], p.liquid, "none"));
      prims.push(poly(top, SURFACE, 1.2));
    }
    prims.push(poly([tl, bl, br, tr], WALL, 2));
    if (!p.open) prims.push(line(tl, tr, WALL, 2));
    const surf = add(o, v(0, lv));
    if (p.marker && lv > 0 && (H - lv) * ctx.view.scale > 12) prims.push(...surfaceMarker(add(surf, v(W * 0.45, 0)), ctx, SURFACE));
    return { prims, outline: [bl, br, tr, tl], anchors: { bottom: o, top: add(o, v(0, H)), center: add(o, v(0, H / 2)), surface: surf, liquidCenter: add(o, v(0, lv / 2)), left: add(o, v(-W, H / 2)), right: add(o, v(W, H / 2)) }, argAnchors: { leftAt: t => t >= 0 && t <= 1 ? add(o, v(-W, H * t)) : undefined, rightAt: t => t >= 0 && t <= 1 ? add(o, v(W, H * t)) : undefined, bottomAt: t => t >= 0 && t <= 1 ? add(o, v(-W + p.w * t, 0)) : undefined }, label: { at: add(o, v(0, H)), candidates: ["above", "above-right", "above-left", "right", "left"] }, refs: { depth: lengthQ(lv, ctx), w: lengthQ(p.w, ctx), h: lengthQ(p.h, ctx) } };
  },
});
addSample("tank", (id, c, r) => [{ id, type: "tank", at: P(c.x, c.y - 1), w: 2, h: 1.8, level: between(r, 0.45, 0.7), wavy: r() < 0.5 }]);

// --- pipe ---------------------------------------------------------------------------------

interface PipeProps { d: number; fill: string; flow: boolean; color: string }
/** Offset a polyline by `off` to its left with mitred joins. */
export function offsetPolyline(pts: Vec2[], off: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < pts.length; k++) {
    const nPrev = k > 0 ? perp(unit(sub(pts[k]!, pts[k - 1]!))) : undefined, nNext = k < pts.length - 1 ? perp(unit(sub(pts[k + 1]!, pts[k]!))) : undefined;
    if (!nPrev) { out.push(add(pts[k]!, mul(nNext!, off))); continue; }
    if (!nNext) { out.push(add(pts[k]!, mul(nPrev, off))); continue; }
    const m = unit(add(nPrev, nNext)), c = m.x * nNext.x + m.y * nNext.y;
    out.push(add(pts[k]!, mul(m, off / Math.max(c, 0.2))));
  }
  return out;
}
definePart<PipeProps>({
  type: "pipe", aliases: ["duct"], category: "fluids",
  description: "Pipe along `points` with diameter `d`: two mitred walls, a light fill and optional flow arrowheads. It may touch the parts its end points name (tanks, pumps, valves).",
  options: { points: "centreline points", d: "inner diameter (world, default 0.2)", flow: "draw flow arrowheads (default true)", fill: "palette colour (default bodyFill)", color: "wall colour (default mechanism)" },
  positioning: "points", pointProps: [{ name: "points", list: true }], touchRefs: ["points"],
  propKeys: ["points", "d", "flow", "fill"],
  props: (s, ctx) => ({ d: lengthProp(s, "d", ctx, { default: 0.2, positive: true }), fill: colorProp(s, "fill", WATER), flow: boolProp(s, "flow", true), color: colorProp(s, "color", WALL) }),
  anchors: ["start", "end", "mid", "at(t)"], anchorArgs: { at: "number" },
  hooks: ["curve"],
  geometry: (i, ctx) => {
    const pts = listOf(i, "points"), r = i.props.d / 2;
    if (r * 2 * ctx.view.scale < 6) fail("E_INVALID_VALUE", [i.id], `Pipe "${i.id}" is only ${(r * 2 * ctx.view.scale).toFixed(1)} px wide`, { measured: { diameterPx: r * 2 * ctx.view.scale } });
    const L = offsetPolyline(pts, r), R = offsetPolyline(pts, -r);
    const prims: Prim[] = [shape([...L, ...[...R].reverse()], i.props.fill, "none"), poly(L, i.props.color, 1.6), poly(R, i.props.color, 1.6)];
    if (i.props.flow && polylineLen(pts) * ctx.view.scale > 40) {
      for (const t of [0.5]) { const q = alongPolyline(pts, t); prims.push(head(add(q.p, mul(q.dir, px(ctx, 3))), angleOf(q.dir), SURFACE)); }
    }
    const mid = alongPolyline(pts, 0.5);
    return { prims, curve: pts, anchors: { start: pts[0]!, end: pts[pts.length - 1]!, mid: mid.p }, argAnchors: { at: t => t >= 0 && t <= 1 ? alongPolyline(pts, t).p : undefined }, label: { at: add(mid.p, mul(perp(mid.dir), r)), candidates: Math.abs(mid.dir.x) >= Math.abs(mid.dir.y) ? ABOVE_FIRST : ["right", "left", "above", "below"] }, refs: { length: lengthQ(polylineLen(pts), ctx), d: lengthQ(i.props.d, ctx) } };
  },
});
addSample("pipe", (id, c) => [{ id, type: "pipe", points: [P(c.x - 1.5, c.y + 0.5), P(c.x, c.y + 0.5), P(c.x, c.y - 0.5), P(c.x + 1.5, c.y - 0.5)], d: 0.22 }]);

// --- valve ---------------------------------------------------------------------------------

interface ValveProps { size: number; rotation: number; kind: "gate" | "check" | "control"; open: boolean }
definePart<ValveProps>({
  type: "valve", category: "fluids",
  description: "Valve symbol on a line: two triangles meeting at the origin (bow tie), with a stem and handwheel (gate), an actuator dome (control) or a single filled triangle (check). Filled when closed. Ports: inlet (left), outlet (right) before rotation.",
  options: { size: "length (world, default 0.5)", rotation: "degrees", kind: "gate (default) | control | check", open: "open (unfilled, default true)" },
  positioning: "placed",
  propKeys: ["size", "rotation", "kind", "open"],
  props: (s, ctx) => ({ size: lengthProp(s, "size", ctx, { default: 0.5, positive: true }), rotation: angleProp(s, "rotation", ctx, 0), kind: enumProp(s, "kind", ["gate", "check", "control"] as const, "gate"), open: boolProp(s, "open", true) }),
  anchors: ["center", "inlet", "outlet", "stem"],
  geometry: (i, ctx) => {
    const p = i.props, c = i.origin, f = (x: number, y: number) => add(c, rot(v(x * p.size / 2, y * p.size / 2), p.rotation));
    const fill = p.open ? "#fff" : "#526873";
    const prims: Prim[] = [shape([f(-1, 0.55), f(-1, -0.55), f(0, 0)], p.kind === "check" ? "#526873" : fill, "#222"), shape([f(1, 0.55), f(1, -0.55), f(0, 0)], fill, "#222")];
    let stem = c;
    if (p.kind === "gate") { prims.push(line(f(0, 0), f(0, 1.05), "#222", 1.4), line(f(-0.45, 1.05), f(0.45, 1.05), "#222", 2)); stem = f(0, 1.05); }
    if (p.kind === "control") { prims.push(line(f(0, 0), f(0, 0.9), "#222", 1.4)); const top = arcSamples(v(0, 0.9), 0.5, 0, Math.PI).map(q => f(q.x, q.y)); prims.push(shape(top, "#fff", "#222")); stem = f(0, 1.4); }
    return { prims, anchors: { center: c, inlet: f(-1, 0), outlet: f(1, 0), stem }, label: { at: stem, candidates: ["above", "above-right", "above-left", "below"] } };
  },
});
addSample("valve", (id, c, r) => [
  { id, type: "valve", at: P(c.x, c.y), size: 0.7, kind: pickOf(r, ["gate", "control", "check"] as const) },
  { id: `${id}_l`, type: "pipe", points: [P(c.x - 1.5, c.y), `${id}.inlet`], d: 0.14, flow: false },
  { id: `${id}_r`, type: "pipe", points: [`${id}.outlet`, P(c.x + 1.5, c.y)], d: 0.14, flow: false },
]);

// --- pump -----------------------------------------------------------------------------------

interface PumpProps { r: number; rotation: number }
definePart<PumpProps>({
  type: "pump", aliases: ["compressor"], category: "fluids",
  description: "Pump (or compressor) symbol: a circle with a triangle pointing in the flow direction; inlet on the left, outlet on the right before rotation.",
  options: { r: "radius (world, default 0.35)", rotation: "degrees (flow direction)" },
  positioning: "placed",
  propKeys: ["r", "rotation"],
  props: (s, ctx) => ({ r: lengthProp(s, "r", ctx, { default: 0.35, positive: true }), rotation: angleProp(s, "rotation", ctx, 0) }),
  anchors: ["center", "inlet", "outlet", "top", "bottom"],
  hooks: ["radius", "outline"],
  geometry: (i) => {
    const { r, rotation } = i.props, c = i.origin, f = (x: number, y: number) => add(c, rot(v(x * r, y * r), rotation));
    const prims: Prim[] = [circle(c, r, "#fff", "#222"), shape([f(-0.5, 0.62), f(-0.5, -0.62), f(0.78, 0)], "#d6e1e6", "#526873")];
    return { prims, radius: r, outline: arcSamples(c, r, 0, 2 * Math.PI).slice(0, -1), anchors: { center: c, inlet: f(-1, 0), outlet: f(1, 0), top: f(0, 1), bottom: f(0, -1) }, label: { at: c, candidates: ["above", "below", "above-right", "below-right"] } };
  },
});
addSample("pump", (id, c) => [
  { id, type: "pump", at: P(c.x, c.y), r: 0.45 },
  { id: `${id}_l`, type: "pipe", points: [P(c.x - 1.5, c.y), `${id}.inlet`], d: 0.16, flow: false },
  { id: `${id}_r`, type: "pipe", points: [`${id}.outlet`, P(c.x + 1.5, c.y)], d: 0.16 },
]);

// --- piston-cylinder ------------------------------------------------------------------------------

interface PistonProps { w: number; h: number; position: number; gas: string; rod: boolean; weights: number; text?: string }
definePart<PistonProps>({
  type: "pistonCylinder", aliases: ["piston", "cylinder"], category: "fluids",
  description: "Piston-cylinder device: an open-top cylinder (origin at its bottom centre), gas below a piston at `position` (fraction of the height), optional rod and stacked weights, optional text in the gas.",
  options: { w: "inner width", h: "cylinder height", position: "piston height fraction (default 0.55)", gas: "palette colour (default surfaceFill)", rod: "draw a rod (default false)", weights: "number of weights on the piston (default 0)", text: "text in the gas, e.g. \"gas\"" },
  positioning: "placed",
  propKeys: ["w", "h", "position", "gas", "rod", "weights", "text"],
  props: (s, ctx) => ({ w: lengthProp(s, "w", ctx, { positive: true }), h: lengthProp(s, "h", ctx, { positive: true }), position: numProp(s, "position", ctx, { default: 0.55, min: 0.1, max: 0.9 }), gas: colorProp(s, "gas", "#e8edef"), rod: boolProp(s, "rod"), weights: numProp(s, "weights", ctx, { default: 0, min: 0, max: 4, integer: true }), text: textProp(s, "text") }),
  anchors: ["bottom", "top", "piston", "pistonTop", "gas", "rodTop", "left", "right"],
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const p = i.props, o = i.origin, W = p.w / 2, H = p.h, y = p.position * H, th = Math.max(px(ctx, 8), H * 0.07);
    const fits: NonNullable<Geo["fits"]> = [];
    const prims: Prim[] = [shape([add(o, v(-W, 0)), add(o, v(W, 0)), add(o, v(W, y)), add(o, v(-W, y))], p.gas, "none")];
    prims.push(poly([add(o, v(-W, H)), add(o, v(-W, 0)), add(o, v(W, 0)), add(o, v(W, H))], WALL, 2));
    const pis = [add(o, v(-W + px(ctx, 1.5), y)), add(o, v(W - px(ctx, 1.5), y)), add(o, v(W - px(ctx, 1.5), y + th)), add(o, v(-W + px(ctx, 1.5), y + th))];
    prims.push(shape(pis, "#8a969c", "#526873"));
    let top = add(o, v(0, y + th));
    if (p.rod) { prims.push(line(top, add(o, v(0, H + px(ctx, 16))), "#526873", 3)); top = add(o, v(0, H + px(ctx, 16))); }
    for (let k = 0; k < p.weights; k++) {
      const wy = y + th + k * px(ctx, 11) + px(ctx, 1), ww = W * (0.55 - k * 0.08);
      prims.push(shape([add(o, v(-ww, wy)), add(o, v(ww, wy)), add(o, v(ww, wy + px(ctx, 10))), add(o, v(-ww, wy + px(ctx, 10)))], "#d6e1e6", "#586d78"));
    }
    const gasC = add(o, v(0, y / 2));
    if (p.text) prims.push(fittedText(fits, gasC, p.text, 12, "#333", [add(o, v(-W, 0)), add(o, v(W, 0)), add(o, v(W, y)), add(o, v(-W, y))]));
    return { prims, fits, outline: [add(o, v(-W, 0)), add(o, v(W, 0)), add(o, v(W, H)), add(o, v(-W, H))], anchors: { bottom: o, top: add(o, v(0, H)), piston: add(o, v(0, y)), pistonTop: add(o, v(0, y + th)), gas: gasC, rodTop: top, left: add(o, v(-W, H / 2)), right: add(o, v(W, H / 2)) }, label: { at: add(o, v(W, y)), candidates: ["right", "left", "above-right"] }, refs: { gasHeight: lengthQ(y, ctx) } };
  },
});
addSample("pistonCylinder", (id, c, r) => [{ id, type: "pistonCylinder", at: P(c.x, c.y - 1.1), w: 1.4, h: 2, position: between(r, 0.45, 0.6), text: "gas", weights: pickOf(r, [0, 1, 2]) }]);

// --- heat flow ------------------------------------------------------------------------------------

interface HeatProps { color: string; waves: number; width: number }
definePart<HeatProps>({
  type: "heatFlow", aliases: ["heatArrow", "heat"], category: "fluids",
  description: "Heat-transfer arrow from `from` to `to`: a wavy shaft with an arrowhead, in the force red by default. Label it Q.",
  options: { from: "point", to: "point", waves: "number of waves (default from length)", color: "palette colour (default force)", width: "px (default 1.6)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }], touchRefs: ["from", "to"],
  propKeys: ["from", "to", "waves", "width"],
  props: (s, ctx) => ({ color: colorProp(s, "color", "#c0392b"), waves: s.waves === undefined ? 0 : numProp(s, "waves", ctx, { min: 1, max: 20, integer: true }), width: strokeWidthProp(s, "width", 1.6) }),
  anchors: ["start", "end", "mid"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), Lpx = dist(a, b) * ctx.view.scale;
    if (Lpx < 30) fail("E_ARROW_TOO_SHORT", [i.id], `Heat arrow "${i.id}" is ${Lpx.toFixed(1)} px long; at least 30 px is needed`, { measured: { lengthPx: Lpx } });
    const u = unit(sub(b, a)), tipBase = sub(b, mul(u, px(ctx, 8)));
    const waves = i.props.waves || Math.max(1, Math.round((Lpx - 8) / 18));
    const shaft = wavy(a, tipBase, px(ctx, 3), waves);
    const prims: Prim[] = [poly([...shaft, sub(b, mul(u, px(ctx, 3)))], i.props.color, i.props.width), head(b, angleOf(u), i.props.color)];
    return { prims, anchors: { start: a, end: b, mid: lerp(a, b, 0.5) }, label: { at: lerp(a, b, 0.5), candidates: Math.abs(u.x) >= Math.abs(u.y) ? ABOVE_FIRST : ["right", "left", "above", "below"] } };
  },
});
addSample("heatFlow", (id, c) => [{ id, type: "heatFlow", from: P(c.x - 1.2, c.y), to: P(c.x + 1.2, c.y), label: "Q" }]);

// --- reservoir ------------------------------------------------------------------------------------

interface ResProps { w: number; h: number; kind: "hot" | "cold"; text?: string; textSize: number }
definePart<ResProps>({
  type: "reservoir", aliases: ["thermalReservoir"], category: "fluids",
  description: "Thermal reservoir: a box outlined in force red (hot) or rayAlt blue (cold) with a heavier bottom or top edge and centred text (default \"Hot reservoir\" / \"Cold reservoir\"). Origin at the centre.",
  options: { w: "width", h: "height", kind: "hot | cold", text: "centred text, e.g. T₁ = 500 K", textSize: "11-13" },
  positioning: "placed",
  propKeys: ["w", "h", "kind", "text", "textSize"],
  props: (s, ctx) => { const kind = enumProp(s, "kind", ["hot", "cold"] as const, "hot"); return { w: lengthProp(s, "w", ctx, { positive: true }), h: lengthProp(s, "h", ctx, { positive: true }), kind, text: textProp(s, "text", kind === "hot" ? "Hot reservoir" : "Cold reservoir"), textSize: sizeProp(s) }; },
  anchors: ["center", "top", "bottom", "left", "right", "topAt(t)", "bottomAt(t)"], anchorArgs: { topAt: "number", bottomAt: "number" },
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const p = i.props, c = i.origin, W = p.w / 2, H = p.h / 2, col = p.kind === "hot" ? "#c0392b" : "#2679a0";
    const outline = [add(c, v(-W, -H)), add(c, v(W, -H)), add(c, v(W, H)), add(c, v(-W, H))];
    const fits: NonNullable<Geo["fits"]> = [];
    const edgeY = p.kind === "hot" ? -H : H;
    const prims: Prim[] = [{ k: "rect", c, w: p.w, h: p.h, rxPx: 0, fill: "#fff", stroke: col }, line(add(c, v(-W, edgeY)), add(c, v(W, edgeY)), col, 3)];
    if (p.text) prims.push(fittedText(fits, c, p.text, p.textSize, col, outline));
    return { prims, fits, outline, anchors: { center: c, top: add(c, v(0, H)), bottom: add(c, v(0, -H)), left: add(c, v(-W, 0)), right: add(c, v(W, 0)) }, argAnchors: { topAt: t => t >= 0 && t <= 1 ? add(c, v(-W + p.w * t, H)) : undefined, bottomAt: t => t >= 0 && t <= 1 ? add(c, v(-W + p.w * t, -H)) : undefined }, label: { at: c, candidates: ["right", "left", "above", "below"] } };
  },
});
addSample("reservoir", (id, c, r) => [{ id, type: "reservoir", at: P(c.x, c.y), w: 2.6, h: 0.8, kind: pickOf(r, ["hot", "cold"] as const), text: pickOf(r, ["T₁ = 600 K", "Hot reservoir"]) }]);

// --- liquid surface ----------------------------------------------------------------------------------

interface SurfaceProps { waves: number; amp?: number; marker: boolean; color: string; fill: boolean; depth: number }
definePart<SurfaceProps>({
  type: "liquidSurface", aliases: ["freeSurface", "waterline"], category: "fluids",
  description: "Wavy free surface from `from` to `to` with the ▽ free-surface marker; optionally fills liquid below it to `depth`.",
  options: { from: "point", to: "point", waves: "periods (default from length)", amp: "amplitude (world, default 2.5 px)", marker: "draw the marker (default true)", fill: "fill the liquid below (default false)", depth: "fill depth (world, default 0.5)", color: "palette colour (default rayAlt)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }], touchRefs: ["from", "to"],
  propKeys: ["from", "to", "waves", "amp", "marker", "fill", "depth"],
  props: (s, ctx) => ({ waves: s.waves === undefined ? 0 : numProp(s, "waves", ctx, { min: 1, max: 60, integer: true }), amp: s.amp === undefined ? undefined : lengthProp(s, "amp", ctx, { positive: true }), marker: boolProp(s, "marker", true), color: colorProp(s, "color", SURFACE), fill: boolProp(s, "fill"), depth: lengthProp(s, "depth", ctx, { default: 0.5, positive: true }) }),
  anchors: ["start", "end", "mid", "at(t)"], anchorArgs: { at: "number" },
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), Lpx = dist(a, b) * ctx.view.scale;
    if (Lpx < 24) fail("E_INVALID_VALUE", [i.id], `Surface "${i.id}" is only ${Lpx.toFixed(1)} px long`, { measured: { lengthPx: Lpx } });
    const pts = wavy(a, b, i.props.amp ?? px(ctx, 2.5), i.props.waves || Math.max(2, Math.round(Lpx / 30)));
    const prims: Prim[] = [];
    if (i.props.fill) prims.push(shape([...pts, add(b, v(0, -i.props.depth)), add(a, v(0, -i.props.depth))], WATER, "none"));
    prims.push(poly(pts, i.props.color, 1.2));
    if (i.props.marker) prims.push(...surfaceMarker(lerp(a, b, 0.7), ctx, i.props.color));
    return { prims, anchors: { start: a, end: b, mid: lerp(a, b, 0.5) }, argAnchors: { at: t => t >= 0 && t <= 1 ? lerp(a, b, t) : undefined }, label: { at: lerp(a, b, 0.25), candidates: ["above", "above-right", "above-left", "below"] } };
  },
});
addSample("liquidSurface", (id, c, r) => [{ id, type: "liquidSurface", from: P(c.x - 1.5, c.y), to: P(c.x + 1.5, c.y), fill: r() < 0.6, depth: 0.8 }]);

