/**
 * Algebra helpers: factoring, GCD, expansion, polynomial root finding.
 */

import { exprToPoly } from "./symbolic.js";
import type { Poly } from "./symbolic.js";
import { polyAdd, polyMul, polyToExpr } from "./symbolic.js";
import { num, vr, parseExpr } from "./expression.js";
import type { Expr } from "./expression.js";

export function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b !== 0) { [a, b] = [b, a % b]; }
  return a || 1;
}

export function factorCommonCoefficient(p: Poly): { coef: number; poly: Poly } {
  let coef = 0;
  for (const c of p.values()) {
    if (c === 0) continue;
    if (coef === 0) coef = c;
    else coef = gcd(Math.round(Math.abs(coef)), Math.round(Math.abs(c)));
  }
  const out: Poly = new Map();
  for (const [k, c] of p) out.set(k, c / coef);
  return { coef, poly: out };
}

export function findPolynomialRoots(p: Poly): { real: number[]; complex: { re: number; im: number }[] } {
  // Reduce to polynomial in one variable x by fixing all other variables at 0: a key of n x's is the x^n term.
  const a: number[] = [];
  for (const [k, c] of p) {
    const vars = k === "1" ? [] : k.split("*");
    if (vars.some((name) => name !== "x")) continue;
    while (a.length <= vars.length) a.push(0);
    a[vars.length] += c;
  }
  // Strip leading zeros
  while (a.length > 0 && a[a.length - 1] === 0) a.pop();
  const real: number[] = [];
  const complex: { re: number; im: number }[] = [];
  // Zero roots, then Durand-Kerner on the rest (all roots, real and complex, of any degree).
  while (a.length > 1 && a[0] === 0) { a.shift(); real.push(0); }
  const n = a.length - 1;
  if (n < 1) return { real, complex };
  const monic = a.map((c) => c / a[n]);
  const radius = 1 + Math.max(...monic.slice(0, n).map(Math.abs));
  let z = Array.from({ length: n }, (_, k) => ({ re: radius * Math.cos(0.4 + (2 * Math.PI * k) / n), im: radius * Math.sin(0.4 + (2 * Math.PI * k) / n) }));
  for (let iter = 0; iter < 1000; iter++) {
    let moved = 0;
    z = z.map((zk, k) => {
      let pr = monic[n], pi = 0; // p(zk) by Horner
      for (let i = n - 1; i >= 0; i--) [pr, pi] = [pr * zk.re - pi * zk.im + monic[i], pr * zk.im + pi * zk.re];
      let dr = 1, di = 0; // prod over j != k of (zk - zj)
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        const wr = zk.re - z[j].re, wi = zk.im - z[j].im;
        [dr, di] = [dr * wr - di * wi, dr * wi + di * wr];
      }
      const den = dr * dr + di * di || 1e-300;
      const qr = (pr * dr + pi * di) / den, qi = (pi * dr - pr * di) / den;
      moved = Math.max(moved, Math.hypot(qr, qi));
      return { re: zk.re - qr, im: zk.im - qi };
    });
    if (moved <= 1e-15 * radius) break;
  }
  for (const r of z) {
    if (Math.abs(r.im) <= 1e-9 * Math.max(1, Math.abs(r.re))) real.push(r.re);
    else complex.push(r);
  }
  real.sort((x, y) => x - y);
  return { real, complex };
}

export function expand(e: Expr): Poly {
  return exprToPoly(e);
}
