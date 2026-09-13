/**
 * Linear algebra helpers. Pure JS; small matrices; LU solve; inverse; det.
 */

export type Matrix = number[][];

export function zeros(r: number, c: number): Matrix {
  return Array.from({ length: r }, () => Array(c).fill(0));
}

export function identity(n: number): Matrix {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
}

export function transpose(m: Matrix): Matrix {
  const r = m.length, c = m[0].length;
  const out = zeros(c, r);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j][i] = m[i][j];
  return out;
}

export function matmul(a: Matrix, b: Matrix): Matrix {
  const r = a.length, k = a[0].length, c = b[0].length;
  const out = zeros(r, c);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
    let s = 0;
    for (let p = 0; p < k; p++) s += a[i][p] * b[p][j];
    out[i][j] = s;
  }
  return out;
}

export function det(m: Matrix): number {
  const n = m.length;
  if (n === 1) return m[0][0];
  if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  let d = 0;
  for (let j = 0; j < n; j++) {
    const sub: Matrix = [];
    for (let i = 1; i < n; i++) sub.push(m[i].filter((_, k) => k !== j));
    d += (j % 2 === 0 ? 1 : -1) * m[0][j] * det(sub);
  }
  return d;
}

export function solve(A: Matrix, b: number[]): number[] {
  const n = A.length;
  const M: Matrix = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) throw new Error("Singular matrix");
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

export function inverse(m: Matrix): Matrix {
  const n = m.length;
  const aug: Matrix = m.map((r, i) => [...r, ...identity(n)[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
    [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
    if (Math.abs(aug[i][i]) < 1e-12) throw new Error("Singular");
    const piv = aug[i][i];
    for (let j = 0; j < 2 * n; j++) aug[i][j] /= piv;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = aug[k][i];
      for (let j = 0; j < 2 * n; j++) aug[k][j] -= f * aug[i][j];
    }
  }
  return aug.map((r) => r.slice(n));
}

export function cross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}
