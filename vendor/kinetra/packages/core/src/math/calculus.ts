import type { Expr } from "./expression.js";
import { num, vr, parseExpr } from "./expression.js";
import { derivative, simplify } from "./symbolic.js";
import { evaluate } from "./eval.js";

/** Numerical gradient. */
export function gradient(e: Expr, vars: string[], at: Record<string, number>, h = 1e-6): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of vars) {
    const plus = evaluate(e, { vars: { ...at, [v]: at[v] + h } });
    const minus = evaluate(e, { vars: { ...at, [v]: at[v] - h } });
    out[v] = (plus - minus) / (2 * h);
  }
  return out;
}

/** Numerical integration via adaptive Simpson. */
export function integrate(f: (x: number) => number, a: number, b: number, tol = 1e-9, maxDepth = 20): number {
  function simpson(xa: number, xb: number, fa: number, fb: number, fm: number, whole: number, depth: number): number {
    const xm = (xa + xb) / 2;
    const lm = f(xm - (xb - xa) / 4);
    const rm = f(xm + (xb - xa) / 4);
    const left = ((xb - xa) / 12) * (fa + 4 * lm + fm);
    const right = ((xb - xa) / 12) * (fm + 4 * rm + fb);
    const sum = left + right;
    if (depth >= maxDepth || Math.abs(sum - whole) < 15 * tol) return sum + (sum - whole) / 15;
    return simpson(xa, xm, fa, fm, lm, left, depth + 1) + simpson(xm, xb, fm, fb, rm, right, depth + 1);
  }
  const fa = f(a);
  const fb = f(b);
  const fm = f((a + b) / 2);
  return simpson(a, b, fa, fb, fm, ((b - a) / 6) * (fa + 4 * fm + fb), 0);
}

/** Numerical ODE solver (RK4). */
export function rk4(deriv: (t: number, y: number[]) => number[], t0: number, y0: number[], h: number, steps: number): { t: number; y: number[] }[] {
  const out: { t: number; y: number[] }[] = [{ t: t0, y: [...y0] }];
  let t = t0;
  let y = y0.slice();
  for (let i = 0; i < steps; i++) {
    const k1 = deriv(t, y);
    const k2 = deriv(t + h / 2, y.map((v, j) => v + (h / 2) * k1[j]));
    const k3 = deriv(t + h / 2, y.map((v, j) => v + (h / 2) * k2[j]));
    const k4 = deriv(t + h, y.map((v, j) => v + h * k3[j]));
    y = y.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    t += h;
    out.push({ t, y: y.slice() });
  }
  return out;
}
