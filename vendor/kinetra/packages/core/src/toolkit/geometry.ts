/**
 * View-space collision shapes and exact distance tests. Every drawn element
 * registers shapes in pixels (y down), stroke width included:
 *  - stroke: a polyline thickened by r (lines, arrows, wires, outlines, arcs)
 *  - area:   a filled simple polygon (text boxes, arrowheads, filled bodies)
 *  - disc:   a filled circle
 */
import type { Vec2 } from "../diagram/primitives.js";

export type CollisionShape =
  | { kind: "stroke"; points: Vec2[]; r: number; closed?: boolean; strict?: boolean; soft?: boolean }
  | { kind: "area"; points: Vec2[]; strict?: boolean; soft?: boolean }
  | { kind: "disc"; c: Vec2; r: number; strict?: boolean };
// `strict` marks shapes (a part's own text) that must stay clear even of
// elements the part is allowed to touch (mayTouch or a part's `touches`).
// `soft` marks low-priority reference strokes (plot grid lines): a label may
// sit over them; compose then draws a white halo behind that label. A soft
// area is a background region (a medium such as glass or water) that anything
// may be drawn over.

export interface Box { x0: number; y0: number; x1: number; y1: number }

export function shapeBox(s: CollisionShape): Box {
  if (s.kind === "disc") return { x0: s.c.x - s.r, y0: s.c.y - s.r, x1: s.c.x + s.r, y1: s.c.y + s.r };
  const r = s.kind === "stroke" ? s.r : 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of s.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
}

export function unionBox(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export function boxPolygon(b: Box): Vec2[] {
  return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
}

export function shapeFinite(s: CollisionShape): boolean {
  if (s.kind === "disc") return [s.c.x, s.c.y, s.r].every(Number.isFinite);
  return s.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) && (s.kind !== "stroke" || Number.isFinite(s.r));
}

const sub = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;

export function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return Math.hypot(p.x - a.x - t * ab.x, p.y - a.y - t * ab.y);
}

function segsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function segSegDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function edges(points: Vec2[], closed: boolean): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i]!, points[i + 1]!]);
  if (closed && points.length > 2) out.push([points[points.length - 1]!, points[0]!]);
  if (points.length === 1) out.push([points[0]!, points[0]!]);
  return out;
}

/** Minimum distance between the shapes' filled regions (0 if they overlap). */
export function shapeDistance(a: CollisionShape, b: CollisionShape): number {
  if (a.kind === "disc" && b.kind === "disc") return Math.max(0, Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) - a.r - b.r);
  if (a.kind === "disc") return shapeDistance(b, a);
  // a is stroke or area
  const aEdges = edges(a.points, a.kind === "area" || !!(a.kind === "stroke" && a.closed));
  const ar = a.kind === "stroke" ? a.r : 0;
  if (b.kind === "disc") {
    if (a.kind === "area" && pointInPolygon(b.c, a.points)) return 0;
    const d = Math.min(...aEdges.map(([p, q]) => pointSegDist(b.c, p, q)));
    return Math.max(0, d - ar - b.r);
  }
  const bEdges = edges(b.points, b.kind === "area" || !!(b.kind === "stroke" && b.closed));
  const br = b.kind === "stroke" ? b.r : 0;
  if (a.kind === "area" && b.points.some(p => pointInPolygon(p, a.points))) return 0;
  if (b.kind === "area" && a.points.some(p => pointInPolygon(p, b.points))) return 0;
  let d = Infinity;
  for (const [p, q] of aEdges) for (const [r, s] of bEdges) { d = Math.min(d, segSegDist(p, q, r, s)); if (d === 0) return 0; }
  return Math.max(0, d - ar - br);
}

export function boxesNear(a: Box, b: Box, gap: number): boolean {
  return !(a.x1 + gap < b.x0 || b.x1 + gap < a.x0 || a.y1 + gap < b.y0 || b.y1 + gap < a.y0);
}

/** Is `inner` contained in the polygon `outer` with at least `margin` clearance from its edges? */
export function containedIn(inner: Vec2[], outer: Vec2[], margin: number): boolean {
  if (!inner.every(p => pointInPolygon(p, outer))) return false;
  const oe = edges(outer, true), ie = edges(inner, true);
  for (const [p, q] of ie) for (const [r, s] of oe) if (segSegDist(p, q, r, s) < margin) return false;
  return true;
}

export function polylineLength(points: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return l;
}

/** Distance from p to a polyline. */
export function pointPolylineDist(p: Vec2, points: Vec2[]): number {
  let d = Infinity;
  for (let i = 1; i < points.length; i++) d = Math.min(d, pointSegDist(p, points[i - 1]!, points[i]!));
  return points.length === 1 ? Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y) : d;
}

/**
 * True when two wire or signal paths (view px) come close only at clean crossings: each
 * near pair of segments properly intersects at >= 30 degrees, at least 4 px
 * (`minVertexPx`) from every vertex of both paths. A T (an end on the other
 * path), a shared corner or a collinear overlap is not a crossing and stays a
 * collision.
 */
export function wiresCrossCleanly(a: Vec2[], b: Vec2[], near: number, minVertexPx = 4): boolean {
  let crossings = 0;
  const cr = (u: Vec2, w: Vec2) => u.x * w.y - u.y * w.x, vsub = (u: Vec2, w: Vec2) => ({ x: u.x - w.x, y: u.y - w.y });
  for (let s = 1; s < a.length; s++) for (let t = 1; t < b.length; t++) {
    const p = a[s - 1]!, q = a[s]!, r = b[t - 1]!, e = b[t]!;
    const close = Math.min(pointSegDist(p, r, e), pointSegDist(q, r, e), pointSegDist(r, p, q), pointSegDist(e, p, q));
    const d1 = vsub(q, p), d2 = vsub(e, r), den = cr(d1, d2);
    const tt = den === 0 ? NaN : cr(vsub(r, p), d2) / den, uu = den === 0 ? NaN : cr(vsub(r, p), d1) / den;
    const hit = tt > 0 && tt < 1 && uu > 0 && uu < 1;
    if (!hit && close >= near) continue;
    if (!hit) return false;
    const x = { x: p.x + d1.x * tt, y: p.y + d1.y * tt };
    const sin = Math.abs(den) / (Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y));
    if (sin < Math.sin(30 * Math.PI / 180) || [...a, ...b].some(vx => Math.hypot(vx.x - x.x, vx.y - x.y) < minVertexPx)) return false;
    crossings++;
  }
  return crossings > 0;
}
