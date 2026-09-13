/**
 * Boolean algebra primitives for Kinetra's digital logic engine.
 *
 * We represent a Boolean function as a 64-bit mask (BigInt) of all satisfying
 * input assignments. Operations on these masks are O(1) bitwise operations
 * and the truth table is implicit. This is the canonical representation
 * Kinetra uses to compare expressions, truth tables, and K-maps.
 */

export type VarName = string;

export interface BooleanContext {
  variables: VarName[];
  /** Total number of assignments = 2^|variables|. Capped at 2^16. */
  totalAssignments: number;
}

export const MAX_VARS = 16;

export function context(vars: VarName[]): BooleanContext {
  if (vars.length > MAX_VARS) {
    throw new Error(`Too many variables: ${vars.length} (max ${MAX_VARS})`);
  }
  // Normalize to single uppercase letters so the parser (which always
  // produces uppercase variable names) and the caller variables array
  // agree. This keeps inputs and expression variables in sync.
  const normalized = vars.map((v) => {
    if (typeof v !== "string" || v.length === 0) {
      throw new Error("Invalid variable name: " + JSON.stringify(v));
    }
    return v.toUpperCase();
  });
  return { variables: normalized, totalAssignments: 1 << vars.length };
}

export function fromVariableIndex(name: VarName, ctx: BooleanContext): bigint {
  const idx = ctx.variables.indexOf(name);
  if (idx < 0) throw new Error(`Unknown variable: ${name}`);
  // bit i is set for every assignment where variable at index i is true.
  return 1n << BigInt(idx);
}

/** Mask representing all assignments of `ctx`. */
/**
 * The "every assignment is on" mask. Each of the `totalAssignments` bits
 * corresponds to one input vector. So for n variables this is
 * (1 << 2^n) - 1, which is correct even though JS bit-shift would overflow
 * for n >= 31; we use BigInt throughout. Computed per-context so the caller
 * does not have to track width.
 */
export function allAssignmentsMask(ctx: BooleanContext): bigint {
  return (1n << BigInt(ctx.totalAssignments)) - 1n;
}
export const ALL_OFF: bigint = 0n;

export function maskToAssignments(mask: bigint, ctx: BooleanContext): number[] {
  const out: number[] = [];
  const total = ctx.totalAssignments;
  for (let i = 0; i < total; i++) {
    if (((mask >> BigInt(i)) & 1n) === 1n) out.push(i);
  }
  return out;
}

export function assignmentsToMask(assignments: Iterable<number>, ctx: BooleanContext): bigint {
  let m = 0n;
  for (const a of assignments) {
    if (a < 0 || a >= ctx.totalAssignments) {
      throw new Error(`Assignment ${a} out of range for ${ctx.totalAssignments}`);
    }
    m |= 1n << BigInt(a);
  }
  return m;
}

export function evaluateLiteral(varName: VarName, ctx: BooleanContext): bigint {
  const idx = ctx.variables.indexOf(varName);
  if (idx < 0) throw new Error(`Unknown variable: ${varName}`);
  // For variable x_i, mask has bit `a` set iff assignment a has bit i = 1.
  const bit = 1n << BigInt(idx);
  let m = 0n;
  for (let a = 0; a < ctx.totalAssignments; a++) {
    if (((BigInt(a) >> BigInt(idx)) & 1n) === 1n) m |= 1n << BigInt(a);
  }
  return m;
}

export function andMasks(a: bigint, b: bigint): bigint {
  return a & b;
}

export function orMasks(a: bigint, b: bigint): bigint {
  return a | b;
}

export function xorMasks(a: bigint, b: bigint): bigint {
  return a ^ b;
}

export function notMask(a: bigint, ctx: BooleanContext): bigint { return allAssignmentsMask(ctx) ^ a; }

export function card(mask: bigint): number {
  let c = 0;
  let m = mask;
  while (m !== 0n) {
    c += Number(m & 1n);
    m >>= 1n;
  }
  return c;
}

export function equals(a: bigint, b: bigint): boolean {
  return a === b;
}

export function implies(a: bigint, b: bigint, ctx: BooleanContext): boolean {
  return (a & ~b & allAssignmentsMask(ctx)) === 0n;
}

export function donCarePositions(positions: number[], ctx: BooleanContext): bigint {
  return assignmentsToMask(positions, ctx);
}

export interface InputAssignment {
  values: Record<VarName, 0 | 1>;
  index: number;
}

export function enumerateInputs(ctx: BooleanContext): InputAssignment[] {
  const out: InputAssignment[] = [];
  for (let i = 0; i < ctx.totalAssignments; i++) {
    const values: Record<VarName, 0 | 1> = {};
    for (let v = 0; v < ctx.variables.length; v++) {
      values[ctx.variables[v]] = ((i >> v) & 1) ? 1 : 0;
    }
    out.push({ values, index: i });
  }
  return out;
}
