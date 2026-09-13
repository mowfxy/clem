import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectilePosition, projectileVelocity, projectileAnalytics, buildSceneFromProjectile, validateProjectile,
} from "../../src/diagram/projectile.js";
import { renderScene2D } from "../../src/diagram/scene2d.js";

const EPS = 1e-6;

test("projectile: at t=0 position is initial position and velocity is launch velocity", () => {
  const m = { initialPosition: { x: 0, y: 0 }, initialSpeed: 20, launchAngleDeg: 45, gravity: 9.81, width: 400, height: 300 };
  const p0 = projectilePosition(m, 0);
  assert.ok(Math.abs(p0.x) < EPS && Math.abs(p0.y) < EPS);
  const v0 = projectileVelocity(m, 0);
  assert.ok(Math.abs(v0.x - 20 * Math.cos(45 * Math.PI / 180)) < EPS);
  assert.ok(Math.abs(v0.y - 20 * Math.sin(45 * Math.PI / 180)) < EPS);
});

test("projectile: apex time is vy/g and apex height is y0 + vy^2/(2g)", () => {
  const m = { initialPosition: { x: 0, y: 0 }, initialSpeed: 30, launchAngleDeg: 60, gravity: 10, width: 400, height: 300 };
  const a = projectileAnalytics(m);
  const vy = 30 * Math.sin(60 * Math.PI / 180);
  assert.ok(Math.abs(a.apex.time - vy / 10) < 1e-9);
  const expectedY = (vy * vy) / (2 * 10);
  assert.ok(Math.abs(a.apex.position.y - expectedY) < 1e-9);
});

test("projectile: flight time matches solving 0.5*g*t^2 - vy*t - y0 = 0", () => {
  const m = { initialPosition: { x: 0, y: 5 }, initialSpeed: 25, launchAngleDeg: 30, gravity: 9.81, width: 400, height: 300 };
  const a = projectileAnalytics(m);
  const vy = 25 * Math.sin(30 * Math.PI / 180);
  const disc = vy * vy + 2 * 9.81 * 5;
  const expectedT = (vy + Math.sqrt(disc)) / 9.81;
  assert.ok(Math.abs(a.flightTime - expectedT) < 1e-9);
});

test("projectile: range equals vx * flightTime", () => {
  const m = { initialPosition: { x: 0, y: 0 }, initialSpeed: 20, launchAngleDeg: 45, gravity: 9.81, width: 400, height: 300 };
  const a = projectileAnalytics(m);
  const vx = 20 * Math.cos(45 * Math.PI / 180);
  assert.ok(Math.abs(a.range.distance - vx * a.flightTime) < 1e-9);
});

test("projectile: 45deg gives maximum range for fixed initial speed (within tolerance)", () => {
  const v = 20; const g = 9.81;
  const ranges = [];
  for (let deg = 5; deg < 90; deg += 5) {
    const m = { initialPosition: { x: 0, y: 0 }, initialSpeed: v, launchAngleDeg: deg, gravity: g, width: 400, height: 300 };
    ranges.push({ deg, r: projectileAnalytics(m).range.distance });
  }
  const maxR = Math.max(...ranges.map((r) => r.r));
  const best45 = ranges.find((r) => Math.abs(r.deg - 45) < 1e-9).r;
  assert.ok(Math.abs(best45 - maxR) / maxR < 0.01, "best45=" + best45 + " maxR=" + maxR);
});

test("projectile: at t=flightTime, y(t) returns to y0 (ground)", () => {
  const m = { initialPosition: { x: 0, y: 0 }, initialSpeed: 15, launchAngleDeg: 40, gravity: 9.81, width: 400, height: 300 };
  const a = projectileAnalytics(m);
  const pLanding = projectilePosition(m, a.flightTime);
  assert.ok(Math.abs(pLanding.y) < 1e-6);
});

test("projectile: validateProjectile rejects negative gravity and speed", () => {
  assert.throws(() => validateProjectile({ initialPosition: { x: 0, y: 0 }, initialSpeed: -1, launchAngleDeg: 0, gravity: 9.81, width: 1, height: 1 }));
  assert.throws(() => validateProjectile({ initialPosition: { x: 0, y: 0 }, initialSpeed: 1, launchAngleDeg: 0, gravity: -1, width: 1, height: 1 }));
});

test("projectile: buildSceneFromProjectile renders valid SVG with trajectory and key points", () => {
  const m = { initialPosition: { x: 0, y: 0 }, initialSpeed: 20, launchAngleDeg: 45, gravity: 9.81, width: 600, height: 400, showKeyPoints: true, showInitialVectors: true };
  const s = buildSceneFromProjectile(m);
  const svg = renderScene2D(s);
  assert.ok(svg.includes("<svg") && svg.includes("</svg>"));
  assert.ok(s.shapes.length >= 4, "shape count = " + s.shapes.length);
});

test("projectile: deterministic � same model produces byte-identical SVG", () => {
  const m = { initialPosition: { x: 0, y: 0 }, initialSpeed: 20, launchAngleDeg: 45, gravity: 9.81, width: 600, height: 400, samples: 32 };
  const a = renderScene2D(buildSceneFromProjectile(m));
  const b = renderScene2D(buildSceneFromProjectile(m));
  assert.equal(a, b);
});
test("projectile: horizontal launch (theta=0, vy=0) still falls and lands at correct time and range", () => {
  // y0 = 5, v0 = 10, theta = 0 -> vy = 0.
  // The ball falls under gravity: 0 = y0 - 0.5*g*t^2 -> t = sqrt(2*y0/g) = sqrt(10/9.81) ~ 1.01 s.
  // Range = vx * t = 10 * 1.01 = 10.10 m.
  const m = { initialPosition: { x: 0, y: 5 }, initialSpeed: 10, launchAngleDeg: 0, gravity: 9.81, width: 800, height: 400 };
  const a = projectileAnalytics(m);
  const tExpected = Math.sqrt(2 * 5 / 9.81);
  const rExpected = 10 * tExpected;
  assert.ok(Math.abs(a.flightTime - tExpected) < 1e-9, "flightTime=" + a.flightTime + " expected " + tExpected);
  assert.ok(Math.abs(a.range.distance - rExpected) < 1e-9, "range=" + a.range.distance + " expected " + rExpected);
  // Apex is at launch (vy = 0 -> no upward motion).
  assert.ok(Math.abs(a.apex.time) < 1e-9, "apex.time should be 0, got " + a.apex.time);
  assert.ok(Math.abs(a.maxHeight - 5) < 1e-9, "maxHeight should equal initial y, got " + a.maxHeight);
});

test("projectile: downward launch (theta<0) reaches ground faster than horizontal", () => {
  // y0 = 10, v0 = 20, theta = -30. vy = -10. The ball drops under both gravity and initial vy.
  // Solve y(t) = 0 -> 10 + (-10)*t - 0.5*9.81*t^2 = 0 -> 4.905*t^2 + 10*t - 10 = 0
  // -> t = (-10 + sqrt(100 + 196.2)) / (2 * 4.905) = (-10 + sqrt(296.2))/9.81 ~ 0.735 s.
  const m = { initialPosition: { x: 0, y: 10 }, initialSpeed: 20, launchAngleDeg: -30, gravity: 9.81, width: 800, height: 400 };
  const a = projectileAnalytics(m);
  const vy = 20 * Math.sin(-30 * Math.PI / 180);
  const aQuad = 0.5 * 9.81, bQuad = -vy, cQuad = -10;
  const disc = bQuad * bQuad - 4 * aQuad * cQuad;
  const tExpected = (-bQuad + Math.sqrt(disc)) / (2 * aQuad);
  assert.ok(Math.abs(a.flightTime - tExpected) < 1e-9, "flightTime=" + a.flightTime + " expected " + tExpected);
  // Apex is at launch (initial velocity is downward).
  assert.ok(Math.abs(a.apex.time) < 1e-9, "apex.time should be 0, got " + a.apex.time);
});

test("projectile: launch from ground (y0=0, vy>0) lands at t=2*vy/g", () => {
  // y0 = 0, v0 = 20, theta = 45 -> vy = 14.14.
  // y(t) = 0 has roots 0 and 2*vy/g. flightTime should be 2*vy/g = 2*14.14/9.81 ~ 2.88 s.
  const m = { initialPosition: { x: 0, y: 0 }, initialSpeed: 20, launchAngleDeg: 45, gravity: 9.81, width: 800, height: 400 };
  const a = projectileAnalytics(m);
  const vy = 20 * Math.sin(45 * Math.PI / 180);
  const tExpected = 2 * vy / 9.81;
  assert.ok(Math.abs(a.flightTime - tExpected) < 1e-9, "flightTime=" + a.flightTime + " expected " + tExpected);
  // Range = vx * t.
  const vx = 20 * Math.cos(45 * Math.PI / 180);
  assert.ok(Math.abs(a.range.distance - vx * tExpected) < 1e-9, "range=" + a.range.distance + " expected " + (vx * tExpected));
});

