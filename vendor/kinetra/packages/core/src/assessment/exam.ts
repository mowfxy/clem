/**
 * Exam generation.
 *
 * Exams are quizzes with a fixed order, an overall time budget, and a
 * section breakdown. They may contain multiple sections (e.g. multiple
 * choice + free response + circuit).
 */

import { KinetraError } from "../errors.js";
import { newPrefixedId } from "../utils/id.js";
import type { Quiz, QuizQuestion } from "./quiz.js";

export interface ExamSection {
  id: string;
  title: string;
  weight: number; // 0..1
  questions: QuizQuestion[];
}

export interface Exam {
  id: string;
  title: string;
  courseId: string;
  topicId?: string;
  durationMin: number;
  sections: ExamSection[];
  totalWeight: number;
  createdAt: string;
}

export interface ExamSeed {
  title: string;
  courseId: string;
  topicId?: string;
  durationMin: number;
  sections: Array<{ title: string; weight: number; questions: QuizQuestion[] }>;
}

export function createExam(seed: ExamSeed): Exam {
  if (!seed.title) throw new KinetraError("validation", "Exam title is required");
  if (seed.durationMin <= 0) throw new KinetraError("validation", "Exam duration must be > 0", { durationMin: seed.durationMin });
  let total = 0;
  for (const s of seed.sections) total += s.weight;
  if (total <= 0) throw new KinetraError("validation", "Section weights must sum > 0");
  const sections: ExamSection[] = seed.sections.map((s) => ({
    id: newPrefixedId("sec"),
    title: s.title,
    weight: s.weight,
    questions: s.questions.map((q) => ({
        ...q,
        id: q.id ?? newPrefixedId("q"),
      })),
  }));
  return {
    id: newPrefixedId("exam"),
    title: seed.title,
    courseId: seed.courseId,
    topicId: seed.topicId,
    durationMin: seed.durationMin,
    sections,
    totalWeight: total,
    createdAt: new Date().toISOString(),
  };
}

export function sectionScore(exam: Exam, sectionId: string, responses: Record<string, string>): number {
  const sec = exam.sections.find((s) => s.id === sectionId);
  if (!sec) throw new KinetraError("missing", `Section not found: ${sectionId}`);
  let correct = 0;
  for (const q of sec.questions) {
    const r = responses[q.id];
    if (r !== undefined && r.trim().toLowerCase() === q.answer.trim().toLowerCase()) correct++;
  }
  return correct;
}

export function toQuiz(exam: Exam, sectionId?: string): Quiz {
  const qs = sectionId
    ? (exam.sections.find((s) => s.id === sectionId)?.questions ?? [])
    : exam.sections.flatMap((s) => s.questions);
  return {
    id: newPrefixedId("quiz"),
    title: sectionId ? `${exam.title} (${sectionId})` : `${exam.title} (all)`,
    courseId: exam.courseId,
    topicId: exam.topicId,
    createdAt: exam.createdAt,
    questions: qs,
  };
}
