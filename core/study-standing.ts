import type { StudySet } from "./types";

const DAY = 86_400_000;
/** A card the learner recalls for three weeks or more is one they know; below that it is still being learned. */
const KNOWN_DAYS = 21;

/**
 * Where a learner stands in one subject, from their own flashcards and quizzes: the exam countdown, how much of
 * what they study they know, and how their latest quizzes went. Subject chats get it as part of the subject's
 * memory, so explanations meet the learner where they are. Empty when they have not studied anything yet.
 */
export function studyStanding(sets: StudySet[], examDate?: string, now = Date.now()) {
  const lines: string[] = [];
  if (examDate && /^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
    const days = Math.ceil((new Date(examDate + "T09:00:00").getTime() - now) / DAY);
    if (days >= 0) lines.push(`Exam on ${examDate} (${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}).`);
  }
  const cards = sets.flatMap((set) => set.items.map((_, i) => set.cards?.[i] || null));
  const seen = cards.filter((c) => c && c.reps);
  if (seen.length) {
    const known = seen.filter((c) => c!.stability >= KNOWN_DAYS && !(c!.lapses && c!.stability < KNOWN_DAYS)).length;
    const due = seen.filter((c) => c!.due <= now).length;
    lines.push(`Reviewed ${seen.length} of ${cards.length} cards and questions; knows ${known} well${due ? `, ${due} due for review now` : ""}.`);
  }
  const quizzes = sets
    .filter((set) => set.kind === "quiz" && set.attempts.some((a) => a.total > 0))
    .map((set) => ({ set, tries: set.attempts.filter((a) => a.total > 0).sort((a, b) => a.at - b.at) }))
    .sort((a, b) => b.tries.at(-1)!.at - a.tries.at(-1)!.at)
    .slice(0, 4);
  if (quizzes.length) {
    const score = (a: { correct: number; total: number }) => `${a.correct}/${a.total}`;
    lines.push("Latest quizzes: " + quizzes.map(({ set, tries }) => {
      const last = tries.at(-1)!, before = tries.at(-2);
      return `“${set.title.slice(0, 80)}” ${score(last)}${before ? ` (before: ${score(before)})` : ""}`;
    }).join("; ") + ".");
  }
  return lines.join(" ");
}
