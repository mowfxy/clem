import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSceneFromFBD, validateFBD, magnitudeFromComponents, componentsFromPolar, angleFromComponents,
} from "../../src/diagram/freebody.js";
import {
  projectilePosition, projectileVelocity, projectileAnalytics, buildSceneFromProjectile, validateProjectile,
} from "../../src/diagram/projectile.js";
import {
  mechanicalAdvantage, buildSceneFromPulley, validatePulley,
} from "../../src/diagram/pulley.js";
import {
  lensImage, buildSceneFromOptics,
} from "../../src/diagram/optics.js";
import {
  renderVectorField, renderScalarField, validateVectorField,
} from "../../src/diagram/fields.js";
import { renderScene2D, newScene2D, worldToView, viewToWorld } from "../../src/diagram/scene2d.js";

const EPS = 1e-9;

function assertValidSvg(svg) {
  assert.ok(typeof svg === "string" && svg.length > 50, "svg non-empty");
  assert.ok(svg.includes("<svg"), "contains <svg");
  assert.ok(svg.includes("</svg>"), "contains </svg>");
}

test("FBD: polar<->components round-trip preserves magnitude within 1e-9", () => {
  for (let deg = 0; deg < 360; deg += 7) {
    for (const mag of [0.1, 1, 5, 12.345, 100]) {
      const c = componentsFromPolar(mag, deg);
      const back = Math.hypot(c.x, c.y);
      assert.ok(Math.abs(back - mag) < 1e-9, "mag=" + mag + " deg=" + deg);
    }
  }
});

test("FBD: angleFromComponents gives expected quadrant angle for orthogonal vectors", () => {
  assert.equal(Math.round(angleFromComponents({ x: 1, y: 0 })), 0);
  assert.equal(Math.round(angleFromComponents({ x: 0, y: 1 })), 90);
  assert.equal(Math.round(angleFromComponents({ x: -1, y: 0 })), 180);
  assert.equal(Math.round(angleFromComponents({ x: 0, y: -1 })), 270);
  assert.equal(Math.round(angleFromComponents({ x: 1, y: 1 })), 45);
  assert.equal(Math.round(angleFromComponents({ x: -1, y: 1 })), 135);
});

test("FBD: validateFBD rejects inconsistent force magnitude (both over and under)", () => {
  const base = {
    bodyPosition: { x: 0, y: 0 }, bodySize: { w: 1, h: 1 }, frameAngleDeg: 0,
    world: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, width: 400, height: 400,
    forces: [{ point: { x: 0, y: 0 }, components: { x: 3, y: 0 }, magnitude: 5, unit: "N" }],
  };
  assert.throws(() => validateFBD(base), "magnitude 5 with components (3,0) is inconsistent");
  assert.throws(() => validateFBD({ ...base, forces: [{ ...base.forces[0], magnitude: 1 }] }), "magnitude 1 with components (3,0) is inconsistent");
  validateFBD({ ...base, forces: [{ ...base.forces[0], magnitude: 3 }] });
});

test("FBD: buildSceneFromFBD produces valid SVG with body box + force vectors", () => {
  const m = {
    bodyPosition: { x: 0, y: 0 },
    bodySize: { w: 2, h: 1 },
    bodyLabel: "m",
    frameAngleDeg: 0,
    forces: [
      { point: { x: 0, y: 0 }, components: { x: 3, y: 0 }, magnitude: 3, unit: "N", label: "F" },
      { point: { x: 0, y: 0 }, components: { x: 0, y: -2 }, magnitude: 2, unit: "N", label: "W" },
    ],
    world: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    width: 400, height: 400,
  };
  const s = buildSceneFromFBD(m);
  const svg = renderScene2D(s);
  assertValidSvg(svg);
  assert.ok(s.shapes.length >= 4, "shape count = " + s.shapes.length);
});

test("FBD: scene2D worldToView / viewToWorld is round-trip exact", () => {
  const s = newScene2D({ width: 400, height: 300, world: { xMin: -10, xMax: 10, yMin: -5, yMax: 5 } });
  for (const p of [
    { x: 0, y: 0 },
    { x: 7.5, y: -3.2 },
    { x: -10, y: 5 },
    { x: 10, y: -5 },
    { x: 1.234, y: 4.567 },
  ]) {
    const v = worldToView(s, p);
    const back = viewToWorld(s, v);
    assert.ok(Math.abs(back.x - p.x) < 1e-9, "x roundtrip p=" + JSON.stringify(p));
    assert.ok(Math.abs(back.y - p.y) < 1e-9, "y roundtrip p=" + JSON.stringify(p));
  }
});

test("FBD: equilibrium: two opposing forces of equal magnitude yield net-zero vector", () => {
  const f1 = componentsFromPolar(10, 0);
  const f2 = componentsFromPolar(10, 180);
  const net = { x: f1.x + f2.x, y: f1.y + f2.y };
  assert.ok(Math.abs(net.x) < 1e-9);
  assert.ok(Math.abs(net.y) < 1e-9);
});

test("FBD: F=ma consistency: net force, mass, accel aligned and proportional", () => {
  const m = 2.0;
  const a = 4.0;
  const fMag = m * a;
  const aVec = componentsFromPolar(a, 30);
  const fVec = { x: m * aVec.x, y: m * aVec.y };
  const fMagCheck = Math.hypot(fVec.x, fVec.y);
  assert.ok(Math.abs(fMagCheck - fMag) < 1e-9, "fMag=" + fMag + " check=" + fMagCheck);
  // Direction must match
  const dirA = angleFromComponents(aVec);
  const dirF = angleFromComponents(fVec);
  assert.ok(Math.abs(dirA - dirF) < 1e-9, "direction a=" + dirA + " f=" + dirF);
});
