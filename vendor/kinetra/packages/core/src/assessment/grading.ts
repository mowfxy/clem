/**
 * Grading helpers.
 *
 * Generic scoring utilities shared by quizzes, exams, and free-form
 * assignments. The AI grader (when configured) returns a structured
 * payload via the provider layer; this module reduces those payloads into
 * numeric scores for the mastery tracker.
 */

import { KinetraError } from "../errors.js";

export type GradingBand = "A" | "B" | "C" | "D" | "F";

export interface GradeResult {
  score: number; // 0..1
  band: GradingBand;
  feedback: string;
  citation?: string;
  partialCredit: number; // 0..1
}

export function bandFor(score: number): GradingBand {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

export interface RawGraderPayload {
  score?: unknown;
  feedback?: unknown;
  citation?: unknown;
  partialCredit?: unknown;
}

export function normalizeGraderPayload(raw: unknown): GradeResult {
  if (!raw || typeof raw !== "object") {
    throw new KinetraError("parse", "Grader payload is not an object", { got: typeof raw });
  }
  const p = raw as RawGraderPayload;
  const score = Number(p.score);
  if (!Number.isFinite(score)) {
    throw new KinetraError("parse", "Grader score is not finite", { score: p.score });
  }
  const clamped = Math.max(0, Math.min(1, score));
  const feedback = typeof p.feedback === "string" ? p.feedback : "";
  const citation = typeof p.citation === "string" ? p.citation : undefined;
  const partialCredit = Number.isFinite(Number(p.partialCredit))
    ? Math.max(0, Math.min(1, Number(p.partialCredit)))
    : clamped;
  return { score: clamped, band: bandFor(clamped), feedback, citation, partialCredit };
}

export function combineScores(parts: number[], weights: number[]): number {
  if (parts.length !== weights.length) {
    throw new KinetraError("validation", "parts and weights length mismatch", { parts: parts.length, weights: weights.length });
  }
  let totalWeight = 0;
  for (const w of weights) totalWeight += w;
  if (totalWeight <= 0) throw new KinetraError("validation", "weights must be > 0");
  let acc = 0;
  for (let i = 0; i < parts.length; i++) {
    acc += Math.max(0, Math.min(1, parts[i])) * weights[i];
  }
  return acc / totalWeight;
}
