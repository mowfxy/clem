/**
 * Values by formula. Any number in a composition may be an expression with
 * units ("2.5 m", "m*g*sin(30 deg)"). Expressions are tokenised here, then
 * parsed and evaluated by Kinetra's math engine (math/expression, math/eval);
 * dimensions come from Kinetra's unit table (units.ts). Every value is held in
 * SI. Angles carry an extra dimension so that sin(30) is rejected rather than
 * silently read as radians.
 */
import { parseExpr } from "../math/expression.js";
import type { Expr } from "../math/expression.js";
import { evaluate } from "../math/eval.js";
import { UNITS, dim, dimDiv, dimEqual, dimMul, dimPow, dimToString } from "../units.js";
import type { Dim } from "../units.js";
import { closestNames, fail } from "./errors.js";
import type { NumLike } from "./types.js";

export interface QDim { base: Dim; angle: number }
/** A value in SI units with its dimension. */
export interface TkQuantity { value: number; dim: QDim }

export const DIMLESS: QDim = { base: dim(), angle: 0 };
export const ANGLE: QDim = { base: dim(), angle: 1 };
export const LENGTH: QDim = { base: dim({ m: 1 }), angle: 0 };

export function qdimEqual(a: QDim, b: QDim): boolean {
  return dimEqual(a.base, b.base) && Math.abs(a.angle - b.angle) < 1e-12;
}
const qmul = (a: QDim, b: QDim): QDim => ({ base: dimMul(a.base, b.base), angle: a.angle + b.angle });
const qdiv = (a: QDim, b: QDim): QDim => ({ base: dimDiv(a.base, b.base), angle: a.angle - b.angle });
const qpow = (a: QDim, k: number): QDim => ({ base: dimPow(a.base, k), angle: a.angle * k });
const isDimless = (d: QDim) => qdimEqual(d, DIMLESS);

/** Unit spellings accepted in expressions, beyond the keys of UNITS. */
const UNIT_ALIASES: Record<string, string> = { "°": "deg", "Ω": "ohm", "kΩ": "kohm", "MΩ": "Mohm", "µF": "uF", "μF": "uF", "µA": "uA", "μA": "uA", "µs": "us", "μs": "us", "degC": "Cdeg" };

/**
 * Engineering units the core table (units.ts) lacks, defined here in SI so
 * units.ts stays unchanged. A model variable of the same name still wins.
 */
const MECH = { kg: 1, m: -1, s: -2 }, FORCE = { kg: 1, m: 1, s: -2 }, ENERGY = { kg: 1, m: 2, s: -2 };
const EXTRA_UNITS: Record<string, { toBase: number; dim: Partial<Record<"kg" | "m" | "s" | "A" | "K" | "mol" | "cd", number>> }> = {
  mN: { toBase: 1e-3, dim: FORCE }, kN: { toBase: 1e3, dim: FORCE }, MN: { toBase: 1e6, dim: FORCE },
  Pa: { toBase: 1, dim: MECH }, kPa: { toBase: 1e3, dim: MECH }, MPa: { toBase: 1e6, dim: MECH }, GPa: { toBase: 1e9, dim: MECH },
  bar: { toBase: 1e5, dim: MECH }, atm: { toBase: 101325, dim: MECH },
  litre: { toBase: 1e-3, dim: { m: 3 } }, liter: { toBase: 1e-3, dim: { m: 3 } }, mL: { toBase: 1e-6, dim: { m: 3 } },
  kJ: { toBase: 1e3, dim: ENERGY }, MJ: { toBase: 1e6, dim: ENERGY }, kWh: { toBase: 3.6e6, dim: ENERGY },
  MW: { toBase: 1e6, dim: { kg: 1, m: 2, s: -3 } },
  mT: { toBase: 1e-3, dim: { kg: 1, s: -2, A: -1 } },
  uC: { toBase: 1e-6, dim: { A: 1, s: 1 } }, nC: { toBase: 1e-9, dim: { A: 1, s: 1 } },
  uH: { toBase: 1e-6, dim: { kg: 1, m: 2, s: -2, A: -2 } }, nH: { toBase: 1e-9, dim: { kg: 1, m: 2, s: -2, A: -2 } },
  // Atomic and optical scales (Agent 3): electron-volts (exact SI value) and small lengths.
  eV: { toBase: 1.602176634e-19, dim: ENERGY }, keV: { toBase: 1.602176634e-16, dim: ENERGY }, MeV: { toBase: 1.602176634e-13, dim: ENERGY },
  um: { toBase: 1e-6, dim: { m: 1 } }, nm: { toBase: 1e-9, dim: { m: 1 } }, pm: { toBase: 1e-12, dim: { m: 1 } },
};
const EXTRA_ALIASES: Record<string, string> = { "µC": "uC", "μC": "uC", "µH": "uH", "μH": "uH", "µm": "um", "μm": "um" };

export function unitQuantity(symbol: string): TkQuantity | undefined {
  const extra = EXTRA_UNITS[EXTRA_ALIASES[symbol] ?? symbol];
  if (extra) return { value: extra.toBase, dim: { base: dim(extra.dim), angle: 0 } };
  const key = UNIT_ALIASES[symbol] ?? symbol;
  const def = key === "" ? undefined : UNITS[key];
  if (!def) return undefined;
  return { value: def.toBase, dim: { base: def.dim, angle: key === "deg" || key === "rad" ? 1 : 0 } };
}

const PREFERRED_UNITS = ["N", "J", "W", "V", "A", "ohm", "F", "H", "T", "Hz", "C", "kg", "m", "s", "K"];
/** Human-readable dimension, naming a unit where one matches ("N", "m", "rad"). */
export function dimLabel(d: QDim): string {
  if (isDimless(d)) return "dimensionless";
  if (dimEqual(d.base, dim()) && d.angle === 1) return "angle (rad)";
  if (d.angle === 0) for (const u of PREFERRED_UNITS) if (dimEqual(UNITS[u]!.dim, d.base)) return `${u} (${dimToString(d.base)})`;
  const base = dimToString(d.base);
  return d.angle ? `${base === "dimensionless" ? "" : base + "*"}rad^${d.angle}` : base;
}

const FUNCTIONS = new Set(["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "exp", "ln", "log", "log2", "log10", "sqrt", "cbrt", "abs", "floor", "ceil", "round", "min", "max", "sign", "mod"]);
const CONSTANTS: Record<string, number> = { pi: Math.PI, "π": Math.PI, e: Math.E };

export interface Scope {
  lookup(name: string): TkQuantity | undefined;
  names(): string[];
}

export const EMPTY_SCOPE: Scope = { lookup: () => undefined, names: () => [] };

type Tok = { k: "num"; s: string } | { k: "id"; s: string } | { k: "op"; s: string };

function tokenize(src: string, where: string, owner: string[]): Tok[] {
  const out: Tok[] = [];
  const s = src.replace(/[·×]/g, "*").replace(/−/g, "-");
  let i = 0;
  const idStart = /[A-Za-z_°ΩµμͰ-Ͽ]/, idChar = /[A-Za-z0-9_ΩµμͰ-Ͽ]/;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) { out.push({ k: "num", s: num[0] }); i += num[0].length; continue; }
    if (idStart.test(c)) {
      let j = i + 1;
      if (c !== "°") while (j < s.length && (idChar.test(s[j]!) || (s[j] === "." && idStart.test(s[j + 1] ?? "")))) j++;
      out.push({ k: "id", s: s.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^(),".includes(c)) { out.push({ k: "op", s: c }); i++; continue; }
    fail("E_EXPR_PARSE", owner, `Unexpected character "${c}" in expression "${src}"`, { path: where, suggestion: "Use numbers, names, units and + - * / ^ ( ) , only." });
  }
  return out;
}

/** Parse and evaluate an expression (or plain number) to an SI quantity. */
export function evalQuantity(value: NumLike, scope: Scope, where: string, owner: string[]): TkQuantity {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("E_NON_FINITE", owner, `${where} is not finite`, { path: where, measured: { value } });
    return { value, dim: DIMLESS };
  }
  if (typeof value !== "string" || value.trim() === "") fail("E_SCHEMA", owner, `${where} must be a number or an expression string`, { path: where, measured: { value } });
  const toks = tokenize(value, where, owner);
  const vars: Record<string, number> = {};
  const dims = new Map<string, QDim>();
  // Every literal and name becomes an alias q_<n>: Kinetra's parser then sees
  // only identifiers, operators and explicit multiplication.
  const alias = (q: TkQuantity) => { const a = `q_${dims.size}`; vars[a] = q.value; dims.set(a, q.dim); return a; };
  const isUnitTok = (x?: Tok) => x?.k === "id" && !!unitQuantity(x.s);
  const exponent = (j: number): [string, number] => {
    // "^2", "^-1" directly after a unit
    if (toks[j]?.k === "op" && toks[j]!.s === "^") {
      const neg = toks[j + 1]?.k === "op" && toks[j + 1]!.s === "-";
      const n = toks[j + (neg ? 2 : 1)];
      if (n?.k === "num") return [`^${neg ? "-" : ""}${alias({ value: Number(n.s), dim: DIMLESS })}`, j + (neg ? 3 : 2)];
    }
    return ["", j];
  };
  const parts: string[] = [];
  let prevValue = false;
  for (let t = 0; t < toks.length;) {
    const tok = toks[t]!;
    const next = toks[t + 1];
    const startsValue = tok.k === "num" || tok.k === "id" || (tok.k === "op" && tok.s === "(");
    if (prevValue && startsValue) parts.push("*");
    if (tok.k === "num") {
      // A number followed by units is one quantity literal: "9.81 m/s^2".
      let group = alias({ value: Number(tok.s), dim: DIMLESS });
      let j = t + 1;
      if (isUnitTok(toks[j])) {
        while (true) {
          if (isUnitTok(toks[j])) {
            const [exp, k] = exponent(j + 1);
            group += `*${alias(unitQuantity(toks[j]!.s)!)}${exp}`;
            j = k;
          } else if (toks[j]?.k === "op" && toks[j]!.s === "/" && isUnitTok(toks[j + 1])) {
            const [exp, k] = exponent(j + 2);
            group += `/${alias(unitQuantity(toks[j + 1]!.s)!)}${exp}`;
            j = k;
          } else break;
        }
        group = `(${group})`;
      }
      parts.push(group);
      prevValue = true;
      t = j;
      continue;
    }
    if (tok.k === "op" && tok.s === "-" && !prevValue && parts.at(-1) !== "^") {
      // Unary minus binds looser than ^ (so -3^2 = -9); Kinetra's parser
      // binds it tighter, so it is rewritten as multiplication by -1.
      parts.push(`${alias({ value: -1, dim: DIMLESS })}*`);
      t++;
      continue;
    }
    if (tok.k === "op") { parts.push(tok.s); prevValue = tok.s === ")"; t++; continue; }
    if (FUNCTIONS.has(tok.s) && next?.k === "op" && next.s === "(") { parts.push(tok.s); prevValue = false; t++; continue; }
    if (tok.s === "pow") fail("E_EXPR_PARSE", owner, `pow() is not supported in "${value}"`, { path: where, suggestion: "Write a^b instead of pow(a, b)." });
    // A bare name is a variable or reference first, then a unit, then a constant.
    const q = scope.lookup(tok.s) ?? unitQuantity(tok.s) ?? (tok.s in CONSTANTS ? { value: CONSTANTS[tok.s]!, dim: DIMLESS } : undefined);
    if (!q) {
      const known = [...scope.names(), ...Object.keys(UNITS).filter(Boolean), ...Object.keys(UNIT_ALIASES), ...Object.keys(EXTRA_UNITS), "pi"];
      const near = closestNames(tok.s, known);
      fail("E_EXPR_UNKNOWN_NAME", owner, `Unknown name "${tok.s}" in expression "${value}"`, { path: where, measured: { name: tok.s }, suggestion: near.length ? `Did you mean ${near.map(n => `"${n}"`).join(", ")}? Declare variables under "vars".` : `Declare "${tok.s}" under "vars", or use a unit from Kinetra's unit table (m, cm, s, kg, N, J, V, A, ohm, deg, rad, ...).` });
    }
    parts.push(alias(q));
    prevValue = true;
    t++;
  }
  let ast: Expr;
  try { ast = parseExpr(parts.join("")); }
  catch (e) { fail("E_EXPR_PARSE", owner, `Cannot parse "${value}": ${(e as Error).message}`, { path: where, suggestion: "Check parentheses and operators, e.g. \"0.5*m*v^2\"." }); }
  const d = dimOf(ast, dims, vars, value, where, owner);
  let v: number;
  try { v = evaluate(ast, { vars }); }
  catch (e) { fail("E_NON_FINITE", owner, `Cannot evaluate "${value}": ${(e as Error).message}`, { path: where, suggestion: "Avoid dividing by zero; check the variables this expression uses." }); }
  if (!Number.isFinite(v)) fail("E_NON_FINITE", owner, `"${value}" evaluates to ${v}`, { path: where, measured: { value: v }, suggestion: "Check for division by zero, square roots or logarithms of negative values, and huge exponents." });
  return { value: v, dim: d };
}

function dimOf(e: Expr, dims: Map<string, QDim>, vars: Record<string, number>, src: string, where: string, owner: string[]): QDim {
  const rec = (x: Expr) => dimOf(x, dims, vars, src, where, owner);
  const mismatch = (what: string, a: QDim, b?: QDim, suggestion?: string): never =>
    fail("E_UNIT_MISMATCH", owner, `${what} in "${src}"`, { path: where, measured: b ? { left: dimLabel(a), right: dimLabel(b) } : { argument: dimLabel(a) }, suggestion });
  const same = (xs: Expr[], what: string) => {
    const ds = xs.map(rec);
    for (const d of ds.slice(1)) if (!qdimEqual(d, ds[0]!)) mismatch(`Cannot ${what} ${dimLabel(ds[0]!)} and ${dimLabel(d)}`, ds[0]!, d, "Make both sides the same kind of quantity, e.g. convert units or fix the formula.");
    return ds[0]!;
  };
  switch (e.type) {
    case "num": case "const": return DIMLESS;
    case "var": return dims.get(e.name) ?? DIMLESS;
    case "neg": return rec(e.arg);
    case "add": return same(e.args, "add");
    case "sub": return same([e.left, e.right], "subtract");
    case "mul": return e.args.map(rec).reduce(qmul, DIMLESS);
    case "div": return qdiv(rec(e.left), rec(e.right));
    case "pow": {
      const b = rec(e.left), k = rec(e.right);
      if (!isDimless(k)) mismatch("Exponent must be dimensionless", k);
      if (isDimless(b)) return DIMLESS;
      return qpow(b, evaluate(e.right, { vars }));
    }
    case "fn": {
      const ds = e.args.map(rec);
      const n = e.name;
      if (["sin", "cos", "tan"].includes(n)) {
        if (!qdimEqual(ds[0]!, ANGLE)) mismatch(`${n}() expects an angle, got ${dimLabel(ds[0]!)}`, ds[0]!, undefined, `Give the angle a unit, e.g. ${n}(30 deg) or ${n}(0.5 rad).`);
        return DIMLESS;
      }
      if (["asin", "acos", "atan"].includes(n)) { if (!isDimless(ds[0]!)) mismatch(`${n}() expects a dimensionless ratio`, ds[0]!); return ANGLE; }
      if (n === "atan2") { same(e.args, "compare in atan2"); return ANGLE; }
      if (["sinh", "cosh", "tanh", "exp", "ln", "log", "log2", "log10"].includes(n)) { for (const d of ds) if (!isDimless(d)) mismatch(`${n}() expects a dimensionless argument`, d); return DIMLESS; }
      if (n === "sqrt") return qpow(ds[0]!, 0.5);
      if (n === "cbrt") return qpow(ds[0]!, 1 / 3);
      if (n === "sign") return DIMLESS;
      if (["min", "max", "mod"].includes(n)) return same(e.args, `combine in ${n}()`);
      return ds[0] ?? DIMLESS;
    }
    default:
      return fail("E_EXPR_PARSE", owner, `Unsupported construct "${e.type}" in "${src}"`, { path: where });
  }
}

/** Evaluation context: scope plus the physical size of one world unit. */
export interface ValueContext { scope: Scope; worldUnitSI: number }

/** A length in world units. Plain numbers are world units; dimensioned values convert via worldUnit. */
export function evalLength(value: NumLike, ctx: ValueContext, where: string, owner: string[]): number {
  const q = evalQuantity(value, ctx.scope, where, owner);
  if (isDimless(q.dim)) return q.value;
  if (qdimEqual(q.dim, LENGTH)) return q.value / ctx.worldUnitSI;
  return fail("E_UNIT_MISMATCH", owner, `${where} must be a length, got ${dimLabel(q.dim)}`, { path: where, measured: { value: q.value, dimension: dimLabel(q.dim) }, suggestion: "Use a length such as \"2 m\" or a plain number of world units." });
}

/** An angle in radians. Plain JSON numbers are degrees; expressions need an angle unit. */
export function evalAngle(value: NumLike, ctx: ValueContext, where: string, owner: string[]): number {
  if (typeof value === "number") return evalQuantity(value, ctx.scope, where, owner).value * Math.PI / 180;
  const q = evalQuantity(value, ctx.scope, where, owner);
  if (qdimEqual(q.dim, ANGLE)) return q.value;
  return fail("E_UNIT_MISMATCH", owner, `${where} must be an angle, got ${dimLabel(q.dim)}`, { path: where, measured: { value: q.value, dimension: dimLabel(q.dim) }, suggestion: `Write the unit, e.g. "${value} deg", or use a JSON number (degrees).` });
}

export function evalNumber(value: NumLike, ctx: ValueContext, where: string, owner: string[]): number {
  const q = evalQuantity(value, ctx.scope, where, owner);
  if (isDimless(q.dim)) return q.value;
  return fail("E_UNIT_MISMATCH", owner, `${where} must be dimensionless, got ${dimLabel(q.dim)}`, { path: where, measured: { value: q.value, dimension: dimLabel(q.dim) } });
}

/** Scope over model variables, evaluated lazily with cycle detection. */
export function variableScope(vars: Record<string, NumLike>, parent: Scope = EMPTY_SCOPE): Scope {
  const cache = new Map<string, TkQuantity>();
  const stack: string[] = [];
  const scope: Scope = {
    names: () => [...Object.keys(vars), ...parent.names()],
    lookup(name) {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) return parent.lookup(name);
      const hit = cache.get(name);
      if (hit) return hit;
      if (stack.includes(name)) {
        const cycle = [...stack.slice(stack.indexOf(name)), name];
        fail("E_CIRCULAR", cycle.map(n => `var:${n}`), `Variables depend on each other in a cycle: ${cycle.join(" -> ")}`, { path: `vars.${name}`, suggestion: "Give one of these variables a value that does not refer back to the others." });
      }
      stack.push(name);
      try {
        const q = evalQuantity(vars[name]!, scope, `vars.${name}`, [`var:${name}`]);
        cache.set(name, q);
        return q;
      } finally { stack.pop(); }
    },
  };
  return scope;
}

/** Scope that adds fixed quantities on top of a parent scope. */
export function mapScope(values: Map<string, TkQuantity>, parent: Scope): Scope {
  return { lookup: n => values.get(n) ?? parent.lookup(n), names: () => [...values.keys(), ...parent.names()] };
}
