/**
 * Mastery rules.
 *
 * Pure functions that map a stream of correctness events to a mastery
 * score for a topic. The SQLite store (`store/mastery.ts`) persists the
 * score; this module holds the rule so it can be unit-tested in isolation.
 */

export interface MasteryEvent {
  correct: boolean;
  /** Weight relative to other events; defaults to 1. */
  weight?: number;
  /** Difficulty 0..1 used to inflate correct scores and deflate incorrect ones. */
  difficulty?: number;
}

export interface MasteryState {
  score: number; // 0..1
  n: number;
  lastUpdated: string;
}

const PRIOR = 0.5;

/**
 * Bayesian-style running mean with a difficulty prior. New events pull the
 * score toward 1 (correct) or 0 (incorrect), modulated by difficulty. The
 * weight parameter controls how strongly each event pulls.
 */
export function updateMastery(prev: MasteryState | null, ev: MasteryEvent, now: string = new Date().toISOString()): MasteryState {
  const w = clamp(ev.weight ?? 1, 0.01, 10);
  const d = clamp(ev.difficulty ?? 0.5, 0, 1);
  const base = prev?.score ?? PRIOR;
  // Correct events pull toward 1, incorrect toward 0. Difficulty widens the
  // learning rate per event so harder items teach more (when correct) or
  // hurt more (when wrong). The per-event step size is constant in (0, 1)
  // so each event has a meaningful, predictable effect; the event weight
  // scales that step proportionally.
  const target = ev.correct ? 1 : 0;
  const stepSize = clamp(0.3 + 0.2 * d, 0, 0.99); // 0.3..0.5
  const alpha = clamp(stepSize * Math.min(w, 1), 0, 1);
  const next = base + (target - base) * alpha;
  const n = (prev?.n ?? 0) + w;
  return {
    score: Math.max(0, Math.min(1, next)),
    n,
    lastUpdated: now,
  };
}

export function isMastered(state: MasteryState | null, threshold = 0.8): boolean {
  return state !== null && state.score >= threshold;
}

export function isWeak(state: MasteryState | null, threshold = 0.5): boolean {
  return state !== null && state.score < threshold;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
