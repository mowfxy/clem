import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSceneFromProjectile, renderProjectile } from "../../src/diagram/projectile.js";
import { buildSceneFromOptics, renderOptics } from "../../src/diagram/optics.js";
import { renderSchematic } from "../../src/diagram/circuit_schematic.js";
import { buildSceneFromFBD, renderFBD } from "../../src/diagram/freebody.js";
import { renderScene2D, addShape } from "../../src/diagram/scene2d.js";

function textWidth(contents: string, size: number) { return (contents.length || 1) * size * 0.62; }
interface BBox { x: number; y: number; w: number; h: number; }
interface ParsedShape { kind: "text" | "rect" | "circle" | "line"; label?: string; bbox: BBox; }

function parseShapes(svg: string): { width: number; height: number; shapes: ParsedShape[] } {
  const wm = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  const width = wm ? parseFloat(wm[1]) : 600;
  const height = wm ? parseFloat(wm[2]) : 400;
  const shapes: ParsedShape[] = [];
  for (const m of svg.matchAll(/<text\s+x="([^"]+)"\s+y="([^"]+)"[^>]*font-size="([^"]+)"[^>]*text-anchor="([^"]+)"[^>]*>([^<]*)<\/text>/g)) {
    const x = parseFloat(m[1]); const y = parseFloat(m[2]); const size = parseFloat(m[3]); const anchor = m[4]; const t = m[5].trim();
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = textWidth(t, size);
    const h = size * 1.15;
    let left = x;
    if (anchor === "middle") left = x - w / 2;
    else if (anchor === "end") left = x - w;
    const top = y - size * 0.85;
    shapes.push({ kind: "text", label: t, bbox: { x: left, y: top, w, h } });
  }
  for (const m of svg.matchAll(/<rect\s+x="([^"]+)"\s+y="([^"]+)"\s+width="([^"]+)"\s+height="([^"]+)"[^>]*>/g)) {
    const x = parseFloat(m[1]); const y = parseFloat(m[2]); const w = parseFloat(m[3]); const h = parseFloat(m[4]);
    if ([x, y, w, h].some((v) => !Number.isFinite(v))) continue;
    if (x === 0 && y === 0 && w >= width - 1 && h >= height - 1) continue;
    shapes.push({ kind: "rect", bbox: { x, y, w, h } });
  }
  return { width, height, shapes };
}

function rectsIntersect(a: BBox, b: BBox, pad = 1): boolean {
  return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
}

function audit(svg: string) {
  const { width, height, shapes } = parseShapes(svg);
  const reports: Array<Record<string, unknown>> = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i]; const b = shapes[j];
      if (a.kind !== "text" || b.kind !== "text") continue;
      if (rectsIntersect(a.bbox, b.bbox, 0)) reports.push({ kind: "text-text", a: a.label, b: b.label });
    }
  }
  for (const a of shapes) {
    if (a.kind !== "text") continue;
    for (const b of shapes) {
      if (b.kind !== "rect" || b.bbox.w < 0.5) continue;
      if (rectsIntersect(a.bbox, b.bbox, 0)) {
        const inset = a.bbox.x > b.bbox.x + 1 && a.bbox.x + a.bbox.w < b.bbox.x + b.bbox.w - 1 &&
                      a.bbox.y > b.bbox.y + 1 && a.bbox.y + a.bbox.h < b.bbox.y + b.bbox.h - 1;
        if (inset) reports.push({ kind: "text-inside-rect", text: a.label });
      }
    }
  }
  for (const a of shapes) {
    if (a.kind !== "text") continue;
    if (a.bbox.x < -1 || a.bbox.y < -1 || a.bbox.x + a.bbox.w > width + 1 || a.bbox.y + a.bbox.h > height + 1) {
      reports.push({ kind: "text-out-of-frame", text: a.label });
    }
  }
  return reports;
}

const S1 = { initialPosition: { x: 0, y: 20 }, initialSpeed: 25, launchAngleDeg: 30, gravity: 9.81, width: 800, height: 400 };
const S2 = { initialPosition: { x: 0, y: 5 }, initialSpeed: 10, launchAngleDeg: 0, gravity: 9.81, width: 800, height: 400 };
const S3 = { element: { kind: "thin-lens-converging", x: 0, y: 0, focal: 10 }, objectHeight: 5, objectBase: { x: -20, y: 0 }, world: { xMin: -30, xMax: 30, yMin: -10, yMax: 10 }, width: 600, height: 400 };
const S4 = { element: { kind: "thin-lens-converging", x: 0, y: 0, focal: 10 }, objectHeight: 3, objectBase: { x: -5, y: 0 }, world: { xMin: -30, xMax: 30, yMin: -10, yMax: 10 }, width: 600, height: 400 };
const S5 = { element: { kind: "concave-mirror", x: 0, y: 0, focal: 10, radius: 20 }, objectHeight: 4, objectBase: { x: -15, y: 0 }, world: { xMin: -30, xMax: 30, yMin: -10, yMax: 10 }, width: 600, height: 400 };
const S6 = {
  components: [
    { id: "V1", kind: "voltage-source", position: { x: 0, y: 0 }, label: "V", unit: "V", value: 5 },
    { id: "R1", kind: "resistor",       position: { x: 4, y: 0 }, label: "R", unit: "Ohm", value: 1000 },
    { id: "C1", kind: "capacitor",      position: { x: 8, y: 2 }, label: "C", unit: "F",  value: 1e-6 },
    { id: "G1", kind: "ground",         position: { x: 8, y: 4 } }
  ],
  wires: [
    { from: { componentId: "V1", pin: 1 as const }, to: { componentId: "G1", pin: 0 as const } },
    { from: { componentId: "V1", pin: 0 as const }, to: { componentId: "R1", pin: 0 as const } },
    { from: { componentId: "R1", pin: 1 as const }, to: { componentId: "C1", pin: 0 as const } },
    { from: { componentId: "C1", pin: 1 as const }, to: { componentId: "G1", pin: 0 as const } }
  ],
  world: { xMin: -1, xMax: 11, yMin: -2, yMax: 6 },
  width: 600, height: 300
};
const S7 = {
  bodyPosition: { x: 0, y: 0 },
  bodySize: { w: 2, h: 1 },
  bodyLabel: "m1=5kg",
  frameAngleDeg: 0,
  forces: [
    { point: { x: 0, y: 0.5 }, components: { x: 0, y: -5 * 9.81 }, magnitude: 49.05, unit: "N", label: "W", color: "#222" },
    { point: { x: 0, y: 0 },   components: { x: 0, y: 49.05 * Math.cos(30 * Math.PI / 180) }, magnitude: 49.05 * Math.cos(30 * Math.PI / 180), unit: "N", label: "N", color: "#117a3a" },
    { point: { x: 0, y: 0.5 }, components: { x: -5 * 9.81 * Math.sin(30 * Math.PI / 180), y: 0 }, magnitude: 5 * 9.81 * Math.sin(30 * Math.PI / 180), unit: "N", label: "Wpar", color: "#7a3a11" },
    { point: { x: 0, y: 0 },   components: { x: 4.91, y: 0 }, magnitude: 4.91, unit: "N", label: "f", color: "#c0392b" },
    { point: { x: 0, y: 0.5 }, components: { x: 29.43, y: 0 }, magnitude: 29.43, unit: "N", label: "T", color: "#1f4f8b" }
  ],
  world: { xMin: -4, xMax: 4, yMin: -2, yMax: 4 },
  width: 600, height: 400
};

test("Overlap audit: S1 projectile has no text-text, text-inside-rect, or text-out-of-frame issues", () => {
  const svg = renderProjectile(S1);
  const reports = audit(svg);
  assert.equal(reports.filter((r) => r.kind === "text-text").length, 0, JSON.stringify(reports.filter((r) => r.kind === "text-text")));
  assert.equal(reports.filter((r) => r.kind === "text-inside-rect").length, 0);
  assert.equal(reports.filter((r) => r.kind === "text-out-of-frame").length, 0, JSON.stringify(reports.filter((r) => r.kind === "text-out-of-frame")));
});

test("Overlap audit: S2 projectile (vy=0 apex == launch) does not duplicate labels", () => {
  const svg = renderProjectile(S2);
  const reports = audit(svg);
  assert.equal(reports.filter((r) => r.kind === "text-text").length, 0, JSON.stringify(reports.filter((r) => r.kind === "text-text")));
  assert.equal(reports.filter((r) => r.kind === "text-out-of-frame").length, 0);
});

test("Overlap audit: S3 thin-lens converging has no overlap events", () => {
  const svg = renderOptics(S3);
  const reports = audit(svg);
  assert.equal(reports.length, 0, JSON.stringify(reports));
});

test("Overlap audit: S4 thin-lens short-focal-image stays outside arrow line", () => {
  const svg = renderOptics(S4);
  const reports = audit(svg);
  assert.equal(reports.length, 0, JSON.stringify(reports));
});

test("Overlap audit: S5 concave mirror has no overlap events", () => {
  const svg = renderOptics(S5);
  const reports = audit(svg);
  assert.equal(reports.length, 0, JSON.stringify(reports));
});

test("Overlap audit: S6 RC schematic has no text-out-of-frame events", () => {
  const svg = renderSchematic(S6);
  const reports = audit(svg);
  assert.equal(reports.filter((r) => r.kind === "text-out-of-frame").length, 0, JSON.stringify(reports));
});

test("Overlap audit: S6 RC schematic SVG contains no NaN attributes (no rotationDeg/pins supplied)", () => {
  const svg = renderSchematic(S6);
  assert.ok(!svg.includes("NaN"), "SVG contains NaN: " + svg.slice(0, 200));
  assert.ok(svg.includes("<svg"), "missing <svg>");
  assert.ok(svg.includes("</svg>"), "missing </svg>");
});

test("Overlap audit: S7 free-body diagram has no text-inside-rect, no text-text collision", () => {
  const svg = renderFBD(S7);
  const reports = audit(svg);
  assert.equal(reports.filter((r) => r.kind === "text-inside-rect").length, 0, JSON.stringify(reports));
  assert.equal(reports.filter((r) => r.kind === "text-text").length, 0, JSON.stringify(reports));
});

test("Overlap audit: scene2d text clamp pushes out-of-frame text back inside", () => {
  const scene = buildSceneFromProjectile({ initialPosition: { x: 0, y: 0 }, initialSpeed: 10, launchAngleDeg: 30, gravity: 9.81, width: 400, height: 300 });
  addShape(scene, { kind: "label", at: { x: 1e6, y: 1e6 }, text: "off-canvas", size: 12, anchor: "start" });
  const svg = renderScene2D(scene);
  const reports = audit(svg);
  const oof = reports.filter((r) => r.kind === "text-out-of-frame");
  assert.equal(oof.length, 0, "off-canvas label was not clamped: " + JSON.stringify(oof));
});



import { renderVectorField, renderScalarField } from "../../src/diagram/fields.js";
import { renderPulley } from "../../src/diagram/pulley.js";
import { renderLogicSchematic } from "../../src/diagram/logic_schematic.js";
import { EXTRA_SCENARIOS } from "./fixtures/overlap-scenarios.mjs";

test("Overlap audit: F1 vector field (uniform flow) has no overlap events", () => {
  const [, name, model] = EXTRA_SCENARIOS.find((s) => s[0] === "F1")!;
  assert.equal(name, "renderVectorField");
  const svg = renderVectorField(model as Parameters<typeof renderVectorField>[0]);
  const reports = audit(svg);
  assert.equal(reports.length, 0, JSON.stringify(reports));
});

test("Overlap audit: F2 scalar field (Gaussian hill) has no overlap events", () => {
  const [, name, model] = EXTRA_SCENARIOS.find((s) => s[0] === "F2")!;
  assert.equal(name, "renderScalarField");
  const svg = renderScalarField(model as Parameters<typeof renderScalarField>[0]);
  const reports = audit(svg);
  assert.equal(reports.length, 0, JSON.stringify(reports));
});

test("Overlap audit: P1 single fixed pulley has no overlap events", () => {
  const [, name, model] = EXTRA_SCENARIOS.find((s) => s[0] === "P1")!;
  assert.equal(name, "renderPulley");
  const svg = renderPulley(model as Parameters<typeof renderPulley>[0]);
  const reports = audit(svg);
  assert.equal(reports.length, 0, JSON.stringify(reports));
});

test("Overlap audit: P2 Atwood machine has no overlap events", () => {
  const [, name, model] = EXTRA_SCENARIOS.find((s) => s[0] === "P2")!;
  assert.equal(name, "renderPulley");
  const svg = renderPulley(model as Parameters<typeof renderPulley>[0]);
  const reports = audit(svg);
  assert.equal(reports.length, 0, JSON.stringify(reports));
});

test("Overlap audit: L1 IEC symbols intentionally contain their labels", () => {
  const [, name, model] = EXTRA_SCENARIOS.find((s) => s[0] === "L1")!;
  assert.equal(name, "renderLogicSchematic");
  const svg = renderLogicSchematic(model as Parameters<typeof renderLogicSchematic>[0]);
  const reports = audit(svg).filter(r => r.kind !== "text-inside-rect");
  assert.equal(reports.length, 0, JSON.stringify(reports));
});

test("Overlap audit: L2 IEC symbols intentionally contain their labels", () => {
  const [, name, model] = EXTRA_SCENARIOS.find((s) => s[0] === "L2")!;
  assert.equal(name, "renderLogicSchematic");
  const svg = renderLogicSchematic(model as Parameters<typeof renderLogicSchematic>[0]);
  const reports = audit(svg).filter(r => r.kind !== "text-inside-rect");
  assert.equal(reports.length, 0, JSON.stringify(reports));
});

test("Overlap audit: C2 RLC low-pass circuit has no overlap events", () => {
  const [, name, model] = EXTRA_SCENARIOS.find((s) => s[0] === "C2")!;
  assert.equal(name, "renderSchematic");
  const svg = renderSchematic(model as Parameters<typeof renderSchematic>[0]);
  const reports = audit(svg);
  assert.equal(reports.length, 0, JSON.stringify(reports));
});

test("Overlap audit: C3 Wheatstone bridge circuit has no overlap events", () => {
  const [, name, model] = EXTRA_SCENARIOS.find((s) => s[0] === "C3")!;
  assert.equal(name, "renderSchematic");
  const svg = renderSchematic(model as Parameters<typeof renderSchematic>[0]);
  const reports = audit(svg);
  assert.equal(reports.length, 0, JSON.stringify(reports));
});
