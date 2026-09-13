/** Ideal rope diagrams. Supported routes: a single fixed wheel (one load or
 * Atwood pair), two equal-height fixed wheels, or an explicitly anchored single
 * movable wheel. Unspecified compound routing is rejected rather than guessed. */
import { createArtifact, withRendering } from "../artifacts.js";
import { addShape, newScene2D, renderScene2D, validateScene2D } from "./scene2d.js";
import type { Scene2DModel } from "./scene2d.js";
import type { Vec2 } from "./primitives.js";
export interface PulleyModel {
  pulleys: {
    center: Vec2;
    radius: number;
    fixed: boolean;
    label?: string;
  }[];
  masses: {
    mass: number;
    position: Vec2;
    size: {
      w: number;
      h: number;
    };
    label?: string;
  }[];
  tension: number;
  configuration?: "fixed" | "atwood" | "movable";
  world: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  width: number;
  height: number;
  title?: string;
}
export function mechanicalAdvantage(m: PulleyModel): number {
  validatePulley(m);
  return m.configuration === "movable" ? 2 : 1;
}
export function atwoodDynamics(m1: number, m2: number, gravity = 9.81) {
  if (![m1, m2, gravity].every(n => Number.isFinite(n) && n > 0))
    throw new Error("Atwood: masses and gravity must be positive and finite");
  return { acceleration: (m2 - m1) * gravity / (m1 + m2), tension: 2 * m1 * m2 * gravity / (m1 + m2) };
}
export function validatePulley(m: PulleyModel): void {
  validateScene2D({ ...m, shapes: [] });
  if (!m.pulleys.length || !m.masses.length)
    throw new Error("Pulley: needs a pulley and a mass");
  if (!Number.isFinite(m.tension) || m.tension < 0)
    throw new Error("Pulley: tension must be finite and nonnegative");
  for (const p of m.pulleys)
    if (![p.center.x, p.center.y, p.radius].every(Number.isFinite) || p.radius <= 0)
      throw new Error("Pulley: invalid wheel geometry");
  for (const p of m.masses)
    if (![p.mass, p.position.x, p.position.y, p.size.w, p.size.h].every(Number.isFinite) || p.mass <= 0 || p.size.w <= 0 || p.size.h <= 0)
      throw new Error("Pulley: invalid mass or body geometry");
  if (m.configuration === "movable") {
    if (m.pulleys.length !== 1 || m.pulleys[0].fixed || m.masses.length !== 1)
      throw new Error("Pulley: movable route needs one moving wheel and one load");
    const p = m.pulleys[0], mass = m.masses[0];
    if (Math.abs(mass.position.x - p.center.x) > 1e-9 || mass.position.y + mass.size.h / 2 >= p.center.y - p.radius)
      throw new Error("Pulley: movable load must hang below its wheel on the axle");
  }
  else {
    if (m.pulleys.some(p => !p.fixed) || m.pulleys.length > 2 || m.masses.length > 2 || (m.pulleys.length === 2 && m.masses.length !== 2))
      throw new Error("Pulley: compound routing is unsupported; specify a supported fixed or single movable route");
    if (m.pulleys.length === 2) {
      const [a, b] = m.pulleys;
      if (Math.abs(a.center.y + a.radius - b.center.y - b.radius) > 1e-9 || Math.abs(a.center.x - b.center.x) <= a.radius + b.radius)
        throw new Error("Pulley: two fixed wheels must have aligned top tangents and be separated");
    }
    if (m.masses.length === 2 && m.masses[0].position.x >= m.masses[1].position.x)
      throw new Error("Pulley: masses must be ordered left to right with distinct positions");
  }
}
/** Tangency from a point outside a circle; choose the left or right contact. */
export function pulleyTangent(point: Vec2, center: Vec2, radius: number, side: "left" | "right"): Vec2 {
  const dx = point.x - center.x, dy = point.y - center.y, d2 = dx * dx + dy * dy;
  if (d2 <= radius * radius)
    throw new Error("Pulley: rope endpoint must be outside wheel");
  const a = radius * radius / d2, b = radius * Math.sqrt(d2 - radius * radius) / d2;
  const pts = [{ x: center.x + a * dx - b * dy, y: center.y + a * dy + b * dx }, { x: center.x + a * dx + b * dy, y: center.y + a * dy - b * dx }];
  return pts.sort((a, b) => a.x - b.x)[side === "left" ? 0 : 1];
}
export function buildSceneFromPulley(m: PulleyModel): Scene2DModel {
  validatePulley(m);
  const s = newScene2D({ width: m.width, height: m.height, world: m.world, title: m.title, padding: { left: 18, right: 18, top: 28, bottom: 32 } });
  s.caption = "Ideal rope · uniform tension T = " + m.tension.toFixed(2) + " N · geometry schematic";
  const ceiling = m.world.yMax - (m.world.yMax - m.world.yMin) * 0.045;
  const segment = (from: Vec2, to: Vec2, color = "#555", width = 1.5) => addShape(s, { kind: "segment", from, to, color, width });
  segment({ x: m.world.xMin, y: ceiling }, { x: m.world.xMax, y: ceiling }, "#888", 3);
  for (const p of m.pulleys) {
    if (p.center.y + p.radius >= ceiling)
      throw new Error("Pulley: wheel must be below support");
    if (p.fixed)
      segment({ x: p.center.x, y: ceiling }, p.center, "#888", 2);
    addShape(s, { kind: "circle", center: p.center, r: p.radius, fill: "#e8edef", stroke: "#65757d" });
    addShape(s, { kind: "point", at: p.center, color: "#65757d", label: p.label });
  }
  if (m.configuration === "movable") {
    const p = m.pulleys[0], mass = m.masses[0];
    segment({ x: p.center.x - p.radius, y: ceiling }, { x: p.center.x - p.radius, y: p.center.y });
    addShape(s, { kind: "arc", center: p.center, r: p.radius, fromDeg: 180, toDeg: 360, color: "#444", width: 1.5 });
    const end = { x: p.center.x + p.radius, y: ceiling - 0.25 };
    segment({ x: p.center.x + p.radius, y: p.center.y }, end);
    addShape(s, { kind: "vector", at: end, v: { x: 0, y: 0.2 }, label: "effort", color: "#237f9b" });
    segment(p.center, { x: mass.position.x, y: mass.position.y + mass.size.h / 2 });
  }
  else {
    const wheels = [...m.pulleys].sort((a, b) => a.center.x - b.center.x), left = wheels[0], right = wheels.at(-1)!;
    const a = m.masses[0], b = m.masses[1];
    const start = { x: a.position.x, y: a.position.y + a.size.h / 2 };
    const end = b ? { x: b.position.x, y: b.position.y + b.size.h / 2 } : { x: right.center.x + right.radius + 0.5, y: start.y };
    if (start.y >= left.center.y - left.radius || end.y >= right.center.y - right.radius)
      throw new Error("Pulley: hanging endpoints must be below wheels");
    const contactA = pulleyTangent(start, left.center, left.radius, "left"), contactB = pulleyTangent(end, right.center, right.radius, "right");
    segment(start, contactA);
    segment(contactB, end);
    const angle = (p: Vec2, c: Vec2) => Math.atan2(p.y - c.y, p.x - c.x) * 180 / Math.PI;
    const aa = angle(contactA, left.center), bb = angle(contactB, right.center);
    if (wheels.length === 1)
      addShape(s, { kind: "arc", center: left.center, r: left.radius, fromDeg: aa < 0 ? aa + 360 : aa, toDeg: bb, color: "#444", width: 1.5 });
    else {
      addShape(s, { kind: "arc", center: left.center, r: left.radius, fromDeg: aa < 0 ? aa + 360 : aa, toDeg: 90, color: "#444", width: 1.5 });
      segment({ x: left.center.x, y: left.center.y + left.radius }, { x: right.center.x, y: right.center.y + right.radius });
      addShape(s, { kind: "arc", center: right.center, r: right.radius, fromDeg: 90, toDeg: bb, color: "#444", width: 1.5 });
    }
    if (!b)
      addShape(s, { kind: "vector", at: end, v: { x: 0, y: -0.3 }, label: "effort", color: "#237f9b" });
  }
  for (const mass of m.masses) {
    addShape(s, { kind: "rect", origin: { x: mass.position.x - mass.size.w / 2, y: mass.position.y - mass.size.h / 2 }, size: mass.size, fill: "#d6e1e6", stroke: "#586d78" });
    addShape(s, { kind: "label", at: { x: mass.position.x, y: mass.position.y - mass.size.h / 2 }, offset: { dx: 0, dy: 18 }, text: mass.label ?? mass.mass + " kg", anchor: "middle" });
  }
  return s;
}
export function renderPulley(m: PulleyModel): string { return renderScene2D(buildSceneFromPulley(m)); }
export function pulleyArtifact(m: PulleyModel, title = "Pulley system") {
  return withRendering(createArtifact({ kind: "pulley", title, model: m }), "svg", { format: "svg", content: renderPulley(m), contentType: "image/svg+xml" });
}
