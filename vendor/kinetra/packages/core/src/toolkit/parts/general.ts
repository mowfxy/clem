/**
 * General parts: boxes, nodes, text blocks, arrows, connectors (with a small
 * orthogonal router), braces, dimension lines, angle arcs, leader callouts,
 * legends and tables.
 */
import { fail } from "../errors.js";
import { DIMLESS } from "../expr.js";
import type { PartDefinition } from "../parts.js";
import { wiresCrossCleanly } from "../geometry.js";
import {
  ABOVE_FIRST, AROUND, CLOSED, DEG, P, add, addSample, alongPolyline, angleOf, angleProp, angleQ, arc, arcSamples, arrowPath, besideLine, between, boolProp,
  circle, colorProp, definePart, dist, dot, enumProp, fittedText, head, idProp, lengthProp, lengthQ, lerp, line, listOf, listProp, mul, numProp, perp,
  pickOf, polar, poly, polylineLen, propPath, ptsOf, px, rot, roundedRectPoints, shape, sizeProp, strokeWidthProp, sub, text, textProp, textPx, unit, v, vector,
} from "./kit.js";
import type { ElementSpec, Geo, PartContext, PartInstance, Prim, Vec2 } from "./kit.js";
import { formatLabelMarkup } from "../text_metrics.js";

const boxAnchors = (c: Vec2, w: number, h: number, a = 0): Record<string, Vec2> => {
  const f = (x: number, y: number) => add(c, rot(v(x * w / 2, y * h / 2), a));
  return { center: c, top: f(0, 1), bottom: f(0, -1), left: f(-1, 0), right: f(1, 0), topLeft: f(-1, 1), topRight: f(1, 1), bottomLeft: f(-1, -1), bottomRight: f(1, -1) };
};
/** Side anchors with a fraction along the side (0 = first corner, 1 = second), left-to-right / bottom-to-top. */
const sideArgs = (c: Vec2, w: number, h: number, a = 0) => {
  const f = (x: number, y: number) => add(c, rot(v(x * w / 2, y * h / 2), a));
  const t = (g: (t: number) => Vec2) => (arg: number) => arg >= 0 && arg <= 1 ? g(arg) : undefined;
  return { topAt: t(s => f(-1 + 2 * s, 1)), bottomAt: t(s => f(-1 + 2 * s, -1)), leftAt: t(s => f(-1, -1 + 2 * s)), rightAt: t(s => f(1, -1 + 2 * s)) };
};
const SIDE_ARG_DOCS = ["topAt(t)", "bottomAt(t)", "leftAt(t)", "rightAt(t)"];

// --- roundedBox -------------------------------------------------------------------------

interface RBoxProps { w: number; h: number; r: number; rotation: number; fill: string; stroke: string; text?: string; textSize: number; textColor: string; dashed: boolean }
definePart<RBoxProps>({
  type: "roundedBox", aliases: ["panel", "tfBlock", "blockDiagramBlock"], category: "general",
  description: "Box with optional rounded corners and centred text (block-diagram blocks, flow-chart steps, panels); origin at its centre.",
  options: { w: "width", h: "height", r: "corner radius (world, default 0)", rotation: "degrees", fill: "palette colour", stroke: "palette colour", text: "centred text", textSize: "11-13", textColor: "palette colour" },
  positioning: "placed",
  propKeys: ["w", "h", "r", "rotation", "fill", "stroke", "text", "textSize", "textColor"],
  props: (s, ctx) => {
    const p = { w: lengthProp(s, "w", ctx, { positive: true }), h: lengthProp(s, "h", ctx, { positive: true }), r: lengthProp(s, "r", ctx, { default: 0, min: 0 }), rotation: angleProp(s, "rotation", ctx, 0), fill: colorProp(s, "fill", "#fff"), stroke: colorProp(s, "stroke", "#222"), text: textProp(s, "text"), textSize: sizeProp(s), textColor: colorProp(s, "textColor", "#222"), dashed: false };
    if (p.r > Math.min(p.w, p.h) / 2) fail("E_INVALID_VALUE", [s.id], `Corner radius of "${s.id}" exceeds half the shorter side`, { path: propPath(s, "r"), measured: { r: p.r, max: Math.min(p.w, p.h) / 2 } });
    return p;
  },
  anchors: ["center", "top", "bottom", "left", "right", "topLeft", "topRight", "bottomLeft", "bottomRight", ...SIDE_ARG_DOCS],
  anchorArgs: { topAt: "number", bottomAt: "number", leftAt: "number", rightAt: "number" },
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const { w, h, r, rotation } = i.props, c = i.origin;
    const outline = roundedRectPoints(v(0, 0), w, h, r).map(p => add(c, rot(p, rotation)));
    const prims: Prim[] = [];
    const fits: NonNullable<Geo["fits"]> = [];
    if (rotation === 0) prims.push({ k: "rect", c, w, h, rxPx: r * ctx.view.scale, fill: i.props.fill, stroke: i.props.stroke });
    else prims.push(shape(roundedRectPoints(v(0, 0), w, h, r, 5).map(p => add(c, rot(p, rotation))), i.props.fill, i.props.stroke));
    if (i.props.text) prims.push(fittedText(fits, c, i.props.text, i.props.textSize, i.props.textColor, outline));
    return { prims, fits, outline, anchors: boxAnchors(c, w, h, rotation), argAnchors: sideArgs(c, w, h, rotation), label: { at: c, candidates: i.props.text ? ["above", "below", "right", "left", "above-right", "below-right"] : CLOSED }, refs: { w: lengthQ(w, ctx), h: lengthQ(h, ctx) } };
  },
});
addSample("roundedBox", (id, c, r) => [{ id, type: "roundedBox", at: P(c.x, c.y), w: between(r, 1.6, 2.4), h: between(r, 0.8, 1.1), r: pickOf(r, [0, 0.15, 0.3]), text: pickOf(r, ["Controller", "G(s)", "Plant", "Step 1"]) }]);

// --- circleNode -------------------------------------------------------------------------

interface NodeProps { r: number; fill: string; stroke: string; text?: string; textSize: number; textColor: string }
definePart<NodeProps>({
  type: "circleNode", aliases: ["node"], category: "general",
  description: "Circle with centred text (graph nodes, states, junction labels); origin at its centre.",
  options: { r: "radius", fill: "palette colour (default white)", stroke: "palette colour", text: "centred text", textSize: "11-13", textColor: "palette colour" },
  positioning: "placed",
  propKeys: ["r", "fill", "stroke", "text", "textSize", "textColor"],
  props: (s, ctx) => ({ r: lengthProp(s, "r", ctx, { positive: true }), fill: colorProp(s, "fill", "#fff"), stroke: colorProp(s, "stroke", "#222"), text: textProp(s, "text"), textSize: sizeProp(s), textColor: colorProp(s, "textColor", "#222") }),
  anchors: ["center", "top", "bottom", "left", "right", "rim(angle)"],
  anchorArgs: { rim: "angle" },
  hooks: ["outline", "radius"],
  geometry: (i, ctx) => circleGeo(i.origin, i.props.r, i.props.fill, i.props.stroke, i.props.text, i.props.textSize, i.props.textColor, ctx),
});
export function circleGeo(c: Vec2, r: number, fill: string, stroke: string, t: string | undefined, size: number, color: string, ctx: PartContext, extra: Prim[] = []): Geo {
  const outline = Array.from({ length: 72 }, (_, k) => polar(c, r, k * 5 * DEG));
  const fits: NonNullable<Geo["fits"]> = [];
  const prims: Prim[] = [circle(c, r, fill, stroke), ...extra];
  if (t) prims.push(fittedText(fits, c, t, size, color, outline));
  return { prims, fits, outline, radius: r, anchors: { center: c, top: polar(c, r, 90 * DEG), bottom: polar(c, r, -90 * DEG), left: polar(c, r, Math.PI), right: polar(c, r, 0) }, argAnchors: { rim: a => polar(c, r, a) }, label: { at: c, candidates: t ? ["above-right", "above", "below", "right", "left", "below-right", "above-left", "below-left"] : CLOSED }, refs: { r: lengthQ(r, ctx) } };
}
addSample("circleNode", (id, c, r) => [{ id, type: "circleNode", at: P(c.x, c.y), r: between(r, 0.45, 0.7), text: pickOf(r, ["A", "S₀", "q1", "42"]) }]);

// --- textBlock --------------------------------------------------------------------------

interface TextBlockProps { lines: string[]; size: number; color: string; align: "left" | "center" | "right"; frame: boolean; padding: number; fill: string; lineGap: number }
definePart<TextBlockProps>({
  type: "textBlock", aliases: ["paragraph"], category: "general",
  description: "Multi-line text, optionally framed; origin at the block centre. Lines are given as a list or split on \\n.",
  options: { text: "string with \\n, or", lines: "list of strings", size: "11-13", align: "left | center | right", frame: "draw a box", padding: "px inside the frame (default 4)", fill: "frame fill", color: "text colour" },
  positioning: "placed",
  propKeys: ["text", "lines", "size", "align", "frame", "padding", "fill"],
  props: (s, ctx) => {
    let raw: unknown[];
    if (s.lines !== undefined) raw = listProp<unknown>(s, "lines", { min: 1, max: 40 });
    else if (typeof s.text === "string" && s.text !== "") raw = s.text.split("\n");
    else return fail("E_SCHEMA", [s.id], `textBlock "${s.id}" needs "text" or "lines"`, { path: propPath(s, "text") });
    if (raw.some(l => typeof l !== "string" || l === "")) fail("E_SCHEMA", [s.id], `Every line of "${s.id}" must be a non-empty string`, { path: propPath(s, "lines") });
    return { lines: (raw as string[]).map(l => formatLabelMarkup(l, [s.id])), size: sizeProp(s, "size"), color: colorProp(s, "color", "#333"), align: enumProp(s, "align", ["left", "center", "right"] as const, "center"), frame: boolProp(s, "frame"), padding: numProp(s, "padding", ctx, { default: 4, min: 0, max: 40 }), fill: colorProp(s, "fill", "#fff"), lineGap: 3 };
  },
  anchors: ["center", "top", "bottom", "left", "right", "topLeft", "topRight", "bottomLeft", "bottomRight", "line(i)"],
  anchorArgs: { line: "number" },
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const { lines, size, align, padding } = i.props;
    const ms = lines.map(l => textPx(l, size));
    const wpx = Math.max(...ms.map(m => m.w)), lh = Math.max(...ms.map(m => m.h)) + i.props.lineGap;
    const W = px(ctx, wpx + 2 * padding), H = px(ctx, lh * lines.length - i.props.lineGap + 2 * padding);
    const c = i.origin, top = c.y + H / 2 - px(ctx, padding);
    const prims: Prim[] = [];
    if (i.props.frame) prims.push({ k: "rect", c, w: W, h: H, rxPx: 0, fill: i.props.fill, stroke: "#444" });
    const centers: Vec2[] = [];
    lines.forEach((l, k) => {
      const cy = top - px(ctx, lh * k + (lh - i.props.lineGap) / 2);
      const ax = align === "center" ? c.x : c.x + (align === "left" ? -1 : 1) * px(ctx, wpx / 2 - 1);
      centers.push(v(c.x, cy));
      prims.push(text(v(ax, cy), l, size, i.props.color, align === "center" ? "middle" : align === "left" ? "start" : "end"));
    });
    const outline = [v(c.x - W / 2, c.y - H / 2), v(c.x + W / 2, c.y - H / 2), v(c.x + W / 2, c.y + H / 2), v(c.x - W / 2, c.y + H / 2)];
    return { prims, outline, anchors: boxAnchors(c, W, H), argAnchors: { line: k => Number.isInteger(k) ? centers[k] : undefined }, label: { at: c, candidates: ABOVE_FIRST }, refs: { w: lengthQ(W, ctx), h: lengthQ(H, ctx) } };
  },
});
addSample("textBlock", (id, c, r) => [{ id, type: "textBlock", at: P(c.x, c.y), lines: ["Given:", "m = 2 kg", "v₀ = 3 m/s"], align: pickOf(r, ["left", "center"] as const), frame: r() < 0.6 }]);

// --- curvedArrow --------------------------------------------------------------------------

interface CurvedProps { bend: number; color: string; width: number; double: boolean; labelAt: number }
/** Circular arc from a to b bulging to the left of a->b by bend * chord. */
export function bendArc(a: Vec2, b: Vec2, bend: number) {
  const ch = dist(a, b), m = lerp(a, b, 0.5), u = unit(sub(b, a)), n = perp(u);
  const sag = bend * ch;
  const R = (ch * ch / 4 + sag * sag) / (2 * Math.abs(sag));
  const c = add(m, mul(n, Math.sign(sag) * (sag * sag > 0 ? Math.abs(sag) - R : 0)));
  const a0 = angleOf(sub(a, c)); let a1 = angleOf(sub(b, c));
  // A left bulge (sag > 0) runs clockwise about the centre (+y up), a right bulge counter-clockwise.
  if (sag > 0) { while (a1 > a0) a1 -= 2 * Math.PI; } else { while (a1 < a0) a1 += 2 * Math.PI; }
  return { c, R, a0, a1, apex: add(m, mul(n, sag)) };
}
definePart<CurvedProps>({
  type: "curvedArrow", aliases: ["arcArrow"], category: "general",
  description: "Curved arrow along a circular arc from `from` to `to`, bulging to the left of the direction of travel by bend x chord (negative bends right). Head at `to`; `double` adds one at `from`.",
  options: { from: "point", to: "point", bend: "-0.45..0.45, default 0.25", double: "heads at both ends", color: "palette colour", width: "shaft px (default 1.6)", labelAt: "label slot t in [0,1] (default 0.5)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }],
  propKeys: ["from", "to", "bend", "double", "width", "labelAt"],
  props: (s, ctx) => {
    const bend = numProp(s, "bend", ctx, { default: 0.25, min: -0.45, max: 0.45 });
    if (Math.abs(bend) < 0.02) fail("E_INVALID_VALUE", [s.id], `bend of "${s.id}" is too small for a curved arrow`, { path: propPath(s, "bend"), suggestion: "Use a straight arrow, or |bend| >= 0.02." });
    return { bend, color: colorProp(s, "color", "#222"), width: strokeWidthProp(s, "width", 1.6), double: boolProp(s, "double"), labelAt: numProp(s, "labelAt", ctx, { default: 0.5, min: 0, max: 1 }) };
  },
  anchors: ["start", "end", "mid", "apex", "center", "at(t)", "slot(t)"],
  anchorArgs: { at: "number", slot: "number" },
  hooks: ["curve"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to");
    if (dist(a, b) * ctx.view.scale < 16) fail("E_ARROW_TOO_SHORT", [i.id], `Curved arrow "${i.id}" spans ${(dist(a, b) * ctx.view.scale).toFixed(1)} px; at least 16 px is needed`, { measured: { chordPx: dist(a, b) * ctx.view.scale } });
    const g = bendArc(a, b, i.props.bend);
    const pts = arcSamples(g.c, g.R, g.a0, g.a1);
    const at = (t: number) => polar(g.c, g.R, g.a0 + (g.a1 - g.a0) * t);
    const prims = arcArrowPrims(g.c, g.R, g.a0, g.a1, ctx, i.props.color, i.props.width, i.props.double);
    const slot = at(i.props.labelAt);
    return { prims, curve: pts, anchors: { start: a, end: b, mid: at(0.5), apex: g.apex, center: g.c }, argAnchors: { at: t => t >= 0 && t <= 1 ? at(t) : undefined, slot: t => t >= 0 && t <= 1 ? at(t) : undefined }, label: { at: slot, candidates: outwardCandidates(sub(slot, g.c)) }, refs: { radius: lengthQ(g.R, ctx), sweep: angleQ(Math.abs(g.a1 - g.a0)) } };
  },
});
/** Arc shaft with heads; the shaft is trimmed 3 px under each head. */
export function arcArrowPrims(c: Vec2, R: number, a0: number, a1: number, ctx: PartContext, color: string, w: number, double: boolean, startOnly = false): Prim[] {
  const s = Math.sign(a1 - a0), trim = px(ctx, 3) / R;
  const b0 = double || startOnly ? a0 + s * trim : a0, b1 = startOnly ? a1 : a1 - s * trim;
  const out: Prim[] = [arc(c, R, b0, b1, color, w)];
  if (!startOnly) out.push(head(polar(c, R, a1), a1 + s * Math.PI / 2, color));
  if (double || startOnly) out.push(head(polar(c, R, a0), a0 - s * Math.PI / 2, color));
  return out;
}
/** Label candidates pointing away from a centre along `d`. */
export function outwardCandidates(d: Vec2) {
  const order = ["right", "above-right", "above", "above-left", "left", "below-left", "below", "below-right"] as const;
  const k = ((Math.round(angleOf(d) / (Math.PI / 4)) % 8) + 8) % 8;
  return [0, 1, -1, 2, -2, 3, -3, 4].map(dd => order[(k + dd + 8) % 8]!);
}
addSample("curvedArrow", (id, c, r) => [{ id, type: "curvedArrow", from: P(c.x - 1.2, c.y - 0.3), to: P(c.x + 1.2, c.y - 0.3), bend: between(r, 0.2, 0.4), double: r() < 0.3, color: pickOf(r, ["ink", "force", "velocity"]) }]);

// --- doubleArrow ----------------------------------------------------------------------------

interface DArrowProps { color: string; dashed: boolean; labelAt: number }
definePart<DArrowProps>({
  type: "doubleArrow", aliases: ["twoWayArrow"], category: "general",
  description: "Straight arrow with heads at both ends (drawn as two Scene2D vectors from the midpoint, so the heads match every other arrow).",
  options: { from: "point", to: "point", color: "palette colour", dashed: "boolean", labelAt: "label slot t (default 0.5)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }],
  propKeys: ["from", "to", "dashed", "labelAt"],
  props: (s, ctx) => ({ color: colorProp(s, "color", "#222"), dashed: boolProp(s, "dashed"), labelAt: numProp(s, "labelAt", ctx, { default: 0.5, min: 0, max: 1 }) }),
  anchors: ["start", "end", "mid", "at(t)", "slot(t)"],
  anchorArgs: { at: "number", slot: "number" },
  hooks: ["segment", "curve"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), m = lerp(a, b, 0.5);
    if (dist(a, b) * ctx.view.scale < 24) fail("E_ARROW_TOO_SHORT", [i.id], `Double arrow "${i.id}" is ${(dist(a, b) * ctx.view.scale).toFixed(1)} px long; at least 24 px is needed for two heads`, { measured: { lengthPx: dist(a, b) * ctx.view.scale, minPx: 24 } });
    const at = (t: number) => t >= 0 && t <= 1 ? lerp(a, b, t) : undefined;
    return { prims: [vector(m, b, i.props.color, i.props.dashed), vector(m, a, i.props.color, i.props.dashed)], segment: [a, b], curve: [a, b], anchors: { start: a, end: b, mid: m }, argAnchors: { at, slot: at }, label: { at: lerp(a, b, i.props.labelAt), candidates: besideLine(sub(b, a)) }, refs: { length: lengthQ(dist(a, b), ctx) } };
  },
});
addSample("doubleArrow", (id, c, r) => { const a = between(r, -30, 30) * DEG; return [{ id, type: "doubleArrow", from: P(c.x - 1.2 * Math.cos(a), c.y - 1.2 * Math.sin(a)), to: P(c.x + 1.2 * Math.cos(a), c.y + 1.2 * Math.sin(a)), dashed: r() < 0.3 }]; });

// --- connector (with router) --------------------------------------------------------------------

type Side4 = "left" | "right" | "up" | "down";
type EndKind = "none" | "arrow" | "dot";
interface ConnProps { route: "straight" | "orthogonal" | "curved"; start: EndKind; end: EndKind; color: string; width: number; dashed: boolean; labelAt: number; avoid: string[]; fromSide?: Side4; toSide?: Side4; marginPx: number; path?: Vec2[]; via: boolean }
const SIDES: Record<Side4, Vec2> = { left: v(-1, 0), right: v(1, 0), up: v(0, 1), down: v(0, -1) };
const refId = (r: unknown): string | undefined => typeof r === "string" ? /^([A-Za-z_][A-Za-z0-9_-]*)/.exec(r)?.[1] : r && typeof r === "object" && typeof (r as { ref?: unknown }).ref === "string" ? refId((r as { ref: string }).ref) : undefined;

definePart<ConnProps>({
  type: "connector", aliases: ["wireArrow", "link", "signal"], category: "general",
  description: "Line between two anchors: straight, orthogonal (routed around the endpoint parts and any `avoid` parts with few bends and few crossings of other connectors in `avoid`) or curved. Ends: arrow, dot or none. It may touch the parts it connects, and it may cross another straight or orthogonal connector cleanly (at 30° or more, 10 px from corners and ends) without mayTouch.",
  options: { from: "point", to: "point", route: "straight | orthogonal | curved", via: "explicit corner points (orthogonal; skips routing)", start: "none | arrow | dot", end: "arrow (default) | dot | none", fromSide: "exit direction left/right/up/down (default: inferred)", toSide: "entry side of the target", avoid: "element ids to route around", margin: "px clearance from bodies (default 12)", labelAt: "label slot t", color: "palette colour", width: "px (default 1.4)", dashed: "boolean" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }, { name: "via", list: true, optional: true, min: 1 }],
  propKeys: ["from", "to", "via", "route", "start", "end", "fromSide", "toSide", "avoid", "margin", "labelAt", "width", "dashed"],
  props: (s, ctx) => {
    const sides = ["left", "right", "up", "down"] as const;
    return {
      route: enumProp(s, "route", ["straight", "orthogonal", "curved"] as const, "straight"), start: enumProp(s, "start", ["none", "arrow", "dot"] as const, "none"), end: enumProp(s, "end", ["none", "arrow", "dot"] as const, "arrow"),
      color: colorProp(s, "color", "#222"), width: strokeWidthProp(s, "width", 1.4), dashed: boolProp(s, "dashed"), labelAt: numProp(s, "labelAt", ctx, { default: 0.5, min: 0, max: 1 }),
      avoid: listProp<string>(s, "avoid", { optional: true }).map((_, k) => idProp({ ...s, [`avoid[${k}]`]: (s.avoid as string[])[k] }, `avoid[${k}]`)),
      fromSide: s.fromSide === undefined ? undefined : enumProp(s, "fromSide", sides, "right"), toSide: s.toSide === undefined ? undefined : enumProp(s, "toSide", sides, "left"),
      marginPx: numProp(s, "margin", ctx, { default: 12, min: 2, max: 60 }), via: s.via !== undefined,
    };
  },
  elementRefs: s => Array.isArray(s.avoid) ? (s.avoid as unknown[]).filter((x): x is string => typeof x === "string") : [],
  link: (i, get, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to");
    const ends = [refId(i.spec.from), refId(i.spec.to)].filter((x): x is string => !!x);
    i.touches = [...new Set(ends)];
    const p = i.props;
    if (p.route === "straight") { p.path = [a, b]; return; }
    const boxOfId = (id: string) => { const o = get(id); return o.def.box(o.inst, ctx); };
    const dirFor = (pt: Vec2, id: string | undefined, other: Vec2, explicit?: Side4): Vec2 => {
      if (explicit) return SIDES[explicit];
      if (id) {
        const bx = boxOfId(id), c = v((bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2), hx = Math.max((bx.x1 - bx.x0) / 2, 1e-9), hy = Math.max((bx.y1 - bx.y0) / 2, 1e-9);
        const rel = sub(pt, c);
        if (Math.hypot(rel.x / hx, rel.y / hy) > 1e-6) return Math.abs(rel.x) / hx >= Math.abs(rel.y) / hy ? v(Math.sign(rel.x) || 1, 0) : v(0, Math.sign(rel.y) || 1);
      }
      const d = sub(other, pt);
      return Math.abs(d.x) >= Math.abs(d.y) ? v(Math.sign(d.x) || 1, 0) : v(0, Math.sign(d.y) || 1);
    };
    const idA = refId(i.spec.from), idB = refId(i.spec.to);
    const dA = dirFor(a, idA, b, p.fromSide);
    const dB = p.toSide ? mul(SIDES[p.toSide], -1) : dirFor(b, idB, a);
    if (p.route === "curved") {
      const k = 0.4 * dist(a, b), c1 = add(a, mul(dA, k)), c2 = add(b, mul(dB, k));
      p.path = Array.from({ length: 41 }, (_, n) => { const t = n / 40, u = 1 - t; return v(u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y); });
      return;
    }
    if (p.via) { p.path = [a, ...(i.points.via as Vec2[]), b]; return; }
    const m = px(ctx, p.marginPx);
    const obstacleIds = [...new Set([...ends, ...p.avoid])].filter(id => get(id).inst.type !== "connector");
    const obstacles = obstacleIds.map(boxOfId);
    const others = p.avoid.map(id => get(id)).filter(o => o.inst.type === "connector").map(o => (o.inst.props as ConnProps).path ?? []);
    // Keep the route (and its stroke) inside the canvas.
    const inset = px(ctx, p.width / 2 + 1), cv = ctx.canvas;
    const bounds = cv ? { x0: cv.x0 + inset, y0: cv.y0 + inset, x1: cv.x1 - inset, y1: cv.y1 - inset } : undefined;
    const route = routeOrthogonal(a, dA, b, dB, obstacles, others, m, { a: idA ? obstacleIds.indexOf(idA) : -1, b: idB ? obstacleIds.indexOf(idB) : -1 }, bounds);
    if (!route) fail("E_CONTRADICTORY", [i.id, ...ends, ...p.avoid], `No orthogonal route for "${i.id}" clears the parts it must avoid inside the canvas`, { suggestion: "Move the parts apart, reduce \"margin\", give \"fromSide\"/\"toSide\", enlarge the world bounds, or give \"via\" corner points." });
    p.path = route;
  },
  contactWith: (i, o, ctx) => {
    // Two signal lines may cross without connecting, away from corners and arrowheads (10 px).
    if (o.type !== "connector") return undefined;
    const a = i.props.path ?? [ptsOf(i, "from"), ptsOf(i, "to")], q = o.props as ConnProps, b = q.path ?? [];
    if (i.props.route === "curved" || q.route === "curved" || b.length < 2) return undefined;
    return wiresCrossCleanly(a.map(ctx.view.toView), b.map(ctx.view.toView), (i.props.width + q.width) / 2 + 0.5, 10) ? "signal lines cross without connecting" : undefined;
  },
  anchors: ["start", "end", "mid", "at(t)", "slot(t)", "bend(i)"],
  anchorArgs: { at: "number", slot: "number", bend: "number" },
  hooks: ["curve"],
  geometry: (i, ctx) => {
    const p = i.props, pts = p.path ?? [ptsOf(i, "from"), ptsOf(i, "to")];
    if (polylineLen(pts) * ctx.view.scale < 12) fail("E_ARROW_TOO_SHORT", [i.id], `Connector "${i.id}" is ${(polylineLen(pts) * ctx.view.scale).toFixed(1)} px long; at least 12 px is needed`, { measured: { lengthPx: polylineLen(pts) * ctx.view.scale } });
    const prims: Prim[] = [];
    if (p.end === "arrow" || p.start === "arrow") prims.push(...arrowPathEnds(pts, ctx, p.color, p.width, p.dashed, p.start === "arrow", p.end === "arrow"));
    else prims.push(poly(pts, p.color, p.width, false, p.dashed));
    if (p.start === "dot") prims.push(dot(pts[0]!, p.color));
    if (p.end === "dot") prims.push(dot(pts[pts.length - 1]!, p.color));
    const at = (t: number) => t >= 0 && t <= 1 ? alongPolyline(pts, t).p : undefined;
    const s = alongPolyline(pts, p.labelAt);
    return { prims, curve: pts, anchors: { start: pts[0]!, end: pts[pts.length - 1]!, mid: alongPolyline(pts, 0.5).p }, argAnchors: { at, slot: at, bend: k => Number.isInteger(k) && k >= 0 && k < pts.length - 2 ? pts[k + 1] : undefined }, label: { at: s.p, candidates: besideLine(s.dir) }, refs: { length: lengthQ(polylineLen(pts), ctx), bends: { value: pts.length - 2, dim: DIMLESS } } };
  },
});

/** Shaft with optional heads at either end. */
function arrowPathEnds(pts: Vec2[], ctx: PartContext, color: string, w: number, dashed: boolean, startHead: boolean, endHead: boolean): Prim[] {
  if (endHead) return arrowPath(pts, ctx, color, w, dashed, startHead);
  return arrowPath([...pts].reverse(), ctx, color, w, dashed, false);
}

/**
 * Orthogonal router on the grid of obstacle edges: Dijkstra over (node,
 * heading) with cost = length + bend penalty + crossing penalty, never
 * entering an obstacle box grown by the clearance `m`. Starts with a stub out
 * of `a` along `dA` and ends with a stub into `b` against `dB`; `others` are
 * polylines whose crossings are penalised.
 */
export function routeOrthogonal(a: Vec2, dA: Vec2, b: Vec2, dB: Vec2, boxes: { x0: number; y0: number; x1: number; y1: number }[], others: Vec2[][], m: number, own: { a?: number; b?: number } = {}, bounds?: { x0: number; y0: number; x1: number; y1: number }): Vec2[] | undefined {
  const obstacles = boxes.map(o => ({ x0: o.x0 - m, y0: o.y0 - m, x1: o.x1 + m, y1: o.y1 + m }));
  // Each stub leaves the grown box of its own part (the box index in `own`, else any box
  // whose edge the point lies on); a point strictly inside another part cannot be routed.
  const stub = (p: Vec2, d: Vec2, ownIdx: number | undefined) => {
    let t = m * 1.05;
    obstacles.forEach((o, k) => {
      if (!(p.x >= o.x0 && p.x <= o.x1 && p.y >= o.y0 && p.y <= o.y1)) return;
      const raw = boxes[k]!, strictlyInside = p.x > raw.x0 + 1e-9 && p.x < raw.x1 - 1e-9 && p.y > raw.y0 + 1e-9 && p.y < raw.y1 - 1e-9;
      if (strictlyInside && k !== ownIdx) return;
      t = Math.max(t, (d.x > 0 ? o.x1 - p.x : d.x < 0 ? p.x - o.x0 : d.y > 0 ? o.y1 - p.y : p.y - o.y0) + m * 0.05);
    });
    return add(p, mul(d, t));
  };
  const sA = stub(a, dA, own.a), sB = stub(b, dB, own.b);
  const xs = new Set([sA.x, sB.x]), ys = new Set([sA.y, sB.y]);
  for (const o of obstacles) { xs.add(o.x0); xs.add(o.x1); ys.add(o.y0); ys.add(o.y1); }
  // Canvas bounds (optional): grid lines at the edges, and no node outside them.
  const outside = (p: Vec2) => !!bounds && (p.x < bounds.x0 - 1e-9 || p.x > bounds.x1 + 1e-9 || p.y < bounds.y0 - 1e-9 || p.y > bounds.y1 + 1e-9);
  if (bounds) { xs.add(bounds.x0); xs.add(bounds.x1); ys.add(bounds.y0); ys.add(bounds.y1); }
  if (outside(sA) || outside(sB)) return undefined;
  const sortU = (s: Set<number>) => { const arr = [...s].sort((p, q) => p - q); const out: number[] = []; for (const x of arr) { if (out.length && Math.abs(x - out[out.length - 1]!) < 1e-9) continue; out.push(x); } const mids = out.slice(1).map((x, k) => (x + out[k]!) / 2); return [...out, ...mids].sort((p, q) => p - q); };
  const X = sortU(xs), Y = sortU(ys);
  const inside = (p: Vec2) => obstacles.some(o => p.x > o.x0 + 1e-9 && p.x < o.x1 - 1e-9 && p.y > o.y0 + 1e-9 && p.y < o.y1 - 1e-9);
  const segBlocked = (p: Vec2, q: Vec2) => inside(lerp(p, q, 0.5)) || obstacles.some(o => (p.x === q.x ? p.x > o.x0 + 1e-9 && p.x < o.x1 - 1e-9 && Math.min(p.y, q.y) < o.y0 && Math.max(p.y, q.y) > o.y1 : p.y > o.y0 + 1e-9 && p.y < o.y1 - 1e-9 && Math.min(p.x, q.x) < o.x0 && Math.max(p.x, q.x) > o.x1));
  const crossCount = (p: Vec2, q: Vec2) => { let n = 0; for (const path of others) for (let k = 1; k < path.length; k++) if (segCross(p, q, path[k - 1]!, path[k]!)) n++; return n; };
  if (inside(sA) || inside(sB)) return undefined;
  const xi = (x: number) => X.findIndex(t => Math.abs(t - x) < 1e-9), yi = (y: number) => Y.findIndex(t => Math.abs(t - y) < 1e-9);
  const dirs = [v(1, 0), v(-1, 0), v(0, 1), v(0, -1)];
  const dIndex = (d: Vec2) => dirs.findIndex(e => e.x === Math.sign(d.x) && e.y === Math.sign(d.y));
  const key = (i: number, j: number, d: number) => (i * Y.length + j) * 4 + d;
  const N = X.length * Y.length * 4;
  const cost = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const bendPenalty = m * 3, crossPenalty = m * 12;
  const start = key(xi(sA.x), yi(sA.y), dIndex(dA));
  cost[start] = 0;
  // Simple binary-heap Dijkstra.
  const heap: [number, number][] = [[0, start]];
  const push = (c: number, k: number) => { heap.push([c, k]); let n = heap.length - 1; while (n > 0) { const pa = (n - 1) >> 1; if (heap[pa]![0] <= heap[n]![0]) break; [heap[pa], heap[n]] = [heap[n]!, heap[pa]!]; n = pa; } };
  const pop = () => { const top = heap[0]!; const last = heap.pop()!; if (heap.length) { heap[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r2 = l + 1; let s = n; if (l < heap.length && heap[l]![0] < heap[s]![0]) s = l; if (r2 < heap.length && heap[r2]![0] < heap[s]![0]) s = r2; if (s === n) break; [heap[s], heap[n]] = [heap[n]!, heap[s]!]; n = s; } } return top; };
  const goalI = xi(sB.x), goalJ = yi(sB.y), goalD = dIndex(mul(dB, -1));
  let best = -1;
  while (heap.length) {
    const [c, k] = pop();
    if (c > cost[k]!) continue;
    const d = k % 4, node = (k - d) / 4, j = node % Y.length, i = (node - j) / Y.length;
    if (i === goalI && j === goalJ && d === goalD) { best = k; break; }
    for (let nd = 0; nd < 4; nd++) {
      if (dirs[nd]!.x === -dirs[d]!.x && dirs[nd]!.y === -dirs[d]!.y) continue;
      if (nd !== d) { const nk = key(i, j, nd), nc = c + bendPenalty; if (nc < cost[nk]!) { cost[nk] = nc; prev[nk] = k; push(nc, nk); } continue; }
      const ni = i + dirs[nd]!.x, nj = j + dirs[nd]!.y;
      if (ni < 0 || nj < 0 || ni >= X.length || nj >= Y.length) continue;
      const p = v(X[i]!, Y[j]!), q = v(X[ni]!, Y[nj]!);
      if (inside(q) || outside(q) || segBlocked(p, q)) continue;
      const nk = key(ni, nj, nd), nc = c + dist(p, q) + crossPenalty * crossCount(p, q);
      if (nc < cost[nk]!) { cost[nk] = nc; prev[nk] = k; push(nc, nk); }
    }
  }
  if (best < 0) return undefined;
  const nodes: Vec2[] = [];
  for (let k = best; k >= 0; k = prev[k]!) { const d = k % 4, node = (k - d) / 4, j = node % Y.length, i = (node - j) / Y.length; const p = v(X[i]!, Y[j]!); if (!nodes.length || dist(nodes[nodes.length - 1]!, p) > 1e-12) nodes.push(p); }
  nodes.reverse();
  const pts = [a, ...nodes, b];
  // Drop collinear interior points.
  const out: Vec2[] = [pts[0]!];
  for (let k = 1; k < pts.length - 1; k++) { const p0 = out[out.length - 1]!, p1 = pts[k]!, p2 = pts[k + 1]!; const cr = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x); if (Math.abs(cr) > 1e-12) out.push(p1); }
  out.push(pts[pts.length - 1]!);
  return out;
}
/** Do the closed segments p-q and r-s meet? Touching counts, so a crossing at a grid node is still penalised. */
function segCross(p: Vec2, q: Vec2, r: Vec2, s: Vec2): boolean {
  const c = (a: Vec2, b: Vec2, d: Vec2) => (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  const on = (a: Vec2, b: Vec2, d: Vec2) => Math.min(a.x, b.x) - 1e-12 <= d.x && d.x <= Math.max(a.x, b.x) + 1e-12 && Math.min(a.y, b.y) - 1e-12 <= d.y && d.y <= Math.max(a.y, b.y) + 1e-12;
  const d1 = c(p, q, r), d2 = c(p, q, s), d3 = c(r, s, p), d4 = c(r, s, q);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const z = 1e-12;
  return (Math.abs(d1) < z && on(p, q, r)) || (Math.abs(d2) < z && on(p, q, s)) || (Math.abs(d3) < z && on(r, s, p)) || (Math.abs(d4) < z && on(r, s, q));
}
addSample("connector", (id, c, r) => {
  const route = pickOf(r, ["straight", "orthogonal", "curved"] as const);
  return [
    { id, type: "connector", from: `${id}_a.right`, to: route === "straight" ? `${id}_b.left` : `${id}_b.top`, route, end: pickOf(r, ["arrow", "dot"] as const) },
    { id: `${id}_a`, type: "roundedBox", at: P(c.x - 1.1, c.y + 0.45), w: 0.9, h: 0.5, text: "A" },
    { id: `${id}_b`, type: "roundedBox", at: P(c.x + 1.1, route === "straight" ? c.y + 0.45 : c.y - 0.7), w: 0.9, h: 0.5, text: "B" },
  ];
});

// --- brace -----------------------------------------------------------------------------------

interface BraceProps { depth?: number; color: string; width: number; side: "left" | "right" }
definePart<BraceProps>({
  type: "brace", aliases: ["curlyBrace"], category: "general",
  description: "Curly brace spanning `from` to `to`; its tip points to the left of the direction of travel (side: right flips it).",
  options: { from: "point", to: "point", side: "left (default) | right of from->to", depth: "tip depth (world, default 12% of the span, at most 0.4)", color: "palette colour", width: "px (default 1.2)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }],
  propKeys: ["from", "to", "side", "depth", "width"],
  props: (s, ctx) => ({ depth: s.depth === undefined ? undefined : lengthProp(s, "depth", ctx, { positive: true }), color: colorProp(s, "color", "#444"), width: strokeWidthProp(s, "width", 1.2), side: enumProp(s, "side", ["left", "right"] as const, "left") }),
  anchors: ["start", "end", "mid", "tip"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), L = dist(a, b);
    if (L * ctx.view.scale < 16) fail("E_INVALID_VALUE", [i.id], `Brace "${i.id}" spans only ${(L * ctx.view.scale).toFixed(1)} px`, { measured: { spanPx: L * ctx.view.scale, minPx: 16 } });
    const u = unit(sub(b, a)), n = mul(perp(u), i.props.side === "left" ? 1 : -1);
    const d = i.props.depth ?? Math.min(0.12 * L, 0.4);
    const q = d / 2;
    // Two half-braces: quarter arc, straight run, quarter arc into the tip.
    const P2 = (x: number, y: number) => add(add(a, mul(u, x)), mul(n, y));
    const quarter = (cx: number, cy: number, from: number, to: number) => Array.from({ length: 9 }, (_, k) => { const t = from + (to - from) * k / 8; return P2(cx + q * Math.cos(t), cy + q * Math.sin(t)); });
    const pts = [
      ...quarter(q, 0, Math.PI, Math.PI / 2), ...quarter(L / 2 - q, d, -Math.PI / 2, 0),
      ...quarter(L / 2 + q, d, Math.PI, Math.PI * 1.5), ...quarter(L - q, 0, Math.PI / 2, 0),
    ];
    const tip = P2(L / 2, d);
    return { prims: [poly(pts, i.props.color, i.props.width)], anchors: { start: a, end: b, mid: lerp(a, b, 0.5), tip }, label: { at: tip, candidates: outwardCandidates(n) }, refs: { length: lengthQ(L, ctx) } };
  },
});
addSample("brace", (id, c) => [{ id, type: "brace", from: P(c.x + 1.2, c.y - 0.2), to: P(c.x - 1.2, c.y - 0.2) }]);

// --- dimension -------------------------------------------------------------------------------

interface DimProps { offset: number; text?: string; precision: number; unit?: string; color: string; textSize: number }
definePart<DimProps>({
  type: "dimension", aliases: ["dimensionLine"], category: "general",
  description: "Engineering dimension between two points: extension lines, a dimension line offset to the left of from->to (negative: right) with inward heads, and its value as text. The default text is the measured length in `unit` (default: the canvas world unit).",
  options: { from: "point", to: "point", offset: "world, signed (default 0.4)", text: "override the measured text", unit: "display unit, e.g. cm", precision: "significant decimals (default 2)", color: "palette colour (default dimension #444)", textSize: "11-13" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }],
  propKeys: ["from", "to", "offset", "text", "unit", "precision", "textSize"],
  labels: false,
  props: (s, ctx) => ({ offset: lengthProp(s, "offset", ctx, { default: 0.4 }), text: textProp(s, "text"), precision: numProp(s, "precision", ctx, { default: 2, min: 0, max: 6, integer: true }), unit: s.unit === undefined ? undefined : String(s.unit), color: colorProp(s, "color", "#444"), textSize: sizeProp(s, "textSize", 11) }),
  anchors: ["start", "end", "mid", "text"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), L = dist(a, b);
    const u = unit(sub(b, a)), n = perp(u), off = i.props.offset, sgn = Math.sign(off) || 1;
    const da = add(a, mul(n, off)), db = add(b, mul(n, off));
    const ext = px(ctx, 4), gapPx = px(ctx, 2);
    const col = i.props.color;
    const unitName = i.props.unit ?? (ctx.worldUnitSI === 1 ? "m" : undefined);
    const shown = i.props.text ?? formatLength(L * ctx.worldUnitSI, unitName, i.props.precision);
    const tp = textPx(shown, i.props.textSize);
    const lenPx = L * ctx.view.scale;
    if (lenPx < 2 * 7 + 4) fail("E_ARROW_TOO_SHORT", [i.id], `Dimension "${i.id}" is ${lenPx.toFixed(1)} px long; at least 18 px is needed for its heads`, { measured: { lengthPx: lenPx } });
    const prims: Prim[] = [];
    if (Math.abs(off) * ctx.view.scale > 3) {
      prims.push(line(add(a, mul(n, sgn * gapPx)), add(da, mul(n, sgn * ext)), col, 0.8));
      prims.push(line(add(b, mul(n, sgn * gapPx)), add(db, mul(n, sgn * ext)), col, 0.8));
    }
    prims.push(...arrowPath([lerp(da, db, 0.5), db], ctx, col, 1), ...arrowPath([lerp(da, db, 0.5), da], ctx, col, 1));
    // Text sits beside the middle of the dimension line, on the far side from the measured edge.
    const along = Math.abs(u.x) >= Math.abs(u.y);
    const halfAcross = along ? tp.h / 2 : tp.w / 2;
    const tc = add(lerp(da, db, 0.5), mul(n, sgn * px(ctx, halfAcross / Math.max(Math.abs(along ? n.y : n.x), 0.35) + 3)));
    const t = text(tc, shown, i.props.textSize, col);
    prims.push(t);
    return { prims, anchors: { start: da, end: db, mid: lerp(da, db, 0.5), text: tc }, refs: { length: lengthQ(L, ctx) } };
  },
});
/** Format a length in SI metres for a display unit. */
export function formatLength(meters: number, unitName: string | undefined, precision: number): string {
  const units: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, km: 1000, um: 1e-6 };
  if (!unitName) return trimNum(meters, precision);
  const f = units[unitName];
  return f ? `${trimNum(meters / f, precision)} ${unitName}` : `${trimNum(meters, precision)} m`;
}
export const trimNum = (x: number, precision: number) => String(Number(x.toFixed(precision)));
addSample("dimension", (id, c, r) => [{ id, type: "dimension", from: P(c.x - 1.2, c.y - 0.5), to: P(c.x + 1.2, c.y - 0.5), offset: between(r, 0.5, 0.7), unit: pickOf(r, ["m", "cm"]) }]);

// --- angleArc --------------------------------------------------------------------------------

interface AngleProps { r: number; color: string; width: number; arrow: boolean; text?: string; textSize: number; square: boolean; from?: number; to?: number }
definePart<AngleProps>({
  type: "angleArc", aliases: ["angleMark"], category: "general",
  description: "Angle mark at `vertex` from the ray toward `start` counter-clockwise to the ray toward `end` (or from/to angles). Optional arrowhead, a right-angle square, and text on the bisector.",
  options: { vertex: "point", start: "point on the first ray", end: "point on the second ray", fromAngle: "instead of start (deg)", toAngle: "instead of end (deg)", r: "radius (world, default 0.4)", arrow: "head at the end", square: "draw a right-angle square (90 deg only)", text: "e.g. \\theta", textSize: "11-13", color: "palette colour", width: "px (default 1)" },
  positioning: "points", pointProps: [{ name: "vertex" }, { name: "start", optional: true }, { name: "end", optional: true }], touchRefs: ["vertex", "start", "end"],
  propKeys: ["vertex", "start", "end", "fromAngle", "toAngle", "r", "arrow", "square", "text", "textSize", "width"],
  props: (s, ctx) => {
    if ((s.start === undefined) !== (s.end === undefined) || (s.start === undefined && (s.fromAngle === undefined || s.toAngle === undefined))) fail("E_SCHEMA", [s.id], `angleArc "${s.id}" needs "start" and "end" points, or "fromAngle" and "toAngle"`, { path: propPath(s, "start") });
    return { r: lengthProp(s, "r", ctx, { default: 0.4, positive: true }), color: colorProp(s, "color", "#444"), width: strokeWidthProp(s, "width", 1), arrow: boolProp(s, "arrow"), text: textProp(s, "text"), textSize: sizeProp(s), square: boolProp(s, "square"), from: s.fromAngle === undefined ? undefined : angleProp(s, "fromAngle", ctx), to: s.toAngle === undefined ? undefined : angleProp(s, "toAngle", ctx) };
  },
  anchors: ["vertex", "start", "end", "mid", "text", "at(angle)"],
  anchorArgs: { at: "angle" },
  hooks: ["curve"],
  geometry: (i, ctx) => {
    const c = ptsOf(i, "vertex"), p = i.props;
    let a0 = p.from ?? angleOf(sub(ptsOf(i, "start"), c)), a1 = p.to ?? angleOf(sub(ptsOf(i, "end"), c));
    while (a1 <= a0) a1 += 2 * Math.PI;
    while (a1 - a0 > 2 * Math.PI) a1 -= 2 * Math.PI;
    const sweep = a1 - a0, mid = (a0 + a1) / 2;
    const prims: Prim[] = [];
    if (p.square) {
      if (Math.abs(sweep - Math.PI / 2) > 1e-6) fail("E_INVALID_VALUE", [i.id], `"square" on "${i.id}" needs a 90 deg angle; it is ${(sweep / DEG).toFixed(3)} deg`, { measured: { degrees: sweep / DEG } });
      const s = p.r * 0.7;
      prims.push(poly([polar(c, s, a0), add(polar(c, s, a0), sub(polar(c, s, a1), c)), polar(c, s, a1)], p.color, p.width));
    } else if (p.arrow) prims.push(...arcArrowPrims(c, p.r, a0, a1, ctx, p.color, p.width, false));
    else prims.push(arc(c, p.r, a0, a1, p.color, p.width));
    let tAt = polar(c, p.r, mid);
    if (p.text) {
      const tp = textPx(p.text, p.textSize), dir = v(Math.cos(mid), Math.sin(mid));
      const reach = Math.abs(dir.x) * tp.w / 2 + Math.abs(dir.y) * tp.h / 2;
      tAt = polar(c, p.r + px(ctx, reach + 4), mid);
      prims.push(text(tAt, p.text, p.textSize, "#333"));
    }
    return { prims, curve: arcSamples(c, p.r, a0, a1), anchors: { vertex: c, center: c, start: polar(c, p.r, a0), end: polar(c, p.r, a1), mid: polar(c, p.r, mid), text: tAt }, argAnchors: { at: a => polar(c, p.r, a) }, label: { at: polar(c, p.r, mid), candidates: outwardCandidates(v(Math.cos(mid), Math.sin(mid))) }, refs: { angle: angleQ(sweep), r: lengthQ(p.r, ctx) } };
  },
});
addSample("angleArc", (id, c, r) => {
  const t = between(r, 25, 70);
  return [
    { id, type: "angleArc", vertex: `${id}_a.start`, start: `${id}_a.end`, end: `${id}_b.end`, r: 0.6, text: "θ", arrow: r() < 0.4 },
    { id: `${id}_a`, type: "segment", from: P(c.x - 1.2, c.y - 0.7), to: P(c.x + 1.3, c.y - 0.7) },
    { id: `${id}_b`, type: "segment", from: P(c.x - 1.2, c.y - 0.7), to: P(c.x - 1.2 + 1.9 * Math.cos(t * DEG), c.y - 0.7 + 1.9 * Math.sin(t * DEG)), mayTouch: [`${id}_a`] },
  ];
});

// --- leader (callout) ------------------------------------------------------------------------

interface LeaderProps { text: string; size: number; color: string; dx: number; dy: number; marker: "dot" | "arrow" | "none" }
definePart<LeaderProps>({
  type: "leader", aliases: ["callout"], category: "general",
  description: "Callout: a marker at `target`, a leader line to an elbow at target + (dx, dy), a short horizontal landing and the text. The text side follows the sign of dx.",
  options: { target: "point", text: "callout text", dx: "world offset to the elbow (default 0.8)", dy: "world offset (default 0.5)", marker: "dot | arrow (default) | none", size: "11-13", color: "palette colour (default text #333)" },
  positioning: "points", pointProps: [{ name: "target" }], touchRefs: ["target"],
  propKeys: ["target", "text", "dx", "dy", "marker", "size"],
  labels: false,
  props: (s, ctx) => ({ text: textProp(s, "text") ?? fail("E_SCHEMA", [s.id], `leader "${s.id}" needs "text"`, { path: propPath(s, "text") }), size: sizeProp(s, "size"), color: colorProp(s, "color", "#333"), dx: lengthProp(s, "dx", ctx, { default: 0.8 }), dy: lengthProp(s, "dy", ctx, { default: 0.5 }), marker: enumProp(s, "marker", ["dot", "arrow", "none"] as const, "arrow") }),
  anchors: ["target", "elbow", "text"],
  geometry: (i, ctx) => {
    const t = ptsOf(i, "target"), p = i.props, elbow = add(t, v(p.dx, p.dy)), sgn = Math.sign(p.dx) || 1;
    const land = add(elbow, v(sgn * px(ctx, 10), 0));
    const tp = textPx(p.text, p.size);
    const tc = add(land, v(sgn * px(ctx, tp.w / 2 + 3), 0));
    const prims: Prim[] = [];
    if (p.marker === "arrow") prims.push(...arrowPath([land, elbow, t], ctx, "#777", 0.8));
    else prims.push(poly([t, elbow, land], "#777", 0.8));
    if (p.marker === "dot") prims.push(dot(t, "#777"));
    prims.push(text(tc, p.text, p.size, p.color));
    if (dist(t, elbow) * ctx.view.scale < 12) fail("E_ARROW_TOO_SHORT", [i.id], `Leader "${i.id}" is ${(dist(t, elbow) * ctx.view.scale).toFixed(1)} px long; at least 12 px is needed`, { measured: { lengthPx: dist(t, elbow) * ctx.view.scale } });
    return { prims, anchors: { target: t, elbow, text: tc } };
  },
});
addSample("leader", (id, c, r) => [
  { id, type: "leader", target: `${id}_p`, text: pickOf(r, ["pivot", "weld", "max stress"]), dx: 0.7, dy: 0.5 },
  { id: `${id}_p`, type: "point", at: P(c.x - 0.9, c.y - 0.4) },
]);

// --- legend ----------------------------------------------------------------------------------

type LegendKind = "line" | "dashed" | "arrow" | "box" | "dot" | "circle";
interface LegendProps { entries: { text: string; kind: LegendKind; color: string; fill: string }[]; size: number; frame: boolean }
definePart<LegendProps>({
  type: "legend", aliases: ["key"], category: "general",
  description: "Legend box: one row per entry with a swatch (line, dashed, arrow, box, dot, circle) and text. Origin at its centre (attach topLeft etc. to place a corner).",
  options: { entries: "[{text, kind: line|dashed|arrow|box|dot|circle, color, fill}]", size: "11-13 (default 11)", frame: "draw the frame (default true)" },
  positioning: "placed",
  propKeys: ["entries", "size", "frame"],
  labels: false,
  props: s => {
    const raw = listProp<Record<string, unknown>>(s, "entries", { min: 1, max: 20 });
    const entries = raw.map((e, k) => {
      if (!e || typeof e !== "object" || typeof e.text !== "string" || e.text === "") fail("E_SCHEMA", [s.id], `entries[${k}] of "${s.id}" needs "text"`, { path: `${propPath(s, "entries")}[${k}]` });
      const fake = { ...s, kind: e.kind, color: e.color, fill: e.fill } as ElementSpec;
      return { text: formatLabelMarkup(e.text as string, [s.id]), kind: enumProp(fake, "kind", ["line", "dashed", "arrow", "box", "dot", "circle"] as const, "line"), color: colorProp(fake, "color", "#222"), fill: colorProp(fake, "fill", "#cfe4ff") };
    });
    return { entries, size: sizeProp(s, "size", 11), frame: boolProp(s, "frame", true) };
  },
  anchors: ["center", "top", "bottom", "left", "right", "topLeft", "topRight", "bottomLeft", "bottomRight", "entry(i)"],
  anchorArgs: { entry: "number" },
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const p = i.props, pad = 6, sw = 22, gap = 6;
    const ms = p.entries.map(e => textPx(e.text, p.size));
    const rowH = Math.max(14, ...ms.map(m => m.h)) + 3;
    const Wpx = pad * 2 + sw + gap + Math.max(...ms.map(m => m.w)), Hpx = pad * 2 + rowH * p.entries.length - 3;
    const W = px(ctx, Wpx), H = px(ctx, Hpx), c = i.origin;
    const L = c.x - W / 2, T = c.y + H / 2;
    const prims: Prim[] = [];
    if (p.frame) prims.push({ k: "rect", c, w: W, h: H, rxPx: 0, fill: "#fff", stroke: "#aaa" });
    const rows: Vec2[] = [];
    p.entries.forEach((e, k) => {
      const cy = T - px(ctx, pad + rowH * k + (rowH - 3) / 2);
      const s0 = v(L + px(ctx, pad), cy), s1 = v(L + px(ctx, pad + sw), cy), sm = lerp(s0, s1, 0.5);
      rows.push(sm);
      if (e.kind === "line" || e.kind === "dashed") prims.push(line(s0, s1, e.color, 1.6, e.kind === "dashed"));
      else if (e.kind === "arrow") prims.push(vector(s0, s1, e.color));
      else if (e.kind === "box") prims.push({ k: "rect", c: sm, w: px(ctx, 14), h: px(ctx, 10), rxPx: 0, fill: e.fill, stroke: e.color });
      else if (e.kind === "dot") prims.push(dot(sm, e.color));
      else prims.push(circle(sm, px(ctx, 4.5), "none", e.color));
      prims.push(text(v(L + px(ctx, pad + sw + gap + ms[k]!.w / 2), cy), e.text, p.size, "#333"));
    });
    const outline = [v(L, T - H), v(L + W, T - H), v(L + W, T), v(L, T)];
    return { prims, outline, anchors: boxAnchors(c, W, H), argAnchors: { entry: k => Number.isInteger(k) ? rows[k] : undefined } };
  },
});
addSample("legend", (id, c) => [{ id, type: "legend", at: P(c.x, c.y), entries: [{ text: "measured", kind: "dot", color: "ink" }, { text: "model", kind: "line", color: "rayAlt" }, { text: "force", kind: "arrow", color: "force" }] }]);

// --- table -----------------------------------------------------------------------------------

interface TableProps { rows: string[][]; size: number; header: boolean; padding: number; align: "left" | "center" }
definePart<TableProps>({
  type: "table", aliases: ["grid"], category: "general",
  description: "Table of text cells with ruled lines; a header row is separated by a heavier rule. Cell sizes follow the text. Origin at its centre.",
  options: { rows: "list of rows, each a list of strings or numbers", header: "first row is a header (default true)", size: "11-13 (default 11)", padding: "px (default 5)", align: "left | center" },
  positioning: "placed",
  propKeys: ["rows", "header", "size", "padding", "align"],
  labels: false,
  props: (s, ctx) => {
    const rows = listProp<unknown[]>(s, "rows", { min: 1, max: 40 });
    if (!rows.every(r => Array.isArray(r) && r.length === (rows[0] as unknown[]).length && r.length > 0)) fail("E_SCHEMA", [s.id], `Every row of "${s.id}" must be a list with the same number of cells`, { path: propPath(s, "rows") });
    return { rows: rows.map(r => r.map(cell => formatLabelMarkup(typeof cell === "number" ? String(cell) : typeof cell === "string" ? (cell === "" ? " " : cell) : fail("E_SCHEMA", [s.id], `Cells of "${s.id}" must be strings or numbers`, { path: propPath(s, "rows") }), [s.id]))), size: sizeProp(s, "size", 11), header: boolProp(s, "header", true), padding: numProp(s, "padding", ctx, { default: 5, min: 1, max: 30 }), align: enumProp(s, "align", ["left", "center"] as const, "center") };
  },
  anchors: ["center", "top", "bottom", "left", "right", "topLeft", "topRight", "bottomLeft", "bottomRight", "row(i)", "col(j)", "cell(k)"],
  anchorArgs: { row: "number", col: "number", cell: "number" },
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const p = i.props, nr = p.rows.length, nc = p.rows[0]!.length;
    const ms = p.rows.map(r => r.map(t => t.trim() === "" ? { w: 0, h: 0 } : textPx(t, p.size)));
    const colW = Array.from({ length: nc }, (_, j) => Math.max(...ms.map(r => r[j]!.w)) + 2 * p.padding);
    const rowH = Math.max(...ms.flat().map(m => m.h)) + 2 * p.padding;
    const Wpx = colW.reduce((a, b) => a + b, 0), Hpx = rowH * nr;
    const c = i.origin, L = c.x - px(ctx, Wpx / 2), T = c.y + px(ctx, Hpx / 2);
    const X = (xp: number) => L + px(ctx, xp), Y = (yp: number) => T - px(ctx, yp);
    const prims: Prim[] = [{ k: "rect", c, w: px(ctx, Wpx), h: px(ctx, Hpx), rxPx: 0, fill: "none", stroke: "#444" }];
    for (let r = 1; r < nr; r++) prims.push(line(v(X(0), Y(r * rowH)), v(X(Wpx), Y(r * rowH)), "#444", r === 1 && p.header ? 1.6 : 0.8));
    let acc = 0;
    const colX: number[] = [];
    for (let j = 0; j < nc; j++) { colX.push(acc); if (j > 0) prims.push(line(v(X(acc), Y(0)), v(X(acc), Y(Hpx)), "#444", 0.8)); acc += colW[j]!; }
    const centers: Vec2[] = [];
    p.rows.forEach((row, r) => row.forEach((t, j) => {
      const cx = p.align === "center" ? colX[j]! + colW[j]! / 2 : colX[j]! + p.padding + ms[r]![j]!.w / 2;
      const at = v(X(cx), Y(r * rowH + rowH / 2));
      centers.push(at);
      if (t.trim() !== "") prims.push(text(at, t, p.size, r === 0 && p.header ? "#222" : "#333"));
    }));
    const W = px(ctx, Wpx), H = px(ctx, Hpx);
    const outline = [v(L, T - H), v(L + W, T - H), v(L + W, T), v(L, T)];
    return { prims, outline, anchors: boxAnchors(c, W, H), argAnchors: { row: k => Number.isInteger(k) && k >= 0 && k < nr ? v(L, Y(k * rowH + rowH / 2)) : undefined, col: k => Number.isInteger(k) && k >= 0 && k < nc ? v(X(colX[k]! + colW[k]! / 2), T) : undefined, cell: k => Number.isInteger(k) ? centers[k] : undefined }, refs: { rows: { value: nr, dim: DIMLESS }, cols: { value: nc, dim: DIMLESS } } };
  },
});
addSample("table", (id, c, r) => [{ id, type: "table", at: P(c.x, c.y), rows: [["x", "y"], [0, 0], [1, pickOf(r, [1, 2, 3])], [2, 4]] }]);

export type { PartDefinition, PartInstance };
