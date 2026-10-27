/**
 * Helpers for the part-library tests: seeded RNG, sample models, an SVG
 * oracle (independent of the gate) and a coverage oracle that samples every
 * Scene2D shape a part draws and checks that its collision shapes cover it.
 */
import { newScene2D, sceneTransform, viewToWorld, worldToView } from "../../src/diagram/scene2d.js";
import type { Scene2DShape } from "../../src/diagram/scene2d.js";
import type { Vec2 } from "../../src/diagram/primitives.js";
import { LENGTH, qdimEqual, unitQuantity, variableScope } from "../../src/toolkit/expr.js";
import { pointInPolygon, pointPolylineDist } from "../../src/toolkit/geometry.js";
import type { CollisionShape } from "../../src/toolkit/geometry.js";
import { ARROW_HEAD } from "../../src/toolkit/parts.js";
import type { PartContext, ViewMap } from "../../src/toolkit/parts.js";
import { resolveLayout } from "../../src/toolkit/resolver.js";
import { TOOLKIT_PART_SAMPLES } from "../../src/toolkit/index.js";
import type { ComposeModel, ElementSpec } from "../../src/toolkit/index.js";

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One sample in a single 4 x 3 cell at `pxPerUnit`. */
export function cellModel(type: string, seed = 1, pxPerUnit = 60): ComposeModel {
  const els = TOOLKIT_PART_SAMPLES.get(type)!("p", { x: 2, y: 1.5 }, rng(seed));
  return { canvas: { width: 4 * pxPerUnit, height: 3 * pxPerUnit, world: { xMin: 0, xMax: 4, yMin: 0, yMax: 3 } }, elements: els };
}

// --- SVG oracle ----------------------------------------------------------------------------------------

type Rect = { x0: number; y0: number; x1: number; y1: number };
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]));
function segRectDist(a: Vec2, b: Vec2, r: Rect): number {
  let d = Infinity;
  for (let i = 0; i <= 200; i++) {
    const p = { x: a.x + (b.x - a.x) * i / 200, y: a.y + (b.y - a.y) * i / 200 };
    d = Math.min(d, Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.y0 - p.y, 0, p.y - r.y1)));
  }
  return d;
}
/** Re-parse the SVG: backdrops inside the canvas, no two backdrops overlap, no line crosses a backdrop. */
export function svgOracle(svg: string, width: number, height: number): string[] {
  const problems: string[] = [];
  const backdrops: Rect[] = [...svg.matchAll(/<rect ([^>]*fill="#ffffff" stroke="none"[^>]*)\/>/g)].map(m => { const a = attrs(m[1]!); return { x0: +a.x!, y0: +a.y!, x1: +a.x! + +a.width!, y1: +a.y! + +a.height! }; });
  for (const b of backdrops) if (b.x0 < -1e-9 || b.y0 < -1e-9 || b.x1 > width + 1e-9 || b.y1 > height + 1e-9) problems.push(`label backdrop outside canvas ${JSON.stringify(b)}`);
  for (let i = 0; i < backdrops.length; i++) for (let j = i + 1; j < backdrops.length; j++) {
    const a = backdrops[i]!, b = backdrops[j]!;
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) problems.push(`label backdrops overlap ${JSON.stringify([a, b])}`);
  }
  const lines = [...svg.matchAll(/<line ([^>]*)\/>/g)].map(m => attrs(m[1]!)).filter(a => !(a.stroke === "#777" && a["stroke-width"] === "0.8"));
  // Grid lines (#eee) may pass under a label only when a white halo rect covers that label's backdrop.
  const halos: Rect[] = [...svg.matchAll(/<rect ([^>]*fill="#fff" stroke="none"[^>]*)\/>/g)].map(m => { const a = attrs(m[1]!); return { x0: +a.x!, y0: +a.y!, x1: +a.x! + +a.width!, y1: +a.y! + +a.height! }; });
  const haloed = (b: Rect) => halos.some(h => h.x0 <= b.x0 + 0.02 && h.y0 <= b.y0 + 0.02 && h.x1 >= b.x1 - 0.02 && h.y1 >= b.y1 - 0.02);
  for (const l of lines) for (const b of backdrops) {
    if (l.stroke === "#eee" && haloed(b)) continue;
    const d = segRectDist({ x: +l.x1!, y: +l.y1! }, { x: +l.x2!, y: +l.y2! }, b);
    if (d < +l["stroke-width"]! / 2) problems.push(`line crosses a label backdrop (${d.toFixed(2)} px)`);
  }
  if (/NaN|Infinity/.test(svg)) problems.push("non-finite number");
  return problems;
}

// --- coverage oracle ---------------------------------------------------------------------------------------

/** Resolve a model the way compose() does and return its instances with a part context. */
export function resolveModel(m: ComposeModel) {
  const scope = variableScope(m.vars ?? {});
  const wu = unitQuantity(m.canvas.worldUnit ?? "m")!;
  if (!qdimEqual(wu.dim, LENGTH)) throw new Error("bad world unit");
  const world = m.canvas.world as { xMin: number; xMax: number; yMin: number; yMax: number };
  const scene = newScene2D({ width: m.canvas.width, height: m.canvas.height, world });
  const t = sceneTransform(scene);
  const view: ViewMap = { toView: p => worldToView(scene, p), toWorld: p => viewToWorld(scene, p), scale: t.sx };
  const ctx: PartContext = { scope, worldUnitSI: wu.value, view, scales: new Map() };
  return { ctx, res: resolveLayout(m.elements as ElementSpec[], ctx), scene };
}

/** Points (view px) that a Scene2D shape paints, each with the half-width it is painted at. */
export function paintedSamples(sh: Scene2DShape, ctx: PartContext, canvas: { width: number; height: number }): Vec2[] {
  const V = (p: Vec2) => ctx.view.toView(p);
  const out: Vec2[] = [];
  const along = (a: Vec2, b: Vec2, hw: number, caps: boolean) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L));
    const u = L ? { x: (b.x - a.x) / L, y: (b.y - a.y) / L } : { x: 1, y: 0 }, nr = { x: -u.y, y: u.x };
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n };
      out.push(p, { x: p.x + nr.x * hw, y: p.y + nr.y * hw }, { x: p.x - nr.x * hw, y: p.y - nr.y * hw });
    }
    if (caps) out.push({ x: a.x - u.x * hw, y: a.y - u.y * hw }, { x: b.x + u.x * hw, y: b.y + u.y * hw });
  };
  const ring = (pts: Vec2[], hw: number) => { for (let k = 0; k < pts.length; k++) along(pts[k]!, pts[(k + 1) % pts.length]!, hw, false); };
  const interior = (pts: Vec2[]) => { const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }; if (pointInPolygon(c, pts)) out.push(c); for (const p of pts) for (const f of [0.25, 0.6]) { const q = { x: p.x + (c.x - p.x) * f, y: p.y + (c.y - p.y) * f }; if (pointInPolygon(q, pts)) out.push(q); } };
  switch (sh.kind) {
    case "segment": along(V(sh.from), V(sh.to), (sh.width ?? 1) / 2, true); break;
    case "vector": {
      const a = V(sh.at), b = V({ x: sh.at.x + sh.v.x, y: sh.at.y + sh.v.y }), L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-10) break;
      along(a, b, 0.8, false);
      const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, n = { x: -u.y, y: u.x };
      // Marker M0,0 L7,3.5 L0,7 with refX 6, refY 3.5 at the tip.
      const m = (mx: number, my: number) => ({ x: b.x + u.x * (mx - 6) + n.x * (my - 3.5), y: b.y + u.y * (mx - 6) + n.y * (my - 3.5) });
      const tri = [m(0, 0), m(7, 3.5), m(0, 7)];
      ring(tri, 0); interior(tri);
      void ARROW_HEAD;
      break;
    }
    case "circle": {
      const c = V(sh.center), r = sh.r * ctx.view.scale, pts = Array.from({ length: 180 }, (_, k) => ({ x: c.x + r * Math.cos(k * Math.PI / 90), y: c.y + r * Math.sin(k * Math.PI / 90) }));
      if ((sh.stroke ?? "#222") !== "none") for (const p of pts) { const d = { x: (p.x - c.x) / r, y: (p.y - c.y) / r }; out.push(p, { x: p.x + d.x * 0.5, y: p.y + d.y * 0.5 }, { x: p.x - d.x * 0.5, y: p.y - d.y * 0.5 }); }
      if ((sh.fill ?? "none") !== "none") interior(pts);
      break;
    }
    case "rect": {
      const o = V(sh.origin), q = V({ x: sh.origin.x + sh.size.w, y: sh.origin.y + sh.size.h });
      const x0 = o.x, x1 = q.x, y0 = q.y, y1 = o.y, rx = Math.min(sh.rx ?? 0, (x1 - x0) / 2, (y1 - y0) / 2);
      const pts: Vec2[] = [];
      const corner = (cx: number, cy: number, a0: number) => { for (let d = 0; d <= 90; d += 2) pts.push({ x: cx + rx * Math.cos((a0 + d) * Math.PI / 180), y: cy + rx * Math.sin((a0 + d) * Math.PI / 180) }); };
      if (rx > 0) { corner(x1 - rx, y1 - rx, 0); corner(x0 + rx, y1 - rx, 90); corner(x0 + rx, y0 + rx, 180); corner(x1 - rx, y0 + rx, 270); }
      else pts.push({ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 });
      if ((sh.stroke ?? "#222") !== "none") ring(pts, 0.5);
      if ((sh.fill ?? "none") !== "none") interior(pts);
      break;
    }
    case "arc": {
      const steps = Math.max(2, Math.ceil(Math.abs(sh.toDeg - sh.fromDeg) / 3));
      const pts = Array.from({ length: steps + 1 }, (_, i) => { const a = (sh.fromDeg + (sh.toDeg - sh.fromDeg) * i / steps) * Math.PI / 180; return V({ x: sh.center.x + sh.r * Math.cos(a), y: sh.center.y + sh.r * Math.sin(a) }); });
      for (let k = 1; k < pts.length; k++) along(pts[k - 1]!, pts[k]!, (sh.width ?? 1) / 2, false);
      break;
    }
    case "polygon": {
      const pts = sh.points.map(V);
      if ((sh.stroke ?? "#222") !== "none") ring(pts, 0.5);
      if ((sh.fill ?? "none") !== "none") interior(pts);
      break;
    }
    case "point": { const c = V(sh.at); for (let k = 0; k < 16; k++) out.push({ x: c.x + 3 * Math.cos(k * Math.PI / 8), y: c.y + 3 * Math.sin(k * Math.PI / 8) }); out.push(c); break; }
    case "label": {
      // Scene2D's backdrop rectangle, including its clamp into the canvas.
      const p = V(sh.at), sz = sh.size ?? 12, anchor = sh.anchor ?? "start", w = (sh.text.length || 1) * sz * 0.62, h = sz * 1.15;
      let left = anchor === "middle" ? p.x - w / 2 : anchor === "end" ? p.x - w : p.x;
      let top = p.y - sz * 0.85;
      left = Math.min(Math.max(left, 2), canvas.width - 2 - w); top = Math.min(Math.max(top, 2), canvas.height - 2 - h);
      const r = [{ x: left - 1, y: top - 0.5 }, { x: left + w + 1, y: top - 0.5 }, { x: left + w + 1, y: top + h + 0.5 }, { x: left - 1, y: top + h + 0.5 }];
      ring(r, 0); interior(r);
      break;
    }
    case "path": throw new Error("kit parts never draw raw paths");
    case "group": for (const c of sh.children) out.push(...paintedSamples(c, ctx, canvas)); break;
  }
  return out;
}

export function covered(p: Vec2, shapes: CollisionShape[], eps = 0.06): boolean {
  for (const s of shapes) {
    if (s.kind === "disc") { if (Math.hypot(p.x - s.c.x, p.y - s.c.y) <= s.r + eps) return true; continue; }
    if (s.kind === "stroke") { const pts = s.closed ? [...s.points, s.points[0]!] : s.points; if (pointPolylineDist(p, pts) <= s.r + eps) return true; continue; }
    if (pointInPolygon(p, s.points) || pointPolylineDist(p, [...s.points, s.points[0]!]) <= eps) return true;
  }
  return false;
}

/** For each element: painted samples not covered by its own collision shapes. */
export function uncovered(m: ComposeModel): { id: string; type: string; missed: number; sample?: Vec2 }[] {
  const { ctx, res } = resolveModel(m);
  // Run gate hooks first (some parts validate geometry there).
  const out: { id: string; type: string; missed: number; sample?: Vec2 }[] = [];
  for (const id of res.order) {
    const inst = res.instances.get(id)!, def = res.defs.get(id)!;
    const shapes = def.collide(inst, ctx);
    let missed = 0, sample: Vec2 | undefined;
    for (const sh of def.draw(inst, ctx)) for (const p of paintedSamples(sh, ctx, m.canvas)) if (!covered(p, shapes)) { missed++; sample ??= p; }
    out.push({ id, type: inst.type, missed, sample });
  }
  return out;
}
