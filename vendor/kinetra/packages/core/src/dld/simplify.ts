/**
 * Boolean simplification. Wraps the K-map engine for expressions and provides
 * a mask-driven minimiser. The mask is the source of truth: simplification
 * never invents a function different from the input mask.
 */

import { context } from "./boolean.js";
import type { BooleanContext } from "./boolean.js";
import { buildKMap } from "./kmap.js";
import type { KMap } from "./kmap.js";
import { collectVariables } from "./expression.js";
import type { BoolExpr } from "./expression.js";
import { and, or, not, variable, constant } from "./expression.js";
import { expressionToMask } from "./truth_table.js";
import { maskToMintermExpression, maskToMaxtermExpression } from "./truth_table.js";

export interface SimplifyOptions {
  form?: "sop" | "pos";
  dontCares?: number[];
}

export interface SimplifyResult {
  before: BoolExpr;
  after: BoolExpr;
  beforeText: string;
  afterText: string;
  kmap: KMap;
  minterms: number[];
  maxterms: number[];
  maskEqual: boolean;
}

export function simplifyExpression(expr: BoolExpr, opts: SimplifyOptions = {}): SimplifyResult {
  const vars = collectVariables(expr);
  const ctx = context(vars);
  const mask = expressionToMask(expr, ctx);
  const minterms: number[] = [];
  const maxterms: number[] = [];
  for (let i = 0; i < ctx.totalAssignments; i++) {
    if (((mask >> BigInt(i)) & 1n) === 1n) minterms.push(i);
    else maxterms.push(i);
  }
  const kmap = buildKMap({ variables: vars, minterms, dontCares: opts.dontCares, form: opts.form });
  return {
    before: expr,
    after: kmap.simplified,
    beforeText: formatExprSimple(expr),
    afterText: kmap.simplifiedText,
    kmap,
    minterms,
    maxterms,
    maskEqual: expressionToMask(kmap.simplified, ctx) === mask,
  };
}

export function formatExprSimple(e: BoolExpr): string {
  switch (e.type) {
    case "const": return e.value === 1 ? "1" : "0";
    case "var": return e.name;
    case "not": return "!" + formatExprSimple(e.arg);
    case "and": return e.args.map(formatExprSimple).join("");
    case "or": return "(" + e.args.map(formatExprSimple).join(" + ") + ")";
    case "xor": return "(" + e.args.map(formatExprSimple).join(" ? ") + ")";
  }
  return "?";
}
