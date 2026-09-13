/**
 * Projectile motion. Inputs are initial conditions, gravity, and a time
 * range. The renderer draws a precise trajectory using closed-form
 * kinematics: x(t) = v0*cos(theta)*t, y(t) = v0*sin(theta)*t - 0.5*g*t^2.
 */

import { createArtifact, withRendering } from "../artifacts.js";
import { addShape, newScene2D, renderScene2D } from "./scene2d.js";
import type { Scene2DModel } from "./scene2d.js";
import type { Vec2 } from "./primitives.js";

export interface ProjectileModel {
  initialPosition: Vec2;
  initialSpeed: number; // m/s
  launchAngleDeg: number; // above horizontal
  gravity: number; // m/s^2 (positive)
  /** Time range to render. If omitted, computed from apex + impact. */
  tMax?: number;
  /** Number of samples along trajectory. */
  samples?: number;
  /** Whether to render key vectors (v, vx, vy) at the start. */
  showInitialVectors?: boolean;
  /** Whether to label apex and range. */
  showKeyPoints?: boolean;
  /** World bounds; if omitted, computed from trajectory. */
  world?: { xMin: number; xMax: number; yMin: number; yMax: number };
  width: number; height: number;
  /** Reserved drag coefficient. Only zero or omission is supported. */
  drag?: number;
}

export interface ProjectileAnalytics {
  apex: { time: number; position: Vec2 };
  range: { time: number; distance: number };
  flightTime: number;
  maxHeight: number;
}

const DEG = Math.PI / 180;

export function projectilePosition(m: ProjectileModel, t: number): Vec2 {
  validateProjectile(m);
  if (!Number.isFinite(t) || t < 0) throw new Error("Projectile: time must be finite and nonnegative");
  const vx = m.initialSpeed * Math.cos(m.launchAngleDeg * DEG);
  const vy = m.initialSpeed * Math.sin(m.launchAngleDeg * DEG);
  return {
    x: m.initialPosition.x + vx * t,
    y: m.initialPosition.y + vy * t - 0.5 * m.gravity * t * t,
  };
}

export function projectileVelocity(m: ProjectileModel, t: number): Vec2 {
  validateProjectile(m);
  if (!Number.isFinite(t) || t < 0) throw new Error("Projectile: time must be finite and nonnegative");
  const vx = m.initialSpeed * Math.cos(m.launchAngleDeg * DEG);
  const vy = m.initialSpeed * Math.sin(m.launchAngleDeg * DEG);
  return { x: vx, y: vy - m.gravity * t };
}

export function projectileAnalytics(m: ProjectileModel): ProjectileAnalytics {
  validateProjectile(m);
  const vx = m.initialSpeed * Math.cos(m.launchAngleDeg * DEG);
  const vy = m.initialSpeed * Math.sin(m.launchAngleDeg * DEG);
  // Apex is reached only when the projectile is initially moving upward (vy > 0).
  // Time of apex from vy(t) = 0 -> t = vy / g.
  const tApex = vy > 0 ? vy / m.gravity : 0;
  const apexY = vy > 0 ? m.initialPosition.y + vy * tApex - 0.5 * m.gravity * tApex * tApex : m.initialPosition.y;
  const apexX = vy > 0 ? m.initialPosition.x + vx * tApex : m.initialPosition.x;
  // Flight time: solve y(t) = 0 -> 0.5*g*t^2 - vy*t - y0 = 0; pick the positive root.
  // Ground-level launches with nonpositive vertical velocity have flightTime = 0.
  // Validation rejects initial positions below ground.
  let tImpact = 0;
  // Solve 0 = y0 + vy*t - 0.5*g*t^2; pick a physically valid positive root.
  // For y0 = 0 and vy > 0, the projectile returns to ground at t = 2*vy/g.
  // For y0 > 0, pick the larger positive root (after apex when vy > 0; same root when vy <= 0).
  if (m.initialPosition.y >= 0) {
    const a = 0.5 * m.gravity;
    const b = -vy;
    const c = -m.initialPosition.y;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r1 = (-b + Math.sqrt(disc)) / (2 * a);
      const r2 = (-b - Math.sqrt(disc)) / (2 * a);
      const candidates = [r1, r2].filter((r) => r > 1e-9 && (vy <= 0 || r >= tApex - 1e-9));
      if (candidates.length > 0) tImpact = Math.max(...candidates);
    }
  }
  const range = vx * tImpact;
  return {
    apex: { time: tApex, position: { x: apexX, y: apexY } },
    range: { time: tImpact, distance: range },
    flightTime: tImpact,
    maxHeight: apexY,
  };
}

export function validateProjectile(m: ProjectileModel): void {
  if (![m.gravity, m.initialSpeed, m.launchAngleDeg, m.initialPosition.x, m.initialPosition.y].every(Number.isFinite)) throw new Error("Projectile: initial conditions must be finite");
  if (m.gravity <= 0) throw new Error("Projectile: gravity must be positive");
  if (m.initialSpeed < 0) throw new Error("Projectile: initialSpeed must be >= 0");
  if (m.initialPosition.y < 0) throw new Error("Projectile: initial height must be at or above ground y=0");
  if (m.drag !== undefined && m.drag !== 0) throw new Error("Projectile: drag is not supported; use drag=0 for vacuum motion");
  if (m.samples !== undefined && (!Number.isInteger(m.samples) || m.samples < 2 || m.samples > 10000)) throw new Error("Projectile: samples must be an integer from 2 to 10000");
  if (m.tMax !== undefined && (!Number.isFinite(m.tMax) || m.tMax < 0)) throw new Error("Projectile: tMax must be finite and nonnegative");
}

export function buildSceneFromProjectile(m: ProjectileModel): Scene2DModel {
  validateProjectile(m);
  const a = projectileAnalytics(m);
  const samples = m.samples ?? 64;
  const tMax = Math.min(m.tMax ?? a.flightTime, a.flightTime);
  const positions: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * tMax;
    positions.push(projectilePosition(m, t));
  }
  // Auto world
  let minX = m.initialPosition.x;
  let maxX = m.initialPosition.x;
  let minY = m.initialPosition.y;
  let maxY = m.initialPosition.y;
  for (const p of positions) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const world = m.world ?? { xMin: minX - 1, xMax: maxX + 1, yMin: Math.min(0, minY) - 1, yMax: maxY + 1 };
  const s = newScene2D({ width: m.width, height: m.height, world, axes: { xLabel: "x (m)", yLabel: "y (m)", grid: true } });
  // Ground line
  addShape(s, { kind: "segment", from: { x: world.xMin, y: 0 }, to: { x: world.xMax, y: 0 }, color: "#888" });
  // Trajectory
  const d = positions.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  addShape(s, { kind: "path", d, fill: "none", stroke: "#1f4f8b", width: 1.6 });
  // Launch point
  addShape(s, { kind: "point", at: m.initialPosition, color: "#c0392b", label: "launch" });
  if (m.showInitialVectors ?? true) {
    const v = projectileVelocity(m, 0);
    const scale = Math.min(world.xMax - world.xMin, world.yMax - world.yMin) * 0.18 / Math.max(1, m.initialSpeed);
    addShape(s, { kind: "vector", at: m.initialPosition, v: { x: v.x * scale, y: v.y * scale }, label: "v0", color: "#c0392b" });
  }
  if (m.showKeyPoints ?? true) {
    // Skip the apex label if apex == launch (vy == 0); it would just duplicate
    // the launch label.
    const dxs = a.apex.position.x - m.initialPosition.x;
    const dys = a.apex.position.y - m.initialPosition.y;
    if (Math.hypot(dxs, dys) > 0.01 && a.apex.time <= tMax) {
      addShape(s, { kind: "point", at: a.apex.position, color: "#7a3a11", label: `apex (${a.apex.position.x.toFixed(2)}, ${a.apex.position.y.toFixed(2)})` });
    }
    if (a.range.time > 0 && a.range.time <= tMax) {
      addShape(s, { kind: "point", at: { x: m.initialPosition.x + a.range.distance, y: 0 }, color: "#225", label: `range = ${a.range.distance.toFixed(2)} m` });
    }
  }
  return s;
}

export function renderProjectile(m: ProjectileModel): string {
  return renderScene2D(buildSceneFromProjectile(m));
}

export function projectileArtifact(m: ProjectileModel, title = "Projectile motion"): ReturnType<typeof createArtifact<"projectile", ProjectileModel>> {
  const a = createArtifact({ kind: "projectile", title, model: m });
  return withRendering(a, "svg", { format: "svg", content: renderProjectile(m), contentType: "image/svg+xml" });
}
