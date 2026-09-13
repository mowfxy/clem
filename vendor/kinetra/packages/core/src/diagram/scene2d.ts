/**
 * 2D scene container. Provides a coordinate frame, viewport, and a
 * structured representation that downstream renderers consume.
 */

import { el, line, renderSvg, text } from "./primitives.js";
import type { SvgElement } from "./primitives.js";
import type { Color, Vec2 } from "./primitives.js";

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
  // Shapes
  for (const sh of s.shapes) pushShape(s, sh, children);
  if (s.caption) {
    children.push(text(s.width / 2, s.height - 8, s.caption, "#555", 11, "middle"));
  }
  const root: SvgElement = el("g", {}, children);
  return renderSvg(root, { viewBox: `0 0 ${s.width} ${s.height}`, width: s.width, height: s.height, background: s.background ?? "#fff" });
}

function pushShape(s: Scene2DModel, sh: Scene2DShape, out: SvgElement[]): void {
  switch (sh.kind) {
    case "point": {
      const p = worldToView(s, sh.at);
      out.push(el("circle", { cx: p.x, cy: p.y, r: 3, fill: sh.color ?? "#222" }));
      if (sh.label) {
        const tc = clampText(s, p.x + 5, p.y - 5, sh.label, 12, "start", { dx: 0, dy: 0 });
        out.push(text(tc.x, tc.y, sh.label, sh.color ?? "#222", 12, "start"));
      }
      return;
    }
    case "segment": {
      const a = worldToView(s, sh.from);
      const b = worldToView(s, sh.to);
      const attrs: Record<string, string | number> = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: sh.color ?? "#222", "stroke-width": sh.width ?? 1, "stroke-linecap": "round" };
      if (sh.dashed) attrs["stroke-dasharray"] = "4 4";
      out.push(el("line", attrs));
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
      if (sh.label) {
        const tc = clampText(s, tip.x + 5, tip.y - 5, sh.label, 12, "start", { dx: 0, dy: 0 });
        out.push(text(tc.x, tc.y, sh.label, sh.color ?? "#222", 12, "start"));
      }
      return;
    }
    case "circle": {
      const c = worldToView(s, sh.center);
      const t = sceneTransform(s);
      out.push(el("ellipse", { cx: c.x, cy: c.y, rx: sh.r * t.sx, ry: sh.r * t.sy, fill: sh.fill ?? "none", stroke: sh.stroke ?? "#222", "stroke-width": 1 }));
      return;
    }
    case "rect": {
      const o = worldToView(s, sh.origin);
      const op = worldToView(s, { x: sh.origin.x + sh.size.w, y: sh.origin.y + sh.size.h });
      out.push(el("rect", { x: o.x, y: op.y, width: op.x - o.x, height: o.y - op.y, fill: sh.fill ?? "none", stroke: sh.stroke ?? "#222", "stroke-width": 1, rx: sh.rx ?? 0 }));
      return;
    }
    case "arc": {
      const steps = Math.max(2, Math.ceil(Math.abs(sh.toDeg - sh.fromDeg) / 3));
      const points = Array.from({ length: steps + 1 }, (_, i) => {
        const a = (sh.fromDeg + (sh.toDeg - sh.fromDeg) * i / steps) * Math.PI / 180;
        return worldToView(s, { x: sh.center.x + sh.r * Math.cos(a), y: sh.center.y + sh.r * Math.sin(a) });
      });
      out.push(el("path", { d: points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" "), fill: "none", stroke: sh.color ?? "#222", "stroke-width": sh.width ?? 1 }));
      return;
    }
    case "polygon": {
      const pts = sh.points.map((p) => worldToView(s, p));
      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
      out.push(el("path", { d, fill: sh.fill ?? "none", stroke: sh.stroke ?? "#222", "stroke-width": 1 }));
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
      const tc = clampText(s, p.x + dx, p.y + dy, sh.text, sz, anchor, { dx: 0, dy: 0 });
      // White backdrop so the label stays readable when grid lines or other
      // thin reference strokes pass behind it.
      const lW = textWidth(sh.text, sz);
      const lH = sz * 1.15;
      let bgX = tc.x;
      if (anchor === "middle") bgX = tc.x - lW / 2;
      else if (anchor === "end") bgX = tc.x - lW;
      const bgY = tc.y - sz * 0.85;
      out.push(el("rect", { x: bgX - 1, y: bgY - 0.5, width: lW + 2, height: lH + 1, fill: "#ffffff", stroke: "none" }));
      out.push(text(tc.x, tc.y, sh.text, sh.color ?? "#222", sz, anchor));
      return;
    }
    case "group": {
      for (const c of sh.children) pushShape(s, c, out);
      return;
    }
  }
}

/**
 * Produce an SVG with a marker definition block so all vector arrowheads
 * render. The renderScene2D function uses marker ids; include the defs
 * string in the output by wrapping the scene in a slightly different root.
 */
export function renderScene2DWithArrows(s: Scene2DModel): string {
  return renderScene2D(s);
}
