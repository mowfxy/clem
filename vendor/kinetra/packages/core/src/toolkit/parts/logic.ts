/**
 * Logic and controls: logic gates, flip-flops, summing junctions, take-off
 * points and finite-state-machine states, transitions and self-loops.
 * Block-diagram blocks are `roundedBox` (alias tfBlock) and signal arrows
 * are `connector` (alias signal).
 *
 * The default IEC gate wraps diagram/logic_schematic.ts: the same 56-unit
 * body, height max(44, 16(n+1)), input pins 10 units out at (k+1)h/(n+1),
 * output pin 12 units out, 3-unit inversion bubble, #333 strokes and the
 * &, ≥1, =1, 1 marks at 13 px. One unit is w/56 world units.
 */
import { fail } from "../errors.js";
import { DIMLESS } from "../expr.js";
import {
  ABOVE_FIRST, AROUND, DEG, P, add, addSample, angleOf, arc, arcSamples, between, boolProp, circle, colorProp, definePart, dist, dot, enumProp, fittedText,
  head, idProp, lengthProp, lengthQ, lerp, line, mul, numProp, perp, pickOf, polar, poly, propPath, px, rot, shape, sizeProp, strokeWidthProp, sub, text,
  textProp, unit, v, vector, angleProp,
} from "./kit.js";
import type { Geo, PartContext, PartInstance, Prim, Vec2 } from "./kit.js";
import { arcArrowPrims, bendArc, outwardCandidates } from "./general.js";
import { signPrims } from "./fields.js";

const STROKE = "#333";
export type GateKind = "AND" | "OR" | "NOT" | "NAND" | "NOR" | "XOR" | "XNOR" | "BUF";
const KINDS: GateKind[] = ["AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR", "BUF"];
const IEC_MARK: Record<GateKind, string> = { AND: "&", NAND: "&", OR: "≥1", NOR: "≥1", XOR: "=1", XNOR: "=1", NOT: "1", BUF: "1" };
const inverted = (k: GateKind) => ["NAND", "NOR", "NOT", "XNOR"].includes(k);

/** Gate body height in template units (logic_schematic.ts: max(44, (n + 1) * 16)). */
export const gateHeightUnits = (inputs: number) => Math.max(44, (inputs + 1) * 16);
/** Terminal offsets in template units relative to the gate's left-centre (logic_schematic.ts logicTerminals). */
export function gateTerminalsUnits(inputs: number): { inputs: Vec2[]; output: Vec2 } {
  const h = gateHeightUnits(inputs);
  return { inputs: Array.from({ length: inputs }, (_, k) => v(-10, -h / 2 + (k + 1) * h / (inputs + 1))), output: v(56 + 12, 0) };
}

interface GateProps { kind: GateKind; inputs: number; w: number; rotation: number; style: "iec" | "ansi"; text?: string }
definePart<GateProps>({
  type: "logicGate", aliases: ["gate"], category: "logic",
  description: "Logic gate (AND, OR, NOT, NAND, NOR, XOR, XNOR, BUF). style iec (default) matches Kinetra's logic schematic; ansi draws the distinctive shapes. Origin at the body centre; pins in(k) top to bottom (also in0..in3) and out.",
  options: { kind: "AND | OR | NOT | NAND | NOR | XOR | XNOR | BUF", inputs: "1-8 (default 2; NOT/BUF 1)", w: "body width (world, default 1.12)", rotation: "degrees", style: "iec | ansi", text: "replace the IEC mark (e.g. a name)" },
  positioning: "placed",
  propKeys: ["kind", "inputs", "w", "rotation", "style", "text"],
  props: (s, ctx) => {
    const kind = enumProp(s, "kind", KINDS, "AND");
    const single = kind === "NOT" || kind === "BUF";
    const inputs = numProp(s, "inputs", ctx, { default: single ? 1 : 2, min: 1, max: 8, integer: true });
    if (single && inputs !== 1) fail("E_INVALID_VALUE", [s.id], `${kind} gate "${s.id}" has exactly one input`, { path: propPath(s, "inputs"), measured: { inputs } });
    if (!single && inputs < 2) fail("E_INVALID_VALUE", [s.id], `${kind} gate "${s.id}" needs at least two inputs`, { path: propPath(s, "inputs"), measured: { inputs } });
    return { kind, inputs, w: lengthProp(s, "w", ctx, { default: 1.12, positive: true }), rotation: angleProp(s, "rotation", ctx, 0), style: enumProp(s, "style", ["iec", "ansi"] as const, "iec"), text: textProp(s, "text") };
  },
  anchors: ["center", "out", "in(k)", "in0", "in1", "in2", "in3", "top", "bottom"], anchorArgs: { in: "number" },
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const p = i.props, u = p.w / 56, H = gateHeightUnits(p.inputs);
    // Template frame: x from the body's left edge, y from the centre (units), +y up.
    const Q = (x: number, y: number) => add(i.origin, rot(v((x - 28) * u, y * u), p.rotation));
    const term = gateTerminalsUnits(p.inputs);
    const inv = inverted(p.kind);
    const fits: NonNullable<Geo["fits"]> = [];
    const prims: Prim[] = [];
    // Inputs top to bottom: the template counts k from the top of the body (view y down).
    const ins = term.inputs.map(q => v(q.x, -q.y));
    let outline: Vec2[];
    let bodyRight = 56;
    if (p.style === "iec") {
      outline = [Q(0, -H / 2), Q(56, -H / 2), Q(56, H / 2), Q(0, H / 2)];
      prims.push(shape(outline, "#fff", "none"), poly(outline, STROKE, 1.4, true));
      prims.push(fittedText(fits, Q(28, 0), p.text ?? IEC_MARK[p.kind], 13, "#222", outline));
      for (const q of ins) prims.push(line(Q(q.x, q.y), Q(0, q.y), STROKE, 1.2));
    } else {
      const body = ansiBody(p.kind, H);
      outline = body.outline.map(q => Q(q.x, q.y));
      prims.push(shape(outline, "#fff", "none"), poly(outline, STROKE, 1.4, true));
      if (body.extra) prims.push(poly(body.extra.map(q => Q(q.x, q.y)), STROKE, 1.4));
      for (const q of ins) prims.push(line(Q(q.x, q.y), Q(body.backX(q.y), q.y), STROKE, 1.2));
      bodyRight = body.right;
      if (p.text) prims.push(fittedText(fits, Q(body.right * 0.42, 0), p.text, 12, "#222", outline));
    }
    if (inv) prims.push(circle(Q(bodyRight + 3, 0), 3 * u, "#fff", STROKE));
    prims.push(line(Q(bodyRight + (inv ? 6 : 0), 0), Q(term.output.x, 0), STROKE, 1.2));
    const anchors: Record<string, Vec2> = { center: Q(28, 0), out: Q(term.output.x, 0), top: Q(28, H / 2), bottom: Q(28, -H / 2) };
    ins.forEach((q, k) => { anchors[`in${k}`] = Q(q.x, q.y); });
    return { prims, fits, outline, anchors, argAnchors: { in: k => Number.isInteger(k) ? anchors[`in${k}`] : undefined }, label: { at: Q(28, H / 2), candidates: ABOVE_FIRST }, refs: { inputs: { value: p.inputs, dim: DIMLESS } } };
  },
});

/** ANSI distinctive-shape outlines in template units (x from the back, y up). */
function ansiBody(kind: GateKind, H: number): { outline: Vec2[]; extra?: Vec2[]; backX: (y: number) => number; right: number } {
  const h = H / 2;
  if (kind === "NOT" || kind === "BUF") return { outline: [v(0, h * 0.8), v(0, -h * 0.8), v(48, 0)], backX: () => 0, right: 48 };
  if (kind === "AND" || kind === "NAND") {
    const pts = [v(0, h), v(0, -h), v(56 - h, -h), ...arcSamples(v(56 - h, 0), h, -Math.PI / 2, Math.PI / 2).slice(1), v(0, h)];
    return { outline: pts.slice(0, -1), backX: () => 0, right: 56 };
  }
  // OR family: concave back, two arcs meeting at the tip.
  const back = (y: number) => 10 * (1 - (y / h) ** 2);
  const N = 16;
  const top = Array.from({ length: N + 1 }, (_, k) => { const t = k / N; return v(back(h) + (56 - back(h)) * t, h * (1 - t * t)); });
  const outline = [...top, ...[...top].reverse().slice(1).map(q => v(q.x, -q.y)).slice(0, -1), ...Array.from({ length: N + 1 }, (_, k) => { const y = -h + 2 * h * k / N; return v(back(y), y); })];
  const xor = kind === "XOR" || kind === "XNOR";
  return { outline, extra: xor ? Array.from({ length: N + 1 }, (_, k) => { const y = -h + 2 * h * k / N; return v(back(y) - 7, y); }) : undefined, backX: y => back(y) - (xor ? 7 : 0), right: 56 };
}
addSample("logicGate", (id, c, r) => {
  // The main gate uses the default IEC style; the helper shows the ANSI shapes.
  const kind = pickOf(r, KINDS), other = pickOf(r, KINDS.filter(k => k !== "NOT" && k !== "BUF"));
  return [{ id, type: "logicGate", at: P(c.x - 0.5, c.y + 0.25), kind, inputs: kind === "NOT" || kind === "BUF" ? 1 : pickOf(r, [2, 3]), w: 1.1 }, { id: `${id}_b`, type: "logicGate", at: P(c.x + 1.0, c.y - 0.9), kind: other, style: "ansi", w: 0.8 }];
});

// --- flip-flop -------------------------------------------------------------------------------------

type FFKind = "D" | "JK" | "T" | "SR";
interface FFProps { kind: FFKind; w: number; h: number; clock: boolean; size: number }
const FF_INPUTS: Record<FFKind, string[]> = { D: ["D"], JK: ["J", "K"], T: ["T"], SR: ["S", "R"] };
definePart<FFProps>({
  type: "flipFlop", aliases: ["latch", "ff"], category: "logic",
  description: "Flip-flop box (D, JK, T, SR) with its input names inside, a clock triangle (unless clock: false for a latch), and outputs Q and Q̄. Origin at the centre. Pins: d / j / k / t / s / r, clk, q, qbar.",
  options: { kind: "D | JK | T | SR", w: "width (default 1.2)", h: "height (default 1.6)", clock: "edge-triggered clock input (default true)", size: "text size 11-13 (default 11)" },
  positioning: "placed",
  propKeys: ["kind", "w", "h", "clock", "size"],
  props: (s, ctx) => ({ kind: enumProp(s, "kind", ["D", "JK", "T", "SR"] as const, "D"), w: lengthProp(s, "w", ctx, { default: 1.2, positive: true }), h: lengthProp(s, "h", ctx, { default: 1.6, positive: true }), clock: boolProp(s, "clock", true), size: sizeProp(s, "size", 11) }),
  anchors: ["center", "d", "j", "k", "t", "s", "r", "clk", "q", "qbar", "top", "bottom"],
  hooks: ["outline"],
  geometry: (i, ctx) => {
    const p = i.props, c = i.origin, W = p.w / 2, H = p.h / 2, lead = Math.max(px(ctx, 12), p.w * 0.18);
    const outline = [add(c, v(-W, -H)), add(c, v(W, -H)), add(c, v(W, H)), add(c, v(-W, H))];
    const prims: Prim[] = [shape(outline, "#fff", "none"), poly(outline, STROKE, 1.4, true)];
    const anchors: Record<string, Vec2> = { center: c, top: add(c, v(0, H)), bottom: add(c, v(0, -H)) };
    const ins = FF_INPUTS[p.kind];
    const rows = p.clock ? [...ins.slice(0, 1), "clk", ...ins.slice(1)] : ins;
    const yAt = (k: number, n: number) => H - p.h * (k + 1) / (n + 1);
    const tx = px(ctx, 4);
    rows.forEach((name, k) => {
      const y = yAt(k, rows.length), pin = add(c, v(-W - lead, y));
      prims.push(line(pin, add(c, v(-W, y)), STROKE, 1.2));
      anchors[name.toLowerCase()] = pin;
      if (name === "clk") { const s = Math.min(px(ctx, 6), p.h * 0.08); prims.push(poly([add(c, v(-W, y + s)), add(c, v(-W + s * 1.3, y)), add(c, v(-W, y - s))], STROKE, 1.2)); }
      else prims.push(text(add(c, v(-W + tx, y)), name, p.size, "#222", "start"));
    });
    for (const [k, name, key] of [[0, "Q", "q"], [1, "Q̄", "qbar"]] as const) {
      const y = yAt(k, 2), pin = add(c, v(W + lead, y));
      prims.push(line(add(c, v(W, y)), pin, STROKE, 1.2), text(add(c, v(W - tx, y)), name, p.size, "#222", "end"));
      anchors[key] = pin;
    }
    return { prims, outline, anchors, label: { at: add(c, v(0, H)), candidates: ABOVE_FIRST } };
  },
});
addSample("flipFlop", (id, c, r) => [{ id, type: "flipFlop", at: P(c.x, c.y), kind: pickOf(r, ["D", "JK", "T", "SR"] as const), clock: r() < 0.8, w: 1.3, h: 1.7 }]);

// --- summing junction -------------------------------------------------------------------------------

type Port = "left" | "right" | "top" | "bottom";
interface SumProps { r: number; signs: Partial<Record<Port, "+" | "-">>; style: "cross" | "sigma" | "plain" }
definePart<SumProps>({
  type: "summingJunction", aliases: ["sum", "summer"], category: "logic",
  description: "Block-diagram summing junction: a circle (with an X, a Σ, or plain) and a sign beside each signed input port. Ports: left, right, top, bottom (on the rim).",
  options: { r: "radius (world, default 0.22)", signs: "{left: \"+\", bottom: \"-\", ...}", style: "cross (default) | sigma | plain" },
  positioning: "placed",
  propKeys: ["r", "signs", "style"],
  props: (s, ctx) => {
    const raw = s.signs ?? { left: "+", bottom: "-" };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("E_SCHEMA", [s.id], `"signs" of "${s.id}" must be an object such as {"left": "+", "bottom": "-"}`, { path: propPath(s, "signs") });
    const signs: SumProps["signs"] = {};
    for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
      if (!["left", "right", "top", "bottom"].includes(k)) fail("E_SCHEMA", [s.id], `signs.${k} of "${s.id}" is not a port (left, right, top, bottom)`, { path: `${propPath(s, "signs")}.${k}` });
      const sv = val === "−" ? "-" : val;
      if (sv !== "+" && sv !== "-") fail("E_SCHEMA", [s.id], `signs.${k} of "${s.id}" must be "+" or "-"`, { path: `${propPath(s, "signs")}.${k}` });
      signs[k as Port] = sv;
    }
    return { r: lengthProp(s, "r", ctx, { default: 0.22, positive: true }), signs, style: enumProp(s, "style", ["cross", "sigma", "plain"] as const, "cross") };
  },
  anchors: ["center", "left", "right", "top", "bottom", "rim(angle)"], anchorArgs: { rim: "angle" },
  hooks: ["radius", "outline"],
  geometry: (i, ctx) => {
    const c = i.origin, r = i.props.r, fits: NonNullable<Geo["fits"]> = [];
    const outline = arcSamples(c, r, 0, 2 * Math.PI).slice(0, -1);
    const prims: Prim[] = [circle(c, r, "#fff", "#222")];
    if (i.props.style === "cross") { const d = r * Math.SQRT1_2; prims.push(line(add(c, v(-d, -d)), add(c, v(d, d)), "#222", 1.2), line(add(c, v(-d, d)), add(c, v(d, -d)), "#222", 1.2)); }
    if (i.props.style === "sigma") prims.push(fittedText(fits, c, "Σ", 12, "#222", outline));
    const dirs: Record<Port, number> = { right: 0, top: Math.PI / 2, left: Math.PI, bottom: -Math.PI / 2 };
    const sz = px(ctx, 3.2);
    for (const [port, sign] of Object.entries(i.props.signs) as [Port, "+" | "-"][]) {
      // The sign sits outside the rim, 40 degrees anticlockwise of its port.
      const at = polar(c, r + sz + px(ctx, 4), dirs[port] + 40 * DEG);
      prims.push(...signPrims(at, sz, sign, "#222", 1.2));
    }
    return { prims, fits, radius: r, outline, anchors: { center: c, left: polar(c, r, Math.PI), right: polar(c, r, 0), top: polar(c, r, Math.PI / 2), bottom: polar(c, r, -Math.PI / 2) }, argAnchors: { rim: a => polar(c, r, a) }, label: { at: c, candidates: ["above-right", "below-right", "above-left", "below-left"] } };
  },
});
addSample("summingJunction", (id, c, r) => [
  { id, type: "summingJunction", at: P(c.x, c.y), r: 0.3, style: pickOf(r, ["cross", "sigma"] as const), signs: { left: "+", bottom: "-" } },
  { id: `${id}_in`, type: "connector", from: P(c.x - 1.5, c.y), to: `${id}.left` },
  { id: `${id}_fb`, type: "connector", from: P(c.x, c.y - 1.1), to: `${id}.bottom` },
  { id: `${id}_out`, type: "connector", from: `${id}.right`, to: P(c.x + 1.5, c.y) },
]);

// --- take-off point --------------------------------------------------------------------------------

definePart<{ color: string }>({
  type: "takeoff", aliases: ["pickoff", "branchPoint"], category: "logic",
  description: "Take-off (pick-off) point on a signal line: a dot at the origin. It may touch the line it is attached to (at/attach).",
  options: { color: "palette colour" },
  positioning: "placed", touchPlacement: true,
  propKeys: [],
  props: s => ({ color: colorProp(s, "color", "#222") }),
  anchors: ["center"],
  geometry: i => ({ prims: [dot(i.origin, i.props.color)], anchors: { center: i.origin }, label: { at: i.origin, candidates: AROUND } }),
});
addSample("takeoff", (id, c) => [
  { id: `${id}_line`, type: "connector", from: P(c.x - 1.5, c.y + 0.3), to: P(c.x + 1.5, c.y + 0.3) },
  { id, type: "takeoff", at: `${id}_line.at(0.5)` },
  { id: `${id}_br`, type: "connector", from: `${id}`, to: P(c.x, c.y - 0.8), route: "orthogonal", mayTouch: [`${id}_line`] },
].sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0)));

// --- FSM state ---------------------------------------------------------------------------------------

interface StateProps { r: number; text?: string; accepting: boolean; initial?: number; textSize: number; fill: string }
definePart<StateProps>({
  type: "state", aliases: ["fsmState"], category: "logic",
  description: "State of a finite-state machine: a circle with its name, a second ring when accepting, and an optional initial-state arrow coming in from direction `initial` (degrees, e.g. 180 for from the left). Round, so transitions and self-loops attach to its rim.",
  options: { r: "radius (world, default 0.4)", text: "state name", accepting: "double ring (default false)", initial: "direction the start arrow comes from (degrees)", textSize: "11-13", fill: "palette colour (default white)" },
  positioning: "placed",
  propKeys: ["r", "text", "accepting", "initial", "textSize", "fill"],
  props: (s, ctx) => ({ r: lengthProp(s, "r", ctx, { default: 0.4, positive: true }), text: textProp(s, "text"), accepting: boolProp(s, "accepting"), initial: s.initial === undefined ? undefined : angleProp(s, "initial", ctx), textSize: sizeProp(s), fill: colorProp(s, "fill", "#fff") }),
  anchors: ["center", "top", "bottom", "left", "right", "rim(angle)", "initialTail"], anchorArgs: { rim: "angle" },
  hooks: ["radius", "outline"],
  geometry: (i, ctx) => {
    const c = i.origin, r = i.props.r, fits: NonNullable<Geo["fits"]> = [];
    const outline = arcSamples(c, r, 0, 2 * Math.PI).slice(0, -1);
    const prims: Prim[] = [circle(c, r, i.props.fill, "#222")];
    const inner = r - px(ctx, 4);
    if (i.props.accepting) prims.push(circle(c, inner, "none", "#222"));
    if (i.props.text) prims.push(fittedText(fits, c, i.props.text, i.props.textSize, "#222", i.props.accepting ? arcSamples(c, inner, 0, 2 * Math.PI).slice(0, -1) : outline));
    const anchors: Record<string, Vec2> = { center: c, top: polar(c, r, Math.PI / 2), bottom: polar(c, r, -Math.PI / 2), left: polar(c, r, Math.PI), right: polar(c, r, 0) };
    if (i.props.initial !== undefined) {
      const a = i.props.initial, tail = polar(c, r + Math.max(px(ctx, 26), r * 0.9), a);
      prims.push(vector(tail, polar(c, r + px(ctx, 1), a), "#222"));
      anchors.initialTail = tail;
    }
    return { prims, fits, radius: r, outline, anchors, argAnchors: { rim: a => polar(c, r, a) }, label: { at: c, candidates: ["above-right", "below-right", "above-left", "below-left", "above", "below"] } };
  },
});
addSample("state", (id, c, r) => [{ id, type: "state", at: P(c.x + 0.3, c.y), r: 0.5, text: pickOf(r, ["q₀", "S1", "idle"]), accepting: r() < 0.5, initial: 180 }]);

// --- transition between states ---------------------------------------------------------------------

interface TransProps { from: string; to: string; bend: number; color: string; width: number; labelAt: number; geo?: { kind: "line"; a: Vec2; b: Vec2 } | { kind: "arc"; c: Vec2; R: number; a0: number; a1: number; apex: Vec2 } }
definePart<TransProps>({
  type: "transition", aliases: ["fsmTransition"], category: "logic",
  description: "Transition arrow between two round parts (states): straight when bend is 0, otherwise a circular arc bulging to the left of from->to by bend x the centre distance (use opposite signs for the two directions of a pair). It starts and ends exactly on the rims and may touch both states.",
  options: { from: "state id", to: "state id", bend: "-0.45..0.45 (default 0)", color: "palette colour", width: "px (default 1.4)", labelAt: "label slot t (default 0.5)" },
  positioning: "points", pointProps: [],
  propKeys: ["from", "to", "bend", "width", "labelAt"],
  props: (s, ctx) => ({ from: idProp(s, "from"), to: idProp(s, "to"), bend: numProp(s, "bend", ctx, { default: 0, min: -0.45, max: 0.45 }), color: colorProp(s, "color", "#222"), width: strokeWidthProp(s, "width", 1.4), labelAt: numProp(s, "labelAt", ctx, { default: 0.5, min: 0.05, max: 0.95 }) }),
  elementRefs: s => [s.from, s.to].filter((x): x is string => typeof x === "string"),
  link: (i, get, ctx) => {
    const A = get(i.props.from), B = get(i.props.to);
    for (const [o, key] of [[A, "from"], [B, "to"]] as const) if (!o.def.radius) fail("E_SCHEMA", [i.id, o.inst.id], `Transition "${i.id}" ${key} "${o.inst.id}" (${o.inst.type}) is not round`, { path: propPath(i.spec, key), suggestion: "Connect states (or other round parts); use a connector for boxes." });
    if (i.props.from === i.props.to) fail("E_SCHEMA", [i.id], `Transition "${i.id}" starts and ends at "${i.props.from}"; use a selfLoop`, { path: propPath(i.spec, "to") });
    const ca = A.def.anchor(A.inst, "center", undefined, ctx)!, cb = B.def.anchor(B.inst, "center", undefined, ctx)!, ra = A.def.radius!(A.inst), rb = B.def.radius!(B.inst);
    const gap = px(ctx, 1);
    if (dist(ca, cb) <= ra + rb + px(ctx, 14)) fail("E_CONTRADICTORY", [i.id, i.props.from, i.props.to], `States "${i.props.from}" and "${i.props.to}" are too close for a transition arrow`, { measured: { gapPx: (dist(ca, cb) - ra - rb) * ctx.view.scale, minPx: 14 } });
    if (i.props.bend === 0) { const u = unit(sub(cb, ca)); i.props.geo = { kind: "line", a: add(ca, mul(u, ra)), b: sub(cb, mul(u, rb + gap)) }; }
    else {
      const g = bendArc(ca, cb, i.props.bend);
      const at = (t: number) => polar(g.c, g.R, g.a0 + (g.a1 - g.a0) * t);
      const cross = (pred: (t: number) => boolean) => { let lo = 0, hi = 1; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (pred(m)) hi = m; else lo = m; } return hi; };
      const t0 = cross(t => dist(at(t), ca) >= ra);
      const t1 = 1 - cross(t => dist(at(1 - t), cb) >= rb + gap);
      i.props.geo = { kind: "arc", c: g.c, R: g.R, a0: g.a0 + (g.a1 - g.a0) * t0, a1: g.a0 + (g.a1 - g.a0) * t1, apex: g.apex };
    }
    i.touches = [i.props.from, i.props.to];
    i.origin = i.props.geo.kind === "line" ? i.props.geo.a : polar(i.props.geo.c, i.props.geo.R, i.props.geo.a0);
  },
  anchors: ["start", "end", "mid", "slot(t)"], anchorArgs: { slot: "number" },
  geometry: (i, ctx) => {
    const g = i.props.geo!;
    if (g.kind === "line") {
      const s = lerp(g.a, g.b, i.props.labelAt);
      return { prims: [vector(g.a, g.b, i.props.color)], anchors: { start: g.a, end: g.b, mid: lerp(g.a, g.b, 0.5) }, argAnchors: { slot: t => t >= 0 && t <= 1 ? lerp(g.a, g.b, t) : undefined }, label: { at: s, candidates: Math.abs(g.b.x - g.a.x) >= Math.abs(g.b.y - g.a.y) ? ABOVE_FIRST : ["right", "left", "above", "below"] } };
    }
    const at = (t: number) => polar(g.c, g.R, g.a0 + (g.a1 - g.a0) * t);
    const s = at(i.props.labelAt);
    return { prims: arcArrowPrims(g.c, g.R, g.a0, g.a1, ctx, i.props.color, i.props.width, false), anchors: { start: at(0), end: at(1), mid: at(0.5) }, argAnchors: { slot: t => t >= 0 && t <= 1 ? at(t) : undefined }, label: { at: s, candidates: outwardCandidates(sub(s, g.c)) } };
  },
});
addSample("transition", (id, c) => [
  { id, type: "transition", from: `${id}_a`, to: `${id}_b`, bend: 0.3, label: "1" },
  { id: `${id}_back`, type: "transition", from: `${id}_b`, to: `${id}_a`, bend: 0.3, label: "0" },
  { id: `${id}_a`, type: "state", at: P(c.x - 1.0, c.y), r: 0.38, text: "A" },
  { id: `${id}_b`, type: "state", at: P(c.x + 1.0, c.y), r: 0.38, text: "B" },
]);

// --- self-loop ------------------------------------------------------------------------------------------

interface LoopProps { state: string; angle: number; size: number; direction: "ccw" | "cw"; color: string; width: number; geo?: { c: Vec2; r: number; a0: number; a1: number; apex: Vec2 } }
definePart<LoopProps>({
  type: "selfLoop", aliases: ["loop"], category: "logic",
  description: "Self-loop on a round part (a state): a loop centred in direction `angle` (default 90, on top) that leaves and re-enters the rim, with its arrowhead on re-entry.",
  options: { state: "state id", angle: "where the loop sits (degrees, default 90)", size: "loop radius as a fraction of the state radius (default 0.7)", direction: "ccw (default) | cw", color: "palette colour", width: "px (default 1.4)" },
  positioning: "points", pointProps: [],
  propKeys: ["state", "angle", "size", "direction", "width"],
  props: (s, ctx) => ({ state: idProp(s, "state"), angle: angleProp(s, "angle", ctx, 90 * DEG), size: numProp(s, "size", ctx, { default: 0.7, min: 0.25, max: 1.2 }), direction: enumProp(s, "direction", ["ccw", "cw"] as const, "ccw"), color: colorProp(s, "color", "#222"), width: strokeWidthProp(s, "width", 1.4) }),
  elementRefs: s => typeof s.state === "string" ? [s.state] : [],
  link: (i, get, ctx) => {
    const S = get(i.props.state);
    if (!S.def.radius) fail("E_SCHEMA", [i.id, i.props.state], `selfLoop "${i.id}" needs a round part; "${i.props.state}" is a ${S.inst.type}`, { path: propPath(i.spec, "state") });
    const C = S.def.anchor(S.inst, "center", undefined, ctx)!, R = S.def.radius!(S.inst), rho = R * i.props.size;
    if (rho * ctx.view.scale < 8) fail("E_INVALID_VALUE", [i.id], `Self-loop "${i.id}" is only ${(rho * ctx.view.scale).toFixed(1)} px in radius`, { measured: { radiusPx: rho * ctx.view.scale } });
    const d = R + rho * 0.55, Lc = polar(C, d, i.props.angle);
    const beta = angleOf(sub(C, Lc)), phi = Math.acos((d * d + rho * rho - R * R) / (2 * d * rho));
    let a0 = beta + phi, a1 = beta + 2 * Math.PI - phi;
    if (i.props.direction === "cw") [a0, a1] = [a1, a0];
    i.props.geo = { c: Lc, r: rho, a0, a1, apex: polar(Lc, rho, i.props.angle) };
    i.touches = [i.props.state];
    i.origin = polar(Lc, rho, a0);
  },
  anchors: ["apex", "start", "end", "center"],
  geometry: (i, ctx) => {
    const g = i.props.geo!;
    return { prims: arcArrowPrims(g.c, g.r, g.a0, g.a1, ctx, i.props.color, i.props.width, false), anchors: { apex: g.apex, start: polar(g.c, g.r, g.a0), end: polar(g.c, g.r, g.a1), center: g.c }, label: { at: g.apex, candidates: outwardCandidates(sub(g.apex, g.c)) } };
  },
});
addSample("selfLoop", (id, c) => [
  { id, type: "selfLoop", state: `${id}_s`, angle: 90, label: "a" },
  { id: `${id}_s`, type: "state", at: P(c.x, c.y - 0.35), r: 0.45, text: "q₁" },
]);

export type { PartContext, PartInstance };
