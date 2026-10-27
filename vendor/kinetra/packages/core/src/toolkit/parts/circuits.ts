/**
 * Circuit symbols. The seven kinds of the existing schematic renderer
 * (diagram/circuit_schematic.ts: resistor, capacitor, inductor,
 * voltage-source, current-source, switch, ground) are wrapped here with the
 * same geometry, stroke widths and pin offsets, so a toolkit circuit looks like
 * a template one; circuit_schematic.ts itself is unchanged. The other symbols
 * follow the same conventions: ink #222, bodies 1.4 px, plates 1.6 px, wires
 * 1.2 px, pins named pin0/pin1 plus role names (anode, plus, base, ...).
 * Junction dots are separate parts and are only accepted at real nodes.
 */
import { fail } from "../errors.js";
import { DIMLESS } from "../expr.js";
import { wiresCrossCleanly } from "../geometry.js";
import type { ComponentKind } from "../../diagram/circuit_schematic.js";
import {
  ABOVE_FIRST, AROUND, DEG, P, add, addSample, angleProp, arcSamples, between, boolProp, circle, colorProp, definePart, dist, dot, enumProp, fittedText,
  fp, frameOf, head, idProp, lengthProp, lengthQ, lerp, line, listOf, listProp, mul, numProp, perp, pickOf, poly, propPath, ptsOf, px, shape, sizeProp, sub,
  text, textProp, unit, v, vector, refElement, strokeWidthProp, boxPrims,
} from "./kit.js";
import type { Frame, Geo, PartContext, PartInstance, Prim, Vec2 } from "./kit.js";
import type { LabelPosition } from "../types.js";

const INK = "#222", BODY = 1.4, PLATE = 1.6, WIRE = 1.2;

interface SymProps { rotation: number; scale: number; flip: boolean; span?: number; closed: boolean; cells: number; variant: string; textSize: number; text?: string }
interface SymbolSpec {
  /** Local pin positions (scale 1, before rotation). The first two are pin0 and pin1. */
  pins: Record<string, [number, number]>;
  /** Pin role aliases, e.g. anode -> pin0. */
  aliases?: Record<string, string>;
  /** Pins on the symbol's x axis that `span` may move outward (default pin0, pin1). */
  spanPins?: [string, string] | null;
  draw(Q: (x: number, y: number) => Vec2, p: SymProps, f: Frame, ctx: PartContext, fits: NonNullable<Geo["fits"]>): Prim[];
  /** Closed body outline for centre labels (local). */
  body?: [number, number][];
}

/** Register a two-or-more-pin circuit symbol. */
function symbol(type: string, aliases: string[], description: string, spec: SymbolSpec, extraKeys: string[] = [], options: Record<string, string> = {}) {
  const pinNames = Object.keys(spec.pins);
  const roleNames = Object.keys(spec.aliases ?? {});
  const span = spec.spanPins === undefined ? (["pin0", "pin1"] as [string, string]) : spec.spanPins;
  definePart<SymProps>({
    type, aliases, category: "circuits", description,
    options: { rotation: "degrees (0: pin0 left, pin1 right)", scale: "size factor (default 1; symbol widths match the template schematic in world units)", flip: "mirror across the axis", ...(span ? { span: "pin-to-pin distance (world); leads are extended" } : {}), ...options },
    positioning: "placed",
    propKeys: ["rotation", "scale", "flip", ...(span ? ["span"] : []), ...extraKeys],
    props: (s, ctx) => {
      const p: SymProps = { rotation: angleProp(s, "rotation", ctx, 0), scale: numProp(s, "scale", ctx, { default: 1, min: 0.2, max: 20 }), flip: boolProp(s, "flip"), span: s.span === undefined ? undefined : lengthProp(s, "span", ctx, { positive: true }), closed: boolProp(s, "closed"), cells: numProp(s, "cells", ctx, { default: type === "cell" ? 1 : 2, min: 1, max: 6, integer: true }), variant: typeof s.variant === "string" ? s.variant : "", textSize: sizeProp(s, "textSize", 11), text: textProp(s, "text") };
      if (span && p.span !== undefined) {
        const [a, b] = span, w = Math.abs(spec.pins[b]![0] - spec.pins[a]![0]) * p.scale;
        if (p.span < w - 1e-12) fail("E_INVALID_VALUE", [s.id], `span of "${s.id}" (${p.span}) is shorter than the symbol (${w.toFixed(3)})`, { path: propPath(s, "span"), measured: { span: p.span, symbolWidth: w } });
      }
      return p;
    },
    anchors: ["center", ...pinNames, ...roleNames, ...(span ? ["start", "end"] : [])],
    hooks: spec.body ? ["outline"] : undefined,
    geometry: (i, ctx) => {
      const f = frameOf(i), Q = (x: number, y: number) => fp(f, x, y), p = i.props;
      const fits: NonNullable<Geo["fits"]> = [];
      const prims = spec.draw(Q, p, f, ctx, fits);
      const anchors: Record<string, Vec2> = { center: i.origin };
      for (const [n, [x, y]] of Object.entries(spec.pins)) anchors[n] = Q(x, y);
      if (span && p.span !== undefined) {
        const [a, b] = span, ax = spec.pins[a]!, bx = spec.pins[b]!, half = p.span / 2 / p.scale;
        const na: [number, number] = [-half, ax[1]], nb: [number, number] = [half, bx[1]];
        prims.push(line(Q(ax[0], ax[1]), Q(na[0], na[1]), INK, WIRE), line(Q(bx[0], bx[1]), Q(nb[0], nb[1]), INK, WIRE));
        anchors[a] = Q(na[0], na[1]); anchors[b] = Q(nb[0], nb[1]);
      }
      for (const [role, pin] of Object.entries(spec.aliases ?? {})) anchors[role] = anchors[pin]!;
      if (span) { anchors.start = anchors[span[0]]!; anchors.end = anchors[span[1]]!; }
      // Labels anchor on the edge of the drawn symbol (top when horizontal, right when vertical), so they sit beside it without a leader.
      const vertical = Math.abs(Math.sin(p.rotation)) > 0.7;
      const bb = boxPrims(prims, ctx), mid = v((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2);
      const label = vertical ? { at: v(bb.x1, mid.y), candidates: ["right", "left", "above-right", "below-right", "above", "below"] as LabelPosition[] } : { at: v(mid.x, bb.y1), candidates: ["above", "below", "above-right", "above-left", "below-right", "below-left", "right", "left"] as LabelPosition[] };
      const outline = spec.body?.map(([x, y]) => Q(x, y));
      return { prims, fits, outline, anchors, label, refs: { scale: { value: p.scale, dim: DIMLESS } } };
    },
  });
}

// --- the wrapped template symbols (geometry identical to circuit_schematic.ts) --------------------

/** Pin offsets of the template symbols, as circuit_schematic.ts defines them. */
// Clem patch: Clem's ComponentKind has more kinds (batteries, dependent sources, meters…) than these wrapped symbols.
type TemplateKind = Extract<ComponentKind, "resistor" | "capacitor" | "inductor" | "voltage-source" | "current-source" | "switch" | "ground">;
export const TEMPLATE_PINS: Record<TemplateKind, [[number, number], [number, number]]> = {
  resistor: [[-0.3, 0], [0.3, 0]],
  capacitor: [[-0.15, 0], [0.15, 0]],
  inductor: [[-0.36, 0], [0.36, 0]],
  "voltage-source": [[-0.18, 0], [0.18, 0]],
  "current-source": [[-0.18, 0], [0.18, 0]],
  switch: [[-0.2, 0], [0.2, 0]],
  ground: [[0, 0], [0, 0]],
};
const pinsOf = (k: TemplateKind) => ({ pin0: TEMPLATE_PINS[k][0], pin1: TEMPLATE_PINS[k][1] });

symbol("resistor", [], "Resistor (zig-zag), as in the template schematic: 0.6 wide, pins pin0/pin1 at ±0.3.", {
  pins: pinsOf("resistor"),
  draw: Q => { const w = 0.6, h = 0.18; const xs = [-w / 2, -w / 2 + w * 0.1, -w / 2 + w * 0.3, -w / 2 + w * 0.5, -w / 2 + w * 0.7, -w / 2 + w * 0.9, w / 2]; const ys = [0, -h, h, -h, h, -h, 0]; return [poly(xs.map((x, k) => Q(x, ys[k]!)), INK, BODY)]; },
});
symbol("capacitor", [], "Capacitor: two plates 0.3 apart (template geometry); `variant: \"polarized\"` curves the minus plate and adds a + mark.", {
  pins: pinsOf("capacitor"), aliases: { plus: "pin0", minus: "pin1" },
  draw: (Q, p, f, ctx) => {
    const out: Prim[] = [line(Q(-0.15, -0.15), Q(-0.15, 0.15), INK, PLATE)];
    if (p.variant === "polarized") {
      // The minus plate curves away from the plus plate.
      out.push(poly(Array.from({ length: 9 }, (_, k) => { const t = -0.15 + 0.3 * k / 8; return Q(0.15 + 0.05 * (t / 0.15) ** 2, t); }), INK, PLATE));
      out.push(line(Q(-0.27, 0.12), Q(-0.21, 0.12), INK, 1.2), line(Q(-0.24, 0.09), Q(-0.24, 0.15), INK, 1.2));
    } else out.push(line(Q(0.15, -0.15), Q(0.15, 0.15), INK, PLATE));
    return out;
  },
}, ["variant"], { variant: "\"polarized\" for an electrolytic capacitor" });
symbol("inductor", [], "Inductor: four half-turns between pins at ±0.36, as in the template schematic (bumps below the axis; flip puts them above).", {
  pins: pinsOf("inductor"),
  draw: Q => { const h = 0.09, out: Prim[] = []; for (let k = 0; k < 4; k++) { const cx = -0.36 + h + 2 * h * k; out.push(poly(arcSamples(v(cx, 0), h, Math.PI, 2 * Math.PI).map(q => Q(q.x, q.y)), INK, BODY)); } return out; },
});
symbol("voltageSource", ["dcSource", "voltage-source"], "Independent voltage source: circle r 0.18 with + (pin0 side) and − marks, as in the template schematic.", {
  pins: pinsOf("voltage-source"), aliases: { plus: "pin0", minus: "pin1" }, body: circleLocal(0.18),
  draw: Q => { const r = 0.18; return [circleQ(Q, 0, 0, r), line(Q(-r * 0.7, 0), Q(-r * 0.2, 0), INK, 1.2), line(Q(-r * 0.45, -r * 0.25), Q(-r * 0.45, r * 0.25), INK, 1.2), line(Q(r * 0.2, 0), Q(r * 0.7, 0), INK, 1.2)]; },
});
symbol("currentSource", ["current-source"], "Independent current source: circle r 0.18 with an arrow from pin0 to pin1, as in the template schematic.", {
  pins: pinsOf("current-source"), body: circleLocal(0.18),
  draw: Q => { const r = 0.18; return [circleQ(Q, 0, 0, r), line(Q(-r * 0.65, 0), Q(r * 0.6, 0), INK, BODY), poly([Q(r * 0.2, r * 0.3), Q(r * 0.6, 0), Q(r * 0.2, -r * 0.3)], INK, BODY)]; },
});
symbol("switch", ["spst"], "Single-pole switch (template geometry): open by default, `closed: true` closes it.", {
  pins: pinsOf("switch"),
  draw: (Q, p) => [line(Q(-0.2, 0), Q(0.16, p.closed ? 0 : 0.18), INK, BODY), line(Q(0.16, 0), Q(0.2, 0), INK, BODY)],
}, ["closed"], { closed: "boolean (default false)" });
symbol("circuitGround", ["groundSymbol", "earth"], "Ground symbol (template geometry): its single pin is at the origin (pin0 = pin1).", {
  pins: { pin0: [0, 0], pin1: [0, 0] }, spanPins: null,
  draw: Q => [line(Q(0, 0), Q(0, -0.2), INK, BODY), line(Q(-0.15, -0.2), Q(0.15, -0.2), INK, PLATE), line(Q(-0.1, -0.27), Q(0.1, -0.27), INK, 1.2), line(Q(-0.05, -0.34), Q(0.05, -0.34), INK, 1.2)],
});

function circleLocal(r: number): [number, number][] { return Array.from({ length: 48 }, (_, k) => [r * Math.cos(k * Math.PI / 24), r * Math.sin(k * Math.PI / 24)]); }
/** A circle in symbol-local coordinates (its radius scales with the frame). */
function circleQ(Q: (x: number, y: number) => Vec2, x: number, y: number, r: number, fill = "#fff"): Prim {
  const c = Q(x, y), e = Q(x + r, y);
  return circle(c, dist(c, e), fill, INK);
}

// --- new symbols ------------------------------------------------------------------------------------

const leads = (Q: (x: number, y: number) => Vec2, a: number, b: number): Prim[] => [line(Q(-0.3, 0), Q(a, 0), INK, WIRE), line(Q(b, 0), Q(0.3, 0), INK, WIRE)];

function batteryDraw(cells: number) {
  return (Q: (x: number, y: number) => Vec2): Prim[] => {
    const gap = 0.07, w = gap * (2 * cells - 1), x0 = -w / 2;
    const out: Prim[] = leads(Q, x0, x0 + w);
    for (let k = 0; k < cells; k++) {
      const xl = x0 + 2 * k * gap, xs = xl + gap;
      out.push(line(Q(xl, -0.15), Q(xl, 0.15), INK, PLATE), line(Q(xs, -0.075), Q(xs, 0.075), INK, 2.5));
      if (k < cells - 1) out.push(line(Q(xs, 0), Q(xs + gap, 0), INK, 0.8));
    }
    out.push(line(Q(x0 - 0.1, 0.13), Q(x0 - 0.05, 0.13), INK, 1.2), line(Q(x0 - 0.075, 0.105), Q(x0 - 0.075, 0.155), INK, 1.2));
    return out;
  };
}
symbol("battery", [], "Battery of `cells` cells (long plate +, short plate −); + is pin0. Pins at ±0.3.", {
  pins: { pin0: [-0.3, 0], pin1: [0.3, 0] }, aliases: { plus: "pin0", minus: "pin1" },
  draw: (Q, p) => batteryDraw(p.cells)(Q),
}, ["cells"], { cells: "1-6 (default 2)" });
symbol("cell", [], "Single electrochemical cell (one long + plate, one short − plate); + is pin0. Pins at ±0.3.", {
  pins: { pin0: [-0.3, 0], pin1: [0.3, 0] }, aliases: { plus: "pin0", minus: "pin1" },
  draw: Q => batteryDraw(1)(Q),
});
symbol("bulb", ["lamp"], "Lamp: a circle with a cross (IEC); pins at ±0.3.", {
  pins: { pin0: [-0.3, 0], pin1: [0.3, 0] }, body: circleLocal(0.16),
  draw: Q => { const r = 0.16, d = r * Math.SQRT1_2; return [...leads(Q, -r, r), circleQ(Q, 0, 0, r), line(Q(-d, -d), Q(d, d), INK, BODY), line(Q(-d, d), Q(d, -d), INK, BODY)]; },
});
for (const [type, letter, desc] of [["ammeter", "A", "Ammeter"], ["voltmeter", "V", "Voltmeter"], ["ohmmeter", "Ω", "Ohmmeter"], ["galvanometer", "G", "Galvanometer"]] as const) {
  symbol(type, [], `${desc}: a circle with "${letter}"; pins at ±0.3. The letter must fit inside the circle at the current zoom (raise scale if the gate says it does not).`, {
    pins: { pin0: [-0.3, 0], pin1: [0.3, 0] }, aliases: { plus: "pin0", minus: "pin1" }, body: circleLocal(0.2),
    draw: (Q, p, f, ctx, fits) => [...leads(Q, -0.2, 0.2), circleQ(Q, 0, 0, 0.2), fittedText(fits, Q(0, 0), p.text ?? letter, p.textSize, INK, circleLocal(0.2).map(([x, y]) => Q(x, y)))],
  }, ["textSize", "text"], { textSize: "11-13 (default 11)", text: "override the letter" });
}
const diodeBody = (Q: (x: number, y: number) => Vec2): Prim[] => [...leads(Q, -0.1, 0.1), shape([Q(-0.1, 0.11), Q(-0.1, -0.11), Q(0.1, 0)], INK, INK)];
symbol("diode", [], "Diode: anode (pin0) to cathode (pin1); pins at ±0.3.", {
  pins: { pin0: [-0.3, 0], pin1: [0.3, 0] }, aliases: { anode: "pin0", cathode: "pin1" },
  draw: Q => [...diodeBody(Q), line(Q(0.1, -0.11), Q(0.1, 0.11), INK, PLATE)],
});
symbol("zener", ["zenerDiode"], "Zener diode: a diode whose bar has bent ends; anode pin0, cathode pin1.", {
  pins: { pin0: [-0.3, 0], pin1: [0.3, 0] }, aliases: { anode: "pin0", cathode: "pin1" },
  draw: Q => [...diodeBody(Q), poly([Q(0.06, -0.14), Q(0.1, -0.11), Q(0.1, 0.11), Q(0.14, 0.14)], INK, PLATE)],
});
symbol("led", ["lightEmittingDiode"], "Light-emitting diode: a diode with two outward arrows; anode pin0, cathode pin1.", {
  pins: { pin0: [-0.3, 0], pin1: [0.3, 0] }, aliases: { anode: "pin0", cathode: "pin1" },
  draw: (Q, p, f, ctx) => {
    const out: Prim[] = [...diodeBody(Q), line(Q(0.1, -0.11), Q(0.1, 0.11), INK, PLATE)];
    for (const dx of [-0.03, 0.06]) { const a = Q(dx, 0.13), b = Q(dx + 0.1, 0.25); const u = unit(sub(b, a)); out.push(line(a, sub(b, mul(u, px(ctx, 3))), INK, 1), head(b, Math.atan2(u.y, u.x), INK)); }
    return out;
  },
});
symbol("acSource", ["sineSource"], "AC voltage source: a circle with one sine period; pins at ±0.18 (use span for longer leads).", {
  pins: { pin0: [-0.18, 0], pin1: [0.18, 0] }, body: circleLocal(0.18),
  draw: Q => [circleQ(Q, 0, 0, 0.18), poly(Array.from({ length: 25 }, (_, k) => { const t = -1 + 2 * k / 24; return Q(t * 0.11, 0.06 * Math.sin(Math.PI * t)); }), INK, 1.2)],
});
symbol("potentiometer", ["rheostat"], "Potentiometer: a resistor with a wiper arrow from above; pins pin0, pin1 and wiper.", {
  pins: { pin0: [-0.3, 0], pin1: [0.3, 0], wiper: [0, 0.36] },
  draw: (Q, p, f, ctx) => { const w = 0.6, h = 0.18; const xs = [-w / 2, -w / 2 + w * 0.1, -w / 2 + w * 0.3, -w / 2 + w * 0.5, -w / 2 + w * 0.7, -w / 2 + w * 0.9, w / 2]; const ys = [0, -h, h, -h, h, -h, 0]; const tip = Q(0, 0.2), tail = Q(0, 0.36); const u = unit(sub(tip, tail)); return [poly(xs.map((x, k) => Q(x, ys[k]!)), INK, BODY), line(tail, sub(tip, mul(u, px(ctx, 3))), INK, 1.2), head(tip, Math.atan2(u.y, u.x), INK)]; },
});
symbol("fuse", [], "Fuse: a small rectangle with the conductor through it; pins at ±0.3.", {
  pins: { pin0: [-0.3, 0], pin1: [0.3, 0] }, body: [[-0.18, -0.07], [0.18, -0.07], [0.18, 0.07], [-0.18, 0.07]],
  draw: Q => [...leads(Q, -0.18, 0.18), shape([Q(-0.18, -0.07), Q(0.18, -0.07), Q(0.18, 0.07), Q(-0.18, 0.07)], "#fff", INK), line(Q(-0.18, 0), Q(0.18, 0), INK, 1)],
});
symbol("spdtSwitch", ["changeoverSwitch", "spdt"], "Single-pole double-throw switch: common on the left (pin0), throws pin1 (upper) and pin2 (lower). `closed: true` selects the lower throw.", {
  pins: { pin0: [-0.3, 0], pin1: [0.3, 0.12], pin2: [0.3, -0.12] }, aliases: { common: "pin0", upper: "pin1", lower: "pin2" }, spanPins: null,
  draw: (Q, p, f, ctx) => [line(Q(-0.3, 0), Q(-0.18, 0), INK, WIRE), line(Q(-0.18, 0), Q(0.16, p.closed ? -0.1 : 0.1), INK, BODY), line(Q(0.18, 0.12), Q(0.3, 0.12), INK, WIRE), line(Q(0.18, -0.12), Q(0.3, -0.12), INK, WIRE), circle(Q(-0.18, 0), px(ctx, 2.2), "#fff", INK), circle(Q(0.18, 0.12), px(ctx, 2.2), "#fff", INK), circle(Q(0.18, -0.12), px(ctx, 2.2), "#fff", INK)],
}, ["closed"], { closed: "boolean: lower throw (default upper)" });
symbol("pushButton", ["pushSwitch"], "Normally-open push-button switch; `closed: true` draws it pressed. Pins at ±0.3.", {
  pins: { pin0: [-0.3, 0], pin1: [0.3, 0] },
  draw: (Q, p, f, ctx) => { const y = p.closed ? 0.02 : 0.1; return [...leads(Q, -0.15, 0.15), circle(Q(-0.15, 0), px(ctx, 2.2), "#fff", INK), circle(Q(0.15, 0), px(ctx, 2.2), "#fff", INK), line(Q(-0.17, y), Q(0.17, y), INK, BODY), line(Q(0, y), Q(0, y + 0.14), INK, BODY), line(Q(-0.06, y + 0.14), Q(0.06, y + 0.14), INK, PLATE)]; },
}, ["closed"], { closed: "pressed (default false)" });

// Transistors and the op-amp: three or more pins off the x axis.
symbol("bjt", ["transistor", "npn", "pnp"], "Bipolar transistor (type npn or pnp, or variant \"pnp\"): base pin on the left, collector up, emitter down, with the emitter arrow and an envelope circle.", {
  pins: { base: [-0.3, 0], collector: [0.12, 0.32], emitter: [0.12, -0.32] }, aliases: { pin0: "base", pin1: "collector", pin2: "emitter" }, spanPins: null,
  body: circleLocal(0.24).map(([x, y]) => [x + 0.04, y] as [number, number]),
  draw: (Q, p, f, ctx) => {
    const pnp = p.variant === "pnp";
    const out: Prim[] = [circleQ(Q, 0.04, 0, 0.24), line(Q(-0.3, 0), Q(-0.08, 0), INK, WIRE), line(Q(-0.08, -0.13), Q(-0.08, 0.13), INK, 2.5), line(Q(-0.08, 0.06), Q(0.12, 0.18), INK, BODY), line(Q(0.12, 0.18), Q(0.12, 0.32), INK, WIRE), line(Q(0.12, -0.18), Q(0.12, -0.32), INK, WIRE)];
    const e0 = Q(-0.08, -0.06), e1 = Q(0.12, -0.18), u = unit(sub(e1, e0));
    if (!pnp) { out.push(line(e0, sub(e1, mul(u, px(ctx, 3))), INK, BODY), head(e1, Math.atan2(u.y, u.x), INK)); }
    else { const tip = lerp(e0, e1, 0.15); out.push(line(add(tip, mul(u, px(ctx, 3))), e1, INK, BODY), head(tip, Math.atan2(-u.y, -u.x), INK)); }
    return out;
  },
}, ["variant"], { variant: "npn (default) | pnp" });
symbol("mosfet", ["nmos", "pmos", "fet"], "Enhancement MOSFET (variant \"n\" or \"p\"): gate on the left, drain up, source down, with the body arrow (into the channel for n) and the source tied to the body.", {
  pins: { gate: [-0.3, 0], drain: [0.12, 0.32], source: [0.12, -0.32] }, aliases: { pin0: "gate", pin1: "drain", pin2: "source" }, spanPins: null,
  draw: (Q, p, f, ctx) => {
    const pch = p.variant === "p";
    const out: Prim[] = [line(Q(-0.3, 0), Q(-0.12, 0), INK, WIRE), line(Q(-0.12, -0.15), Q(-0.12, 0.15), INK, PLATE)];
    for (const [y0, y1] of [[0.09, 0.19], [-0.05, 0.05], [-0.19, -0.09]]) out.push(line(Q(-0.06, y0!), Q(-0.06, y1!), INK, 2));
    out.push(poly([Q(-0.06, 0.14), Q(0.12, 0.14), Q(0.12, 0.32)], INK, WIRE), poly([Q(-0.06, -0.14), Q(0.12, -0.14), Q(0.12, -0.32)], INK, WIRE), line(Q(0.12, 0), Q(0.12, -0.14), INK, WIRE));
    const a = Q(0.12, 0), b = Q(-0.06, 0), u = unit(sub(b, a));
    if (!pch) out.push(line(a, sub(b, mul(u, px(ctx, 3))), INK, WIRE), head(b, Math.atan2(u.y, u.x), INK));
    else out.push(line(add(b, mul(u, -px(ctx, 3))), a, INK, WIRE), head(lerp(b, a, 0.85), Math.atan2(-u.y, -u.x), INK));
    return out;
  },
}, ["variant"], { variant: "n (default) | p" });
symbol("opamp", ["opAmp", "amplifier"], "Operational amplifier: a triangle pointing +x; inverting input (inMinus) on top unless `flip`, non-inverting (inPlus) below, output on the right; `variant: \"supply\"` adds vPlus/vMinus leads.", {
  pins: { inMinus: [-0.45, 0.15], inPlus: [-0.45, -0.15], out: [0.45, 0], vPlus: [0, 0.32], vMinus: [0, -0.32] }, aliases: { pin0: "inMinus", pin1: "inPlus", pin2: "out" }, spanPins: null,
  body: [[-0.3, 0.3], [-0.3, -0.3], [0.3, 0]],
  draw: (Q, p) => {
    const out: Prim[] = [shape([Q(-0.3, 0.3), Q(-0.3, -0.3), Q(0.3, 0)], "#fff", INK), line(Q(-0.45, 0.15), Q(-0.3, 0.15), INK, WIRE), line(Q(-0.45, -0.15), Q(-0.3, -0.15), INK, WIRE), line(Q(0.3, 0), Q(0.45, 0), INK, WIRE)];
    out.push(line(Q(-0.25, 0.15), Q(-0.17, 0.15), INK, 1.2));
    out.push(line(Q(-0.25, -0.15), Q(-0.17, -0.15), INK, 1.2), line(Q(-0.21, -0.19), Q(-0.21, -0.11), INK, 1.2));
    if (p.variant === "supply") out.push(line(Q(0, 0.15), Q(0, 0.32), INK, WIRE), line(Q(0, -0.15), Q(0, -0.32), INK, WIRE));
    return out;
  },
}, ["variant"], { variant: "\"supply\" draws the supply leads" });

// --- wires and junctions ------------------------------------------------------------------------------

interface WireProps { color: string; width: number; orthogonal: "none" | "hv" | "vh"; path?: Vec2[] }
definePart<WireProps>({
  type: "wire", aliases: ["conductor"], category: "circuits",
  description: "Circuit wire through `points` (pins and corners), 1.2 px ink like the template. `orthogonal: \"hv\"` or `\"vh\"` inserts a corner between points that are not axis-aligned. Crossing wires are not connected; mark real nodes with a junction. It may touch the parts whose pins it names.",
  options: { points: "pins and corner points", orthogonal: "none (default) | hv | vh", color: "palette colour", width: "px (default 1.2)" },
  positioning: "points", pointProps: [{ name: "points", list: true }], touchRefs: ["points"],
  propKeys: ["points", "orthogonal", "width"],
  props: s => ({ color: colorProp(s, "color", INK), width: strokeWidthProp(s, "width", WIRE), orthogonal: enumProp(s, "orthogonal", ["none", "hv", "vh"] as const, "none") }),
  contactWith: (i, o, ctx) => {
    if (o.type !== "wire" && o.type !== "conductor") return undefined;
    return wiresCrossCleanly(wirePath(listOf(i, "points"), i.props.orthogonal).map(ctx.view.toView), wirePath((o.points.points as Vec2[]), (o.props as WireProps).orthogonal).map(ctx.view.toView), (i.props.width + (o.props as WireProps).width) / 2 + 0.5) ? "wires cross without connecting (no junction)" : undefined;
  },
  anchors: ["start", "end", "vertex(k)", "at(t)"], anchorArgs: { vertex: "number", at: "number" },
  hooks: ["curve"],
  geometry: (i, ctx) => {
    const pts = wirePath(listOf(i, "points"), i.props.orthogonal);
    const at = (t: number) => { if (t < 0 || t > 1) return undefined; const segs = pts.slice(1).map((q, k) => dist(q, pts[k]!)), tot = segs.reduce((a, b) => a + b, 0); let d = t * tot; for (let k = 0; k < segs.length; k++) { if (d <= segs[k]! || k === segs.length - 1) return lerp(pts[k]!, pts[k + 1]!, segs[k]! ? Math.min(1, d / segs[k]!) : 0); d -= segs[k]!; } return pts[0]; };
    return { prims: [poly(pts, i.props.color, i.props.width)], curve: pts, anchors: { start: pts[0]!, end: pts[pts.length - 1]! }, argAnchors: { vertex: k => Number.isInteger(k) ? pts[k] : undefined, at }, label: { at: at(0.5)!, candidates: AROUND }, refs: { length: lengthQ(pts.slice(1).reduce((s, q, k) => s + dist(q, pts[k]!), 0), ctx) } };
  },
});
export function wirePath(pts: Vec2[], mode: "none" | "hv" | "vh"): Vec2[] {
  if (mode === "none") return pts;
  const out: Vec2[] = [pts[0]!];
  for (let k = 1; k < pts.length; k++) {
    const a = out[out.length - 1]!, b = pts[k]!;
    if (Math.abs(a.x - b.x) > 1e-12 && Math.abs(a.y - b.y) > 1e-12) out.push(mode === "hv" ? v(b.x, a.y) : v(a.x, b.y));
    out.push(b);
  }
  return out;
}

interface JunctionProps { wires: string[]; color: string; connections?: number }
definePart<JunctionProps>({
  type: "junction", aliases: ["node_dot", "connectionDot"], category: "circuits",
  description: "Junction dot at a circuit node. It names the `wires` that meet there and is accepted only at a real node: at least three wire ends or pass-throughs at the dot (a wire passing through counts twice). Elsewhere it fails with E_CONSTRAINT_VIOLATED. The wires it names may touch each other.",
  options: { wires: "ids of the wires meeting at the dot", color: "palette colour" },
  positioning: "placed", touchPlacement: true,
  propKeys: ["wires"],
  props: s => ({ wires: listProp<unknown>(s, "wires", { min: 1, max: 12 }).map((w, k) => idProp({ ...s, [`wires[${k}]`]: w }, `wires[${k}]`)), color: colorProp(s, "color", INK) }),
  elementRefs: s => Array.isArray(s.wires) ? (s.wires as unknown[]).filter((x): x is string => typeof x === "string") : [],
  link: (i, get, ctx) => {
    let n = 0;
    const tol = px(ctx, 0.5);
    for (const id of i.props.wires) {
      const o = get(id);
      if (!o.def.curve) fail("E_SCHEMA", [i.id, id], `Junction "${i.id}" lists "${id}" (${o.inst.type}), which is not a wire`, { path: propPath(i.spec, "wires") });
      const pts = o.def.curve(o.inst, ctx);
      let c = 0;
      if (dist(pts[0]!, i.origin) <= tol) c++;
      if (dist(pts[pts.length - 1]!, i.origin) <= tol) c++;
      if (c === 0) for (let k = 1; k < pts.length; k++) { const a = pts[k - 1]!, b = pts[k]!, ab = sub(b, a), l2 = ab.x * ab.x + ab.y * ab.y; const t = l2 ? ((i.origin.x - a.x) * ab.x + (i.origin.y - a.y) * ab.y) / l2 : 0; if (t > 0 && t < 1 && dist(add(a, mul(ab, t)), i.origin) <= tol) { c = 2; break; } }
      if (c === 0) fail("E_CONSTRAINT_VIOLATED", [i.id, id], `Wire "${id}" does not pass through junction "${i.id}"`, { measured: { junction: i.origin }, suggestion: `Route "${id}" through the junction point, or remove it from "wires".` });
      n += c;
    }
    if (n < 3) fail("E_CONSTRAINT_VIOLATED", [i.id, ...i.props.wires], `Junction "${i.id}" joins only ${n} wire end${n === 1 ? "" : "s"}; a dot marks a node of three or more`, { measured: { connections: n }, suggestion: "Remove the dot (two wires meeting at a corner need none), or connect a third wire." });
    i.props.connections = n;
    i.touches = [...new Set([...(i.touches ?? []), ...i.props.wires])];
    // The wires of a validated node meet there by design.
    for (const id of i.props.wires) { const w = get(id).inst; w.touches = [...new Set([...(w.touches ?? []), ...i.props.wires.filter(x => x !== id)])]; }
  },
  anchors: ["center"],
  geometry: (i, ctx) => ({ prims: [circle(i.origin, px(ctx, 3), i.props.color, i.props.color)], anchors: { center: i.origin }, label: { at: i.origin, candidates: AROUND }, refs: { connections: { value: i.props.connections ?? 0, dim: DIMLESS } } }),
});

// --- samples -------------------------------------------------------------------------------------------

const twoPin = (type: string) => (id: string, c: Vec2) => [
  { id, type, at: P(c.x, c.y), scale: 2.4 },
  { id: `${id}_l`, type: "wire", points: [P(c.x - 1.5, c.y), `${id}.pin0`] },
  { id: `${id}_r`, type: "wire", points: [`${id}.pin1`, P(c.x + 1.5, c.y)] },
];
for (const t of ["resistor", "capacitor", "inductor", "voltageSource", "currentSource", "switch", "battery", "cell", "bulb", "ammeter", "voltmeter", "ohmmeter", "galvanometer", "diode", "zener", "led", "acSource", "fuse", "pushButton"]) addSample(t, twoPin(t));
addSample("potentiometer", twoPin("potentiometer"));
addSample("circuitGround", (id, c) => [{ id, type: "circuitGround", at: P(c.x, c.y + 0.4), scale: 2.4 }, { id: `${id}_w`, type: "wire", points: [P(c.x - 1.2, c.y + 0.8), P(c.x, c.y + 0.8), `${id}.pin0`] }]);
addSample("spdtSwitch", (id, c) => [{ id, type: "spdtSwitch", at: P(c.x, c.y), scale: 2.4 }, { id: `${id}_l`, type: "wire", points: [P(c.x - 1.5, c.y), `${id}.common`] }, { id: `${id}_a`, type: "wire", points: [`${id}.upper`, P(c.x + 1.5, c.y + 0.29)] }, { id: `${id}_b`, type: "wire", points: [`${id}.lower`, P(c.x + 1.5, c.y - 0.29)] }]);
addSample("bjt", (id, c, r) => [{ id, type: "bjt", at: P(c.x, c.y), scale: 2.2, variant: pickOf(r, ["npn", "pnp"]) }]);
addSample("mosfet", (id, c, r) => [{ id, type: "mosfet", at: P(c.x, c.y), scale: 2.2, variant: pickOf(r, ["n", "p"]) }]);
addSample("opamp", (id, c) => [{ id, type: "opamp", at: P(c.x, c.y), scale: 2.2, variant: "supply" }]);
addSample("wire", (id, c) => [{ id, type: "wire", points: [P(c.x - 1.4, c.y - 0.6), P(c.x + 1.4, c.y + 0.6)], orthogonal: "hv" }]);
addSample("junction", (id, c) => [
  { id, type: "junction", at: P(c.x, c.y), wires: [`${id}_a`, `${id}_b`] },
  { id: `${id}_a`, type: "wire", points: [P(c.x - 1.4, c.y), P(c.x + 1.4, c.y)] },
  { id: `${id}_b`, type: "wire", points: [P(c.x, c.y), P(c.x, c.y - 0.9)] },
]);

export type { PartInstance };
