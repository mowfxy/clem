import { test } from "node:test";
import assert from "node:assert/strict";
import { mechanicalAdvantage, buildSceneFromPulley, validatePulley, atwoodDynamics } from "../../src/diagram/pulley.js";
import { renderScene2D } from "../../src/diagram/scene2d.js";

test("pulley: single fixed pulley has MA=1", () => {
  const m = {
    pulleys: [{ center: { x: 0, y: 2 }, radius: 0.5, fixed: true }],
    masses: [{ mass: 5, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }],
    tension: 50, world: { xMin: -5, xMax: 5, yMin: -2, yMax: 5 }, width: 400, height: 300,
  };
  assert.equal(mechanicalAdvantage(m), 1);
});

test("pulley: unspecified compound routing must not claim an MA", () => {
  const m = {
    pulleys: [
      { center: { x: 0, y: 2 }, radius: 0.5, fixed: true },
      { center: { x: 0, y: 1 }, radius: 0.5, fixed: false },
    ],
    masses: [{ mass: 5, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }],
    tension: 50, world: { xMin: -5, xMax: 5, yMin: -2, yMax: 5 }, width: 400, height: 300,
  };
  assert.throws(() => mechanicalAdvantage(m), /compound routing/);
});

test("pulley: wheel count alone cannot establish block-and-tackle MA", () => {
  const m = {
    pulleys: [
      { center: { x: -1, y: 2 }, radius: 0.5, fixed: true },
      { center: { x: 1, y: 2 }, radius: 0.5, fixed: true },
      { center: { x: -1, y: 1 }, radius: 0.5, fixed: false },
      { center: { x: 1, y: 1 }, radius: 0.5, fixed: false },
    ],
    masses: [{ mass: 5, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }],
    tension: 50, world: { xMin: -5, xMax: 5, yMin: -2, yMax: 5 }, width: 400, height: 300,
  };
  assert.throws(() => mechanicalAdvantage(m), /compound routing/);
});

test("pulley: validatePulley requires at least one pulley and one mass", () => {
  assert.throws(() => validatePulley({ pulleys: [], masses: [{ mass: 1, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }], tension: 0, world: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, width: 1, height: 1 }));
  assert.throws(() => validatePulley({ pulleys: [{ center: { x: 0, y: 0 }, radius: 0.5, fixed: true }], masses: [], tension: 0, world: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, width: 1, height: 1 }));
  assert.throws(() => validatePulley({ pulleys: [{ center: { x: 0, y: 0 }, radius: 0.5, fixed: true }], masses: [{ mass: 1, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }], tension: -1, world: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, width: 1, height: 1 }));
});

test("pulley: atwood machine — 2 pulleys, 2 masses renders a valid SVG with rope segments", () => {
  const m = {
    pulleys: [
      { center: { x: -2, y: 3 }, radius: 0.5, fixed: true },
      { center: { x: 2, y: 3 }, radius: 0.5, fixed: true },
    ],
    masses: [
      { mass: 2, position: { x: -2, y: 1 }, size: { w: 0.5, h: 0.5 }, label: "m1" },
      { mass: 3, position: { x: 2, y: 1 }, size: { w: 0.5, h: 0.5 }, label: "m2" },
    ],
    tension: 25, world: { xMin: -5, xMax: 5, yMin: 0, yMax: 5 }, width: 600, height: 400,
  };
  const s = buildSceneFromPulley(m);
  const svg = renderScene2D(s);
  assert.ok(svg.includes("<svg") && svg.includes("</svg>"));
  // Should contain rope segments, pulley circles, mass rectangles, and ceiling.
  assert.ok(s.shapes.length >= 5);
});

test("pulley: atwood machine acceleration is (m2-m1)g/(m1+m2)", () => {
  const m1 = 2, m2 = 3, g = 9.81;
  const { acceleration: a, tension: t } = atwoodDynamics(m1, m2, g);
  const expected = (1 * 9.81) / 5;
  assert.ok(Math.abs(a - expected) < 1e-9);
  // Tension T = 2*m1*m2*g/(m1+m2)
  assert.ok(Math.abs(t - (12 * 9.81 / 5)) < 1e-9);
});
