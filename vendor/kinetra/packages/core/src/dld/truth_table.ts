/**
 * Truth table generation and evaluation.
 *
 * The truth table is computed from a Boolean expression mask so the table
 * is always in agreement with the canonical mask representation.
 */

import { enumerateInputs, evaluateLiteral, fromVariableIndex, notMask, card, context, allAssignmentsMask } from "./boolean.js";
import type { BooleanContext } from "./boolean.js";
import type { BoolExpr } from "./expression.js";
import { walk } from "./expression.js";
import { KinetraError } from "../errors.js";

export interface TruthTableRow {
  index: number;
  inputs: Record<string, 0 | 1>;
  output: 0 | 1;
  intermediates: Record<string, 0 | 1>;
}

export interface TruthTable {
  context: BooleanContext;
  rows: TruthTableRow[];
  mask: bigint;
  /** Optional intermediate columns with the expression that produced them. */
  intermediateColumns: { name: string; expr: BoolExpr }[];
}

/** Convert a Boolean expression to a satisfying-assignment mask. */
export function expressionToMask(expr: BoolExpr, ctx: BooleanContext): bigint {
  // Pre-evaluate each unique subexpression and cache.
  const cache = new Map<BoolExpr, bigint>();
  const evalNode = (e: BoolExpr): bigint => {
    const cached = cache.get(e);
    if (cached !== undefined) return cached;
    let m: bigint;
    switch (e.type) {
      case "const":
        m = e.value === 1 ? allAssignmentsMask(ctx) : 0n;
        break;
      case "var":
        m = evaluateLiteral(e.name, ctx);
        break;
      case "not":
        m = notMask(evalNode(e.arg), ctx);
        break;
      case "and": {
        m = allAssignmentsMask(ctx);
        for (const a of e.args) m = m & evalNode(a);
        break;
      }
      case "or": {
        m = 0n;
        for (const a of e.args) m = m | evalNode(a);
        break;
      }
      case "xor": {
        m = 0n;
        for (const a of e.args) m = m ^ evalNode(a);
        break;
      }
    }
    cache.set(e, m);
    return m;
  };
  return evalNode(expr);
}

export function buildTruthTable(
  variables: string[],
  expr: BoolExpr,
  intermediates: { name: string; expr: BoolExpr }[] = [],
): TruthTable {
  const ctx = context(variables);
  const mask = expressionToMask(expr, ctx);
  const interMasks = intermediates.map((i) => ({
    name: i.name,
    mask: expressionToMask(i.expr, ctx),
  }));
  const inputs = enumerateInputs(ctx);
  const rows: TruthTableRow[] = inputs.map(({ values, index }) => {
    const bit = 1n << BigInt(index);
    return {
      index,
      inputs: values,
      output: ((mask & bit) !== 0n) ? 1 : 0,
      intermediates: Object.fromEntries(
        interMasks.map((i) => [i.name, ((i.mask & bit) !== 0n ? 1 : 0)] as const),
      ),
    };
  });
  return { context: ctx, rows, mask, intermediateColumns: intermediates };
}

/** Extract minterm indices from a truth table mask. */
export function minterms(tt: TruthTable): number[] {
  const out: number[] = [];
  for (const r of tt.rows) if (r.output === 1) out.push(r.index);
  return out;
}

/** Extract maxterm indices from a truth table mask. */
export function maxterms(tt: TruthTable): number[] {
  const out: number[] = [];
  for (const r of tt.rows) if (r.output === 0) out.push(r.index);
  return out;
}

export function maskFromMinterms(minterms: number[], ctx: BooleanContext): bigint {
  let m = 0n;
  for (const a of minterms) m |= 1n << BigInt(a);
  return m;
}

export function maskFromMaxterms(maxterms: number[], ctx: BooleanContext): bigint {
  let m = allAssignmentsMask(ctx);
  for (const a of maxterms) m &= ~(1n << BigInt(a));
  return m;
}

export function maskToMintermExpression(mask: bigint, ctx: BooleanContext): BoolExpr {
  const m: BoolExpr[] = [];
  for (let i = 0; i < ctx.totalAssignments; i++) {
    if (((mask >> BigInt(i)) & 1n) === 1n) m.push(mintermExpr(i, ctx));
  }
  if (m.length === 0) return { type: "const", value: 0 };
  if (m.length === ctx.totalAssignments) return { type: "const", value: 1 };
  return { type: "or", args: m };
}

export function maskToMaxtermExpression(mask: bigint, ctx: BooleanContext): BoolExpr {
  const m: BoolExpr[] = [];
  for (let i = 0; i < ctx.totalAssignments; i++) {
    if (((mask >> BigInt(i)) & 1n) === 0n) m.push(maxtermExpr(i, ctx));
  }
  if (m.length === 0) return { type: "const", value: 1 };
  if (m.length === ctx.totalAssignments) return { type: "const", value: 0 };
  return { type: "and", args: m };
}

export function mintermExpr(index: number, ctx: BooleanContext): BoolExpr {
  const args: BoolExpr[] = [];
  for (let v = 0; v < ctx.variables.length; v++) {
    const bit = (index >> v) & 1;
    const name = ctx.variables[v];
    args.push(bit ? variable(name) : not(variable(name)));
  }
  return { type: "and", args };
}

export function maxtermExpr(index: number, ctx: BooleanContext): BoolExpr {
  const args: BoolExpr[] = [];
  for (let v = 0; v < ctx.variables.length; v++) {
    const bit = (index >> v) & 1;
    const name = ctx.variables[v];
    args.push(bit ? not(variable(name)) : variable(name));
  }
  return { type: "or", args };
}
