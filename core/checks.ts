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
      const decimals = (String(check.claimed).split('.')[1] || '').replace(/e.*$/i, '').length;
      const rounding = decimals ? 0.5 * 10 ** -decimals : 0;
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

/** Round for display without trailing noise. */
export function showNumber(v: number) {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e7 || abs < 1e-4)) return v.toExponential(3);
  return Number(v.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
