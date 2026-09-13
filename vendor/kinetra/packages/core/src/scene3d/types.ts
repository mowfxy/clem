/**
 * 3D scene model. World-space coordinates are kept separate from
 * camera-space and rendered coordinates. Coordinate transforms are
 * applied by `coords.ts` and `projection.ts`; the renderer consumes the
 * projected 2D primitives.
 */

import type { Color } from "../diagram/primitives.js";

export interface Vec3 { x: number; y: number; z: number; }

export interface Mat4 {
  /** Row-major 4x4. */
  m: number[];
}

export function identityMat4(): Mat4 {
  const m = new Array(16).fill(0);
  m[0] = m[5] = m[10] = m[15] = 1;
  return { m };
}

export function vec3(x: number, y: number, z: number): Vec3 { return { x, y, z }; }
export function vec3Zero(): Vec3 { return { x: 0, y: 0, z: 0 }; }
export function vec3Add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function vec3Sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function vec3Scale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function vec3Dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function vec3Cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
export function vec3Length(a: Vec3): number { return Math.hypot(a.x, a.y, a.z); }
export function vec3Normalize(a: Vec3): Vec3 { const l = vec3Length(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }

export interface Camera {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fovDeg: number;
  near: number;
  far: number;
}

export interface Axis3D {
  origin: Vec3;
  x: Vec3; y: Vec3; z: Vec3;
  /** Labels for axes. */
  labels: { x: string; y: string; z: string };
  length: number;
}

export interface Object3D {
  id: string;
  kind: "sphere" | "box" | "arrow" | "plane" | "line" | "point" | "vector" | "trajectory";
  position: Vec3;
  rotation?: Vec3; // euler degrees
  scale?: Vec3;
  color?: Color;
  /** Shape-specific extras. */
  radius?: number;
  size?: { w: number; h: number; d: number };
  from?: Vec3;
  to?: Vec3;
  points?: Vec3[];
  label?: string;
}

export interface Scene3DModel {
  camera: Camera;
  axes: Axis3D;
  objects: Object3D[];
  labels: { at: Vec3; text: string; color?: Color }[];
  annotations: { at: Vec3; text: string; color?: Color }[];
  /** World width/height in pixels for the final SVG. */
  width: number; height: number;
  title?: string;
  /** Background color. */
  background?: Color;
}

export function defaultCamera(): Camera {
  return {
    position: { x: 4, y: 3, z: 6 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    fovDeg: 45,
    near: 0.1,
    far: 1000,
  };
}

export function defaultAxes(): Axis3D {
  return {
    origin: { x: 0, y: 0, z: 0 },
    x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 },
    labels: { x: "x", y: "y", z: "z" },
    length: 1,
  };
}

export function validateScene3D(s: Scene3DModel): void {
  if (s.width <= 0 || s.height <= 0) throw new Error("Scene3D: width/height must be positive");
  if (s.camera.near <= 0 || s.camera.far <= s.camera.near) throw new Error("Scene3D: invalid near/far");
  if (s.camera.fovDeg <= 0 || s.camera.fovDeg >= 180) throw new Error("Scene3D: invalid fov");
}