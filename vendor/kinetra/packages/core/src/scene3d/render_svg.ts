/**
 * 3D scene renderer. Consumes a structured Scene3DModel and produces an
 * SVG via deterministic perspective projection with backface culling
 * and a painter''s-algorithm sort.
 */

import { createArtifact, withRendering } from "../artifacts.js";
import { el, line, renderSvg, text } from "../diagram/primitives.js";
import type { Color } from "../diagram/primitives.js";
import type { SvgElement } from "../diagram/primitives.js";
import { validateScene3D } from "./types.js";
import type { Object3D, Scene3DModel, Vec3 } from "./types.js";
import { add, eulerXYZ, length, mulMat4, sub, transformPoint, translation } from "./coords.js";
import { buildView, cameraPosition, isFrontFacing, project } from "./projection.js";
import type { View } from "./projection.js";

interface RenderedPrimitive {
  z: number;
  draw: (g: SvgElement[], defs: string[]) => void;
}

export function renderScene3D(model: Scene3DModel): string {
  validateScene3D(model);
  const view = buildView({
    camera: model.camera,
    width: model.width,
    height: model.height,
    perspective: true,
  });
  const primitives: RenderedPrimitive[] = [];
  const defs: string[] = [];

  // Axes
  const ax = model.axes;
  primitives.push(makeArrow(view, add(ax.origin, scale(ax.x, ax.length)), ax.origin, "#c0392b", ax.labels.x));
  primitives.push(makeArrow(view, add(ax.origin, scale(ax.y, ax.length)), ax.origin, "#117a3a", ax.labels.y));
  primitives.push(makeArrow(view, add(ax.origin, scale(ax.z, ax.length)), ax.origin, "#1f4f8b", ax.labels.z));

  for (const o of model.objects) {
    primitives.push(objectToPrimitive(o, view));
  }
  for (const l of model.labels) {
    primitives.push(makeLabel(view, l.at, l.text, l.color ?? "#222"));
  }
  for (const a of model.annotations) {
    primitives.push(makeLabel(view, a.at, a.text, a.color ?? "#555"));
  }

  primitives.sort((p, q) => q.z - p.z);

  const out: SvgElement[] = [];
  if (model.title) out.push(text(model.width / 2, 18, model.title, "#222", 14, "middle", "Inter, system-ui, sans-serif", "600"));
  for (const p of primitives) p.draw(out, defs);

  const root = el("g", {}, out);
  return renderSvg(root, { viewBox: `0 0 ${model.width} ${model.height}`, width: model.width, height: model.height, background: model.background ?? "#fff", defs: defs.join("") });
}

function scale(v: Vec3, s: number): Vec3 { return { x: v.x * s, y: v.y * s, z: v.z * s }; }

function makeArrow(view: View, to: Vec3, from: Vec3, color: Color, label?: string): RenderedPrimitive {
  const a = project(view, from);
  const b = project(view, to);
  const id = "arr3d-" + Math.abs(Math.floor(a.x * 13 + a.y * 31 + b.x * 7 + b.y * 17)) % 100000;
  return {
    z: (a.depth + b.depth) / 2,
    draw: (g, defs) => {
      defs.push(`<marker id="${id}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="${color}"/></marker>`);
      g.push(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, "stroke-width": 1.6, "marker-end": `url(#${id})` }));
      if (label) g.push(text(b.x + 4, b.y - 4, label, color, 10, "start"));
    },
  };
}

function makeLine(view: View, from: Vec3, to: Vec3, color: Color, label?: string): RenderedPrimitive {
  const a = project(view, from);
  const b = project(view, to);
  return {
    z: (a.depth + b.depth) / 2,
    draw: (g) => {
      g.push(line(a.x, a.y, b.x, b.y, color, 1.4));
      if (label) g.push(text((a.x + b.x) / 2, (a.y + b.y) / 2, label, color, 10, "middle"));
    },
  };
}

function makeLabel(view: View, at: Vec3, text0: string, color: Color): RenderedPrimitive {
  const p = project(view, at);
  return {
    z: p.depth,
    draw: (g) => {
      g.push(text(p.x + 4, p.y - 4, text0, color, 10, "start"));
    },
  };
}

function objectToPrimitive(o: Object3D, view: View): RenderedPrimitive {
  switch (o.kind) {
    case "sphere": {
      const r = o.radius ?? 0.5;
      const proj = project(view, o.position);
      const cameraPos = cameraPosition(view);
      return {
        z: proj.depth,
        draw: (g) => {
          const dist = Math.max(0.5, length(sub(cameraPos, o.position)));
          const radius = (r * 60) / dist;
          g.push(el("circle", { cx: proj.x, cy: proj.y, r: Math.max(2, radius), fill: o.color ?? "#cfe4ff", stroke: "#1f4f8b", "stroke-width": 1 }));
          if (o.label) g.push(text(proj.x + 6, proj.y - 6, o.label, "#222", 10, "start"));
        },
      };
    }
    case "box": {
      const s = o.size ?? { w: 1, h: 1, d: 1 };
      const half = { x: s.w / 2, y: s.h / 2, z: s.d / 2 };
      const corners: Vec3[] = [
        { x: -half.x, y: -half.y, z: -half.z }, { x: half.x, y: -half.y, z: -half.z },
        { x: half.x, y: half.y, z: -half.z }, { x: -half.x, y: half.y, z: -half.z },
        { x: -half.x, y: -half.y, z: half.z }, { x: half.x, y: -half.y, z: half.z },
        { x: half.x, y: half.y, z: half.z }, { x: -half.x, y: half.y, z: half.z },
      ];
      const faces = [
        [0, 1, 2, 3], [4, 5, 6, 7],
        [0, 1, 5, 4], [2, 3, 7, 6],
        [1, 2, 6, 5], [0, 3, 7, 4],
      ];
      const m = mulMat4(translation(o.position.x, o.position.y, o.position.z), eulerXYZ(o.rotation ?? { x: 0, y: 0, z: 0 }));
      const transformed = corners.map((c) => transformPoint(m, c));
      const projected = transformed.map((c) => project(view, c));
      const depth = projected.reduce((a, p) => a + p.depth, 0) / projected.length;
      return {
        z: depth,
        draw: (g) => {
          for (const f of faces) {
            const pts = f.map((i) => projected[i]);
            if (isFrontFacing(view.camera, projected[f[0]], projected[f[1]], projected[f[2]])) {
              const d = `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ") + " Z";
              g.push(el("path", { d, fill: o.color ?? "#cfe4ff", stroke: "#1f4f8b", "stroke-width": 0.8, "fill-opacity": 0.7 }));
            }
          }
          if (o.label) g.push(text(projected[0].x + 4, projected[0].y - 4, o.label, "#222", 10, "start"));
        },
      };
    }
    case "arrow":
    case "vector": {
      const from = o.position;
      const to = o.to ?? add(o.position, { x: 1, y: 0, z: 0 });
      return makeArrow(view, to, from, o.color ?? "#222", o.label);
    }
    case "line": {
      const from = o.from ?? o.position;
      const to = o.to ?? o.position;
      return makeLine(view, from, to, o.color ?? "#222", o.label);
    }
    case "point": {
      const p = project(view, o.position);
      return {
        z: p.depth,
        draw: (g) => {
          g.push(el("circle", { cx: p.x, cy: p.y, r: 3, fill: o.color ?? "#222" }));
          if (o.label) g.push(text(p.x + 5, p.y - 5, o.label, "#222", 10, "start"));
        },
      };
    }
    case "plane": {
      const s = o.size ?? { w: 1, h: 1, d: 0 };
      const corners: Vec3[] = [
        { x: -s.w / 2, y: -s.h / 2, z: 0 }, { x: s.w / 2, y: -s.h / 2, z: 0 },
        { x: s.w / 2, y: s.h / 2, z: 0 }, { x: -s.w / 2, y: s.h / 2, z: 0 },
      ];
      const m = mulMat4(translation(o.position.x, o.position.y, o.position.z), eulerXYZ(o.rotation ?? { x: 0, y: 0, z: 0 }));
      const transformed = corners.map((c) => transformPoint(m, c));
      const projected = transformed.map((c) => project(view, c));
      const depth = projected.reduce((a, p) => a + p.depth, 0) / projected.length;
      return {
        z: depth,
        draw: (g) => {
          const d = `M ${projected[0].x} ${projected[0].y} ` + projected.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ") + " Z";
          g.push(el("path", { d, fill: o.color ?? "#cfe4ff", stroke: "#1f4f8b", "stroke-width": 0.8, "fill-opacity": 0.5 }));
          if (o.label) g.push(text(projected[0].x + 4, projected[0].y - 4, o.label, "#222", 10, "start"));
        },
      };
    }
    case "trajectory": {
      const pts = o.points ?? [];
      const projected = pts.map((p) => project(view, p));
      const depth = projected.reduce((a, p) => a + p.depth, 0) / Math.max(1, projected.length);
      return {
        z: depth,
        draw: (g) => {
          for (let i = 0; i < projected.length - 1; i++) {
            g.push(line(projected[i].x, projected[i].y, projected[i + 1].x, projected[i + 1].y, o.color ?? "#7a3a11", 1.4));
          }
        },
      };
    }
  }
}

export function scene3dArtifact(m: Scene3DModel, title = "3D scene"): ReturnType<typeof createArtifact<"scene-3d", Scene3DModel>> {
  const a = createArtifact({ kind: "scene-3d", title, model: m });
  return withRendering(a, "svg", { format: "svg", content: renderScene3D(m), contentType: "image/svg+xml" });
}
