/** Textbook-style charged-rod apparatus. This is a qualitative illustration of
 * electric interaction, not a point-charge approximation for distributed rods.
 * Coordinates are schematic world units with +y up. Force arrows express equal
 * and opposite directions; their lengths are a display scale, not newtons. */
import { createArtifact, withRendering } from "../artifacts.js";
import { el, line, renderSvg, text } from "./primitives.js";
import type { SvgElement, Vec2 } from "./primitives.js";
import { worldToView, sceneTransform, validateScene2D } from "./scene2d.js";

export interface ChargedRod {
  from: Vec2;
  to: Vec2;
  radius: number;
  material: "rubber" | "glass" | "metal";
  label: string;
  /** Charge sign only; magnitude is deliberately not used for numeric force. */
  charge: -1 | 1;
  /** Fraction of the rod carrying the displayed charge patch. */
  chargeRegion?: [number, number];
  chargeCount?: number;
  /** Approximate point of application for the qualitative force. */
  forceFraction?: number;
}
export interface ElectrostaticRodsModel {
  suspended: ChargedRod;
  nearby: ChargedRod;
  suspension: { anchor: Vec2; fork: Vec2; attachments: [number, number] };
  /** Indicates rotational freedom of the suspension, not a solved angular velocity. */
  showRotationCue?: boolean;
  title?: string;
  width: number;
  height: number;
  world: { xMin: number; xMax: number; yMin: number; yMax: number };
}
const point = (r: ChargedRod, t: number, normal = 0): Vec2 => {
  const dx = r.to.x - r.from.x, dy = r.to.y - r.from.y, len = Math.hypot(dx, dy);
  return { x: r.from.x + dx * t - dy / len * normal, y: r.from.y + dy * t + dx / len * normal };
};

export function electrostaticForcePair(signA: number, signB: number, a: Vec2, b: Vec2, arrowLength: number) {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  if (![signA, signB, a.x, a.y, b.x, b.y, arrowLength].every(Number.isFinite) || signA === 0 || signB === 0 || distance === 0 || arrowLength <= 0) throw new Error("Electrostatics: nonzero charges, distinct points and positive arrow length required");
  const direction = Math.sign(signA) !== Math.sign(signB) ? 1 : -1;
  const onA = { x: direction * (b.x - a.x) / distance * arrowLength, y: direction * (b.y - a.y) / distance * arrowLength };
  return { onA, onB: { x: -onA.x, y: -onA.y }, interaction: direction === 1 ? "attraction" as const : "repulsion" as const };
}

export function validateElectrostaticRods(m: ElectrostaticRodsModel): void {
  validateScene2D({ ...m, shapes: [] });
  for (const rod of [m.suspended, m.nearby]) {
    if (![rod.from.x, rod.from.y, rod.to.x, rod.to.y, rod.radius].every(Number.isFinite) || rod.radius <= 0 || Math.hypot(rod.to.x - rod.from.x, rod.to.y - rod.from.y) <= rod.radius * 3) throw new Error("Electrostatics: invalid rod geometry");
    if (![-1, 1].includes(rod.charge) || !["rubber", "glass", "metal"].includes(rod.material)) throw new Error("Electrostatics: invalid material or charge sign");
    const region = rod.chargeRegion ?? [0.08, 0.92];
    if (!region.every(Number.isFinite) || region[0] < 0 || region[1] > 1 || region[0] >= region[1]) throw new Error("Electrostatics: charge region must be ordered within [0,1]");
    const count = rod.chargeCount ?? 7;
    if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error("Electrostatics: charge count must be 1..30");
    if (rod.forceFraction !== undefined && (!Number.isFinite(rod.forceFraction) || rod.forceFraction < 0 || rod.forceFraction > 1)) throw new Error("Electrostatics: force fraction must be in [0,1]");
    for (const p of [rod.from, rod.to]) if (p.x - rod.radius < m.world.xMin || p.x + rod.radius > m.world.xMax || p.y - rod.radius < m.world.yMin || p.y + rod.radius > m.world.yMax) throw new Error("Electrostatics: rods must fit within world bounds");
  }
  const { anchor, fork, attachments } = m.suspension;
  if (![anchor.x, anchor.y, fork.x, fork.y, ...attachments].every(Number.isFinite) || attachments[0] < 0 || attachments[1] > 1 || attachments[0] >= attachments[1]) throw new Error("Electrostatics: invalid suspension");
  if (anchor.y <= fork.y || attachments.some(t => point(m.suspended, t, m.suspended.radius).y >= fork.y)) throw new Error("Electrostatics: support and fork must be above the suspended rod");
  const pointDistance=(p:Vec2,r:ChargedRod)=>{
    const dx=r.to.x-r.from.x,dy=r.to.y-r.from.y;
    const t=Math.max(0,Math.min(1,((p.x-r.from.x)*dx+(p.y-r.from.y)*dy)/(dx*dx+dy*dy)));
    return Math.hypot(p.x-r.from.x-t*dx,p.y-r.from.y-t*dy);
  };
  const cross=(a:Vec2,b:Vec2,c:Vec2)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const a=m.suspended,b=m.nearby;
  const intersects=cross(a.from,a.to,b.from)*cross(a.from,a.to,b.to)<0 && cross(b.from,b.to,a.from)*cross(b.from,b.to,a.to)<0;
  const gap=Math.min(pointDistance(a.from,b),pointDistance(a.to,b),pointDistance(b.from,a),pointDistance(b.to,a))-a.radius-b.radius;
  if(intersects || gap<=0) throw new Error("Electrostatics: rods must be separated");
}

export function defaultElectrostaticRods(): ElectrostaticRodsModel {
  return {
    width: 900, height: 760, world: { xMin: 0, xMax: 900, yMin: 0, yMax: 760 },
    suspended: { from: { x: 300, y: 310 }, to: { x: 700, y: 397 }, radius: 21, material: "rubber", label: "Rubber", charge: -1, chargeRegion: [0.04, 0.29], chargeCount: 5, forceFraction: 0.12 },
    nearby: { from: { x: 155, y: 150 }, to: { x: 435, y: 211 }, radius: 19, material: "glass", label: "Glass", charge: 1, chargeRegion: [0.07, 0.93], chargeCount: 9, forceFraction: 0.90 },
    suspension: { anchor: { x: 505, y: 650 }, fork: { x: 505, y: 480 }, attachments: [0.34, 0.69] },
    showRotationCue: true,
  };
}

export function renderElectrostaticRods(m: ElectrostaticRodsModel): string {
  validateElectrostaticRods(m);
  const scene = { ...m, shapes: [] }, t = sceneTransform(scene);
  const pv = (p: Vec2) => worldToView(scene, p);
  const out: SvgElement[] = [];
  const scale = Math.min(t.sx, t.sy);
  const serif = "Georgia, 'Times New Roman', serif";
  const rodDefs = `<linearGradient id="rod-rubber" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c9396"/><stop offset="0.24" stop-color="#e9edee"/><stop offset="0.46" stop-color="#f9faf9"/><stop offset="0.8" stop-color="#a4abad"/><stop offset="1" stop-color="#707b80"/></linearGradient>
<linearGradient id="rod-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#87c2d1"/><stop offset="0.22" stop-color="#eafaff"/><stop offset="0.48" stop-color="#f9ffff"/><stop offset="0.8" stop-color="#c6e9ef"/><stop offset="1" stop-color="#8abecb"/></linearGradient>
<linearGradient id="rod-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d8490"/><stop offset="0.4" stop-color="#f2f6f7"/><stop offset="1" stop-color="#82949d"/></linearGradient>
<linearGradient id="support" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f1eb"/><stop offset="1" stop-color="#a9a398"/></linearGradient>`;
  const svgLine = (a: Vec2, b: Vec2, color = "#6c706e", width = 1.8) => { const p = pv(a), q = pv(b); out.push(line(p.x, p.y, q.x, q.y, color, width * scale)); };
  const anchor = pv(m.suspension.anchor), fork = pv(m.suspension.fork);
  // Suspension lives behind the rod; collars are painted on its front later.
  const beamWidth = (m.world.xMax - m.world.xMin) * 0.47 * scale;
  out.push(el("rect", { x: anchor.x - beamWidth / 2, y: anchor.y - 22 * scale, width: beamWidth, height: 22 * scale, rx: 1.5 * scale, fill: "url(#support)" }));
  out.push(line(anchor.x - beamWidth / 2, anchor.y, anchor.x + beamWidth / 2, anchor.y, "#8d8b81", 1.4 * scale));
  out.push(line(anchor.x, anchor.y, fork.x, fork.y, "#737773", 1.8 * scale));
  for (const f of m.suspension.attachments) svgLine(m.suspension.fork, point(m.suspended, f, m.suspended.radius));

  const drawRod = (r: ChargedRod, suspended: boolean) => {
    const a = pv(r.from), b = pv(r.to), length = Math.hypot(b.x - a.x, b.y - a.y), radius = r.radius * scale, cap = radius * 0.4;
    const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const children: SvgElement[] = [];
    const outline = `M 0 ${-radius} L ${length} ${-radius} A ${cap} ${radius} 0 0 1 ${length} ${radius} L 0 ${radius} A ${cap} ${radius} 0 0 1 0 ${-radius} Z`;
    children.push(el("path", { d: outline, fill: `url(#rod-${r.material})`, stroke: r.material === "glass" ? "#84b8c6" : "#737c80", "stroke-width": 1.4 * scale }));
    children.push(el("ellipse", { cx: 0, cy: 0, rx: cap, ry: radius, fill: r.material === "glass" ? "#daeff1" : "#c7cdce", stroke: r.material === "glass" ? "#95c2cc" : "#879194", "stroke-width": scale }));
    children.push(line(cap * 1.5, -radius * 0.68, length - cap, -radius * 0.68, "#fff", 1.3 * scale));
    const region = r.chargeRegion ?? [0.08, 0.92], count = r.chargeCount ?? 7;
    for (let i = 0; i < count; i++) {
      const x = length * (count === 1 ? (region[0] + region[1]) / 2 : region[0] + (region[1] - region[0]) * i / (count - 1));
      children.push(text(x, 5 * scale, r.charge > 0 ? "+" : "−", r.material === "glass" ? "#538492" : "#39454a", 21 * scale, "middle", serif));
    }
    if (suspended) for (const f of m.suspension.attachments) {
      const x = f * length;
      children.push(el("path", { d: `M ${x} ${-radius} C ${x + radius * 0.55} ${-radius * 0.45} ${x + radius * 0.55} ${radius * 0.45} ${x} ${radius}`, stroke: "#666c6a", fill: "none", "stroke-width": 1.6 * scale }));
    }
    out.push(el("g", { "data-rod": suspended ? "suspended" : "nearby", transform: `translate(${a.x} ${a.y}) rotate(${angle})` }, children));
    const label = suspended ? point(r, 0.79, r.radius + 22) : point(r, 1, 0);
    const lp = pv(label);
    out.push(text(lp.x + (suspended ? 0 : 34 * scale), lp.y, r.label, "#272d30", 26 * scale, suspended ? "middle" : "start", serif));
  };
  drawRod(m.suspended, true);
  drawRod(m.nearby, false);
  // Face the force application points toward the other rod.
  const aCenter = point(m.suspended, m.suspended.forceFraction ?? 0.15);
  const bCenter = point(m.nearby, m.nearby.forceFraction ?? 0.85);
  const facing = (r: ChargedRod, toward: Vec2, fraction: number) => {
    const c = point(r, fraction), n = point(r, fraction, 1);
    const face=m.suspended.charge===m.nearby.charge ? -1:1;
    return point(r, fraction, face*((toward.x - c.x) * (n.x - c.x) + (toward.y - c.y) * (n.y - c.y) >= 0 ? 1 : -1) * r.radius);
  };
  const a = facing(m.suspended, bCenter, m.suspended.forceFraction ?? 0.15), b = facing(m.nearby, aCenter, m.nearby.forceFraction ?? 0.85);
  const length = Math.hypot(b.x - a.x, b.y - a.y) * 0.34;
  const pair = electrostaticForcePair(m.suspended.charge, m.nearby.charge, a, b, length);
  for (const [i, p, v] of [[0, a, pair.onA], [1, b, pair.onB]] as const) {
    const start = pv(p), end = pv({ x: p.x + v.x, y: p.y + v.y });
    const dx = end.x - start.x, dy = end.y - start.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    out.push(el("line", { "data-force": i === 0 ? "on-suspended" : "on-nearby", x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: "#19aac8", "stroke-width": 3 * scale }));
    const h = Math.min(13 * scale, len * 0.4), half = h * 0.36;
    out.push(el("path", { d: `M ${end.x} ${end.y} L ${end.x - ux * h - uy * half} ${end.y - uy * h + ux * half} L ${end.x - ux * h + uy * half} ${end.y - uy * h - ux * half} Z`, fill: "#19aac8" }));
    out.push(text((start.x + end.x) / 2 - uy * 22 * scale, (start.y + end.y) / 2 + ux * 22 * scale, "F", "#2f444b", 24 * scale, "middle", serif, "bold"));
  }
  if (m.showRotationCue) {
    const cx = (anchor.x + fork.x) / 2, cy = anchor.y + (fork.y - anchor.y) * 0.44;
    const rx = 52 * scale, ry = 17 * scale;
    // A double-ended curved cue denotes freedom to turn, not predicted torque.
    out.push(el("path", { d: `M ${cx - rx * 0.75} ${cy - ry * 0.65} A ${rx} ${ry} 0 1 0 ${cx + rx * 0.75} ${cy - ry * 0.65}`, fill: "none", stroke: "#a9aeab", "stroke-width": 7 * scale }));
    for (const side of [-1, 1]) {
      const x = cx + side * rx * 0.75, y = cy - ry * 0.65;
      out.push(el("path", { d: `M ${x} ${y - 8 * scale} L ${x + side * 11 * scale} ${y + 8 * scale} L ${x - side * 10 * scale} ${y + 5 * scale} Z`, fill: "#a9aeab" }));
    }
    out.push(text(cx + 76 * scale, cy + 5 * scale, "free to rotate", "#737b79", 15 * scale, "start", serif));
  }
  if (m.title) out.push(text(m.width / 2, 34 * scale, m.title, "#27333a", 26 * scale, "middle", serif));
  out.push(text(m.width / 2, m.height - 62 * scale, pair.interaction === "attraction" ? "Opposite charges attract" : "Like charges repel", "#354c56", 23 * scale, "middle", serif));
  out.push(text(m.width / 2, m.height - 32 * scale, "Equal and opposite electric forces · qualitative diagram; suspension forces omitted", "#727c80", 13 * scale, "middle"));
  return renderSvg(el("g", {}, out), { width: m.width, height: m.height, background: "#fff", defs: rodDefs });
}

export function electrostaticRodsArtifact(m: ElectrostaticRodsModel, title = "Charged rods") {
  return withRendering(createArtifact({ kind: "electrostatics", title, model: m }), "svg", { format: "svg", content: renderElectrostaticRods(m), contentType: "image/svg+xml" });
}
