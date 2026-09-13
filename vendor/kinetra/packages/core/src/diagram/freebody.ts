/**
 * Free-body diagram. The canonical model is a structured physical scene:
 * a body, a coordinate frame, applied forces (vector with magnitude, direction,
 * application point), and a list of constraint normals / frictions. The
 * renderer derives vector components from the structured model.
 */

import { createArtifact, withRendering } from "../artifacts.js";
import { addShape, newScene2D, renderScene2D } from "./scene2d.js";
import type { Scene2DModel } from "./scene2d.js";
import type { Vec2, Color } from "./primitives.js";

export interface FBDModel {
  /** Position of the body (centroid) in world coordinates. */
  bodyPosition: Vec2;
  /** Size of the body (used for rendering a labeled box). */
  bodySize: { w: number; h: number };
  /** Body label. */
  bodyLabel?: string;
  /** Coordinate frame orientation in degrees. 0 means +x right, +y up. */
  frameAngleDeg: number;
  /** World units per unit force. Defaults to one common scale that fits. */
  forceScale?: number;
  showComponents?: boolean;
  bodyAngleDeg?: number;
  /** Forces in world coordinates. */
  forces: FBDForce[];
  /** Optional constraint normals (e.g., wall reaction). */
  constraints?: FBDConstraint[];
  /** Optional velocity vector. */
  velocity?: Vec2;
  /** Optional acceleration vector. */
  acceleration?: Vec2;
  /** Optional dimensions. */
  dimensions?: { from: Vec2; to: Vec2; label: string }[];
  /** Optional annotations. */
  annotations?: { at: Vec2; text: string }[];
  /** Frame labels. */
  frameLabels?: { x: string; y: string };
  /** World bounds for the view. */
  world: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** Viewport size. */
  width: number; height: number;
}

export interface FBDForce {
  /** Application point (world coords). */
  point: Vec2;
  /** Vector components in world coordinates. */
  components: Vec2;
  /** Force magnitude (used for the label). */
  magnitude: number;
  /** Unit symbol. */
  unit: string;
  /** Label. Defaults to "F" + index. */
  label?: string;
  color?: Color;
}

export interface FBDConstraint {
  kind: "surface" | "wall-v" | "wall-h" | "string" | "spring";
  /** Reference point on the body where the constraint applies. */
  point: Vec2;
  /** Reference point outside the body. */
  externalPoint: Vec2;
  label?: string;
}

const DEG = Math.PI / 180;

export function validateFBD(m: FBDModel): void {
  if (![m.bodyPosition.x, m.bodyPosition.y, m.bodySize.w, m.bodySize.h, m.frameAngleDeg, m.bodyAngleDeg ?? 0].every(Number.isFinite)) throw new Error("FBD: body and frame must be finite");
  if (m.forceScale !== undefined && (!Number.isFinite(m.forceScale) || m.forceScale <= 0)) throw new Error("FBD: forceScale must be positive and finite");
  if (m.bodySize.w <= 0 || m.bodySize.h <= 0) throw new Error("FBD: body size must be positive");
  for (const f of m.forces) {
    if (![f.point.x, f.point.y, f.components.x, f.components.y, f.magnitude].every(Number.isFinite) || f.magnitude < 0) throw new Error("FBD: forces must be finite with nonnegative magnitude");
    if (Math.abs(magnitudeFromComponents(f.components) - f.magnitude) > 1e-6 * Math.max(1, f.magnitude)) {
      throw new Error(`FBD: force ${f.label ?? ""} magnitude ${f.magnitude} != components |${f.components.x}|${f.components.y}|`);
    }
  }
}

export function magnitudeFromComponents(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function componentsFromPolar(magnitude: number, angleDeg: number): Vec2 {
  return { x: magnitude * Math.cos(angleDeg * DEG), y: magnitude * Math.sin(angleDeg * DEG) };
}

export function angleFromComponents(v: Vec2): number {
  return (Math.atan2(v.y, v.x) / DEG + 360) % 360;
}

export function buildSceneFromFBD(m: FBDModel): Scene2DModel {
  validateFBD(m);
  const maxForce = Math.max(1, ...m.forces.map(f => f.magnitude));
  let fittedScale = Math.min(m.world.xMax-m.world.xMin, m.world.yMax-m.world.yMin)*0.27/maxForce;
  for (const f of m.forces) for (const [p,v,min,max] of [[f.point.x,f.components.x,m.world.xMin,m.world.xMax],[f.point.y,f.components.y,m.world.yMin,m.world.yMax]]) {
    if (v !== 0) fittedScale = Math.min(fittedScale, Math.max(0, (v > 0 ? max-p:p-min)*0.8/Math.abs(v)));
  }
  if (fittedScale <= 0) throw new Error("FBD: force application points must lie inside world bounds");
  const forceScale=m.forceScale ?? fittedScale;
  const s = newScene2D({ width: m.width, height: m.height, world: m.world });
  s.caption = "Force arrows share one scale; components refer to the displayed frame";
  // Body box
  if (m.bodyAngleDeg) {
    const a=m.bodyAngleDeg*DEG;
    addShape(s,{kind:"polygon",points:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:m.bodyPosition.x+x*m.bodySize.w/2*Math.cos(a)-y*m.bodySize.h/2*Math.sin(a),y:m.bodyPosition.y+x*m.bodySize.w/2*Math.sin(a)+y*m.bodySize.h/2*Math.cos(a)})),fill:"#cfe4ff",stroke:"#1f4f8b"});
  } else addShape(s, { kind: "rect", origin: { x: m.bodyPosition.x - m.bodySize.w / 2, y: m.bodyPosition.y - m.bodySize.h / 2 }, size: m.bodySize, fill: "#cfe4ff", stroke: "#1f4f8b" });
  if (m.bodyLabel) {
    // Place the body label BELOW the body box. The view y-axis points down,
    // so "below in view" corresponds to bodyPos.y - h/2 in world (the bottom
    // of the body in world coords, which maps to the bottom of the rect in
    // view). An additional dy:+16 pushes the baseline 16 px further down in
    // view, clearing the rect.
    addShape(s, { kind: "label", at: { x: m.bodyPosition.x, y: m.bodyPosition.y - m.bodySize.h / 2 }, text: m.bodyLabel, color: "#1f4f8b", size: 13, anchor: "middle", offset: { dx: 0, dy: 16 } });
  }
  // Coordinate frame at body center
  const ax = m.frameAngleDeg;
  // Frame arrow radius: extend outside the body but stay within world bounds.
  // Use min(bodySize*0.6, quarter-world-span) so very large bodies still fit.
  const xSpan = m.world.xMax - m.world.xMin;
  const ySpan = m.world.yMax - m.world.yMin;
  const maxR = Math.min(xSpan, ySpan) * 0.35;
  const r = Math.min(Math.max(m.bodySize.w, m.bodySize.h) * 0.6 + 4, maxR);
  const tipX = { x: m.bodyPosition.x + r * Math.cos(ax * DEG), y: m.bodyPosition.y + r * Math.sin(ax * DEG) };
  const tipY = { x: m.bodyPosition.x + r * Math.cos((ax + 90) * DEG), y: m.bodyPosition.y + r * Math.sin((ax + 90) * DEG) };
  addShape(s, { kind: "vector", at: m.bodyPosition, v: { x: tipX.x - m.bodyPosition.x, y: tipX.y - m.bodyPosition.y }, label: m.frameLabels?.x ?? "x", color: "#66717a", dashed:true });
  addShape(s, { kind: "vector", at: m.bodyPosition, v: { x: tipY.x - m.bodyPosition.x, y: tipY.y - m.bodyPosition.y }, label: m.frameLabels?.y ?? "y", color: "#66717a", dashed:true });
  // Forces
  m.forces.forEach((f, i) => {
    const v={x:f.components.x*forceScale,y:f.components.y*forceScale};
    if (m.showComponents) {
      const a=m.frameAngleDeg*DEG, projection=v.x*Math.cos(a)+v.y*Math.sin(a);
      const corner={x:f.point.x+projection*Math.cos(a),y:f.point.y+projection*Math.sin(a)};
      addShape(s,{kind:"segment",from:f.point,to:corner,color:"#aaa",dashed:true});
      addShape(s,{kind:"segment",from:corner,to:{x:f.point.x+v.x,y:f.point.y+v.y},color:"#aaa",dashed:true});
    }
    addShape(s, { kind: "vector", at: f.point, v, label: (f.label ?? `F${i + 1}`) + ` = ${f.magnitude.toFixed(2)} ${f.unit}`, color: f.color ?? "#c0392b" });
  });
  // Constraints
  for (const c of m.constraints ?? []) {
    addShape(s, { kind: "segment", from: c.point, to: c.externalPoint, color: "#666", width: 1, dashed: c.kind !== "surface" });
    if (c.kind === "surface") {
      // Draw a hatched surface
      const dir = { x: c.externalPoint.x - c.point.x, y: c.externalPoint.y - c.point.y };
      const len = Math.hypot(dir.x, dir.y) || 1;
      const nx = -dir.y / len;
      const ny = dir.x / len;
      const o = c.externalPoint;
      for (let k = 0; k < 6; k++) {
        const t = k * 0.1;
        const a = { x: o.x + t * dir.x + t * 0.2 * nx, y: o.y + t * dir.y + t * 0.2 * ny };
        const b = { x: o.x + t * dir.x + (t * 0.2 + 0.1) * nx, y: o.y + t * dir.y + (t * 0.2 + 0.1) * ny };
        addShape(s, { kind: "segment", from: a, to: b, color: "#666", width: 1 });
      }
    }
  }
  if (m.velocity) addShape(s, { kind: "vector", at: m.bodyPosition, v: m.velocity, label: "v", color: "#117a3a" });
  if (m.acceleration) addShape(s, { kind: "vector", at: m.bodyPosition, v: m.acceleration, label: "a", color: "#7a3a11" });
  for (const d of m.dimensions ?? []) {
    addShape(s, { kind: "segment", from: d.from, to: d.to, color: "#444", width: 1 });
    addShape(s, { kind: "label", at: { x: (d.from.x + d.to.x) / 2, y: (d.from.y + d.to.y) / 2 }, text: d.label, color: "#444", size: 11, anchor: "middle" });
  }
  for (const a of m.annotations ?? []) {
    addShape(s, { kind: "label", at: a.at, text: a.text, color: "#333", size: 12, anchor: "middle" });
  }
  return s;
}

export function renderFBD(m: FBDModel): string {
  validateFBD(m);
  return renderScene2D(buildSceneFromFBD(m));
}

export function fbdArtifact(m: FBDModel, title = "Free-body diagram"): ReturnType<typeof createArtifact<"free-body", FBDModel>> {
  const a = createArtifact({ kind: "free-body", title, model: m });
  return withRendering(a, "svg", { format: "svg", content: renderFBD(m), contentType: "image/svg+xml" });
}
