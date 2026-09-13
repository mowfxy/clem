/**
 * Assessment module tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createQuiz, pickQuestions, gradeQuiz } from "../../src/assessment/quiz.js";
import { createExam, sectionScore, toQuiz } from "../../src/assessment/exam.js";
import { bandFor, normalizeGraderPayload, combineScores } from "../../src/assessment/grading.js";
import { createDeck, review, dueCards, applyReviews } from "../../src/assessment/flashcards.js";
import { updateMastery, isMastered, isWeak } from "../../src/assessment/mastery_rules.js";

test("quiz: createQuiz builds a quiz with stable ids", () => {
  const q = createQuiz({
    topic: "SR flip-flops",
    courseId: "DLD",
    questions: [
      { prompt: "Q1", answer: "A1" },
      { prompt: "Q2", answer: "A2", difficulty: "hard" },
    ],
  });
  assert.equal(q.questions.length, 2);
  assert.ok(q.id.startsWith("quiz_"));
});

test("quiz: pickQuestions sequential respects order", () => {
  const q = createQuiz({
    topic: "t", courseId: "c",
    questions: [
      { prompt: "p1", answer: "a1" },
      { prompt: "p2", answer: "a2" },
      { prompt: "p3", answer: "a3" },
    ],
  });
  const first = pickQuestions(q, 2, "sequential");
  assert.equal(first.length, 2);
  assert.equal(first[0].prompt, "p1");
  assert.equal(first[1].prompt, "p2");
});

test("quiz: pickQuestions hardest-first picks hard first", () => {
  const q = createQuiz({
    topic: "t", courseId: "c",
    questions: [
      { prompt: "easy one", answer: "1", difficulty: "easy" },
      { prompt: "hard one", answer: "2", difficulty: "hard" },
    ],
  });
  const out = pickQuestions(q, 1, "hardest-first");
  assert.equal(out[0].difficulty, "hard");
});

test("quiz: pickQuestions shuffle is deterministic for same quiz", () => {
  const q = createQuiz({
    topic: "t", courseId: "c",
    questions: [
      { prompt: "p1", answer: "a1" },
      { prompt: "p2", answer: "a2" },
      { prompt: "p3", answer: "a3" },
      { prompt: "p4", answer: "a4" },
    ],
  });
  const a = pickQuestions(q, 4, "shuffle").map((x) => x.prompt);
  const b = pickQuestions(q, 4, "shuffle").map((x) => x.prompt);
  assert.deepEqual(a, b);
});

test("quiz: gradeQuiz counts correct and per-question map", () => {
  const q = createQuiz({
    topic: "t", courseId: "c",
    questions: [
      { prompt: "p1", answer: "yes" },
      { prompt: "p2", answer: "no" },
    ],
  });
  const out = gradeQuiz(q, { [q.questions[0].id]: "YES", [q.questions[1].id]: "yes" });
  assert.equal(out.correct, 1);
  assert.equal(out.total, 2);
  assert.equal(out.perQuestion[q.questions[0].id], true);
  assert.equal(out.perQuestion[q.questions[1].id], false);
});

test("exam: createExam rejects empty sections", () => {
  assert.throws(() => createExam({
    title: "X", courseId: "c", durationMin: 30, sections: [],
  }));
});

test("exam: sectionScore counts and toQuiz flattens", () => {
  const exam = createExam({
    title: "Midterm", courseId: "DLD", durationMin: 60,
    sections: [
      { title: "MCQ", weight: 1, questions: [
        { prompt: "p", answer: "a" },
        { prompt: "q", answer: "b" },
      ] },
      { title: "Free", weight: 2, questions: [
        { prompt: "p", answer: "x" },
      ] },
    ],
  });
  assert.equal(exam.sections.length, 2);
  const mcq = exam.sections[0];
  const score = sectionScore(exam, mcq.id, { [mcq.questions[0].id]: "a", [mcq.questions[1].id]: "wrong" });
  assert.equal(score, 1);
  const flat = toQuiz(exam);
  assert.equal(flat.questions.length, 3);
});

test("grading: bandFor maps scores", () => {
  assert.equal(bandFor(0.95), "A");
  assert.equal(bandFor(0.85), "B");
  assert.equal(bandFor(0.75), "C");
  assert.equal(bandFor(0.65), "D");
  assert.equal(bandFor(0.4), "F");
});

test("grading: normalizeGraderPayload clamps and fills defaults", () => {
  const r = normalizeGraderPayload({ score: 1.5, feedback: "ok", partialCredit: 0.7 });
  assert.equal(r.score, 1);
  assert.equal(r.band, "A");
  assert.equal(r.partialCredit, 0.7);
});

test("grading: combineScores rejects mismatched lengths", () => {
  assert.throws(() => combineScores([1], [1, 2]));
});

test("grading: combineScores normalises by weight sum", () => {
  const out = combineScores([1, 0], [1, 1]);
  assert.equal(out, 0.5);
});

test("flashcards: review schedules with SM-2 rules", () => {
  const deck = createDeck({ title: "DLD", courseId: "c", cards: [{ front: "f", back: "b" }] });
  const card = deck.cards[0];
  const r1 = review(card, 4);
  assert.equal(r1.reps, 1);
  assert.equal(r1.intervalDays, 1);
  const r2 = review(r1, 4);
  assert.equal(r2.reps, 2);
  assert.equal(r2.intervalDays, 6);
  const r3 = review(r2, 4);
  assert.ok(r3.intervalDays >= 6);
});

test("flashcards: low grade resets reps", () => {
  const deck = createDeck({ title: "t", courseId: "c", cards: [{ front: "f", back: "b" }] });
  const c = deck.cards[0];
  const r = review(c, 1);
  assert.equal(r.reps, 0);
  assert.equal(r.intervalDays, 1);
});

test("flashcards: dueCards filters by due date", () => {
  const deck = createDeck({ title: "t", courseId: "c", cards: [{ front: "f", back: "b" }] });
  const due = dueCards(deck, new Date(Date.now() + 1000));
  assert.equal(due.length, 1);
});

test("flashcards: applyReviews throws on unknown card", () => {
  const deck = createDeck({ title: "t", courseId: "c", cards: [{ front: "f", back: "b" }] });
  assert.throws(() => applyReviews(deck, [{ cardId: "nope", grade: 4 }]));
});

test("mastery: correct events pull score toward 1", () => {
  let m = updateMastery(null, { correct: true });
  assert.ok(m.score > 0.5);
  for (let i = 0; i < 10; i++) m = updateMastery(m, { correct: true });
  assert.ok(m.score >= 0.99);
  assert.ok(isMastered(m));
});

test("mastery: incorrect events pull score toward 0", () => {
  let m = updateMastery(null, { correct: false });
  assert.ok(m.score < 0.5);
  for (let i = 0; i < 10; i++) m = updateMastery(m, { correct: false });
  assert.ok(isWeak(m));
});
