/**
 * 3D coordinate math: rotation matrices, translations, lookAt, and
 * matrix multiplication. All matrices are stored as column-major 4x4 (matches transformPoint, translation, scale, rotation).
 */

import type { Mat4, Vec3 } from "./types.js";

export function mulMat4(a: Mat4, b: Mat4): Mat4 {
  // Column-major: A[i,k] is at a.m[k*4+i], B[k,j] is at b.m[j*4+k],
  // result C = A * B has C[i,j] at c.m[j*4+i].
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

export function translation(x: number, y: number, z: number): Mat4 {
  const m = new Array(16).fill(0);
  m[0] = m[5] = m[10] = m[15] = 1;
  m[12] = x; m[13] = y; m[14] = z;
  return { m };
}

export function scaleMat(sx: number, sy: number, sz: number): Mat4 {
  const m = new Array(16).fill(0);
  m[0] = sx; m[5] = sy; m[10] = sz; m[15] = 1;
  return { m };
}

export function rotationXEuler(deg: number): Mat4 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const m = new Array(16).fill(0);
  m[0] = 1; m[5] = c; m[6] = s; m[9] = -s; m[10] = c; m[15] = 1;
  return { m };
}

export function rotationYEuler(deg: number): Mat4 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const m = new Array(16).fill(0);
  m[0] = c; m[2] = -s; m[5] = 1; m[8] = s; m[10] = c; m[15] = 1;
  return { m };
}

export function rotationZEuler(deg: number): Mat4 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const m = new Array(16).fill(0);
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c; m[10] = 1; m[15] = 1;
  return { m };
}

export function eulerXYZ(deg: Vec3): Mat4 {
  return mulMat4(rotationXEuler(deg.x), mulMat4(rotationYEuler(deg.y), rotationZEuler(deg.z)));
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = m.m[0] * p.x + m.m[4] * p.y + m.m[8] * p.z + m.m[12];
  const y = m.m[1] * p.x + m.m[5] * p.y + m.m[9] * p.z + m.m[13];
  const z = m.m[2] * p.x + m.m[6] * p.y + m.m[10] * p.z + m.m[14];
  const w = m.m[3] * p.x + m.m[7] * p.y + m.m[11] * p.z + m.m[15];
  if (w === 0) throw new Error("Matrix transform produced w=0");
  return { x: x / w, y: y / w, z: z / w };
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  // Right-handed lookAt (camera looks down -Z), stored column-major to match
  // transformPoint, translation, and the rest of this module.
  const f = normalize(sub(target, eye));
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  const m = new Array(16).fill(0);
  m[0] = s.x; m[1] = u.x; m[2] = -f.x; m[3] = 0;
  m[4] = s.y; m[5] = u.y; m[6] = -f.y; m[7] = 0;
  m[8] = s.z; m[9] = u.z; m[10] = -f.z; m[11] = 0;
  m[12] = -dot(s, eye); m[13] = -dot(u, eye); m[14] = dot(f, eye); m[15] = 1;
  return { m };
}

export function perspective(fovDeg: number, aspect: number, near: number, far: number): Mat4 {
  // Column-major perspective. m[11] = -1 puts -view-z into w so the divide
  // gives NDC z in [-1, 1].
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const m = new Array(16).fill(0);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  m[15] = 0;
  return { m };
}
export function orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  const m = new Array(16).fill(0);
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  m[10] = -2 / (far - near);
m[11] = 0;
m[12] = -(right + left) / (right - left);
m[13] = -(top + bottom) / (top - bottom);
m[14] = -(far + near) / (far - near);
m[15] = 1;
  return { m };
}

// --- vector ops -------------------------------------------------------------

export function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
export function normalize(v: Vec3): Vec3 { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
export function length(v: Vec3): number { return Math.hypot(v.x, v.y, v.z); }