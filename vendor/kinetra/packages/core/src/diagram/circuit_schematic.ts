/**
 * Circuit schematic renderer for analog electrical circuits. Takes a
 * structured `Schematic` model and produces an SVG using deterministic
 * layout (a simple grid-based place-and-route).
 */

import { createArtifact, withRendering } from "../artifacts.js";
import { el, line, renderSvg, text } from "./primitives.js";
import type { Color, SvgElement } from "./primitives.js";
import { sceneTransform, validateScene2D } from "./scene2d.js";

export type ComponentKind =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "voltage-source"
  | "current-source"
  | "switch"
  | "ground";

export interface Component {
  id: string;
  kind: ComponentKind;
  label?: string;
  /** Value (ohms, farads, henries, volts, amps) for display. */
  value?: number;
  /** Unit symbol. */
  unit?: string;
  /** Center position in world coordinates. */
  position: { x: number; y: number };
  /** Rotation in degrees. Defaults to 0 (horizontal). */
  rotationDeg?: number;
  /** Only for switches; omitted means open. */
  closed?: boolean;
  /**
   * Two pin offsets relative to the centre, in local coordinates.
   * Defaults to the standard horizontal pair for the component kind.
   */
  pins?: [{ x: number; y: number }, { x: number; y: number }];
}

export interface Wire {
  /** Optional explicit routing points in world coordinates. Crossings without a dot are not connections. */
  via?: { x: number; y: number }[];
  from: { componentId: string; pin: 0 | 1 };
  to: { componentId: string; pin: 0 | 1 } | { point: { x: number; y: number } };
}

export interface Schematic {
  components: Component[];
  wires: Wire[];
  world: { xMin: number; xMax: number; yMin: number; yMax: number };
  width: number; height: number;
  title?: string;
}

export function validateSchematic(s: Schematic): void {
  validateScene2D({ ...s, shapes: [] });
  if (s.components.length === 0) throw new Error("Schematic: needs at least one component");
  const ids = new Set<string>();
  for (const c of s.components) {
    if (![c.position.x,c.position.y,c.rotationDeg ?? 0,...(c.pins ?? []).flatMap(p=>[p.x,p.y])].every(Number.isFinite)) throw new Error("Schematic: component geometry must be finite");
    if (!(c.kind in SYMBOL)) throw new Error("Schematic: unsupported component kind");
    if (ids.has(c.id)) throw new Error(`Schematic: duplicate component id ${c.id}`);
    ids.add(c.id);
  }
  for (const w of s.wires) {
    if (![0,1].includes(w.from.pin) || ("componentId" in w.to && ![0,1].includes(w.to.pin))) throw new Error("Schematic: pin must be 0 or 1");
    if ((w.via ?? []).some(p=>![p.x,p.y].every(Number.isFinite)) || ("point" in w.to && ![w.to.point.x,w.to.point.y].every(Number.isFinite))) throw new Error("Schematic: wire coordinates must be finite");
    if (!ids.has(w.from.componentId)) throw new Error(`Schematic: wire references unknown component ${w.from.componentId}`);
    if ("componentId" in w.to && !ids.has(w.to.componentId)) throw new Error(`Schematic: wire references unknown component ${w.to.componentId}`);
  }
}

const SYMBOL: Record<ComponentKind, (c: Component) => { body: SvgElement[]; pin1: { x: number; y: number }; pin2: { x: number; y: number }; width: number; height: number }> = {
  resistor: (c) => {
    const w = 0.6, h = 0.18;
    return {
      body: [
        el("path", { d: `M -${w / 2} 0 l ${w * 0.1} -${h} l ${w * 0.2} ${h * 2} l ${w * 0.2} -${h * 2} l ${w * 0.2} ${h * 2} l ${w * 0.2} -${h * 2} l ${w * 0.1} ${h}`, fill: "none", stroke: "#222", "stroke-width": 1.4 }),
      ],
      pin1: { x: -w / 2, y: 0 },
      pin2: { x: w / 2, y: 0 },
      width: w, height: h * 2,
    };
  },
  capacitor: (c) => {
    const w = 0.3, h = 0.3;
    return {
      body: [
        el("line", { x1: -w / 2, y1: -h / 2, x2: -w / 2, y2: h / 2, stroke: "#222", "stroke-width": 1.6 }),
        el("line", { x1: w / 2, y1: -h / 2, x2: w / 2, y2: h / 2, stroke: "#222", "stroke-width": 1.6 }),
      ],
      pin1: { x: -w / 2, y: 0 },
      pin2: { x: w / 2, y: 0 },
      width: w, height: h,
    };
  },
  inductor: (c) => {
    const w = 0.72, h = w / 8;
    return {
      body: [
        el("path", { d: `M -${w / 2} 0 a ${h} ${h} 0 0 1 ${h * 2} 0 a ${h} ${h} 0 0 1 ${h * 2} 0 a ${h} ${h} 0 0 1 ${h * 2} 0 a ${h} ${h} 0 0 1 ${h * 2} 0`, fill: "none", stroke: "#222", "stroke-width": 1.4 }),
      ],
      pin1: { x: -w / 2, y: 0 },
      pin2: { x: w / 2, y: 0 },
      width: w, height: h * 2,
    };
  },
  "voltage-source": (c) => {
    const r = 0.18;
    return {
      body: [
        el("circle", { cx: 0, cy: 0, r, fill: "#fff", stroke: "#222", "stroke-width": 1.4 }),
        el("line", { x1: -r * 0.7, y1: 0, x2: -r * 0.2, y2: 0, stroke: "#222", "stroke-width": 1.2 }),
        el("line", { x1: -r * 0.45, y1: -r * 0.25, x2: -r * 0.45, y2: r * 0.25, stroke: "#222", "stroke-width": 1.2 }),
        el("line", { x1: r * 0.2, y1: 0, x2: r * 0.7, y2: 0, stroke: "#222", "stroke-width": 1.2 }),
      ],
      pin1: { x: -r, y: 0 },
      pin2: { x: r, y: 0 },
      width: r * 2, height: r * 2,
    };
  },
  "current-source": (c) => {
    const r = 0.18;
    return {
      body: [
        el("circle", { cx: 0, cy: 0, r, fill: "#fff", stroke: "#222", "stroke-width": 1.4 }),
        el("line", { x1: -r * 0.65, y1: 0, x2: r * 0.6, y2: 0, stroke: "#222", "stroke-width": 1.4 }),
        el("path", { d: `M ${r * 0.2} ${r * 0.3} L ${r * 0.6} 0 L ${r * 0.2} -${r * 0.3}`, fill: "none", stroke: "#222", "stroke-width": 1.4 }),
      ],
      pin1: { x: -r, y: 0 },
      pin2: { x: r, y: 0 },
      width: r * 2, height: r * 2,
    };
  },
  switch: (c) => {
    return {
      body: [
        el("line", { x1: -0.2, y1: 0, x2: 0.16, y2: c.closed ? 0 : 0.18, stroke: "#222", "stroke-width": 1.4 }),
        el("line", { x1: 0.16, y1: 0, x2: 0.2, y2: 0, stroke: "#222", "stroke-width": 1.4 }),
      ],
      pin1: { x: -0.2, y: 0 },
      pin2: { x: 0.2, y: 0 },
      width: 0.4, height: 0.2,
    };
  },
  ground: (c) => {
    return {
      body: [
        el("line", { x1: 0, y1: 0, x2: 0, y2: -0.2, stroke: "#222", "stroke-width": 1.4 }),
        el("line", { x1: -0.15, y1: -0.2, x2: 0.15, y2: -0.2, stroke: "#222", "stroke-width": 1.6 }),
        el("line", { x1: -0.1, y1: -0.27, x2: 0.1, y2: -0.27, stroke: "#222", "stroke-width": 1.2 }),
        el("line", { x1: -0.05, y1: -0.34, x2: 0.05, y2: -0.34, stroke: "#222", "stroke-width": 1.2 }),
      ],
      pin1: { x: 0, y: 0 },
      pin2: { x: 0, y: 0 },
      width: 0.3, height: 0.34,
    };
  },
};

function rotate(v: { x: number; y: number }, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const cs = Math.cos(r), sn = Math.sin(r);
  return { x: v.x * cs - v.y * sn, y: v.x * sn + v.y * cs };
}

function worldToView(s: Schematic, p: { x: number; y: number }): { x: number; y: number } {
  const t=sceneTransform({...s,shapes:[]});
  return { x: t.tx+p.x*t.sx, y: t.ty-p.y*t.sy };
}

export function renderSchematic(s: Schematic): string {
  validateSchematic(s);
  const out: SvgElement[] = [];
  // Title
  if (s.title) out.push(text(s.width / 2, 18, s.title, "#222", 14, "middle", "Inter, system-ui, sans-serif", "600"));
  // Pin positions per component
  const pinMap = new Map<string, { pin0: { x: number; y: number }; pin1: { x: number; y: number } }>();
  for (const c of s.components) {
    const sym = SYMBOL[c.kind](c);
    const rot = c.rotationDeg ?? 0; const pins = c.pins ?? [sym.pin1, sym.pin2]; const p1World = { x: c.position.x + rotate(pins[0], rot).x, y: c.position.y + rotate(pins[0], rot).y };
    const p2World = { x: c.position.x + rotate(pins[1], rot).x, y: c.position.y + rotate(pins[1], rot).y };
    pinMap.set(c.id, { pin0: p1World, pin1: p2World });
  }
  // Wires
  for (const w of s.wires) {
    const from = pinMap.get(w.from.componentId)!;
    const fromP = w.from.pin === 0 ? from.pin0 : from.pin1;
    const toP = "point" in w.to ? w.to.point : (() => {
      const t = pinMap.get(w.to.componentId)!;
      return w.to.pin === 0 ? t.pin0 : t.pin1;
    })();
    const points=[fromP,...(w.via ?? []),toP].map(p=>worldToView(s,p));
    for(let i=1;i<points.length;i++) out.push(line(points[i-1].x,points[i-1].y,points[i].x,points[i].y,"#222",1.2));
  }
  // Components
  for (const c of s.components) {
    const sym = SYMBOL[c.kind](c);
    const cRot = c.rotationDeg ?? 0;
    const t=sceneTransform({...s,shapes:[]}),a=cRot*Math.PI/180,cs=Math.cos(a),sn=Math.sin(a),p0=worldToView(s,c.position);
    const body:SvgElement[]=sym.body.map(sh=>({...sh,attrs:{...sh.attrs,"vector-effect":"non-scaling-stroke"}}));
    if(c.pins) for(const [i,p] of [sym.pin1,sym.pin2].entries()) body.push(el("line",{x1:p.x,y1:p.y,x2:c.pins[i].x,y2:c.pins[i].y,stroke:"#222","stroke-width":1.2,"vector-effect":"non-scaling-stroke"}));
    const g = el("g", { "data-component":c.id, transform: `matrix(${t.sx*cs} ${-t.sy*sn} ${-t.sx*sn} ${-t.sy*cs} ${p0.x} ${p0.y})` }, body);
    out.push(g);
    if (c.label || c.value != null) {
      const display = (c.label ?? c.kind) + (c.value != null ? ` (${c.value}${c.unit ?? ""})` : "");
      const off = { x: 0, y: 0.5 };
      const p = worldToView(s, { x: c.position.x + rotate(off, cRot).x, y: c.position.y + rotate(off, cRot).y });
      out.push(text(p.x, p.y, display, "#222", 11, "middle"));
    }
  }
  const root = el("g", {}, out);
  return renderSvg(root, { viewBox: `0 0 ${s.width} ${s.height}`, width: s.width, height: s.height, background: "#fff" });
}

export function schematicArtifact(s: Schematic, title = "Schematic"): ReturnType<typeof createArtifact<"schematic", Schematic>> {
  const a = createArtifact({ kind: "schematic", title, model: s });
  return withRendering(a, "svg", { format: "svg", content: renderSchematic(s), contentType: "image/svg+xml" });
}
