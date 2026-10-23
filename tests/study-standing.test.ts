import test from "node:test";
import assert from "node:assert/strict";
import { studyStanding } from "../core/study-standing.ts";
import type { StudySet } from "../core/types.ts";
const DAY = 86_400_000, now = Date.parse("2026-10-23T12:00:00Z");
const card = (stability: number, due: number, lapses = 0) => ({ due, stability, difficulty: 5, reps: 3, lapses, last: now - DAY });
test("study standing sums up the exam, cards and latest quizzes", () => {
  const sets: StudySet[] = [
    { id: "f", spaceId: "s", kind: "flashcards", title: "Cells", items: [{ question: "a", answer: "b" }, { question: "c", answer: "d" }, { question: "e", answer: "f" }], created: 0, attempts: [], cards: [card(30, now + 9 * DAY), card(2, now - DAY, 1), null] },
    { id: "q", spaceId: "s", kind: "quiz", title: "Enzymes", items: [{ question: "g", answer: "h" }], created: 0, attempts: [{ at: now - 3 * DAY, correct: 4, total: 10 }, { at: now - DAY, correct: 7, total: 10 }] },
  ];
  const text = studyStanding(sets, "2026-11-02", now);
  assert.match(text, /Exam on 2026-11-02 \(in 10 days\)/);
  assert.match(text, /Reviewed 2 of 4 cards and questions; knows 1 well, 1 due for review now/);
  assert.match(text, /“Enzymes” 7\/10 \(before: 4\/10\)/);
  assert.equal(studyStanding([], "2026-01-01", now), "");
});
