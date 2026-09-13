/**
 * Numeric evaluator for the math expression AST. Uses a small CAS-like
 * approach with exact differentiation and simplification where reasonable.
 */

import type { Expr } from "./expression.js";
import { KinetraError } from "../errors.js";
import { approxEqual, clamp } from "../utils/text.js";

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, inf: Infinity, nan: NaN };

export interface EvalContext {
  vars: Record<string, number>;
}

export function evaluate(e: Expr, ctx: EvalContext = { vars: {} }): number {
  switch (e.type) {
    case "num": return e.value;
    case "const": return CONSTS[e.name];
    case "var": {
      if (!(e.name in ctx.vars)) {
        throw new KinetraError("validation", `Unknown variable: ${e.name}`, { name: e.name });
      }
      return ctx.vars[e.name];
    }
    case "neg": return -evaluate(e.arg, ctx);
    case "add": return e.args.reduce((a, b) => a + evaluate(b, ctx), 0);
    case "sub": return evaluate(e.left, ctx) - evaluate(e.right, ctx);
    case "mul": return e.args.reduce((a, b) => a * evaluate(b, ctx), 1);
    case "div": {
      const r = evaluate(e.right, ctx);
      if (r === 0) throw new KinetraError("validation", "Division by zero");
      return evaluate(e.left, ctx) / r;
    }
    case "pow": {
      const a = evaluate(e.left, ctx);
      const b = evaluate(e.right, ctx);
      return Math.pow(a, b);
    }
    case "fn": {
      const args = e.args.map((a) => evaluate(a, ctx));
      return callFn(e.name, args);
    }
    case "sum": {
      const from = Math.round(evaluate(e.from, ctx));
      const to = Math.round(evaluate(e.to, ctx));
      let acc = 0;
      for (let i = from; i <= to; i++) {
        acc += evaluate(e.body, { vars: { ...ctx.vars, [e.var]: i } });
      }
      return acc;
    }
    case "prod": {
      const from = Math.round(evaluate(e.from, ctx));
      const to = Math.round(evaluate(e.to, ctx));
      let acc = 1;
      for (let i = from; i <= to; i++) {
        acc *= evaluate(e.body, { vars: { ...ctx.vars, [e.var]: i } });
      }
      return acc;
    }
    case "piecewise": {
      for (const c of e.cases) {
        const v = evaluate(c.cond, ctx);
        if (v !== 0 && !Number.isNaN(v)) return evaluate(c.value, ctx);
      }
      return evaluate(e.otherwise, ctx);
    }
    case "matrix":
    case "vector":
      throw new KinetraError("unsupported", "Use evalVector/evalMatrix for aggregate types");
    case "deriv":
      return evaluate(derivative(e.var, e.body), ctx);
  }
}

export function evalVector(e: Expr, ctx: EvalContext = { vars: {} }): number[] {
  if (e.type !== "vector") throw new KinetraError("validation", "Expected vector");
  return e.items.map((x) => evaluate(x, ctx));
}

export function evalMatrix(e: Expr, ctx: EvalContext = { vars: {} }): number[][] {
  if (e.type !== "matrix") throw new KinetraError("validation", "Expected matrix");
  return e.rows.map((r) => r.map((x) => evaluate(x, ctx)));
}

function callFn(name: string, args: number[]): number {
  switch (name) {
    case "sin": return Math.sin(args[0]);
    case "cos": return Math.cos(args[0]);
    case "tan": return Math.tan(args[0]);
    case "asin": return Math.asin(args[0]);
    case "acos": return Math.acos(args[0]);
    case "atan": return Math.atan(args[0]);
    case "atan2": return Math.atan2(args[0], args[1]);
    case "sinh": return Math.sinh(args[0]);
    case "cosh": return Math.cosh(args[0]);
    case "tanh": return Math.tanh(args[0]);
    case "exp": return Math.exp(args[0]);
    case "ln": return Math.log(args[0]);
    case "log": return Math.log(args[0]) / Math.log(args[1]);
    case "log2": return Math.log2(args[0]);
    case "log10": return Math.log10(args[0]);
    case "sqrt": return Math.sqrt(args[0]);
    case "cbrt": return Math.cbrt(args[0]);
    case "abs": return Math.abs(args[0]);
    case "floor": return Math.floor(args[0]);
    case "ceil": return Math.ceil(args[0]);
    case "round": return Math.round(args[0]);
    case "min": return Math.min(...args);
    case "max": return Math.max(...args);
    case "sign": return Math.sign(args[0]);
    case "mod": return args[0] % args[1];
    case "pow": return Math.pow(args[0], args[1]);
  }
  throw new KinetraError("unsupported", `Unknown function: ${name}`);
}

/** Sample an expression across a 1D domain. */
export function sample1d(e: Expr, xVar: string, xMin: number, xMax: number, steps: number): { x: number; y: number }[] {
  if (steps < 2) throw new KinetraError("validation", "steps must be >= 2");
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const x = xMin + (xMax - xMin) * (i / (steps - 1));
    let y: number;
    try {
      y = evaluate(e, { vars: { [xVar]: x } });
    } catch {
      y = NaN;
    }
    out.push({ x, y });
  }
  return out;
}

/** Sample a parametric curve. */
export function sampleParametric(
  xExpr: Expr, yExpr: Expr, tVar: string, tMin: number, tMax: number, steps: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const t = tMin + (tMax - tMin) * (i / (steps - 1));
    out.push({ x: evaluate(xExpr, { vars: { [tVar]: t } }), y: evaluate(yExpr, { vars: { [tVar]: t } }) });
  }
  return out;
}
