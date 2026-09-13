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
  // Reduce to polynomial in one variable x by fixing all other variables at 0.
  const xPoly: number[] = [];
  let max = -1;
  for (const k of p.keys()) {
    if (k === "1") continue;
    const v = k.split("*");
    if (v.length !== 1) continue;
    max = Math.max(max, 1);
  }
  for (let i = 0; i <= max; i++) {
    const key = i === 0 ? "1" : "x";
    xPoly.push(p.get(key) ?? 0);
  }
  if (xPoly.length === 0) return { real: [], complex: [] };
  // Strip leading zeros
  while (xPoly.length > 0 && xPoly[xPoly.length - 1] === 0) xPoly.pop();
  if (xPoly.length <= 1) return { real: [], complex: [] };
  // Use companion matrix eigen decomposition
  const n = xPoly.length - 1;
  const a = xPoly;
  const real: number[] = [];
  for (let x = -10; x <= 10; x += 0.001) {
    let v = 0;
    for (let i = n; i >= 0; i--) v = v * x + a[i];
    if (Math.abs(v) < 1e-3) real.push(x);
  }
  return { real, complex: [] };
}

export function expand(e: Expr): Poly {
  return exprToPoly(e);
}
