/**
 * Karnaugh map engine.
 *
 * Kinetra supports 2/3/4 variable K-maps with the standard Gray-code row and
 * column ordering, wraparound grouping, dont-cares, and a Quine-McCluskey
 * derived grouping for minimal SOP / POS. The canonical representation is
 * `KMap` which is independent of any visual layout.
 */

import { KinetraError } from "../errors.js";
import { context } from "./boolean.js";
import type { BooleanContext } from "./boolean.js";
import { not, or, and, variable, constant, walk } from "./expression.js";
import type { BoolExpr } from "./expression.js";
import { maskFromMinterms } from "./truth_table.js";
import { expressionToMask, maskFromMaxterms, mintermExpr } from "./truth_table.js";

export const KMAP_MAX_VARS = 4;

export function grayCode(n: number): number[] {
  if (n > 16) throw new KinetraError("validation", "Gray code too large", { n });
  const out: number[] = [];
  for (let i = 0; i < (1 << n); i++) out.push(i ^ (i >> 1));
  return out;
}

export function grayToBinary(g: number): number {
  let b = 0;
  for (; g !== 0; g >>= 1) b ^= g;
  return b;
}

export interface KMapSpec {
  variables: string[];
  /** minterm indices (where output is 1). */
  minterms: number[];
  /** dont-care indices (where output can be either). */
  dontCares?: number[];
  /** form for simplification; default "sop". */
  form?: "sop" | "pos";
}

export interface KMapGroup {
  /** Cell indices covered (in minterm numbering). */
  cells: number[];
  /** Variables in the implicant (positive form). */
  positives: string[];
  /** Variables in the implicant (negated form). */
  negatives: string[];
  /** Whether this group uses any dont-care cell. */
  usesDontCare: boolean;
}

export interface KMap {
  spec: KMapSpec;
  context: BooleanContext;
  rowVariables: string[];
  colVariables: string[];
  rowOrder: number[];
  colOrder: number[];
  cells: { index: number; row: number; col: number; value: 0 | 1 | "x" }[];
  mintermMask: bigint;
  dontCareMask: bigint;
  groups: KMapGroup[];
  simplified: BoolExpr;
  simplifiedText: string;
}

export function splitVariablesForMap(vars: string[]): { rows: string[]; cols: string[] } {
  if (vars.length < 2) {
    throw new KinetraError("validation", "K-map requires at least 2 variables", { vars });
  }
  if (vars.length === 2) return { rows: [vars[0]], cols: [vars[1]] };
  if (vars.length === 3) return { rows: [vars[0]], cols: [vars[1], vars[2]] };
  if (vars.length === 4) return { rows: [vars[0], vars[1]], cols: [vars[2], vars[3]] };
  throw new KinetraError("validation", "K-map variable count not supported", { vars });
}

export function buildKMap(spec: KMapSpec): KMap {
  if (spec.variables.length < 2 || spec.variables.length > KMAP_MAX_VARS) {
    throw new KinetraError("validation", "K-map supports 2-4 variables", { n: spec.variables.length });
  }
  const ctx = context(spec.variables);
  const { rows: rowVariables, cols: colVariables } = splitVariablesForMap(spec.variables);
  const rowOrder = grayCode(rowVariables.length);
  const colOrder = grayCode(colVariables.length);
  const mintermMask = maskFromMinterms(spec.minterms, ctx);
  const dontCareMask = maskFromMinterms(spec.dontCares ?? [], ctx);
  const cellValue = (idx: number): 0 | 1 | "x" => {
    if (((dontCareMask >> BigInt(idx)) & 1n) === 1n) return "x";
    return ((mintermMask >> BigInt(idx)) & 1n) === 1n ? 1 : 0;
  };
  const cells: KMap["cells"] = [];
  for (let r = 0; r < rowOrder.length; r++) {
    for (let c = 0; c < colOrder.length; c++) {
      const index = (rowOrder[r] << colVariables.length) | colOrder[c];
      cells.push({ index, row: r, col: c, value: cellValue(index) });
    }
  }
  const form = spec.form ?? "sop";
  const allMask = (1n << BigInt(ctx.totalAssignments)) - 1n;
  if (mintermMask === 0n) {
    return {
      spec, context: ctx, rowVariables, colVariables, rowOrder, colOrder, cells,
      mintermMask, dontCareMask, groups: [], simplified: constant(0),
      simplifiedText: formatExpr(constant(0), form),
    };
  }
  if (mintermMask === allMask) {
    return {
      spec, context: ctx, rowVariables, colVariables, rowOrder, colOrder, cells,
      mintermMask, dontCareMask, groups: [], simplified: constant(1),
      simplifiedText: formatExpr(constant(1), form),
    };
  }
  const { groups, implicants } = minimize(spec.variables, mintermMask, dontCareMask, form);
  // When minimize returns no implicants, the function is identically 0
  // (targetMask == 0). For POS, an "all-ones" function (no zeros) also
  // has targetMask == 0 in the dual, which is correctly handled here.
  const simplified = implicants.length === 0
    ? constant(0)
    : form === "sop"
      ? or(...implicants)
      : and(...implicants);
  return {
    spec,
    context: ctx,
    rowVariables,
    colVariables,
    rowOrder,
    colOrder,
    cells,
    mintermMask,
    dontCareMask,
    groups,
    simplified,
    simplifiedText: formatExpr(simplified, form),
  };
}


/**
 * Expand a prime implicant (pattern + dontMask) into the full set of
 * minterm indices it covers. Two assignments match the same implicant iff
 * they agree on every bit NOT in dontMask, and the agreed value equals
 * the corresponding bit of pattern. This is what the cover step should
 * use; the seed-combination only stores the representative cells used
 * to build the implicant, which is a strict subset.
 */
function expandImplicantMask(pattern: bigint, dontMask: bigint, totalAssignments: number): bigint {
  let m = 0n;
  const fixed = pattern & ~dontMask;
  for (let i = 0n; i < (1n << BigInt(totalAssignments)); i++) {
    if ((i & ~dontMask) === fixed) m |= 1n << i;
  }
  return m;
}

// --- Implicant extraction ---------------------------------------------------

interface PrimeImplicant {
  cells: number[];      // covered minterms
  mask: bigint;         // bitmask of minterm indices (representative)
  pattern: bigint;      // bit pattern over variables where set = 1
  dontMask: bigint;     // bit pattern for "variable is dont-care"
  expandedMask: bigint; // full set of all minterms matching pattern+dontMask
  used: boolean;
}

function minimize(
  variables: string[],
  mintermMask: bigint,
  dontCareMask: bigint,
  form: "sop" | "pos",
): { groups: KMapGroup[]; implicants: BoolExpr[] } {
  // For POS we minimize on the complement mask and then convert each
  // selected implicant into a sum-of-literals clause. POS(F) = AND of
  // (sum-clause_i) = AND of NOT(sop_clause_i) where sop_clause_i are
  // the prime implicants of !F. This is correct in all corner cases
  // (F=0 -> SOP(!F)=all-oner, the AND of those negations is 0; F=1 ->
  // SOP(!F)=0, the AND collapses to 1).
  const totalAssignments = 1 << variables.length;
  const allMask = (1n << BigInt(totalAssignments)) - 1n;
  const workMask = form === "sop" ? mintermMask : (~mintermMask & allMask);
  const workDont = form === "sop" ? dontCareMask : 0n;
  const active = workMask | workDont;
  const targetMask = workMask;

  // Round 1: list all prime implicants via Quine-McCluskey style grouping.
  let current: { cells: number[]; mask: bigint; pattern: bigint; dontMask: bigint; combined: boolean }[] = [];
  for (let i = 0n; i < (1n << BigInt(variables.length)); i++) {
    if (((active >> i) & 1n) === 0n) continue;
    current.push({ cells: [Number(i)], mask: 1n << i, pattern: i, dontMask: 0n, combined: false });
  }
  const primes: PrimeImplicant[] = [];
  while (current.length > 0) {
    const next: typeof current = [];
    const seen = new Set<string>();
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i];
        const b = current[j];
        const xor = a.pattern ^ b.pattern;
        if (xor === 0n) continue;
        if ((xor & (xor - 1n)) !== 0n) continue; // not a single-bit diff
        // Standard QM rule: same dontMask, differ in 1 fixed bit.
        // Also allow: same fixed bits (i.e. agree on every non-dont-care bit),
        // and (dontMask1 ^ dontMask2) is a single bit. This is the "make
        // another variable a dont-care" merge that the standard algorithm
        // misses when intermediate rounds introduced asymmetric dontMasks.
        const sameFixed = (a.pattern & ~a.dontMask) === (b.pattern & ~b.dontMask);
        const diffDont = a.dontMask ^ b.dontMask;
        const standardMerge = a.dontMask === b.dontMask;
        const relaxedMerge = sameFixed && ((diffDont & (diffDont - 1n)) === 0n) && diffDont !== 0n;
        if (!standardMerge && !relaxedMerge) continue;
        const pattern = standardMerge ? (a.pattern & b.pattern) : (a.pattern & b.pattern & ~diffDont);
        const dontMask = standardMerge ? (a.dontMask | xor) : (a.dontMask | b.dontMask);
        const cells = [...a.cells, ...b.cells].sort((x, y) => x - y);
        const key = `${pattern.toString(16)}|${dontMask.toString(16)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ cells, mask: a.mask | b.mask, pattern, dontMask, combined: false });
        a.combined = true;
        b.combined = true;
      }
    }
    for (const c of current) {
      if (!c.combined) {
        primes.push({ cells: c.cells, mask: c.mask, pattern: c.pattern, dontMask: c.dontMask, expandedMask: expandImplicantMask(c.pattern, c.dontMask, totalAssignments), used: false });
      }
    }
    current = next;
  }

  // Cover step: greedily cover required minterms/maxterms with prime implicants.
  const targetIndices: number[] = [];
  for (let i = 0n; i < (1n << BigInt(variables.length)); i++) {
    if (((targetMask >> i) & 1n) === 1n) targetIndices.push(Number(i));
  }
  // Trivial-case early exit: no target at all (SOP=0 or POS=1).
  if (targetIndices.length === 0) {
    return { groups: [], implicants: [] };
  }
  // "Allowed" set = targetMask | dontCareMask. A prime is valid if every
  // cell it covers is in the allowed set. Without this, dont-cares make the
  // cover step reject every prime and return an empty cover.
  const allowedMask = targetMask | workDont;
  for (const p of primes) {
    let coversAll = true;
    for (const t of targetIndices) {
      if (((p.expandedMask >> BigInt(t)) & 1n) === 0n) { coversAll = false; break; }
    }
    // also must not cover any non-allowed indices
    let coversExtras = false;
    for (let i = 0n; i < (1n << BigInt(variables.length)); i++) {
      if (((allowedMask >> i) & 1n) === 1n) continue;
      if (((p.expandedMask >> i) & 1n) === 1n) { coversExtras = true; break; }
    }
    if (coversAll && !coversExtras) p.used = true;
  }
  // Greedy cover: each iteration pick the prime that covers the most uncovered required indices.
  const uncovered = new Set(targetIndices);
  const chosen: PrimeImplicant[] = [];
  while (uncovered.size > 0) {
    let best: PrimeImplicant | undefined;
    let bestCount = 0;
    for (const p of primes) {
      let count = 0;
      let hasExtra = false;
      for (const t of uncovered) {
        if (((p.expandedMask >> BigInt(t)) & 1n) === 1n) count += 1;
      }
      for (let i = 0n; i < (1n << BigInt(variables.length)); i++) {
        if (((allowedMask >> i) & 1n) === 1n) continue;
        if (((p.expandedMask >> i) & 1n) === 1n) { hasExtra = true; break; }
      }
      if (hasExtra) continue;
      if (count > bestCount) { best = p; bestCount = count; }
    }
    if (!best) break;
    chosen.push(best);
    best.used = true;
    for (const t of [...uncovered]) if (((best.mask >> BigInt(t)) & 1n) === 1n) uncovered.delete(t);
  }

  // Essential primes: any required minterm that is covered by exactly one prime.
  // We add them on top of the greedy cover to keep this implementation stable.
  for (const p of primes) {
    if (p.used) continue;
    let only = true;
    let coversAny = false;
    for (const t of targetIndices) {
      if (((p.expandedMask >> BigInt(t)) & 1n) === 1n) coversAny = true;
    }
    if (!coversAny) continue;
    for (const q of primes) {
      if (q === p) continue;
      for (const t of targetIndices) {
        if (((p.expandedMask >> BigInt(t)) & 1n) === 1n && ((q.mask >> BigInt(t)) & 1n) === 1n) {
          only = false; break;
        }
      }
      if (!only) break;
    }
    if (only) {
      chosen.push(p);
      p.used = true;
    }
  }

  // Build groups + implicants.
  const groups: KMapGroup[] = chosen.map((p) => {
    const positives: string[] = [];
    const negatives: string[] = [];
    for (let v = 0; v < variables.length; v++) {
      if (((p.dontMask >> BigInt(v)) & 1n) === 1n) continue;
      const name = variables[v];
      if (((p.pattern >> BigInt(v)) & 1n) === 1n) positives.push(name);
      else negatives.push(name);
    }
    const usesDontCare = p.cells.some((c) => ((dontCareMask >> BigInt(c)) & 1n) === 1n);
    return { cells: p.cells, positives, negatives, usesDontCare };
  });

  const implicants: BoolExpr[] = chosen.map((p) => {
    const sopArgs: BoolExpr[] = [];
    for (let v = 0; v < variables.length; v++) {
      if (((p.dontMask >> BigInt(v)) & 1n) === 1n) continue;
      const name = variables[v];
      const positive = ((p.pattern >> BigInt(v)) & 1n) === 1n;
      sopArgs.push(positive ? variable(name) : not(variable(name)));
    }
    if (sopArgs.length === 0) return constant(1);
    if (form === "sop") return and(...sopArgs);
    // POS clause: negate each literal and OR.
    const posArgs = sopArgs.map((a) =>
      a.type === "not" ? variable(a.arg.name) : not(variable(a.type === "var" ? a.name : "?")),
    );
    return or(...posArgs);
  });

  return { groups, implicants };
}

export function formatExpr(e: BoolExpr, form: "sop" | "pos"): string {
  const parts: string[] = [];
  walk(e, () => undefined);
  switch (e.type) {
    case "const": return e.value === 1 ? "1" : "0";
    case "var": return e.name;
    case "not": return "!" + formatExpr(e.arg, form);
    case "and": return e.args.map((a) => formatExpr(a, form)).join(form === "sop" ? "" : " + ");
    case "or": return "(" + e.args.map((a) => formatExpr(a, form)).join(" + ") + ")";
    case "xor": return "(" + e.args.map((a) => formatExpr(a, form)).join(" ? ") + ")";
  }
  return "?";
}
