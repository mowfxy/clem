import { test } from "node:test";
import assert from "node:assert/strict";
import { renderScene2D, worldToView, newScene2D } from "../../src/diagram/scene2d.js";
import { buildSceneFromProjectile, projectileAnalytics, renderProjectile } from "../../src/diagram/projectile.js";
import { lensImage, renderOptics, validateOptics } from "../../src/diagram/optics.js";
import type { OpticsModel } from "../../src/diagram/optics.js";
import { buildSceneFromFBD } from "../../src/diagram/freebody.js";
import { scalarContours, renderScalarField, renderVectorField } from "../../src/diagram/fields.js";
import { pulleyTangent, mechanicalAdvantage, buildSceneFromPulley, atwoodDynamics } from "../../src/diagram/pulley.js";
import { renderSchematic } from "../../src/diagram/circuit_schematic.js";
import { layoutLogic, renderLogicSchematic } from "../../src/diagram/logic_schematic.js";
import { defaultElectrostaticRods, renderElectrostaticRods, electrostaticForcePair, validateElectrostaticRods } from "../../src/diagram/electrostatics.js";
import type { Circuit } from "../../src/dld/circuit.js";
import { renderTimingDiagram } from "../../src/diagram/timing_render.js";
const close = (a: number, b: number, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const matrix = (s: string) => s.match(/matrix\(([^)]+)\)/)![1].split(/[ ,]+/).map(Number);
const apply = (m: number[], x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const world = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
test("textbook: vector arrow references resolve to correctly colored definitions", () => {
  const svg = renderScene2D({ ...newScene2D({ width: 600, height: 300, world }), shapes: [
      { kind: "vector", at: { x: 0, y: 0 }, v: { x: 1, y: 1 }, color: "#f00" },
      { kind: "vector", at: { x: 0, y: 0 }, v: { x: 1, y: 1 }, color: "#00f" },
    ] });
  const ids = [...svg.matchAll(/marker-end="url\(#([^)]*)\)"/g)].map(m => m[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  ids.forEach((id, i) => assert.ok(svg.includes(`id="${id}"`) && svg.includes(`fill="${i === 0 ? '#f00' : '#00f'}"`)));
});
test("textbook: anisotropic viewport preserves a 45-degree vector and circle contacts", () => {
  const s = newScene2D({ width: 600, height: 300, world });
  const a = worldToView(s, { x: 0, y: 0 }), b = worldToView(s, { x: 1, y: 1 });
  close(a.x, 300);
  close(a.y, 150);
  close(b.x - a.x, a.y - b.y);
  close(b.x - a.x, 30);
  const svg = renderScene2D({ ...s, shapes: [{ kind: "circle", center: { x: 0, y: 0 }, r: 1 }] });
  const ellipse = attrs(svg.match(/<ellipse[^>]+>/)![0]);
  close(Number(ellipse.rx), 30);
  close(Number(ellipse.ry), 30);
});
test("textbook: world path transformation maps to the same pixels as point geometry", () => {
  const svg = renderScene2D({ ...newScene2D({ width: 600, height: 300, world }), shapes: [{ kind: "path", d: "M 1 2 L 3 4" }] });
  const p = apply(matrix(svg), 1, 2);
  close(p.x, 330);
  close(p.y, 90);
  assert.ok(svg.includes('vector-effect="non-scaling-stroke"'));
});
test("textbook: scenes reject nonfinite shape geometry and invalid world bounds", () => {
  assert.throws(() => renderScene2D({ width: 600, height: 300, world, shapes: [{ kind: "point", at: { x: Infinity, y: 0 } }] }), /finite/);
  assert.throws(() => renderScene2D({ width: 600, height: 300, world: { ...world, xMax: NaN }, shapes: [] }), /finite/);
});
const projectile = { width: 600, height: 360, initialPosition: { x: 0, y: 20 }, initialSpeed: 15, launchAngleDeg: 30, gravity: 9.81 };
test("textbook: rendered projectile starts at its launch dot and stops at impact", () => {
  const scene = buildSceneFromProjectile(projectile), svg = renderScene2D(scene);
  const path = svg.match(/<path d="M ([^ ]+) ([^ ]+)[^"]*"[^>]*transform="matrix\(([^)]+)\)"[^>]*>/)!;
  const start = apply(path[3].split(/[ ,]+/).map(Number), Number(path[1]), Number(path[2]));
  const dot = attrs(svg.match(/<circle[^>]+fill="#c0392b"[^>]*>/)![0]);
  close(start.x, Number(dot.cx));
  close(start.y, Number(dot.cy));
  const d = scene.shapes.find(s => s.kind === "path")!;
  assert.equal(d.kind, "path");
  if (d.kind !== "path")
    return;
  const numbers = d.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  close(numbers.at(-1)!, 0);
  const time = (7.5 + Math.sqrt(7.5 ** 2 + 2 * 9.81 * 20)) / 9.81;
  close(numbers.at(-2)!, 15 * Math.cos(Math.PI / 6) * time);
});
test("textbook: partial projectile interval excludes future apex and impact labels", () => {
  const s = buildSceneFromProjectile({ ...projectile, tMax: 0.2 });
  assert.ok(!s.shapes.some(p => p.kind === "point" && /apex|range/.test(p.label ?? "")));
});
test("textbook: unsupported drag, zero gravity and fractional samples fail explicitly", () => {
  assert.throws(() => renderProjectile({ ...projectile, drag: 0.2 }), /drag/);
  assert.throws(() => projectileAnalytics({ ...projectile, gravity: 0 }), /positive/);
  assert.throws(() => renderProjectile({ ...projectile, samples: 2.5 }), /integer/);
});
const optic = { width: 800, height: 450, world: { xMin: -6, xMax: 6, yMin: -3, yMax: 3 }, objectBase: { x: -2, y: 0 }, objectHeight: 0.3 };
for (const kind of ["thin-lens-converging", "thin-lens-diverging", "concave-mirror", "convex-mirror"] as const) {
  for (const u of [0.5, 2, 3])
    test(`textbook: ${kind}, u=${u}: principal rays locate the computed image`, () => {
      const positive = kind === "thin-lens-converging" || kind === "concave-mirror";
      const m: OpticsModel = { ...optic, objectBase: { x: -u, y: 0 }, element: { kind, x: 0, y: 0, focal: positive ? 1 : -1, ...(kind.includes("mirror") ? { radius: 2 } : {}) } as OpticsModel["element"] };
      const r = lensImage(m), outgoing = r.rayPath.filter(p => !p.dashed && Math.abs(p.from.x) < 1e-9);
      assert.equal(outgoing.length, 2);
      for (const ray of outgoing) {
        const slope = (ray.to.y - ray.from.y) / (ray.to.x - ray.from.x);
        close(ray.from.y + slope * (r.imageBase.x - ray.from.x), r.imageHeight);
      }
      const expectedV = 1 / ((positive ? 1 : -1) - 1 / u);
      close(r.imageBase.x, (kind.includes("mirror") ? -1 : 1) * expectedV);
      close(r.magnification, -expectedV / u);
      assert.equal(r.virtual, expectedV < 0);
      if (r.virtual)
        assert.equal(r.rayPath.filter(p => p.dashed).length, 2);
      assert.ok(!/NaN|Infinity/.test(renderOptics(m)));
    });
}
test("textbook: object at focus has parallel outgoing rays and no infinite SVG coordinates", () => {
  const m: OpticsModel = { ...optic, objectBase: { x: -1, y: 0 }, element: { kind: "thin-lens-converging", x: 0, y: 0, focal: 1 } };
  const r = lensImage(m), rays = r.rayPath.filter(p => !p.dashed && p.from.x === 0);
  assert.equal(r.atInfinity, true);
  close((rays[0].to.y - rays[0].from.y) / (rays[0].to.x - rays[0].from.x), (rays[1].to.y - rays[1].from.y) / (rays[1].to.x - rays[1].from.x));
  assert.ok(renderOptics(m).includes("image at infinity"));
  assert.ok(!/NaN|Infinity/.test(renderOptics(m)));
});
test("textbook: translated optical axis preserves the image and wrong focal signs are rejected", () => {
  const m: OpticsModel = { ...optic, objectBase: { x: -2, y: 1 }, element: { kind: "thin-lens-converging", x: 0, y: 1, focal: 1 } };
  close(lensImage(m).imageBase.y, 1);
  assert.throws(() => validateOptics({ ...m, element: { ...m.element, focal: -1 } }), /focal sign/);
});
test("textbook: rotated FBD projections align to the displayed frame and share a force scale", () => {
  const s = buildSceneFromFBD({ width: 600, height: 400, world, bodyPosition: { x: 0, y: 0 }, bodySize: { w: 1, h: 1 }, frameAngleDeg: 30, showComponents: true, forces: [
      { point: { x: 0, y: 0 }, components: { x: 0, y: -10 }, magnitude: 10, unit: "N", label: "A" },
      { point: { x: 0, y: 0 }, components: { x: 0, y: 20 }, magnitude: 20, unit: "N", label: "B" },
    ] });
  assert.equal(s.axes, undefined);
  const forces = s.shapes.filter(p => p.kind === "vector" && /^[AB] =/.test(p.label ?? ""));
  assert.equal(forces.length, 2);
  if (forces[0].kind !== "vector" || forces[1].kind !== "vector")
    return;
  close(Math.hypot(forces[1].v.x, forces[1].v.y) / Math.hypot(forces[0].v.x, forces[0].v.y), 2);
  const component = s.shapes.find(p => p.kind === "segment" && p.dashed)!;
  if (component.kind !== "segment")
    return;
  close((component.to.y - component.from.y) / (component.to.x - component.from.x), Math.tan(Math.PI / 6));
});
test("textbook: linear contours are nondegenerate and lie on the requested level", () => {
  const segments = scalarContours({ type: "scalar", width: 600, height: 400, world, cols: 8, rows: 8, field: p => p.x + 2 * p.y, contours: [0.123] });
  assert.ok(segments.length > 0);
  for (const s of segments) {
    assert.ok(Math.hypot(s.from.x - s.to.x, s.from.y - s.to.y) > 0);
    close(s.from.x + 2 * s.from.y, 0.123);
    close(s.to.x + 2 * s.to.y, 0.123);
  }
});
test("textbook: scalar singularities are omitted from contours and never emit NaN colors", () => {
  const svg = renderScalarField({ type: "scalar", width: 600, height: 400, world, cols: 3, rows: 3, field: p => 1 / (p.x * p.x + p.y * p.y), contours: [1] });
  assert.ok(!/NaN|Infinity/.test(svg));
  assert.ok(svg.includes("gray = undefined"));
  assert.throws(() => renderVectorField({ type: "vector", width: 600, height: 400, world, cols: Infinity, rows: 3, field: () => ({ x: 1, y: 0 }) }), /integers/);
});
test("textbook: rope contacts lie on the wheel and are tangent to its radius", () => {
  for (const side of ["left", "right"] as const) {
    const p = { x: side === "left" ? -1.5 : 1.5, y: -2 }, c = { x: 0, y: 1 }, r = 0.6, t = pulleyTangent(p, c, r, side);
    close(Math.hypot(t.x - c.x, t.y - c.y), r);
    close((p.x - t.x) * (t.x - c.x) + (p.y - t.y) * (t.y - c.y), 0);
  }
});
test("textbook: a single anchored movable pulley has two supporting strands", () => {
  const m = { width: 600, height: 400, world, pulleys: [{ center: { x: 0, y: 1 }, radius: 0.5, fixed: false }], masses: [{ mass: 2, position: { x: 0, y: -1 }, size: { w: 0.5, h: 0.5 } }], configuration: "movable" as const, tension: 9.81 };
  assert.equal(mechanicalAdvantage(m), 2);
  const s = buildSceneFromPulley(m), wrap = s.shapes.find(p => p.kind === "arc");
  assert.ok(wrap?.kind === "arc" && wrap.fromDeg === 180 && wrap.toDeg === 360);
  const d = atwoodDynamics(2, 3);
  close(3 * 9.81 - d.tension, 3 * d.acceleration);
  close(d.tension - 2 * 9.81, 2 * d.acceleration);
});
test("textbook: rotated circuit wire reaches the actual resistor symbol terminal", () => {
  const svg = renderSchematic({ width: 600, height: 600, world, components: [{ id: "R", kind: "resistor", position: { x: 0, y: 0 }, rotationDeg: 90 }], wires: [{ from: { componentId: "R", pin: 0 }, to: { point: { x: 0, y: -2 } } }] });
  const group = svg.match(/<g data-component="R"[^>]+>/)![0];
  const pin = apply(matrix(group), -0.3, 0), wire = attrs(svg.match(/<line[^>]+>/)![0]);
  close(pin.x, Number(wire.x1));
  close(pin.y, Number(wire.y1));
  close(pin.y, 318);
});
const circuit: Circuit = { id: "test", name: "AND", inputs: [{ id: "a", label: "A" }, { id: "b", label: "B" }], outputs: [], nets: [], metadata: {}, gates: [
    { id: "a", kind: "INPUT", inputs: [], output: "na" }, { id: "b", kind: "INPUT", inputs: [], output: "nb" }, { id: "g", kind: "AND", inputs: ["na", "nb"], output: "ng" },
  ] };
test("textbook: independent logic inputs terminate at distinct terminals", () => {
  const svg = renderLogicSchematic({ circuit, width: 600, height: 400 });
  const paths = [...svg.matchAll(/<path data-net="[^"]+" data-input="g:[01]" d="([^"]+)"/g)];
  assert.equal(paths.length, 2);
  assert.notEqual(paths[0][1].match(/V ([^ ]+)/)![1], paths[1][1].match(/V ([^ ]+)/)![1]);
  const ordered = layoutLogic(circuit), reverse = layoutLogic({ ...circuit, gates: [...circuit.gates].reverse() });
  assert.deepEqual([...ordered], [...reverse]);
});
test("textbook: charged rods have equal/opposite forces and sign-correct interaction", () => {
  const a = { x: 0, y: 0 }, b = { x: 3, y: 4 };
  for (const q of [-1, 1]) {
    const p = electrostaticForcePair(-1, q, a, b, 2);
    close(p.onA.x + p.onB.x, 0);
    close(p.onA.y + p.onB.y, 0);
    close(Math.hypot(p.onA.x, p.onA.y), 2);
    assert.equal(p.interaction, q === 1 ? "attraction" : "repulsion");
    assert.equal(Math.sign(p.onA.x * 3 + p.onA.y * 4), q === 1 ? 1 : -1);
  }
});
test("textbook: charged-rod SVG preserves force equality after projection and escapes labels", () => {
  const m = defaultElectrostaticRods(), svg = renderElectrostaticRods({ ...m, suspended: { ...m.suspended, label: 'Rubber < & "' } });
  const arrows = [...svg.matchAll(/<line data-force="[^"]+"[^>]+>/g)].map(x => attrs(x[0]));
  assert.equal(arrows.length, 2);
  close(Number(arrows[0].x2) - Number(arrows[0].x1), -(Number(arrows[1].x2) - Number(arrows[1].x1)));
  close(Number(arrows[0].y2) - Number(arrows[0].y1), -(Number(arrows[1].y2) - Number(arrows[1].y1)));
  assert.ok(svg.includes("Rubber &lt; &amp; &quot;"));
  assert.equal(renderElectrostaticRods(m), renderElectrostaticRods(m));
  assert.ok(!/NaN|Infinity/.test(svg));
});
test("textbook: charged-rod model rejects touching rods and invalid suspension", () => {
  const m = defaultElectrostaticRods();
  assert.throws(() => validateElectrostaticRods({ ...m, nearby: { ...m.suspended } }), /separated/);
  assert.throws(() => validateElectrostaticRods({ ...m, suspension: { ...m.suspension, fork: { x: 0, y: 0 } } }), /above/);
});

test("textbook: timing renderer consumes canonical transitions and carries state into a cropped interval",()=>{
  const svg=renderTimingDiagram({name:"Clock",signals:["CLK"],duration:10,transitions:[{time:1,signal:"CLK",to:1},{time:6,signal:"CLK",to:0}],annotations:[{time:6,text:"fall"}]},{width:600,height:240,tMin:2,tMax:8});
  const waves=[...svg.matchAll(/<line[^>]+data-signal="CLK"[^>]*>/g)].map(m=>attrs(m[0]));
  assert.equal(waves.length,2);assert.equal(waves[0]["data-value"],"1");assert.equal(waves[1]["data-value"],"0");
  close(Number(waves[0].x1),50);close(Number(waves[0].x2),50+4/6*534);close(Number(waves[1].x2),584);
  assert.ok(svg.includes("fall"));assert.ok(!/NaN|Infinity/.test(svg));
});
