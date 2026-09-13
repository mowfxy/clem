/**
 * Optics ray diagrams. Supports mirrors (plane, concave, convex) and thin
 * lenses (converging, diverging). The renderer draws the principal axis,
 * the optical element, the object, image, and the principal/focal rays.
 */
import { createArtifact, withRendering } from "../artifacts.js";
import { addShape, newScene2D, renderScene2D, validateScene2D } from "./scene2d.js";
import type { Scene2DModel } from "./scene2d.js";
import type { Vec2 } from "./primitives.js";
export type OpticalElement = {
  kind: "plane-mirror";
  x: number;
  yMin: number;
  yMax: number;
} | {
  kind: "concave-mirror";
  x: number;
  y: number;
  focal: number;
  radius: number;
} | {
  kind: "convex-mirror";
  x: number;
  y: number;
  focal: number;
  radius: number;
} | {
  kind: "thin-lens-converging";
  x: number;
  y: number;
  focal: number;
} | {
  kind: "thin-lens-diverging";
  x: number;
  y: number;
  focal: number;
};
export interface OpticsModel {
  element: OpticalElement;
  /** Object arrow: base at axis, tip at objectHeight. */
  objectHeight: number;
  objectBase: Vec2;
  /** Auto compute image via lens/mirror equation; only for lens/mirror. */
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
export interface OpticsResult {
  atInfinity: boolean;
  virtual: boolean;
  imageHeight: number;
  imageBase: Vec2;
  magnification: number;
  rayPath: {
    from: Vec2;
    to: Vec2;
    color?: string;
    dashed?: boolean;
  }[];
}
const EPS = 1e-9;
const isMirror = (m: OpticsModel) => m.element.kind.includes("mirror");
const axis = (m: OpticsModel) => m.element.kind === "plane-mirror" ? m.objectBase.y : m.element.y;
export function validateOptics(m: OpticsModel): void {
  validateScene2D({ ...m, shapes: [] });
  if (![m.objectHeight, m.objectBase.x, m.objectBase.y, ...Object.values(m.element).filter(v => typeof v === "number")].every(Number.isFinite))
    throw new Error("Optics: parameters must be finite");
  if (m.element.x - m.objectBase.x <= 0)
    throw new Error("Optics: real object must be left of the optical element");
  if (m.objectHeight <= 0)
    throw new Error("Optics: object height must be positive");
  const e = m.element;
  if (e.kind === "plane-mirror") {
    if (e.yMax <= e.yMin)
      throw new Error("Optics: mirror aperture must be positive");
  }
  else {
    if (Math.abs(m.objectBase.y - e.y) > EPS)
      throw new Error("Optics: object base must lie on the principal axis");
    const positive = e.kind === "concave-mirror" || e.kind === "thin-lens-converging";
    if (e.focal === 0 || (e.focal > 0) !== positive)
      throw new Error("Optics: focal sign must match the element");
    if ("radius" in e && (e.radius <= 0 || Math.abs(e.radius - 2 * Math.abs(e.focal)) > EPS * Math.max(1, e.radius)))
      throw new Error("Optics: spherical mirror radius must equal 2*abs(focal)");
  }
}
export type OpticsRay = OpticsResult["rayPath"][number];
/** Clip straight rays before emitting SVG coordinates. */
export function clipOpticsRay(ray: OpticsRay, w: OpticsModel["world"]): OpticsRay | undefined {
  let lo = 0, hi = 1;
  for (const [a, d, min, max] of [[ray.from.x, ray.to.x - ray.from.x, w.xMin, w.xMax], [ray.from.y, ray.to.y - ray.from.y, w.yMin, w.yMax]]) {
    if (Math.abs(d) < EPS) {
      if (a < min || a > max)
        return;
    }
    else {
      const t0 = (min - a) / d, t1 = (max - a) / d;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
  }
  if (lo >= hi)
    return;
  const at = (t: number) => ({ x: ray.from.x + t * (ray.to.x - ray.from.x), y: ray.from.y + t * (ray.to.y - ray.from.y) });
  return { ...ray, from: at(lo), to: at(hi) };
}
/** Ideal paraxial optics, with a real object to the left. Mirror outlines are
 * schematic; interactions take place at the vertex plane in this approximation. */
export function lensImage(m: OpticsModel): OpticsResult {
  validateOptics(m);
  const e = m.element, u = e.x - m.objectBase.x, y = axis(m), h = m.objectHeight, mirror = isMirror(m);
  const invV = e.kind === "plane-mirror" ? -1 / u : 1 / e.focal - 1 / u;
  const atInfinity = Math.abs(invV) < EPS / Math.max(1, u);
  const v = atInfinity ? Infinity : 1 / invV;
  const mag = e.kind === "plane-mirror" ? 1 : -v / u;
  const result: OpticsResult = { imageHeight: mag * h, imageBase: { x: e.x + (mirror ? -v : v), y }, magnification: mag, virtual: v < 0, atInfinity, rayPath: [] };
  const tip = { x: m.objectBase.x, y: y + h };
  const push = (from: Vec2, to: Vec2, color: string, dashed = false) => { const r = clipOpticsRay({ from, to, color, dashed }, m.world); if (r)
    result.rayPath.push(r); };
  // A parallel ray and an optical-center/vertex ray determine the image.
  const hits = e.kind === "plane-mirror" ? [{ x: e.x, y: y + h * 0.25 }, { x: e.x, y: y + h * 1.35 }] : [{ x: e.x, y: y + h }, { x: e.x, y }];
  hits.forEach((hit, i) => {
    if (e.kind === "plane-mirror" && (hit.y < e.yMin || hit.y > e.yMax))
      return;
    const color = i === 0 ? "#ba4b37" : "#2679a0";
    push(tip, hit, color);
    const slope = e.kind === "plane-mirror" ? -(hit.y - tip.y) / u : i === 0 ? (mirror ? h / e.focal : -h / e.focal) : (mirror ? h / u : -h / u);
    const endX = mirror ? m.world.xMin : m.world.xMax;
    push(hit, { x: endX, y: hit.y + slope * (endX - hit.x) }, color);
    if (result.virtual)
      push(hit, { x: result.imageBase.x, y: y + result.imageHeight }, color, true);
  });
  return result;
}
export function buildSceneFromOptics(m: OpticsModel): Scene2DModel {
  const r = lensImage(m), e = m.element, y = axis(m);
  const s = newScene2D({ width: m.width, height: m.height, world: m.world, title: m.title, padding: { left: 24, right: 24, top: 32, bottom: 38 }, caption: "Paraxial model · solid: light rays · dashed: backward extensions" });
  const span = m.world.yMax - m.world.yMin, tick = span * 0.018;
  addShape(s, { kind: "segment", from: { x: m.world.xMin, y }, to: { x: m.world.xMax, y }, color: "#a0a0a0" });
  if (e.kind === "plane-mirror") {
    addShape(s, { kind: "segment", from: { x: e.x, y: e.yMin }, to: { x: e.x, y: e.yMax }, color: "#50616b", width: 3 });
    for (let k = 0; k < 12; k++) {
      const yy = e.yMin + (e.yMax - e.yMin) * k / 12;
      addShape(s, { kind: "segment", from: { x: e.x, y: yy }, to: { x: e.x + tick * 2, y: yy + tick }, color: "#8a969c" });
    }
  }
  else {
    if (isMirror(m)) {
      // A paraxial mirror symbol has a straight interaction plane with curved
      // ends indicating concavity. Rays attach to that plane, not to a separate
      // spherical outline that would imply exact non-paraxial ray tracing.
      const half = Math.max(m.objectHeight * 1.75, span * 0.22), flat = half * 0.65, curl = (e.focal > 0 ? -1 : 1) * half * 0.12;
      addShape(s, { kind: "path", d: "M " + (e.x + curl) + " " + (y + half) + " Q " + e.x + " " + (y + half) + " " + e.x + " " + (y + flat) + " L " + e.x + " " + (y - flat) + " Q " + e.x + " " + (y - half) + " " + (e.x + curl) + " " + (y - half), stroke: "#526873", width: 2.5 });
    }
    else {
      const half = Math.max(Math.min(m.objectHeight * 1.3, span * 0.38), span * 0.2);
      addShape(s, { kind: "segment", from: { x: e.x, y: y - half }, to: { x: e.x, y: y + half }, color: "#526873", width: 2 });
      for (const sign of [-1, 1]) {
        const yy = y + sign * half, delta = sign * (e.focal > 0 ? -1 : 1) * tick * 2;
        addShape(s, { kind: "path", d: "M " + (e.x - tick * 1.5) + " " + (yy + delta) + " L " + e.x + " " + yy + " L " + (e.x + tick * 1.5) + " " + (yy + delta), stroke: "#526873", width: 2 });
      }
    }
    const foci = isMirror(m) ? [{ x: e.x - e.focal, label: "F" }, { x: e.x - 2 * e.focal, label: "C" }] : [{ x: e.x - Math.abs(e.focal), label: "F" }, { x: e.x + Math.abs(e.focal), label: "F′" }];
    for (const f of foci)
      if (f.x > m.world.xMin && f.x < m.world.xMax) {
        addShape(s, { kind: "segment", from: { x: f.x, y: y - tick }, to: { x: f.x, y: y + tick }, color: "#666" });
        addShape(s, { kind: "label", at: { x: f.x, y: y - 3 * tick }, text: f.label, anchor: "middle", size: 12 });
      }
  }
  for (const ray of r.rayPath) {
    addShape(s, { kind: "segment", ...ray, width: 1.3 });
    if (!ray.dashed) {
      const dx = ray.to.x - ray.from.x, dy = ray.to.y - ray.from.y;
      addShape(s, { kind: "vector", at: { x: ray.from.x + dx * 0.48, y: ray.from.y + dy * 0.48 }, v: { x: dx * 0.12, y: dy * 0.12 }, color: ray.color });
    }
  }
  addShape(s, { kind: "vector", at: m.objectBase, v: { x: 0, y: m.objectHeight }, color: "#333" });
  addShape(s, { kind: "label", at: { x: m.objectBase.x, y: y + m.objectHeight }, offset: { dx: -8, dy: -12 }, anchor: "end", text: "object" });
  if (!r.atInfinity) {
    const tip = { x: r.imageBase.x, y: y + r.imageHeight };
    if (tip.x >= m.world.xMin && tip.x <= m.world.xMax && tip.y >= m.world.yMin && tip.y <= m.world.yMax) {
      addShape(s, { kind: "vector", at: r.imageBase, v: { x: 0, y: r.imageHeight }, color: "#38775c", dashed: r.virtual });
      addShape(s, { kind: "label", at: tip, offset: { dx: 8, dy: r.imageHeight < 0 ? 18 : -12 }, text: r.virtual ? "virtual image" : "real image", size: 12 });
    }
    else
      s.caption = "Image outside viewport: enlarge world bounds · paraxial model";
  }
  else
    s.caption = "Object at focus: outgoing rays parallel; image at infinity · paraxial model";
  return s;
}
export function renderOptics(m: OpticsModel): string { return renderScene2D(buildSceneFromOptics(m)); }
export function opticsArtifact(m: OpticsModel, title = "Optics diagram") {
  return withRendering(createArtifact({ kind: "optics", title, model: m }), "svg", { format: "svg", content: renderOptics(m), contentType: "image/svg+xml" });
}
