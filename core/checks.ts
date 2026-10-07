import { z } from 'zod';
import { compile } from './expr.ts';

/** Checked numbers: the model states each key result as a formula, its inputs and the value it
 *  reported. Mowr recomputes the formula itself and says whether the arithmetic holds.
 *  This verifies arithmetic and substitution, not the choice of formula. */
const checkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  expr: z.string().trim().min(1).max(600),
  vars: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,23}$/), z.number()).optional(),
  claimed: z.number(),
  unit: z.string().trim().max(16).optional(),
  tolerance: z.number().min(0).max(0.2).optional(),
});
export const checksSchema = z.object({ checks: z.array(checkSchema).min(1).max(12) });
export type CheckResult = { label: string; expr: string; unit: string; claimed: number; computed: number; status: 'ok' | 'differs' | 'error'; error?: string };

/** Power of ten of the last significant digit of a number as written: 40.77 → -2, 41 → 0, 1.5e-7 → -8.
 *  Trailing zeros of an integer (1200) are read as rounding, but at least two significant digits are assumed. */
function lastDigitPlace(value: number) {
  // A claimed 0 says nothing about precision, so it gets no rounding allowance.
  if (value === 0) return -Infinity;
  const [mantissa, exp] = String(Math.abs(value)).toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  if (exp !== undefined) return Number(exp) - fraction.length;
  if (fraction) return -fraction.length;
  const zeros = whole.length - whole.replace(/0+$/, '').length;
  return Math.max(0, Math.min(zeros, whole.length - 2));
}

export function runChecks(raw: unknown): CheckResult[] {
  const parsed = checksSchema.safeParse(Array.isArray(raw) ? { checks: raw } : raw);
  if (!parsed.success) throw Error('The calculation check is incomplete.');
  return parsed.data.checks.map(check => {
    const unit = check.unit || '';
    try {
      const vars = check.vars || {};
      const fn = compile(check.expr, Object.keys(vars));
      const computed = fn(vars);
      if (!Number.isFinite(computed)) return { ...check, unit, computed, status: 'error' as const, error: 'The formula does not produce a finite number.' };
      const tolerance = check.tolerance ?? 0.005;
      const scale = Math.max(Math.abs(computed), Math.abs(check.claimed), 1e-12);
      // Reported values are usually rounded: accept a relative tolerance, or a difference within
      // half a unit of the precision the claim was written with.
      const rounding = 0.5 * 10 ** lastDigitPlace(check.claimed);
      const ok = Math.abs(computed - check.claimed) <= Math.max(tolerance * scale, rounding + 1e-12);
      return { label: check.label, expr: check.expr, unit, claimed: check.claimed, computed, status: ok ? 'ok' as const : 'differs' as const };
    } catch (e) {
      return { label: check.label, expr: check.expr, unit, claimed: check.claimed, computed: NaN, status: 'error' as const, error: (e as Error).message };
    }
  });
}

export function parseChecks(body: string): CheckResult[] {
  let data: unknown;
  try { data = JSON.parse(body.trim()); } catch { throw Error('The calculation check is not valid JSON.'); }
  return runChecks(data);
}

/** A ```check block: the line it starts on (1-based) and the lines of its body. */
export type CheckBlock = { at: number; lines: string[] };

/** The ```check blocks of an answer, outside other code fences. */
export function checkBlocks(markdown: string): CheckBlock[] {
  const blocks: CheckBlock[] = [];
  let fence: string | null = null, block: CheckBlock | null = null;
  markdown.replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
    if (block) { if (/^\s*```\s*$/.test(line)) { blocks.push(block); block = null; } else block.lines.push(line); return; }
    const mark = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (fence) { if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null; return; }
    if (/^\s*```\s*check\s*$/i.test(line)) block = { at: index + 1, lines: [] };
    else if (mark) fence = mark;
  });
  return blocks;
}

/**
 * Every check recomputed: one line per stated value that differs from what its formula gives, or that cannot be
 * computed. `lines` names the line each is on (a draft file); an answer in chat names only the label.
 */
export function checkProblems(blocks: CheckBlock[] = [], { lines = true }: { lines?: boolean } = {}) {
  const problems: string[] = [];
  for (const block of blocks) {
    let results;
    try { results = parseChecks(block.lines.join('\n')); } catch (error) {
      problems.push(`${lines ? `Line ${block.at}: ` : 'A check block: '}${(error as Error).message.replace(/\.$/, '')} (a check block holds {"checks":[{"label":…,"expr":…,"vars":{…},"claimed":…}]}, at most 12 per block).`);
      continue;
    }
    for (const result of results) {
      // The check's own line, found by its label; the block's first line when the label is not on a line of its own.
      const offset = block.lines.findIndex(l => l.includes(JSON.stringify(result.label)));
      const where = lines ? `Line ${offset >= 0 ? block.at + 1 + offset : block.at}: ` : '';
      const unit = result.unit ? ' ' + result.unit : '';
      if (result.status === 'differs') problems.push(`${where}"${result.label}" states ${showNumber(result.claimed)}${unit}, but ${result.expr} gives ${showNumber(result.computed)}${unit}.`);
      else if (result.status === 'error') problems.push(`${where}"${result.label}" cannot be computed (${result.error}).`);
    }
  }
  return problems;
}

/** Round for display without trailing noise. */
export function showNumber(v: number) {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e7 || abs < 1e-4)) return v.toExponential(3);
  return Number(v.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
