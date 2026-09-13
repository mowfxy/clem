/**
 * Quiz generation.
 *
 * Builds deterministic quizzes from a topic description and a list of
 * candidate questions. Each question carries a difficulty, an answer key,
 * and a citation reference.
 */

import { KinetraError } from "../errors.js";
import { newPrefixedId } from "../utils/id.js";
import type { SourceRef } from "../types.js";

export type QuizDifficulty = "easy" | "medium" | "hard";

export interface QuizQuestion {
  id: string;
  prompt: string;
  answer: string;
  difficulty: QuizDifficulty;
  topicId?: string;
  source?: SourceRef;
  rationale?: string;
}

export interface Quiz {
  id: string;
  title: string;
  courseId: string;
  topicId?: string;
  createdAt: string;
  questions: QuizQuestion[];
}

export interface QuizSeed {
  topic: string;
  courseId: string;
  topicId?: string;
  source?: SourceRef;
  /**
   * Pre-authored questions, if any. If absent the caller must compose
   * questions through a generator pipeline.
   */
  questions?: Array<Omit<QuizQuestion, "id">>;
  difficulty?: QuizDifficulty;
}

export function createQuiz(seed: QuizSeed): Quiz {
  if (!seed.topic) throw new KinetraError("validation", "Quiz topic is required");
  if (!seed.courseId) throw new KinetraError("validation", "Quiz courseId is required");
  const questions: QuizQuestion[] = (seed.questions ?? []).map((q) => ({
    ...q,
    id: newPrefixedId("q"),
    difficulty: q.difficulty ?? seed.difficulty ?? "medium",
    topicId: q.topicId ?? seed.topicId,
    source: q.source ?? seed.source,
  }));
  return {
    id: newPrefixedId("quiz"),
    title: `${seed.topic} quiz`,
    courseId: seed.courseId,
    topicId: seed.topicId,
    createdAt: new Date().toISOString(),
    questions,
  };
}

export function pickQuestions(
  quiz: Quiz,
  count: number,
  strategy: "sequential" | "shuffle" | "hardest-first" = "shuffle",
): QuizQuestion[] {
  if (count <= 0) return [];
  let pool = [...quiz.questions];
  if (strategy === "hardest-first") {
    const order: QuizDifficulty[] = ["hard", "medium", "easy"];
    pool.sort((a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty));
  } else if (strategy === "shuffle") {
    // Deterministic shuffle keyed by quiz.id so the same quiz yields the same
    // order on every call. Useful for repeatable study sessions.
    const seed = quiz.id;
    pool.sort((a, b) => (seedHash(seed + a.id) - seedHash(seed + b.id)));
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function seedHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function gradeQuiz(
  quiz: Quiz,
  responses: Record<string, string>,
): { correct: number; total: number; perQuestion: Record<string, boolean> } {
  const perQuestion: Record<string, boolean> = {};
  let correct = 0;
  for (const q of quiz.questions) {
    const a = responses[q.id];
    const ok = a !== undefined && normalize(a) === normalize(q.answer);
    perQuestion[q.id] = ok;
    if (ok) correct++;
  }
  return { correct, total: quiz.questions.length, perQuestion };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
