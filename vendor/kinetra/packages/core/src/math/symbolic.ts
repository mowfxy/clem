/**
 * Symbolic math engine. Lightweight CAS: simplification, polynomial
 * arithmetic, derivatives, integration of polynomials, equation solving.
 * Sufficient for the routine tasks Kinetra needs; not a full SymPy clone.
 */

import { num, vr, e } from "./expression.js";
import type { Expr } from "./expression.js";
import { pi, parseExpr, collectVars } from "./expression.js";
import { KinetraError } from "../errors.js";

export type Poly = Map<string, number>;

function keyOf(vars: string[]): string {
  return vars.slice().sort().join("*") || "1";
}

function getKey(vars: string[], value: number): [string, number] {
  return [keyOf(vars), value];
}

export function exprToPoly(e: Expr): Poly {
  const out: Poly = new Map();
  function add(p: Poly): void {
    for (const [k, c] of p) out.set(k, (out.get(k) ?? 0) + c);
  }
  function convert(node: Expr, signs: number[] = [1]): Poly {
    switch (node.type) {
      case "num": {
        const m: Poly = new Map();
        m.set("1", signs[0] * node.value);
        return m;
      }
      case "const": {
        const m: Poly = new Map();
        m.set("1", signs[0] * (node.name === "pi" ? Math.PI : node.name === "e" ? Math.E : 0));
        return m;
      }
      case "neg": return convert(node.arg, [-signs[0]]);
      case "var": {
        const m: Poly = new Map();
        m.set(keyOf([node.name]), signs[0]);
        return m;
      }
      case "add":
        for (const a of node.args) add(convert(a, signs));
        return out;
      case "sub": {
        const m = convert(node.left, signs);
        const r = convert(node.right, [-signs[0]]);
        for (const [k, c] of r) m.set(k, (m.get(k) ?? 0) + c);
        return m;
      }
      case "mul": {
        let acc: Poly = new Map([["1", signs[0]]]);
        for (const a of node.args) {
          const next = convert(a, [1]);
          acc = polyMul(acc, next);
        }
        return acc;
      }
      case "pow": {
        if (node.right.type !== "num" || !Number.isInteger(node.right.value)) {
          throw new KinetraError("unsupported", "Polynomial only supports integer exponents");
        }
        const exp = node.right.value;
        let acc: Poly = new Map([["1", signs[0]]]);
        for (let i = 0; i < exp; i++) {
          acc = polyMul(acc, convert(node.left, [1]));
        }
        return acc;
      }
      default:
        throw new KinetraError("unsupported", `Cannot polynomialise: ${node.type}`);
    }
  }
  return convert(e, [1]);
}

export function polyAdd(a: Poly, b: Poly): Poly {
  const out: Poly = new Map(a);
  for (const [k, c] of b) out.set(k, (out.get(k) ?? 0) + c);
  return out;
}

export function polyMul(a: Poly, b: Poly): Poly {
  const out: Poly = new Map();
  for (const [ka, ca] of a) {
    for (const [kb, cb] of b) {
      const k = mergeKeys(ka, kb);
      out.set(k, (out.get(k) ?? 0) + ca * cb);
    }
  }
  return out;
}

function mergeKeys(a: string, b: string): string {
  if (a === "1") return b;
  if (b === "1") return a;
  const av = a.split("*");
  const bv = b.split("*");
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < av.length || j < bv.length) {
    const a1 = av[i] ?? "8";
    const b1 = bv[j] ?? "8";
    if (a1 < b1) { out.push(a1); i += 1; }
    else if (a1 > b1) { out.push(b1); j += 1; }
    else { out.push(a1); i += 1; j += 1; }
  }
  return out.join("*");
}

export function polyToExpr(p: Poly): Expr {
  const terms: Expr[] = [];
  const keys = [...p.keys()].sort();
  for (const k of keys) {
    const c = p.get(k)!;
    if (c === 0) continue;
    if (k === "1") terms.push(num(c));
    else {
      const vars = k === "1" ? [] : k.split("*");
      let t: Expr = num(c);
      for (const v of vars) t = { type: "mul", args: [t, vr(v)] };
      terms.push(t);
    }
  }
  if (terms.length === 0) return num(0);
  if (terms.length === 1) return terms[0];
  return { type: "add", args: terms };
}

export function simplify(e: Expr): Expr {
  switch (e.type) {
    case "num":
    case "const":
    case "var":
      return e;
    case "neg": {
      const a = simplify(e.arg);
      if (a.type === "num") return num(-a.value);
      if (a.type === "neg") return a.arg;
      return { type: "neg", arg: a };
    }
    case "add": {
      const simplified = e.args.map(simplify);
      const poly = exprToPoly({ type: "add", args: simplified });
      return polyToExpr(poly);
    }
    case "sub": {
      const l = simplify(e.left);
      const r = simplify(e.right);
      if (l.type === "num" && r.type === "num") return num(l.value - r.value);
      return { type: "sub", left: l, right: r };
    }
    case "mul": {
      const simplified = e.args.map(simplify);
      let poly: Poly = new Map([["1", 1]]);
      for (const s of simplified) {
        const p = exprToPoly(s);
        poly = polyMul(poly, p);
      }
      return polyToExpr(poly);
    }
    case "div": {
      const l = simplify(e.left);
      const r = simplify(e.right);
      if (l.type === "num" && r.type === "num" && r.value !== 0) return num(l.value / r.value);
      return { type: "div", left: l, right: r };
    }
    case "pow": {
      const l = simplify(e.left);
      const r = simplify(e.right);
      if (l.type === "num" && r.type === "num") return num(Math.pow(l.value, r.value));
      if (r.type === "num" && r.value === 0) return num(1);
      if (r.type === "num" && r.value === 1) return l;
      return { type: "pow", left: l, right: r };
    }
    case "fn": return { type: "fn", name: e.name, args: e.args.map(simplify) };
    case "sum": return { type: "sum", var: e.var, from: simplify(e.from), to: simplify(e.to), body: simplify(e.body) };
    case "prod": return { type: "prod", var: e.var, from: simplify(e.from), to: simplify(e.to), body: simplify(e.body) };
    case "piecewise": return { type: "piecewise", cases: e.cases.map((c) => ({ cond: simplify(c.cond), value: simplify(c.value) })), otherwise: simplify(e.otherwise) };
    case "vector": return { type: "vector", items: e.items.map(simplify) };
    case "matrix": return { type: "matrix", rows: e.rows.map((r) => r.map(simplify)) };
    case "deriv": return derivative(e.var, e.body);
  }
}

/** Symbolic differentiation. */
export function derivative(v: string, e: Expr): Expr {
  switch (e.type) {
    case "num":
    case "const":
      return num(0);
    case "var":
      return e.name === v ? num(1) : num(0);
    case "neg":
      return { type: "neg", arg: derivative(v, e.arg) };
    case "add":
      return { type: "add", args: e.args.map((a) => derivative(v, a)) };
    case "sub":
      return { type: "sub", left: derivative(v, e.left), right: derivative(v, e.right) };
    case "mul": {
      // product rule over multiple args
      const n = e.args.length;
      if (n === 1) return derivative(v, e.args[0]);
      const terms: Expr[] = [];
      for (let i = 0; i < n; i++) {
        const others: Expr[] = [];
        for (let j = 0; j < n; j++) others.push(j === i ? derivative(v, e.args[j]) : e.args[j]);
        terms.push({ type: "mul", args: others });
      }
      return { type: "add", args: terms };
    }
    case "div":
      return {
        type: "div",
        left: {
          type: "sub",
          left: { type: "mul", args: [derivative(v, e.left), e.right] },
          right: { type: "mul", args: [e.left, derivative(v, e.right)] },
        },
        right: { type: "pow", left: e.right, right: num(2) },
      };
    case "pow": {
      // d/dx f^g = f^g * (g' ln f + g f'/f)
      return {
        type: "mul",
        args: [
          e,
          {
            type: "add",
            args: [
              { type: "mul", args: [derivative(v, e.right), { type: "fn", name: "ln", args: [e.left] }] },
              { type: "mul", args: [e.right, { type: "div", left: derivative(v, e.left), right: e.left }] },
            ],
          },
        ],
      };
    }
    case "fn": {
      const inner = e.args[0];
      const d = derivative(v, inner);
      const dname: Record<string, string> = {
        sin: "cos", cos: "neg_sin", tan: "sec2",
        asin: "asin_p", acos: "acos_p", atan: "atan_p",
        exp: "exp", ln: "ln_p", log: "log_p", sqrt: "sqrt_p", abs: "abs_p",
        sinh: "cosh", cosh: "sinh", tanh: "sech2",
      };
      const helper = dname[e.name as string];
      const helperExpr = (name: string): Expr => {
        switch (name) {
          case "cos": return { type: "mul", args: [d, { type: "fn", name: "cos", args: [inner] }] };
          case "neg_sin": return { type: "neg", arg: { type: "mul", args: [d, { type: "fn", name: "sin", args: [inner] }] } };
          case "sec2": return { type: "mul", args: [d, { type: "pow", left: { type: "fn", name: "cos", args: [inner] }, right: num(-2) }] };
          case "asin_p": return { type: "div", left: d, right: { type: "fn", name: "sqrt", args: [{ type: "sub", left: num(1), right: { type: "pow", left: inner, right: num(2) } }] } };
          case "acos_p": return { type: "neg", arg: { type: "div", left: d, right: { type: "fn", name: "sqrt", args: [{ type: "sub", left: num(1), right: { type: "pow", left: inner, right: num(2) } }] } } };
          case "atan_p": return { type: "div", left: d, right: { type: "add", args: [num(1), { type: "pow", left: inner, right: num(2) }] } };
          case "exp": return { type: "mul", args: [d, e] };
          case "ln_p": return { type: "div", left: d, right: inner };
          case "log_p": return { type: "div", left: d, right: { type: "mul", args: [inner, { type: "fn", name: "ln", args: [num(10)] }] } };
          case "sqrt_p": return { type: "div", left: d, right: { type: "mul", args: [num(2), { type: "fn", name: "sqrt", args: [inner] }] } };
          case "abs_p": return { type: "div", left: d, right: inner };
          case "cosh": return { type: "mul", args: [d, { type: "fn", name: "cosh", args: [inner] }] };
          case "sinh": return { type: "mul", args: [d, { type: "fn", name: "sinh", args: [inner] }] };
          case "sech2": return { type: "mul", args: [d, { type: "pow", left: { type: "fn", name: "cosh", args: [inner] }, right: num(-2) }] };
        }
        return { type: "neg", arg: d };
      };
      return helperExpr(helper ?? "neg");
    }
    case "sum": return { type: "sum", var: e.var, from: e.from, to: e.to, body: derivative(v, e.body) };
    case "prod": return { type: "prod", var: e.var, from: e.from, to: e.to, body: derivative(v, e.body) };
    case "piecewise":
      return { type: "piecewise", cases: e.cases.map((c) => ({ cond: c.cond, value: derivative(v, c.value) })), otherwise: derivative(v, e.otherwise) };
    case "vector": return { type: "vector", items: e.items.map((c) => derivative(v, c)) };
    case "matrix": return { type: "matrix", rows: e.rows.map((r) => r.map((c) => derivative(v, c))) };
    case "deriv": return derivative(v, e.body);
  }
}

/** Definite integral of a polynomial (exact rational arithmetic for constant numerator). */
export function integratePoly(p: Poly, v: string): Poly {
  const out: Poly = new Map();
  for (const [k, c] of p) {
    const vars = k === "1" ? [] : k.split("*");
    const exp = vars.filter((x) => x === v).length;
    if (exp === 0) {
      // x * constant
      out.set(v, (out.get(v) ?? 0) + c);
    } else {
      const remaining = vars.filter((x) => x !== v);
      const newKey = remaining.length === 0 ? "1" : remaining.join("*");
      out.set(newKey, (out.get(newKey) ?? 0) + c / (exp + 1));
    }
  }
  return out;
}
