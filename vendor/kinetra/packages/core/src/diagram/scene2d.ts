/**
 * 2D scene container. Provides a coordinate frame, viewport, and a
 * structured representation that downstream renderers consume.
 */

import { el, line, renderSvg, text } from "./primitives.js";
import type { SvgElement } from "./primitives.js";
import type { Color, Vec2 } from "./primitives.js";
import { collision, textWidth as measure } from "./schematic_kit.js";
import type { Box, Scene, Seg } from "./schematic_kit.js";

export interface Scene2DModel {
  width: number;
  height: number;
  background?: Color;
  /** Equal world-unit scale on both axes by default. Disable only for plots. */
  preserveAspect?: boolean;
  /** Pixel inset reserved for titles, captions or annotations. */
  padding?: { left: number; right: number; top: number; bottom: number };
  /** World coordinates that map to the viewport. */
  world: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** Optional title. */
  title?: string;
  /** Optional caption shown under the scene. */
  caption?: string;
  /** Optional drawn axes flag. */
  axes?: { xLabel?: string; yLabel?: string; grid?: boolean };
  /** Structured shapes. */
  shapes: Scene2DShape[];
  /** Draw every label exactly where it is given, in shape order, without moving it clear of strokes (callers that place labels themselves). */
  fixedLabels?: boolean;
}

export type Scene2DShape =
  | { kind: "point"; at: Vec2; color?: Color; label?: string }
  | { kind: "segment"; from: Vec2; to: Vec2; color?: Color; width?: number; dashed?: boolean }
  | { kind: "vector"; at: Vec2; v: Vec2; label?: string; color?: Color; showComponents?: boolean; dashed?: boolean }
  | { kind: "circle"; center: Vec2; r: number; fill?: Color; stroke?: Color }
  | { kind: "rect"; origin: Vec2; size: { w: number; h: number }; fill?: Color; stroke?: Color; rx?: number }
  | { kind: "arc"; center: Vec2; r: number; fromDeg: number; toDeg: number; color?: Color; width?: number }
  | { kind: "polygon"; points: Vec2[]; fill?: Color; stroke?: Color }
  | { kind: "path"; d: string; space?: "world" | "view"; fill?: Color; stroke?: Color; width?: number }
  | { kind: "label"; at: Vec2; text: string; color?: Color; size?: number; anchor?: "start" | "middle" | "end"; offset?: { dx: number; dy: number } }
  | { kind: "group"; children: Scene2DShape[]; meta?: Record<string, unknown> };

export function newScene2D(opts: {
  width: number; height: number; world: { xMin: number; xMax: number; yMin: number; yMax: number };
  title?: string; caption?: string; background?: Color;
  preserveAspect?: boolean;
  padding?: { left: number; right: number; top: number; bottom: number };
  axes?: { xLabel?: string; yLabel?: string; grid?: boolean };
}): Scene2DModel {
  return { ...opts, shapes: [] };
}

export function addShape(s: Scene2DModel, shape: Scene2DShape): void {
  s.shapes.push(shape);
}

/** Estimate pixel width of a text label at given font-size (heuristic). */
function textWidth(contents: string, size: number): number {
  return (contents.length || 1) * size * 0.62;
}

/**
 * Clamp a text anchor position so its bbox stays inside the viewport.
 * @param x anchor x (interpretation depends on anchor)
 * @param y baseline y
 * @param contents text content
 * @param size font-size
 * @param anchor text-anchor
 * @param offset additional (dx, dy) applied to anchor before clamping
 */
function clampText(s: Scene2DModel, x: number, y: number, contents: string, size: number, anchor: "start" | "middle" | "end", offset: { dx: number; dy: number }): { x: number; y: number } {
  const w = textWidth(contents, size);
  const h = size * 1.15;
  let left = x;
  if (anchor === "middle") left = x - w / 2;
  else if (anchor === "end") left = x - w;
  left += offset.dx;
  const top = y - size * 0.85 + offset.dy;
  let nx = left;
  if (nx < 2) nx = 2;
  if (nx + w > s.width - 2) nx = s.width - 2 - w;
  let ny = top;
  if (ny < 2) ny = 2;
  if (ny + h > s.height - 2) ny = s.height - 2 - h;
  // Convert clamped top-left back to anchor x. For "end" anchor: x = nx + w. For "middle": x = nx + w/2. For "start": x = nx.
  let ax: number;
  if (anchor === "middle") ax = nx + w / 2;
  else if (anchor === "end") ax = nx + w;
  else ax = nx;
  ax -= offset.dx;
  // Convert clamped top back to baseline y: y = ny + size * 0.85. Then subtract offset.dy.
  const ay = ny + size * 0.85 - offset.dy;
  return { x: ax, y: ay };
}

/** Map a world point to viewport (pixel) coordinates. y-axis points up. */
export function worldToView(s: Scene2DModel, p: Vec2): Vec2 {
  const t = sceneTransform(s);
  return { x: t.tx + p.x * t.sx, y: t.ty - p.y * t.sy };
}

export function sceneTransform(s: Scene2DModel) {
  const w = s.world;
  const p=s.padding ?? {left:0,right:0,top:0,bottom:0};
  const width=s.width-p.left-p.right,height=s.height-p.top-p.bottom;
  let sx = width / (w.xMax - w.xMin), sy = height / (w.yMax - w.yMin);
  if (s.preserveAspect !== false) sx = sy = Math.min(sx, sy);
  return { sx, sy, tx: p.left+(width - (w.xMax - w.xMin) * sx) / 2 - w.xMin * sx,
    ty: p.top+(height + (w.yMax - w.yMin) * sy) / 2 + w.yMin * sy };
}

export function viewToWorld(s: Scene2DModel, p: Vec2): Vec2 {
  const t = sceneTransform(s);
  const x = (p.x - t.tx) / t.sx;
  const y = (t.ty - p.y) / t.sy;
  return { x, y };
}

export function validateScene2D(s: Scene2DModel): void {
  if (![s.width, s.height, ...Object.values(s.world)].every(Number.isFinite)) throw new Error("Scene2D: dimensions and bounds must be finite");
  if (s.width <= 0 || s.height <= 0) throw new Error("Scene2D: width/height must be positive");
  if (s.world.xMax <= s.world.xMin) throw new Error("Scene2D: xMax must be greater than xMin");
  if (s.world.yMax <= s.world.yMin) throw new Error("Scene2D: yMax must be greater than yMin");
  if (Number.isNaN(s.width) || Number.isNaN(s.height)) throw new Error("Scene2D: NaN dimensions");
  if(s.padding && (!Object.values(s.padding).every(n=>Number.isFinite(n)&&n>=0) || s.padding.left+s.padding.right>=s.width || s.padding.top+s.padding.bottom>=s.height))throw new Error("Scene2D: invalid padding");
  const visit=(value:unknown):void=>{
    if(typeof value === "number" && !Number.isFinite(value)) throw new Error("Scene2D: geometry must be finite");
    if(value && typeof value === "object") for(const v of Object.values(value)) visit(v);
  };
  visit(s.shapes);
  const shapes=(items:Scene2DShape[])=>{for(const sh of items){
    if((sh.kind === "circle" || sh.kind === "arc") && sh.r<=0) throw new Error("Scene2D: radius must be positive");
    if(sh.kind === "rect" && (sh.size.w<=0 || sh.size.h<=0)) throw new Error("Scene2D: rectangle size must be positive");
    if(sh.kind === "path" && /NaN|Infinity/.test(sh.d)) throw new Error("Scene2D: path must contain finite coordinates");
    if(sh.kind === "group") shapes(sh.children);
  }};
  shapes(s.shapes);
}

export function renderScene2D(s: Scene2DModel): string {
  validateScene2D(s);
  const children: SvgElement[] = [];
  // Title and caption
  if (s.title) {
    children.push(text(s.width / 2, 16, s.title, "#222", 14, "middle", "Inter, system-ui, sans-serif", "600"));
  }
  // Axes
  if (s.axes) {
    const axisColor = "#777";
    const { xMin, xMax, yMin, yMax } = s.world;
    const ox0 = worldToView(s, { x: xMin, y: 0 });
    const ox1 = worldToView(s, { x: xMax, y: 0 });
    const oy0 = worldToView(s, { x: 0, y: yMin });
    const oy1 = worldToView(s, { x: 0, y: yMax });
    if (ox0.y === ox1.y) {
      children.push(line(ox0.x, ox0.y, ox1.x, ox1.y, axisColor, 1));
      const xLabel = s.axes.xLabel ?? "x";
      const xLabelLen = (xLabel.length || 1) * 11 * 0.62;
      const xLabelWidth = (xLabel.length || 1) * 11 * 0.62;
      // Try to right-align so the label ends near the axis endpoint, like a
      // conventional axis tick label.
      let xLx = ox1.x - 4;
      let xAnchor: "start" | "end" = "end";
      if (xLx - xLabelWidth < 2) {
        // Not enough room on the right; flip to start-anchored on the left
        // of the axis endpoint.
        xLx = Math.min(s.width - 2 - xLabelWidth, ox1.x + 4);
        xAnchor = "start";
      }
      const xLy = Math.min(s.height - 2, ox1.y + 16);
      const xc = clampText(s, xLx, xLy, xLabel, 11, xAnchor, { dx: 0, dy: 0 });
      const xFinal = { x: xc.x, y: xc.y };
      // Draw a small white backdrop so the label stays readable even when
      // plot content (cells, arrows) extends to the axis edge.
      const xBgW = textWidth(xLabel, 11) + 4;
      const xBgH = 11 * 1.15 + 2;
      const xBgX = xFinal.x + (xAnchor === "end" ? -xBgW + 2 : -2);
      const xBgY = xFinal.y - 11 * 0.85 - 1;
      children.push(el("rect", { x: xBgX, y: xBgY, width: xBgW, height: xBgH, fill: "#ffffff" }));
      children.push(text(xFinal.x, xFinal.y, xLabel, axisColor, 11, xAnchor));
    }
    if (oy0.x === oy1.x) {
      children.push(line(oy0.x, oy0.y, oy1.x, oy1.y, axisColor, 1));
      const yLabel = s.axes.yLabel ?? "y";
      const yLabelLen = (yLabel.length || 1) * 11 * 0.62;
      // Place the y label so it ends just to the left of the y-axis at the
      // top of the axis. If that would push the left edge off-canvas, drop
      // the label to the next-to-top tick. Then run the result through the
      // shared clampText so the bbox always stays inside the viewport.
      let yLx = oy1.x - yLabelLen - 2;
      let yLy = Math.min(s.height - 2, Math.max(2, oy1.y + 4));
      if (yLx < 2) {
        yLx = Math.min(s.width - 2 - yLabelLen, oy1.x + 4);
        yLy = Math.min(s.height - 2, Math.max(2, oy1.y + 4));
      }
      // Title row sits at y=14..18; push the y-axis label below it when a
      // title is present so they do not collide.
      if (s.title && yLy < 32) yLy = 32;
      const yc = clampText(s, yLx, yLy, yLabel, 11, "start", { dx: 0, dy: 0 });
      const yFinal = { x: yc.x, y: yc.y };
      // Draw a small white backdrop so the label stays readable even when
      // plot content (cells, arrows) extends to the axis edge.
      const yBgW = textWidth(yLabel, 11) + 4;
      const yBgH = 11 * 1.15 + 2;
      const yBgX = yFinal.x - 2;
      const yBgY = yFinal.y - 11 * 0.85 - 1;
      children.push(el("rect", { x: yBgX, y: yBgY, width: yBgW, height: yBgH, fill: "#ffffff" }));
      children.push(text(yFinal.x, yFinal.y, yLabel, axisColor, 11, "start"));
    }
    if (s.axes.grid) {
      const ticks = 8;
      for (let i = 1; i < ticks; i++) {
        const tx = xMin + ((xMax - xMin) * i) / ticks;
        const ty = yMin + ((yMax - yMin) * i) / ticks;
        const a = worldToView(s, { x: tx, y: yMin });
        const b = worldToView(s, { x: tx, y: yMax });
        children.push(line(a.x, a.y, b.x, b.y, "#eee", 1));
        const c = worldToView(s, { x: xMin, y: ty });
        const d = worldToView(s, { x: xMax, y: ty });
        children.push(line(c.x, c.y, d.x, d.y, "#eee", 1));
      }
    }
  }
  // Shapes: geometry first, then every label placed clear of strokes and of the labels before it.
  const ctx: Context = { labels: [], strokes: [], boxes: [] };
  for (const sh of s.shapes) pushShape(s, sh, children, ctx);
  placeLabels(s, ctx, children);
  if (s.caption) {
    children.push(text(s.width / 2, s.height - 8, s.caption, "#555", 11, "middle"));
  }
  const root: SvgElement = el("g", {}, children);
  return renderSvg(root, { viewBox: `0 0 ${s.width} ${s.height}`, width: s.width, height: s.height, background: s.background ?? "#fff" });
}

type LabelRequest = { text: string; size: number; color: string; anchor: "start" | "middle" | "end"; x: number; y: number; at: Vec2; backdrop: boolean };
type Context = { labels: LabelRequest[]; strokes: Seg[]; boxes: Box[] };
/** Holds a label for placement after all geometry, or draws it at its given spot when the scene asks for fixed labels. */
function queue(s: Scene2DModel, ctx: Context, out: SvgElement[], l: LabelRequest) {
  if (!s.fixedLabels) return void ctx.labels.push(l);
  const tc = clampText(s, l.x, l.y, l.text, l.size, l.anchor, { dx: 0, dy: 0 });
  if (l.backdrop) {
    const w = textWidth(l.text, l.size);
    const x = l.anchor === "middle" ? tc.x - w / 2 : l.anchor === "end" ? tc.x - w : tc.x;
    out.push(el("rect", { x: x - 1, y: tc.y - l.size * 0.85 - 0.5, width: w + 2, height: l.size * 1.15 + 1, fill: "#ffffff", stroke: "none" }));
  }
  out.push(text(tc.x, tc.y, l.text, l.color, l.size, l.anchor));
}
const labelBox = (x: number, y: number, contents: string, size: number, anchor: "start" | "middle" | "end"): Box => {
  const w = measure(contents, size);
  return { x: anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x, y: y - size * 0.85, w, h: size * 1.15 };
};
/**
 * Places each label at its preferred spot when that is clear; otherwise at the nearest clear spot around the point
 * it labels (an arrow tip, a point), so labels never sit on each other or on a stroke.
 */
function placeLabels(s: Scene2DModel, ctx: Context, out: SvgElement[]) {
  const scene: Scene = { segments: ctx.strokes, boxes: ctx.boxes, labels: [], frame: { x: 0, y: 0, w: s.width, h: s.height } };
  if (s.title) scene.labels.push(labelBox(s.width / 2, 16, s.title, 14, "middle"));
  for (const l of ctx.labels) {
    const first = clampText(s, l.x, l.y, l.text, l.size, l.anchor, { dx: 0, dy: 0 });
    const options: { x: number; y: number; cost: number }[] = [{ ...first, cost: 0 }];
    const w = measure(l.text, l.size), h = l.size * 1.15;
    const shift = l.anchor === "middle" ? w / 2 : l.anchor === "end" ? w : 0;
    // Beside the point (right or left, sliding up and down), then above or below it (sliding sideways), stepping outward.
    const at = (left: number, top: number, cost: number) => options.push({ x: left + shift, y: top + l.size * 0.85, cost });
    for (const g of [6, 14, 26, 42, 62]) {
      for (const v of [0, -12, 12, -24, 24, -38, 38]) {
        at(l.at.x + g, l.at.y + v - h / 2, 3 + g * 0.5 + Math.abs(v) * 0.3);
        at(l.at.x - g - w, l.at.y + v - h / 2, 4 + g * 0.5 + Math.abs(v) * 0.3);
      }
      for (const u of [0, -0.5, 0.5]) {
        at(l.at.x - w / 2 + u * w, l.at.y - g - h, 3.5 + g * 0.5 + Math.abs(u) * 8);
        at(l.at.x - w / 2 + u * w, l.at.y + g, 3.5 + g * 0.5 + Math.abs(u) * 8);
      }
    }
    let best = options[0], score = Infinity;
    for (const o of options) {
      const sc = o.cost + collision(labelBox(o.x, o.y, l.text, l.size, l.anchor), scene);
      if (sc < score - 1e-9) { best = o; score = sc; }
    }
    const box = labelBox(best.x, best.y, l.text, l.size, l.anchor);
    scene.labels.push(box);
    if (l.backdrop) out.push(el("rect", { x: box.x - 1, y: box.y - 0.5, width: box.w + 2, height: box.h + 1, fill: "#ffffff", stroke: "none" }));
    out.push(text(best.x, best.y, l.text, l.color, l.size, l.anchor));
  }
}

function pushShape(s: Scene2DModel, sh: Scene2DShape, out: SvgElement[], ctx: Context): void {
  switch (sh.kind) {
    case "point": {
      const p = worldToView(s, sh.at);
      out.push(el("circle", { cx: p.x, cy: p.y, r: 3, fill: sh.color ?? "#222" }));
      ctx.boxes.push({ x: p.x - 3, y: p.y - 3, w: 6, h: 6 });
      if (sh.label) queue(s, ctx, out, { text: sh.label, size: 12, color: sh.color ?? "#222", anchor: "start", x: p.x + 5, y: p.y - 5, at: p, backdrop: false });
      return;
    }
    case "segment": {
      const a = worldToView(s, sh.from);
      const b = worldToView(s, sh.to);
      const attrs: Record<string, string | number> = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: sh.color ?? "#222", "stroke-width": sh.width ?? 1, "stroke-linecap": "round" };
      if (sh.dashed) attrs["stroke-dasharray"] = "4 4";
      out.push(el("line", attrs));
      ctx.strokes.push({ a, b });
      return;
    }
    case "vector": {
      const a = worldToView(s, sh.at);
      const tip = worldToView(s, { x: sh.at.x + sh.v.x, y: sh.at.y + sh.v.y });
      if (Math.hypot(tip.x - a.x, tip.y - a.y) < 1e-10) return;
      const id = "arr-" + Array.from(sh.color ?? "#222").map(c=>c.codePointAt(0)!.toString(16)).join("") + "-" + out.length;
      out.push(el("defs", {}, [el("marker", { id, markerWidth: 7, markerHeight: 7, refX: 6, refY: 3.5, orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" }, [el("path", { d: "M0,0 L7,3.5 L0,7 Z", fill: sh.color ?? "#222" })])]));
      const dash = sh.dashed ? "4 4" : undefined;
      out.push(el("line", {
        x1: a.x, y1: a.y, x2: tip.x, y2: tip.y,
        stroke: sh.color ?? "#222", "stroke-width": 1.6,
        "marker-end": `url(#${id})`,
        "stroke-dasharray": dash ?? "",
      }));
      if (sh.showComponents) {
        const cc = "#c8c8c8";
        out.push(line(a.x, a.y, tip.x, a.y, cc, 0.8, "3 3"));
        out.push(line(tip.x, a.y, tip.x, tip.y, cc, 0.8, "3 3"));
      }
      ctx.strokes.push({ a, b: tip });
      if (sh.label) queue(s, ctx, out, { text: sh.label, size: 12, color: sh.color ?? "#222", anchor: "start", x: tip.x + 5, y: tip.y - 5, at: tip, backdrop: false });
      return;
    }
    case "circle": {
      const c = worldToView(s, sh.center);
      const t = sceneTransform(s);
      out.push(el("ellipse", { cx: c.x, cy: c.y, rx: sh.r * t.sx, ry: sh.r * t.sy, fill: sh.fill ?? "none", stroke: sh.stroke ?? "#222", "stroke-width": 1 }));
      ring(ctx, Array.from({ length: 24 }, (_, i) => ({ x: c.x + Math.cos((i * Math.PI) / 12) * sh.r * t.sx, y: c.y + Math.sin((i * Math.PI) / 12) * sh.r * t.sy })), true);
      ctx.boxes.push({ x: c.x - sh.r * t.sx * 0.7, y: c.y - sh.r * t.sy * 0.7, w: sh.r * t.sx * 1.4, h: sh.r * t.sy * 1.4 });
      return;
    }
    case "rect": {
      const o = worldToView(s, sh.origin);
      const op = worldToView(s, { x: sh.origin.x + sh.size.w, y: sh.origin.y + sh.size.h });
      out.push(el("rect", { x: o.x, y: op.y, width: op.x - o.x, height: o.y - op.y, fill: sh.fill ?? "none", stroke: sh.stroke ?? "#222", "stroke-width": 1, rx: sh.rx ?? 0 }));
      ring(ctx, [{ x: o.x, y: op.y }, { x: op.x, y: op.y }, { x: op.x, y: o.y }, { x: o.x, y: o.y }], true);
      ctx.boxes.push({ x: Math.min(o.x, op.x), y: Math.min(o.y, op.y), w: Math.abs(op.x - o.x), h: Math.abs(o.y - op.y) });
      return;
    }
    case "arc": {
      const steps = Math.max(2, Math.ceil(Math.abs(sh.toDeg - sh.fromDeg) / 3));
      const points = Array.from({ length: steps + 1 }, (_, i) => {
        const a = (sh.fromDeg + (sh.toDeg - sh.fromDeg) * i / steps) * Math.PI / 180;
        return worldToView(s, { x: sh.center.x + sh.r * Math.cos(a), y: sh.center.y + sh.r * Math.sin(a) });
      });
      out.push(el("path", { d: points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" "), fill: "none", stroke: sh.color ?? "#222", "stroke-width": sh.width ?? 1 }));
      ring(ctx, points, false);
      return;
    }
    case "polygon": {
      const pts = sh.points.map((p) => worldToView(s, p));
      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
      out.push(el("path", { d, fill: sh.fill ?? "none", stroke: sh.stroke ?? "#222", "stroke-width": 1 }));
      ring(ctx, pts, true);
      return;
    }
    case "path": {
      const t = sceneTransform(s);
      const attrs: Record<string, string | number> = { d: sh.d, fill: sh.fill ?? "none", stroke: sh.stroke ?? "#222", "stroke-width": sh.width ?? 1, "vector-effect": "non-scaling-stroke" };
      if (sh.space !== "view") attrs.transform = `matrix(${t.sx} 0 0 ${-t.sy} ${t.tx} ${t.ty})`;
      out.push(el("path", attrs));
      return;
    }
    case "label": {
      const p = worldToView(s, sh.at);
      const dx = sh.offset?.dx ?? 0;
      const dy = sh.offset?.dy ?? 0;
      const sz = sh.size ?? 12;
      const anchor = sh.anchor ?? "start";
      // A white backdrop keeps the label readable when grid lines or thin reference strokes pass behind it.
      queue(s, ctx, out, { text: sh.text, size: sz, color: sh.color ?? "#222", anchor, x: p.x + dx, y: p.y + dy, at: { x: p.x + dx, y: p.y + dy - sz * 0.35 }, backdrop: true });
      return;
    }
    case "group": {
      for (const c of sh.children) pushShape(s, c, out, ctx);
      return;
    }
  }
}

/** The edges of an outline, as strokes labels keep clear of. */
function ring(ctx: Context, pts: Vec2[], closed: boolean) {
  for (let i = 1; i < pts.length; i++) ctx.strokes.push({ a: pts[i - 1], b: pts[i] });
  if (closed && pts.length > 2) ctx.strokes.push({ a: pts[pts.length - 1], b: pts[0] });
}

/**
 * Produce an SVG with a marker definition block so all vector arrowheads
 * render. The renderScene2D function uses marker ids; include the defs
 * string in the output by wrapping the scene in a slightly different root.
 */
export function renderScene2DWithArrows(s: Scene2DModel): string {
  return renderScene2D(s);
}
