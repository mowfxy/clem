/**
 * Vector and scalar fields. Renders 2D fields on a grid, sampling the
 * field at each cell, drawing arrows (vector field) or colour swatches
 * (scalar field). The renderer is deterministic.
 */
import { createArtifact, withRendering } from "../artifacts.js";
import { addShape, newScene2D, renderScene2D } from "./scene2d.js";
import type { Scene2DModel } from "./scene2d.js";
import type { Vec2 } from "./primitives.js";
export type ScalarField2D = (p: Vec2) => number;
export type VectorField2D = (p: Vec2) => Vec2;
export interface VectorFieldModel {
  type: "vector";
  field: VectorField2D;
  world: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  width: number;
  height: number;
  /** Grid resolution. */
  cols: number;
  rows: number;
  /** Arrow length scale in world units. */
  scale?: number;
  /** Direction-only arrows by default; magnitude mode uses one common scale. */
  encoding?: "direction" | "magnitude";
  /** Title. */
  title?: string;
}
export interface ScalarFieldModel {
  type: "scalar";
  field: ScalarField2D;
  world: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  width: number;
  height: number;
  cols: number;
  rows: number;
  title?: string;
  /** Optional contour levels. */
  contours?: number[];
}
export function validateVectorField(m: VectorFieldModel): void {
  validateGrid(m);
  if (m.scale !== undefined && (!Number.isFinite(m.scale) || m.scale <= 0))
    throw new Error("VectorField: scale must be positive and finite");
}
function validateGrid(m: {
  cols: number;
  rows: number;
}): void {
  if (![m.cols, m.rows].every(n => Number.isInteger(n) && n >= 2 && n <= 200))
    throw new Error("Field: cols/rows must be integers from 2 to 200");
}
function buildBase(m: {
  world: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  width: number;
  height: number;
  title?: string;
}): Scene2DModel {
  return newScene2D({ width: m.width, height: m.height, world: m.world, title: m.title, padding: { left: 30, right: 30, top: 42, bottom: 34 }, axes: { xLabel: "x", yLabel: "y", grid: true } });
}
export function renderVectorField(m: VectorFieldModel): string {
  validateVectorField(m);
  const s = buildBase(m);
  const dx = (m.world.xMax - m.world.xMin) / m.cols;
  const dy = (m.world.yMax - m.world.yMin) / m.rows;
  const scale = m.scale ?? Math.min(dx, dy) * 0.4;
  s.caption = m.encoding === "magnitude" ? "Arrow length = field magnitude × " + scale.toPrecision(3) : "Direction field · equal arrow lengths do not encode magnitude";
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const p = { x: m.world.xMin + (c + 0.5) * dx, y: m.world.yMin + (r + 0.5) * dy };
      let v: Vec2;
      try {
        v = m.field(p);
      }
      catch {
        continue;
      }
      const mag = Math.hypot(v.x, v.y);
      if (!Number.isFinite(mag) || mag === 0)
        continue;
      const len = m.encoding === "magnitude" ? scale * mag : scale;
      addShape(s, { kind: "vector", at: p, v: { x: (v.x / mag) * len, y: (v.y / mag) * len }, color: "#225", label: "" });
    }
  }
  return renderScene2D(s);
}
/** Piecewise-linear contours on a consistently triangulated grid. Shared
 * vertices are sampled once; saddle cells use the same diagonal throughout. */
export function scalarContours(m: ScalarFieldModel): {
  from: Vec2;
  to: Vec2;
  level: number;
}[] {
  validateGrid(m);
  if (!(m.contours ?? []).every(Number.isFinite))
    throw new Error("Field: contour levels must be finite");
  const dx = (m.world.xMax - m.world.xMin) / m.cols, dy = (m.world.yMax - m.world.yMin) / m.rows;
  const vertices = Array.from({ length: m.rows + 1 }, (_, r) => Array.from({ length: m.cols + 1 }, (_, c) => {
    const p = { x: m.world.xMin + c * dx, y: m.world.yMin + r * dy };
    return { p, v: sampleScalar(m, p) };
  }));
  const out: {
    from: Vec2;
    to: Vec2;
    level: number;
  }[] = [];
  const seen = new Set<string>();
  for (const level of m.contours ?? [])
    for (let r = 0; r < m.rows; r++)
      for (let c = 0; c < m.cols; c++) {
        const a = vertices[r][c], b = vertices[r][c + 1], d = vertices[r + 1][c], e = vertices[r + 1][c + 1];
        for (const tri of [[a, b, e], [a, e, d]]) {
          if (tri.some(v => !Number.isFinite(v.v)))
            continue;
          const points: Vec2[] = [];
          const add = (p: Vec2) => { if (!points.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-10))
            points.push(p); };
          for (let i = 0; i < 3; i++) {
            const v0 = tri[i], v1 = tri[(i + 1) % 3];
            if (v0.v === level)
              add(v0.p);
            if ((v0.v < level && v1.v > level) || (v0.v > level && v1.v < level)) {
              const t = (level - v0.v) / (v1.v - v0.v);
              add({ x: v0.p.x + t * (v1.p.x - v0.p.x), y: v0.p.y + t * (v1.p.y - v0.p.y) });
            }
          }
          if (points.length === 2 && Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) > 1e-10) {
            const key = level + ":" + points.map(p => p.x.toPrecision(12) + "," + p.y.toPrecision(12)).sort().join(";");
            if (!seen.has(key)) {
              seen.add(key);
              out.push({ from: points[0], to: points[1], level });
            }
          }
        }
      }
  return out;
}
function sampleScalar(m: ScalarFieldModel, p: Vec2): number { try {
  return m.field(p);
}
catch {
  return NaN;
} }
export function renderScalarField(m: ScalarFieldModel): string {
  validateGrid(m);
  const s = buildBase(m), dx = (m.world.xMax - m.world.xMin) / m.cols, dy = (m.world.yMax - m.world.yMin) / m.rows;
  const cells = [];
  for (let r = 0; r < m.rows; r++)
    for (let c = 0; c < m.cols; c++) {
      const p = { x: m.world.xMin + (c + 0.5) * dx, y: m.world.yMin + (r + 0.5) * dy };
      cells.push({ p, v: sampleScalar(m, p) });
    }
  const valid = cells.map(c => c.v).filter(Number.isFinite);
  const min = valid.length ? Math.min(...valid) : 0, max = valid.length ? Math.max(...valid) : 0;
  s.caption = valid.length ? (min === max ? "Constant field = " + min.toPrecision(3) + " (green)" : "blue = " + min.toPrecision(3) + " · red = " + max.toPrecision(3)) + " · gray = undefined" : "Field undefined throughout viewport";
  // Cells first, then axes/labels: leave the axis overlays visible.
  s.axes = undefined;
  for (const { p, v } of cells) {
    const fill = Number.isFinite(v) ? colorRamp(max === min ? 0.5 : (v - min) / (max - min)) : "#dedede";
    addShape(s, { kind: "rect", origin: { x: p.x - dx / 2, y: p.y - dy / 2 }, size: { w: dx, h: dy }, fill, stroke: fill });
  }
  for (const contour of scalarContours(m))
    addShape(s, { kind: "segment", from: contour.from, to: contour.to, color: "#222", width: 0.6 });
  return renderScene2D(s);
}
function colorRamp(t: number): string {
  const clamp = Math.max(0, Math.min(1, t));
  // Blue -> cyan -> green -> yellow -> red.
  const stops = [
    { t: 0, r: 33, g: 102, b: 172 },
    { t: 0.25, r: 67, g: 162, b: 208 },
    { t: 0.5, r: 122, g: 209, b: 81 },
    { t: 0.75, r: 247, g: 219, b: 60 },
    { t: 1, r: 215, g: 25, b: 28 },
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamp >= stops[i].t && clamp <= stops[i + 1].t) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const local = (clamp - a.t) / (b.t - a.t || 1);
  const r = Math.round(a.r + (b.r - a.r) * local);
  const g = Math.round(a.g + (b.g - a.g) * local);
  const bl = Math.round(a.b + (b.b - a.b) * local);
  return `rgb(${r},${g},${bl})`;
}
export function vectorFieldArtifact(m: VectorFieldModel, title = "Vector field"): ReturnType<typeof createArtifact<"vector-field", VectorFieldModel>> {
  const a = createArtifact({ kind: "vector-field", title, model: m });
  return withRendering(a, "svg", { format: "svg", content: renderVectorField(m), contentType: "image/svg+xml" });
}
