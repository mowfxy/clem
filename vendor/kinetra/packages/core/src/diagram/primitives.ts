/**
 * SVG primitive library. Every diagram, scene, and plot in Kinetra is built
 * from these primitives so the output is consistent and re-usable.
 */

export type Color = string;

export interface Vec2 { x: number; y: number; }

export interface SvgElement {
  tag: string;
  attrs: Record<string, string | number>;
  children: (SvgElement | string)[];
}

export function el(tag: string, attrs: Record<string, string | number>, children: (SvgElement | string)[] = []): SvgElement {
  return { tag, attrs, children };
}

export function renderSvg(root: SvgElement, opts: { viewBox?: string; width?: number; height?: number; background?: string; defs?: string } = {}): string {
  const defs = opts.defs ? `<defs>${opts.defs}</defs>` : "";
  const out: string[] = [];
  renderNode(root, out);
  const w = opts.width ?? root.attrs.width ?? 600;
  const h = opts.height ?? root.attrs.height ?? 400;
  const vb = opts.viewBox ?? root.attrs.viewBox ?? `0 0 ${w} ${h}`;
  const bg = opts.background ? `<rect x="0" y="0" width="${w}" height="${h}" fill="${opts.background}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}">
${defs}
${bg}
${out.join("\n")}
</svg>`;
}

function renderNode(node: SvgElement | string, out: string[]): void {
  if (typeof node === "string") {
    out.push(escapeXml(node));
    return;
  }
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => `${k}="${typeof v === "string" ? escapeXml(v) : v}"`)
    .join(" ");
  if (node.children.length === 0) {
    out.push(`<${node.tag}${attrs ? " " + attrs : ""}/>`);
    return;
  }
  out.push(`<${node.tag}${attrs ? " " + attrs : ""}>`);
  for (const c of node.children) renderNode(c, out);
  out.push(`</${node.tag}>`);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- Geometric helpers -------------------------------------------------------

export function line(x1: number, y1: number, x2: number, y2: number, color: Color = "#222", width = 1, dash?: string): SvgElement {
  const attrs: Record<string, string | number> = { x1, y1, x2, y2, stroke: color, "stroke-width": width, "stroke-linecap": "round" };
  if (dash) attrs["stroke-dasharray"] = dash;
  return el("line", attrs);
}

export function circle(cx: number, cy: number, r: number, fill: string = "none", stroke: string = "#222", width = 1): SvgElement {
  return el("circle", { cx, cy, r, fill, stroke, "stroke-width": width });
}

export function rect(x: number, y: number, w: number, h: number, fill: string = "none", stroke: string = "#222", width = 1, rx = 0): SvgElement {
  return el("rect", { x, y, width: w, height: h, fill, stroke, "stroke-width": width, rx });
}

export function path(d: string, fill: string = "none", stroke: string = "#222", width = 1): SvgElement {
  return el("path", { d, fill, stroke, "stroke-width": width, "stroke-linejoin": "round" });
}

export function text(x: number, y: number, content: string, color: string = "#222", size = 12, anchor: "start" | "middle" | "end" = "start", family = "Arial, Helvetica, sans-serif", weight: string | number = "normal"): SvgElement {
  return el("text", { x, y, fill: color, "font-size": size, "text-anchor": anchor, "font-family": family, "font-weight": weight }, [content]);
}

export function arrowHead(id: string, size = 8, color: string = "#222"): string {
  return `<marker id="${id}" markerWidth="${size}" markerHeight="${size}" refX="${size - 1}" refY="${size / 2}" orient="auto-start-reverse"><path d="M0,0 L${size},${size / 2} L0,${size} Z" fill="${color}"/></marker>`;
}

/**
 * Render a vector arrow with an arrowhead and a label.
 */
export function vector(p: Vec2, v: Vec2, label: string, color: string = "#222", opts: { scale?: number; arrowSize?: number; labelOffset?: { dx: number; dy: number }; dashed?: boolean; showComponents?: boolean; componentColor?: string } = {}): SvgElement[] {
  const scale = opts.scale ?? 1;
  const tip = { x: p.x + v.x * scale, y: p.y - v.y * scale };
  const arrowSize = opts.arrowSize ?? 8;
  const dash = opts.dashed ? "4 4" : undefined;
  const out: SvgElement[] = [
    el("line", {
      x1: p.x, y1: p.y, x2: tip.x, y2: tip.y,
      stroke: color, "stroke-width": 1.6, "stroke-dasharray": dash ?? "",
    }),
  ];
  const length=Math.hypot(tip.x-p.x,tip.y-p.y);
  if(length>0){
    const ux=(tip.x-p.x)/length,uy=(tip.y-p.y)/length,h=Math.min(arrowSize,length*0.5),w=h*0.45;
    out.push(path(`M ${tip.x} ${tip.y} L ${tip.x-ux*h-uy*w} ${tip.y-uy*h+ux*w} L ${tip.x-ux*h+uy*w} ${tip.y-uy*h-ux*w} Z`,color,color,0));
  }
  const off = opts.labelOffset ?? { dx: 6, dy: -6 };
  out.push(text(tip.x + off.dx, tip.y + off.dy, label, color, 12, "start"));
  if (opts.showComponents) {
    const compColor = opts.componentColor ?? "#888";
    out.push(line(p.x, p.y, tip.x, p.y, compColor, 1, "3 3"));
    out.push(line(tip.x, p.y, tip.x, tip.y, compColor, 1, "3 3"));
  }
  return out;
}

export function defineArrowMarker(id: string, color: string = "#222", size = 8): string {
  return arrowHead(id, size, color);
}
