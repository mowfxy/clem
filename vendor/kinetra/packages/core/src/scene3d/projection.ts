/**
 * Camera + projection utilities. Output is a 2D screen point with depth
 * used for painter''s-algorithm hidden-surface ordering.
 */

import type { Mat4, Vec3 } from "./types.js";
import { lookAt, perspective, orthographic, transformPoint, sub, normalize, cross, dot } from "./coords.js";
import { length } from "./coords.js";

export interface ProjectedPoint {
  x: number; y: number; z: number; depth: number;
}

export interface View {
  /** View matrix (camera transform). */
  view: Mat4;
  /** Projection matrix. */
  proj: Mat4;
  /** Combined view * projection. */
  mvp: Mat4;
  /** Camera reference (used for backface culling and lighting). */
  camera: { position: Vec3; target: Vec3; up: Vec3; fovDeg: number; near: number; far: number };
  /** Width / height in pixels. */
  width: number; height: number;
  /** Whether perspective is used. */
  perspective: boolean;
}

export function cameraPosition(view: View): Vec3 {
  return view.camera.position;
}

export function buildView(opts: {
  camera: { position: Vec3; target: Vec3; up: Vec3; fovDeg: number; near: number; far: number };
  width: number; height: number;
  perspective: boolean;
}): View {
  const v = lookAt(opts.camera.position, opts.camera.target, opts.camera.up);
  const aspect = opts.width / opts.height;
  const p = opts.perspective
    ? perspective(opts.camera.fovDeg, aspect, opts.camera.near, opts.camera.far)
    : orthographic(-aspect, aspect, -1, 1, opts.camera.near, opts.camera.far);
  return { view: v, proj: p, mvp: multiply(p, v), camera: opts.camera, width: opts.width, height: opts.height, perspective: opts.perspective };
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  // Column-major: matches mulMat4 in coords.ts.
  const out = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a.m[k * 4 + i] * b.m[j * 4 + k];
      out[j * 4 + i] = s;
    }
  }
  return { m: out };
}


export function project(view: View, p: Vec3): ProjectedPoint {
  const c = transformPoint(view.mvp, p);
  const x = (c.x * 0.5 + 0.5) * view.width;
  const y = (1 - (c.y * 0.5 + 0.5)) * view.height;
  // View-space z: read z column from the view matrix. Column-major, so
  // m[8..10] is the z axis of the view basis; m[14] is the z translation.
  const vc = transformPoint(view.view, p);
  return { x, y, z: c.z, depth: -vc.z };
}

/** Direction vector from camera to point in view space. */
export function cameraDir(camera: { position: Vec3; target: Vec3; up: Vec3 }, p: Vec3): Vec3 {
  return normalize(sub(p, camera.position));
}

/** Camera right vector. */
export function cameraRight(camera: { position: Vec3; target: Vec3; up: Vec3 }): Vec3 {
  const f = normalize(sub(camera.target, camera.position));
  return normalize(cross(f, camera.up));
}

/** Camera up vector after lookAt. */
export function cameraUp(camera: { position: Vec3; target: Vec3; up: Vec3 }): Vec3 {
  const f = normalize(sub(camera.target, camera.position));
  const r = normalize(cross(f, camera.up));
  return normalize(cross(r, f));
}

/** Backface culling: returns true if the polygon (CCW) is facing the camera. */
export function isFrontFacing(camera: { position: Vec3; target: Vec3 }, a: Vec3, b: Vec3, c: Vec3): boolean {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const view = sub(camera.target, camera.position);
  return dot(n, view) < 0;
}

/** Average depth of a polygon. */
export function polygonDepth(pts: Vec3[]): number {
  let total = 0;
  for (const p of pts) total += -p.z;
  return total / pts.length;
}

export { length };