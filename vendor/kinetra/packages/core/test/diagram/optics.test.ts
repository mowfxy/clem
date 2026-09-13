import { test } from "node:test";
import assert from "node:assert/strict";
import { lensImage, buildSceneFromOptics } from "../../src/diagram/optics.js";
import { renderScene2D } from "../../src/diagram/scene2d.js";

const EPS = 1e-6;

function mkLens(focal, x = 0) {
  return { element: { kind: "thin-lens-converging", x, y: 0, focal }, objectHeight: 1, objectBase: { x: -2, y: 0 }, world: { xMin: -5, xMax: 5, yMin: -3, yMax: 3 }, width: 600, height: 300 };
}

test("optics: plane mirror forms an upright same-size virtual image behind mirror", () => {
  const m = {
    element: { kind: "plane-mirror", x: 0, yMin: -1, yMax: 1 },
    objectHeight: 1, objectBase: { x: -2, y: 0 },
    world: { xMin: -5, xMax: 5, yMin: -3, yMax: 3 }, width: 600, height: 300,
  };
  const r = lensImage(m);
  assert.equal(r.imageBase.x, 2);
  assert.equal(r.imageHeight, 1);
  assert.equal(r.magnification, 1);
  assert.equal(r.virtual, true);
});

test("optics: thin lens (f=1) with object at u=2 gives image at v=2 (1/f = 1/u + 1/v)", () => {
  // 1/1 = 1/2 + 1/v => v = 2
  const m = mkLens(1, 0);
  const r = lensImage(m);
  assert.ok(Math.abs(r.imageBase.x - 2) < EPS, "v=" + r.imageBase.x);
  assert.ok(Math.abs(r.magnification - (-1)) < EPS, "mag=" + r.magnification);
  assert.ok(Math.abs(r.imageHeight - (-1)) < EPS, "h'=" + r.imageHeight);
});

test("optics: thin lens (f=2) with object at u=3 gives v=6", () => {
  // 1/2 = 1/3 + 1/v => 1/v = 1/6 => v = 6
  const m = { element: { kind: "thin-lens-converging", x: 0, y: 0, focal: 2 }, objectHeight: 1, objectBase: { x: -3, y: 0 }, world: { xMin: -10, xMax: 10, yMin: -3, yMax: 3 }, width: 600, height: 300 };
  const r = lensImage(m);
  assert.ok(Math.abs(r.imageBase.x - 6) < EPS);
  assert.ok(Math.abs(r.magnification - (-2)) < EPS);
});

test("optics: object at 2f gives image at 2f with magnification -1", () => {
  // 1/f = 1/(2f) + 1/(2f) => 1/f = 1/f ?
  const m = { element: { kind: "thin-lens-converging", x: 0, y: 0, focal: 1 }, objectHeight: 0.5, objectBase: { x: -2, y: 0 }, world: { xMin: -5, xMax: 5, yMin: -3, yMax: 3 }, width: 600, height: 300 };
  const r = lensImage(m);
  assert.ok(Math.abs(r.imageBase.x - 2) < EPS);
  assert.ok(Math.abs(r.magnification + 1) < EPS);
});

test("optics: concave mirror at u=2f forms a real image at x=-2 on object side", () => {
  // 1/1 = 1/2 + 1/v => v = 2
  const m = { element: { kind: "concave-mirror", x: 0, y: 0, focal: 1, radius: 2 }, objectHeight: 1, objectBase: { x: -2, y: 0 }, world: { xMin: -5, xMax: 5, yMin: -3, yMax: 3 }, width: 600, height: 300 };
  const r = lensImage(m);
  assert.ok(Math.abs(r.imageBase.x + 2) < EPS);
  assert.equal(r.virtual, false);
});

test("optics: virtual image — object between lens and focal point (u < f) gives negative v", () => {
  // 1/2 = 1/1 + 1/v => 1/v = -1/2 => v = -2 (virtual)
  const m = { element: { kind: "thin-lens-converging", x: 0, y: 0, focal: 2 }, objectHeight: 1, objectBase: { x: -1, y: 0 }, world: { xMin: -5, xMax: 5, yMin: -3, yMax: 3 }, width: 600, height: 300 };
  const r = lensImage(m);
  assert.ok(r.imageBase.x < 0, "v should be negative (virtual on same side), got " + r.imageBase.x);
  // magnification is positive (upright virtual image)
  assert.ok(r.magnification > 0, "mag should be positive, got " + r.magnification);
});

test("optics: diverging lens always gives virtual image (v < 0)", () => {
  // For f < 0: 1/v = 1/f - 1/u. With u=2, f=-1: 1/v = -1 - 1/2 = -3/2 => v = -2/3.
  const m = { element: { kind: "thin-lens-diverging", x: 0, y: 0, focal: -1 }, objectHeight: 1, objectBase: { x: -2, y: 0 }, world: { xMin: -5, xMax: 5, yMin: -3, yMax: 3 }, width: 600, height: 300 };
  const r = lensImage(m);
  assert.ok(r.imageBase.x < 0, "v should be negative, got " + r.imageBase.x);
  assert.ok(r.magnification < 1 && r.magnification > 0, "mag in (0,1), got " + r.magnification);
});

test("optics: buildSceneFromOptics produces valid SVG with object + image", () => {
  const m = mkLens(1, 0);
  const s = buildSceneFromOptics(m);
  const svg = renderScene2D(s);
  assert.ok(svg.includes("<svg") && svg.includes("</svg>"));
  assert.ok(s.shapes.length >= 4);
});
