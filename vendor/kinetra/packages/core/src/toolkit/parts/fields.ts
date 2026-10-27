/**
 * Fields and electromagnetism: point charges, out-of/into-page marks, bar
 * magnets, coils and solenoids, charged plates, field-arrow grids, field
 * lines and current arrows. Field vectors use the fields template's #225.
 */
import { fail } from "../errors.js";
import { DIMLESS, evalNumber, mapScope } from "../expr.js";
import { pointPolylineDist } from "../geometry.js";
import { getPart } from "../parts.js";
import {
  ABOVE_FIRST, AROUND, CLOSED, DEG, P, add, addSample, alongPolyline, angleOf, angleProp, arcSamples, between, boolProp, circle, colorProp, definePart, dist,
  enumProp, fittedText, frameOf, frameProps, fp, head, lengthProp, lengthQ, lerp, line, listOf, mul, numProp, perp, pickOf, polar, poly, polylineLen, propPath,
  ptsOf, px, rot, shape, sizeProp, strokeWidthProp, sub, text, textProp, unit, v, vector,
} from "./kit.js";
import type { Geo, PartContext, Prim, Vec2, ElementSpec } from "./kit.js";
import { outwardCandidates } from "./general.js";
import type { NumLike } from "../types.js";

const PLUS = "#c0392b", MINUS = "#2679a0", FIELD = "#225";

/** A + or - sign drawn with strokes, half-size `s` (world). */
export function signPrims(c: Vec2, s: number, sign: "+" | "-", color: string, w = 1.6): Prim[] {
  const out: Prim[] = [line(add(c, v(-s, 0)), add(c, v(s, 0)), color, w)];
  if (sign === "+") out.push(line(add(c, v(0, -s)), add(c, v(0, s)), color, w));
  return out;
}

// --- charge ------------------------------------------------------------------------------

interface ChargeProps { sign: "+" | "-"; r: number; color: string; filled: boolean }
definePart<ChargeProps>({
  type: "charge", aliases: ["pointCharge"], category: "fields",
  description: "Point charge: a circle with a + or − sign (positive in the force red, negative in rayAlt blue). Round, so field lines and tangency can use it.",
  options: { sign: "+ (default) | -", r: "radius (world, default 9 px)", filled: "tinted fill (default false: white)", color: "palette colour override" },
  positioning: "placed",
  propKeys: ["sign", "r", "filled"],
  props: (s, ctx) => {
    const sign = s.sign === undefined ? "+" : s.sign === "-" || s.sign === "−" ? "-" : s.sign === "+" ? "+" : fail("E_SCHEMA", [s.id], `"sign" of "${s.id}" must be "+" or "-"`, { path: propPath(s, "sign") });
    return { sign, r: s.r === undefined ? NaN : lengthProp(s, "r", ctx, { positive: true }), color: colorProp(s, "color", sign === "+" ? PLUS : MINUS), filled: boolProp(s, "filled") };
  },
  anchors: ["center", "top", "bottom", "left", "right", "rim(angle)"], anchorArgs: { rim: "angle" },
  hooks: ["radius", "outline"],
  geometry: (i, ctx) => {
    const c = i.origin, r = Number.isNaN(i.props.r) ? px(ctx, 9) : i.props.r;
    if (r * ctx.view.scale < 6) fail("E_INVALID_VALUE", [i.id], `Charge "${i.id}" is ${(r * ctx.view.scale).toFixed(1)} px in radius; at least 6 px is needed for its sign`, { measured: { radiusPx: r * ctx.view.scale } });
    const fill = i.props.filled ? (i.props.sign === "+" ? "#fff" : "#fff") : "#fff";
    const prims: Prim[] = [circle(c, r, fill, i.props.color), ...signPrims(c, r * 0.5, i.props.sign, i.props.color)];
    return { prims, radius: r, outline: arcSamples(c, r, 0, 2 * Math.PI).slice(0, -1), anchors: { center: c, top: polar(c, r, Math.PI / 2), bottom: polar(c, r, -Math.PI / 2), left: polar(c, r, Math.PI), right: polar(c, r, 0) }, argAnchors: { rim: a => polar(c, r, a) }, label: { at: c, candidates: AROUND }, refs: { r: lengthQ(r, ctx) } };
  },
});
addSample("charge", (id, c, r) => [{ id, type: "charge", at: P(c.x - 0.6, c.y), sign: "+", r: 0.3, label: "+q" }, { id: `${id}_b`, type: "charge", at: P(c.x + 0.7, c.y), sign: "-", r: 0.3 }]);

// --- out of / into the page ---------------------------------------------------------------------

interface PageProps { direction: "out" | "in"; r: number; color: string }
const pagePrims = (c: Vec2, r: number, dir: "out" | "in", color: string): Prim[] => {
  const out: Prim[] = [circle(c, r, "#fff", color)];
  if (dir === "out") out.push(circle(c, r * 0.28, color, color));
  else { const d = r * 0.62; out.push(line(add(c, v(-d, -d)), add(c, v(d, d)), color, 1.4), line(add(c, v(-d, d)), add(c, v(d, -d)), color, 1.4)); }
  return out;
};
definePart<PageProps>({
  type: "pageVector", aliases: ["dotCross", "outOfPage", "intoPage"], category: "fields",
  description: "A vector perpendicular to the page: a circle with a dot (out of the page) or a cross (into the page). outOfPage / intoPage set the default direction.",
  options: { direction: "out | in", r: "radius (world, default 7 px)", color: "palette colour (default #225)" },
  positioning: "placed",
  propKeys: ["direction", "r"],
  props: (s, ctx) => ({ direction: enumProp(s, "direction", ["out", "in"] as const, s.type === "intoPage" ? "in" : "out"), r: s.r === undefined ? NaN : lengthProp(s, "r", ctx, { positive: true }), color: colorProp(s, "color", FIELD) }),
  anchors: ["center", "rim(angle)"], anchorArgs: { rim: "angle" },
  hooks: ["radius", "outline"],
  geometry: (i, ctx) => {
    const c = i.origin, r = Number.isNaN(i.props.r) ? px(ctx, 7) : i.props.r;
    if (r * ctx.view.scale < 4) fail("E_INVALID_VALUE", [i.id], `"${i.id}" is too small to read (${(r * ctx.view.scale).toFixed(1)} px radius)`, { measured: { radiusPx: r * ctx.view.scale } });
    return { prims: pagePrims(c, r, i.props.direction, i.props.color), radius: r, outline: arcSamples(c, r, 0, 2 * Math.PI).slice(0, -1), anchors: { center: c }, argAnchors: { rim: a => polar(c, r, a) }, label: { at: c, candidates: AROUND } };
  },
});
addSample("pageVector", (id, c) => [{ id, type: "pageVector", at: P(c.x - 0.5, c.y), direction: "out", r: 0.2, label: "B" }, { id: `${id}_in`, type: "pageVector", at: P(c.x + 0.6, c.y), direction: "in", r: 0.2 }]);

// --- magnet -------------------------------------------------------------------------------------

interface MagnetProps { w: number; h: number; rotation: number; northColor: string; southColor: string; kind: "bar" | "horseshoe" }
definePart<MagnetProps>({
  type: "magnet", aliases: ["barMagnet"], category: "fields",
  description: "Bar magnet (N half in force red, S half in rayAlt blue, letters in their halves) or a horseshoe magnet; origin at the centre, north to +x before rotation.",
  options: { w: "length (default 1.6)", h: "thickness (default 0.45)", rotation: "degrees", kind: "bar | horseshoe", northColor: "palette colour", southColor: "palette colour" },
  positioning: "placed",
  propKeys: ["w", "h", "rotation", "kind", "northColor", "southColor"],
  props: (s, ctx) => ({ w: lengthProp(s, "w", ctx, { default: 1.6, positive: true }), h: lengthProp(s, "h", ctx, { default: 0.45, positive: true }), rotation: angleProp(s, "rotation", ctx, 0), kind: enumProp(s, "kind", ["bar", "horseshoe"] as const, "bar"), northColor: colorProp(s, "northColor", PLUS), southColor: colorProp(s, "southColor", MINUS) }),
  anchors: ["center", "north", "south", "northFace", "southFace", "top", "bottom"],
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const p = i.props, c = i.origin, f = (x: number, y: number) => add(c, rot(v(x, y), p.rotation));
    const fits: NonNullable<Geo["fits"]> = [];
    if (p.kind === "bar") {
      const W = p.w / 2, H = p.h / 2;
      const nq = [f(0, -H), f(W, -H), f(W, H), f(0, H)], sq = [f(-W, -H), f(0, -H), f(0, H), f(-W, H)];
      const prims: Prim[] = [shape(nq, p.northColor, "#222"), shape(sq, p.southColor, "#222"), fittedText(fits, f(W / 2, 0), "N", 12, "#222", nq), fittedText(fits, f(-W / 2, 0), "S", 12, "#222", sq)];
      return { prims, fits, outline: [f(-W, -H), f(W, -H), f(W, H), f(-W, H)], anchors: { center: c, north: f(W / 2, 0), south: f(-W / 2, 0), northFace: f(W, 0), southFace: f(-W, 0), top: f(0, H), bottom: f(0, -H) }, label: { at: c, candidates: ["above", "below", "right", "left"] } };
    }
    // Horseshoe: a U of thickness h opening toward +x; arm ends are the poles.
    const R = p.w / 2, t = p.h, ri = Math.max(R - t, R * 0.2);
    const armLen = R * 0.9;
    const outer = [...arcSamples(v(0, 0), R, Math.PI / 2, 1.5 * Math.PI)];
    const inner = [...arcSamples(v(0, 0), ri, 1.5 * Math.PI, Math.PI / 2)];
    const body = [v(armLen, R), ...outer, v(armLen, -R), v(armLen, -ri), ...inner, v(armLen, ri)].map(q => f(q.x, q.y));
    const northTip = [v(armLen, ri), v(armLen + t * 1.1, ri), v(armLen + t * 1.1, R), v(armLen, R)].map(q => f(q.x, q.y));
    const southTip = [v(armLen, -R), v(armLen + t * 1.1, -R), v(armLen + t * 1.1, -ri), v(armLen, -ri)].map(q => f(q.x, q.y));
    const prims: Prim[] = [shape(body, "#d6e1e6", "#222"), shape(northTip, p.northColor, "#222"), shape(southTip, p.southColor, "#222")];
    const nC = f(armLen + t * 0.55, (R + ri) / 2), sC = f(armLen + t * 0.55, -(R + ri) / 2);
    prims.push(fittedText(fits, nC, "N", 11, "#222", northTip), fittedText(fits, sC, "S", 11, "#222", southTip));
    return { prims, fits, outline: [...body], anchors: { center: c, north: nC, south: sC, northFace: f(armLen + t * 1.1, (R + ri) / 2), southFace: f(armLen + t * 1.1, -(R + ri) / 2), top: f(0, R), bottom: f(0, -R) }, label: { at: f(-R, 0), candidates: ["left", "above-left", "below-left"] } };
  },
});
addSample("magnet", (id, c, r) => pickOf(r, [0, 1]) ? [{ id, type: "magnet", at: P(c.x, c.y), w: 2, h: 0.55 }] : [{ id, type: "magnet", at: P(c.x - 0.3, c.y), kind: "horseshoe", w: 1.6, h: 0.4 }]);

// --- coil / solenoid -------------------------------------------------------------------------------

interface CoilProps { turns: number; radius: number; color: string; width: number; leads: boolean; core: boolean }
definePart<CoilProps>({
  type: "solenoid", aliases: ["coil"], category: "fields",
  description: "Solenoid seen from the side along the axis `from` -> `to`: each turn is an ellipse whose front half is solid and back half dashed in guide grey, with optional leads and an iron core.",
  options: { from: "axis start", to: "axis end", turns: "number of turns (default from length)", radius: "coil radius (world, default 0.35)", leads: "draw the two leads (default true)", core: "draw an iron core (default false)", color: "palette colour (default mechanism)", width: "px (default 1.4)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }],
  propKeys: ["from", "to", "turns", "radius", "leads", "core", "width"],
  props: (s, ctx) => ({ turns: s.turns === undefined ? 0 : numProp(s, "turns", ctx, { min: 1, max: 80, integer: true }), radius: lengthProp(s, "radius", ctx, { default: 0.35, positive: true }), color: colorProp(s, "color", "#526873"), width: strokeWidthProp(s, "width", 1.4), leads: boolProp(s, "leads", true), core: boolProp(s, "core") }),
  anchors: ["start", "end", "mid", "leadStart", "leadEnd", "top", "bottom"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), L = dist(a, b), u = unit(sub(b, a)), n = perp(u), R = i.props.radius;
    const turns = i.props.turns || Math.max(3, Math.round(L * ctx.view.scale / 14));
    const pitch = L / turns;
    if (pitch * ctx.view.scale < 6) fail("E_INVALID_VALUE", [i.id], `Solenoid "${i.id}" turn pitch is ${(pitch * ctx.view.scale).toFixed(1)} px; at least 6 px is needed`, { measured: { pitchPx: pitch * ctx.view.scale, turns } });
    const ex = Math.min(pitch * 0.45, R * 0.35);
    const Q = (s: number, t: number) => add(add(a, mul(u, s)), mul(n, t));
    const prims: Prim[] = [];
    if (i.props.core) prims.push(shape([Q(-px(ctx, 6), -R * 0.55), Q(L + px(ctx, 6), -R * 0.55), Q(L + px(ctx, 6), R * 0.55), Q(-px(ctx, 6), R * 0.55)], "#e8edef", "#888"));
    for (let k = 0; k < turns; k++) {
      const s0 = pitch * (k + 0.5);
      const ell = (t0: number, t1: number) => Array.from({ length: 13 }, (_, m) => { const t = t0 + (t1 - t0) * m / 12; return Q(s0 + ex * Math.cos(t), R * Math.sin(t)); });
      prims.push(poly(ell(Math.PI / 2, 1.5 * Math.PI), "#aaa", 1, false, true));
      prims.push(poly(ell(-Math.PI / 2, Math.PI / 2), i.props.color, i.props.width));
    }
    const anchors: Record<string, Vec2> = { start: a, end: b, mid: lerp(a, b, 0.5), top: Q(L / 2, R), bottom: Q(L / 2, -R) };
    if (i.props.leads) {
      const ls = Q(pitch * 0.5, -R - px(ctx, 14)), le = Q(L - pitch * 0.5, -R - px(ctx, 14));
      prims.push(line(Q(pitch * 0.5, -R), ls, i.props.color, i.props.width), line(Q(L - pitch * 0.5, -R), le, i.props.color, i.props.width));
      anchors.leadStart = ls; anchors.leadEnd = le;
    } else { anchors.leadStart = Q(pitch * 0.5, -R); anchors.leadEnd = Q(L - pitch * 0.5, -R); }
    return { prims, anchors, label: { at: Q(L / 2, R), candidates: ABOVE_FIRST }, refs: { turns: { value: turns, dim: DIMLESS }, length: lengthQ(L, ctx) } };
  },
});
addSample("solenoid", (id, c, r) => [{ id, type: "solenoid", from: P(c.x - 1.3, c.y + 0.1), to: P(c.x + 1.3, c.y + 0.1), radius: 0.45, turns: 8, core: r() < 0.5 }]);

// --- plates --------------------------------------------------------------------------------------

interface PlatesProps { gap: number; length: number; rotation: number; charges: boolean; field: number; color: string }
definePart<PlatesProps>({
  type: "plates", aliases: ["parallelPlates", "capacitorPlates"], category: "fields",
  description: "Parallel charged plates centred on the origin, `gap` apart (the + plate on top before rotation), with optional + / − marks and uniform field arrows from + to −.",
  options: { gap: "plate separation", length: "plate length", rotation: "degrees", charges: "draw + and − marks (default true)", field: "number of field arrows (default 0)", color: "plate colour (default ink)" },
  positioning: "placed",
  propKeys: ["gap", "length", "rotation", "charges", "field"],
  props: (s, ctx) => ({ gap: lengthProp(s, "gap", ctx, { positive: true }), length: lengthProp(s, "length", ctx, { positive: true }), rotation: angleProp(s, "rotation", ctx, 0), charges: boolProp(s, "charges", true), field: numProp(s, "field", ctx, { default: 0, min: 0, max: 40, integer: true }), color: colorProp(s, "color", "#222") }),
  anchors: ["center", "plus", "minus", "plusStart", "plusEnd", "minusStart", "minusEnd"],
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const p = i.props, c = i.origin, f = (x: number, y: number) => add(c, rot(v(x, y), p.rotation));
    const L = p.length / 2, G = p.gap / 2;
    const prims: Prim[] = [line(f(-L, G), f(L, G), p.color, 3), line(f(-L, -G), f(L, -G), p.color, 3)];
    if (p.charges) {
      const n = Math.max(2, Math.floor(p.length * ctx.view.scale / 22));
      const s = px(ctx, 3.5), off = px(ctx, 9);
      for (let k = 0; k < n; k++) {
        const x = -L + p.length * (k + 0.5) / n;
        prims.push(...signPrims(f(x, G + off), s, "+", PLUS, 1.4).map(q => rotPrim(q, f(x, G + off), p.rotation)));
        prims.push(...signPrims(f(x, -G - off), s, "-", MINUS, 1.4).map(q => rotPrim(q, f(x, -G - off), p.rotation)));
      }
    }
    if (p.field > 0) {
      if (p.gap * ctx.view.scale < 20) fail("E_ARROW_TOO_SHORT", [i.id], `Field arrows of "${i.id}" would be under 12 px; widen the gap`, { measured: { gapPx: p.gap * ctx.view.scale } });
      for (let k = 0; k < p.field; k++) { const x = -L + p.length * (k + 0.5) / p.field; prims.push(vector(f(x, G - px(ctx, 4)), f(x, -G + px(ctx, 4)), FIELD)); }
    }
    const ext = p.charges ? G + px(ctx, 14) : G + px(ctx, 2);
    return { prims, outline: [f(-L, -ext), f(L, -ext), f(L, ext), f(-L, ext)], anchors: { center: c, plus: f(0, G), minus: f(0, -G), plusStart: f(-L, G), plusEnd: f(L, G), minusStart: f(-L, -G), minusEnd: f(L, -G) }, label: { at: f(L, 0), candidates: ["right", "left", "above", "below"] }, refs: { gap: lengthQ(p.gap, ctx) } };
  },
});
/** Rotate a primitive about `c` (used for sign marks on rotated parts). */
function rotPrim(q: Prim, c: Vec2, a: number): Prim {
  if (a === 0 || q.k !== "line") return q;
  return { ...q, a: add(c, rot(sub(q.a, c), a)), b: add(c, rot(sub(q.b, c), a)) };
}
addSample("plates", (id, c) => [{ id, type: "plates", at: P(c.x, c.y), gap: 1.2, length: 2.4, field: 5 }]);

// --- field grid ------------------------------------------------------------------------------------

interface GridProps { nx: number; ny: number; ex?: NumLike; ey?: NumLike; angle: number; kind: "vector" | "out" | "in"; color: string; scaleByMagnitude: boolean; spacing: number }
definePart<GridProps>({
  type: "fieldGrid", aliases: ["vectorField", "fieldArrows"], category: "fields",
  description: "A grid of field arrows over the rectangle from `from` (one corner) to `to` (the opposite corner). Uniform (angle), or a field Ex(x, y), Ey(x, y) in world coordinates; arrows are scaled to the grid cell (longest = 70% of a cell) unless scaleByMagnitude is false. kind out/in draws dots or crosses instead.",
  options: { from: "corner", to: "opposite corner", nx: "columns (default 5)", ny: "rows (default 4)", angle: "uniform direction (default 0)", ex: "expression in x, y", ey: "expression in x, y", kind: "vector | out | in", scaleByMagnitude: "lengths follow |E| (default true)", color: "palette colour (default #225)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }],
  propKeys: ["from", "to", "nx", "ny", "angle", "ex", "ey", "kind", "scaleByMagnitude"],
  props: (s, ctx) => {
    if ((s.ex === undefined) !== (s.ey === undefined)) fail("E_SCHEMA", [s.id], `fieldGrid "${s.id}" needs both "ex" and "ey", or neither`, { path: propPath(s, "ex") });
    return { nx: numProp(s, "nx", ctx, { default: 5, min: 1, max: 40, integer: true }), ny: numProp(s, "ny", ctx, { default: 4, min: 1, max: 40, integer: true }), ex: s.ex as NumLike | undefined, ey: s.ey as NumLike | undefined, angle: angleProp(s, "angle", ctx, 0), kind: enumProp(s, "kind", ["vector", "out", "in"] as const, "vector"), color: colorProp(s, "color", FIELD), scaleByMagnitude: boolProp(s, "scaleByMagnitude", true), spacing: 0 };
  },
  anchors: ["center", "cell(k)"], anchorArgs: { cell: "number" },
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), p = i.props;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const cw = (x1 - x0) / p.nx, ch = (y1 - y0) / p.ny, cell = Math.min(cw, ch);
    const centers: Vec2[] = [];
    for (let j = 0; j < p.ny; j++) for (let k = 0; k < p.nx; k++) centers.push(v(x0 + cw * (k + 0.5), y0 + ch * (j + 0.5)));
    const prims: Prim[] = [];
    if (p.kind !== "vector") {
      const r = Math.min(px(ctx, 7), cell * 0.3);
      if (r * ctx.view.scale < 4) fail("E_INVALID_VALUE", [i.id], `Cells of "${i.id}" are too small for dot/cross marks`, { measured: { cellPx: cell * ctx.view.scale } });
      for (const q of centers) prims.push(...pagePrims(q, r, p.kind, p.color));
      return { prims, anchors: { center: v((x0 + x1) / 2, (y0 + y1) / 2) }, argAnchors: { cell: k => Number.isInteger(k) ? centers[k] : undefined }, label: { at: v(x1, y1), candidates: ["above-right", "right", "above"] } };
    }
    const field = (q: Vec2): Vec2 => {
      if (p.ex === undefined) return v(Math.cos(p.angle), Math.sin(p.angle));
      const scope = mapScope(new Map([["x", { value: q.x, dim: DIMLESS }], ["y", { value: q.y, dim: DIMLESS }]]), ctx.scope);
      return v(evalNumber(p.ex, { ...ctx, scope }, propPath(i.spec, "ex"), [i.id]), evalNumber(p.ey!, { ...ctx, scope }, propPath(i.spec, "ey"), [i.id]));
    };
    const vals = centers.map(field), mags = vals.map(q => Math.hypot(q.x, q.y)), max = Math.max(...mags);
    if (!(max > 0) || !Number.isFinite(max)) fail("E_NON_FINITE", [i.id], `The field of "${i.id}" is zero or not finite on every grid point`, { measured: { max } });
    const minPx = 12;
    centers.forEach((q, k) => {
      const m = mags[k]!;
      if (!Number.isFinite(m)) fail("E_NON_FINITE", [i.id], `The field of "${i.id}" is not finite at (${q.x.toFixed(3)}, ${q.y.toFixed(3)})`, { measured: { at: q } });
      let l = cell * 0.7 * (p.scaleByMagnitude ? m / max : 1);
      if (l * ctx.view.scale < minPx) return; // too weak to draw an arrow
      const d = unit(vals[k]!), h = mul(d, l / 2);
      prims.push(vector(sub(q, h), add(q, h), p.color));
      void l;
    });
    if (!prims.length) fail("E_ARROW_TOO_SHORT", [i.id], `Every arrow of "${i.id}" is shorter than 12 px`, { measured: { cellPx: cell * ctx.view.scale } });
    return { prims, anchors: { center: v((x0 + x1) / 2, (y0 + y1) / 2) }, argAnchors: { cell: k => Number.isInteger(k) ? centers[k] : undefined }, label: { at: v(x1, y1), candidates: ["above-right", "right", "above", "below-right"] } };
  },
});
addSample("fieldGrid", (id, c, r) => pickOf(r, [0, 1, 2]) === 0
  ? [{ id, type: "fieldGrid", from: P(c.x - 1.5, c.y - 1), to: P(c.x + 1.5, c.y + 1), nx: 5, ny: 3, kind: pickOf(r, ["out", "in"] as const) }]
  : [{ id, type: "fieldGrid", from: P(c.x - 1.5, c.y - 1), to: P(c.x + 1.5, c.y + 1), nx: 6, ny: 4, ex: "1", ey: `0.25*(x - ${c.x})` }]);

// --- field line ------------------------------------------------------------------------------------

interface FieldLineProps { arrows: number[]; color: string; width: number; dashed: boolean }
definePart<FieldLineProps>({
  type: "fieldLine", aliases: ["streamline"], category: "fields",
  description: "Field or flow line through `points` (smoothed with Catmull-Rom), with arrowheads at the fractions in `arrows` (default [0.5]). It may touch the parts its end points name.",
  options: { points: "list of points (at least 2)", arrows: "head positions along the line, fractions in (0, 1]", color: "palette colour (default #225)", width: "px (default 1.2)", dashed: "boolean" },
  positioning: "points", pointProps: [{ name: "points", list: true }], touchRefs: ["points"],
  propKeys: ["points", "arrows", "width", "dashed"],
  props: s => {
    const arrows = s.arrows === undefined ? [0.5] : Array.isArray(s.arrows) && s.arrows.every(t => typeof t === "number" && t > 0 && t <= 1) ? s.arrows as number[] : fail("E_SCHEMA", [s.id], `"arrows" of "${s.id}" must be a list of fractions in (0, 1]`, { path: propPath(s, "arrows") });
    return { arrows, color: colorProp(s, "color", FIELD), width: strokeWidthProp(s, "width", 1.2), dashed: boolProp(s, "dashed") };
  },
  anchors: ["start", "end", "mid", "at(t)"], anchorArgs: { at: "number" },
  hooks: ["curve"],
  geometry: (i, ctx) => {
    const ctrl = listOf(i, "points"), pts = catmull(ctrl, 8);
    const prims: Prim[] = [poly(pts, i.props.color, i.props.width, false, i.props.dashed)];
    for (const t of i.props.arrows) { const q = alongPolyline(pts, t); const tip = add(q.p, mul(q.dir, px(ctx, 3))); prims.push(head(tip, angleOf(q.dir), i.props.color)); }
    const mid = alongPolyline(pts, 0.5);
    return { prims, curve: pts, anchors: { start: pts[0]!, end: pts[pts.length - 1]!, mid: mid.p }, argAnchors: { at: t => t >= 0 && t <= 1 ? alongPolyline(pts, t).p : undefined }, label: { at: mid.p, candidates: Math.abs(mid.dir.x) > Math.abs(mid.dir.y) ? ABOVE_FIRST : ["right", "left", "above", "below"] }, refs: { length: lengthQ(polylineLen(pts), ctx) } };
  },
});
/** Centripetal-free uniform Catmull-Rom through the control points. */
export function catmull(ctrl: Vec2[], per: number): Vec2[] {
  if (ctrl.length < 3) return ctrl;
  const out: Vec2[] = [ctrl[0]!];
  for (let k = 0; k < ctrl.length - 1; k++) {
    const p0 = ctrl[Math.max(0, k - 1)]!, p1 = ctrl[k]!, p2 = ctrl[k + 1]!, p3 = ctrl[Math.min(ctrl.length - 1, k + 2)]!;
    for (let m = 1; m <= per; m++) {
      const t = m / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c2: number, d: number) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      out.push(v(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y)));
    }
  }
  return out;
}
addSample("fieldLine", (id, c) => [
  { id, type: "fieldLine", points: [`${id}_q.rim(30 deg)`, P(c.x, c.y + 0.8), `${id}_m.rim(150 deg)`], arrows: [0.5] },
  { id: `${id}_q`, type: "charge", at: P(c.x - 1.2, c.y - 0.3), sign: "+", r: 0.25 },
  { id: `${id}_m`, type: "charge", at: P(c.x + 1.2, c.y - 0.3), sign: "-", r: 0.25 },
]);

// --- current arrow ---------------------------------------------------------------------------------

interface CurrentProps { t: number; style: "inline" | "beside"; side: 1 | -1; color: string; lengthPx: number }
definePart<CurrentProps>({
  type: "currentArrow", aliases: ["current"], category: "fields",
  description: "Current direction on a conductor from `from` to `to`: an arrowhead on the wire at fraction `t` (inline), or a short arrow beside it (beside). Label it I. It may touch the wire it marks (an inline head may touch any wire, segment or connector it sits on, with no mayTouch).",
  options: { from: "point", to: "point", t: "position (default 0.5)", style: "inline (default) | beside", side: "left | right for beside", length: "beside arrow length px (default 26)", color: "palette colour (default force)" },
  positioning: "points", pointProps: [{ name: "from" }, { name: "to" }], touchRefs: ["from", "to"],
  propKeys: ["from", "to", "t", "style", "side", "length"],
  props: (s, ctx) => ({ t: numProp(s, "t", ctx, { default: 0.5, min: 0, max: 1 }), style: enumProp(s, "style", ["inline", "beside"] as const, "inline"), side: enumProp(s, "side", ["left", "right"] as const, "left") === "left" ? 1 : -1, color: colorProp(s, "color", "#c0392b"), lengthPx: numProp(s, "length", ctx, { default: 26, min: 14, max: 200 }) }),
  contactWith: (i, o, ctx) => {
    // An inline head sits on its conductor: allow the line it lies on (within 0.5 px).
    if (i.props.style !== "inline") return undefined;
    const def = getPart(o.type), line = def?.curve?.(o, ctx) ?? (def?.segment ? [...def.segment(o)] : undefined);
    if (!line || line.length < 2) return undefined;
    const at = lerp(ptsOf(i, "from"), ptsOf(i, "to"), i.props.t);
    return pointPolylineDist(at, line) * ctx.view.scale <= 0.5 ? "current arrow on its conductor" : undefined;
  },
  anchors: ["at", "tail", "tip"],
  geometry: (i, ctx) => {
    const a = ptsOf(i, "from"), b = ptsOf(i, "to"), u = unit(sub(b, a)), n = mul(perp(u), i.props.side), at = lerp(a, b, i.props.t);
    if (i.props.style === "inline") {
      const tip = add(at, mul(u, px(ctx, 3.5)));
      return { prims: [head(tip, angleOf(u), i.props.color)], anchors: { at, tip, tail: at }, label: { at, candidates: outwardCandidates(n) } };
    }
    const o = add(at, mul(n, px(ctx, 9))), h = mul(u, px(ctx, i.props.lengthPx / 2));
    return { prims: [vector(sub(o, h), add(o, h), i.props.color)], anchors: { at: o, tail: sub(o, h), tip: add(o, h) }, label: { at: o, candidates: outwardCandidates(n) } };
  },
});
addSample("currentArrow", (id, c, r) => [
  { id, type: "currentArrow", from: `${id}_w.start`, to: `${id}_w.end`, style: pickOf(r, ["inline", "beside"] as const), label: "I" },
  { id: `${id}_w`, type: "segment", from: P(c.x - 1.4, c.y), to: P(c.x + 1.4, c.y), width: 1.2 },
]);

export type { ElementSpec, PartContext };
