---
name: kinetra-assess
description: Generate deterministic quizzes, exams, and flashcards from a topic description and candidate questions, grade responses against an answer key, and combine section scores into a final band. Use when the user asks for a quiz, exam, flashcards, or to grade a free-form response against an answer key. Do not use for question authoring on non-engineering topics, hosted LMS integrations, or live proctoring.
---

# Kinetra Assessment

Build quizzes, exams, and flashcard decks from a topic description and a
list of pre-authored questions, then grade deterministic or AI-augmented
responses. The deterministic part is byte-stable: the same seed always
produces the same `Quiz`, `Exam`, or `Deck` ids and question order
(within `pickQuestions(strategy: "shuffle")` which is keyed on
`quiz.id`).

## When to activate

- User asks for a quiz or exam over a course/topic.
- User wants a flashcard deck with spaced repetition.
- User provides answers and asks for a score, band, or per-question
  feedback.
- User wants to combine multiple section scores into a single grade.

Do not activate for question authoring on topics with no technical
content (e.g. creative writing prompts), for hosted LMS sync, or for
proctoring video. The grading helpers module only normalizes AI grader
output - it does not call the model itself.

## Core entry points

All paths are relative to the repo root.

```ts
import {
  createQuiz, pickQuestions, gradeQuiz,
  type Quiz, type QuizQuestion, type QuizDifficulty,
} from "../../../../core/src/assessment/quiz.js";
import {
  createExam, sectionScore, toQuiz,
  type Exam, type ExamSection,
} from "../../../../core/src/assessment/exam.js";
import {
  createDeck, review, dueCards, applyReviews,
  type FlashCard, type Deck, type ReviewGrade,
} from "../../../../core/src/assessment/flashcards.js";
import {
  bandFor, normalizeGraderPayload, combineScores,
  type GradingBand, type GradeResult,
} from "../../../../core/src/assessment/grading.js";
```

## Quiz workflow

1. Build a `Quiz` with `createQuiz({ topic, courseId, topicId?, source?,
   questions?, difficulty? })`. Each question needs `{ prompt, answer,
   difficulty?, topicId?, source?, rationale? }`. The `topic` and
   `courseId` fields are required; `createQuiz` throws on missing.
2. Pick a subset with `pickQuestions(quiz, count, strategy)` where
   `strategy` is `"sequential" | "shuffle" | "hardest-first"`. The
   shuffle is deterministic - keyed on `quiz.id`, not on a user
   seed. Two calls on the same `quiz` return the same subset in the
   same order.
3. Grade responses with `gradeQuiz(quiz, responses)` where `responses`
   is `Record<questionId, answerString>`. The grader normalizes
   whitespace and case, so `"Yes "` and `"yes"` both match `"yes"`.
4. Return `{ correct, total, perQuestion }` to the user.

## Exam workflow

1. Build an `Exam` with `createExam({ title, courseId, topicId?,
   durationMin, sections: [{ title, weight, questions: QuizQuestion[] }] })`.
   `durationMin` must be > 0; section weights must sum to > 0.
2. Score a section with `sectionScore(exam, sectionId, responses)`. The
   section id is assigned by `createExam`; surface it after creation.
   The returned value is the RAW count of correct answers in the
   section (an integer, NOT a normalized 0..1 ratio). Compute
   `correct / section.questions.length` yourself to get a normalized
   score for `combineScores`.
3. Convert an exam section (or all sections) into a `Quiz` with
   `toQuiz(exam, sectionId?)` so the same grading helpers apply.
4. Combine section scores with `combineScores(parts, weights)` - both
   arrays must be the same length and weights must sum to > 0.

## Flashcard workflow

1. Build a `Deck` with `createDeck({ title, courseId, topicId?, cards:
   [{ front, back, topicId?, source? }] })`. Every card starts at
   `ease: 2.5`, `intervalDays: 0`, `dueAt: now`, `reps: 0`,
   `reviews: 0`.
2. Pull today's reviews with `dueCards(deck, now)` (defaults to
   `new Date()`).
3. Record a single review with `review(card, grade, now?)` where
   `grade: 0..5` (SM-2). Grades < 3 reset `reps` and bring the card
   due the next day. Ease is clamped to >= 1.3.
4. Batch them with `applyReviews(deck, [{ cardId, grade }], now?)`. If
   any `cardId` is unknown, this throws a `KinetraError("missing", ...)`;
   resolve all `cardId`s against `deck.cards` before calling.
5. Surface the next review date from `card.dueAt` to the user.

## Grading helpers

- `bandFor(score: 0..1)` -> `"A" | "B" | "C" | "D" | "F"` (A >= 0.9,
  B >= 0.8, C >= 0.7, D >= 0.6, F otherwise).
- `normalizeGraderPayload(raw)` -> `GradeResult` (throws on
  non-object input or non-finite `score`).
- `combineScores(parts, weights)` -> weighted average in `[0, 1]`
  (clamps each part to `[0, 1]`, throws on length mismatch or
  non-positive total weight). NOTE: `combineScores` clamps but does
  NOT verify each `parts[i]` is a finite number; pass `NaN` and the
  result will be `NaN`. Validate inputs first.

## What to hand back

- For a quiz: the question list, the picked subset (with shuffled
  order), and the `{ correct, total, perQuestion }` after grading.
- For an exam: the section structure, per-section score, the
  combined score, and the band.
- For a deck: the cards, today's due list, and the next due date for
  each graded card.
- Always show the `band` and the numeric `score` so the user can audit.

## Common failure modes

- **Missing `topic` or `courseId` in `createQuiz`.** Throws a
  `KinetraError("validation", ...)`. Validate input first.
- **Exam with zero duration or zero weight.** `createExam` throws on
  `durationMin <= 0` and on `sum(weights) <= 0`.
- **Flashcard grade out of range.** `review` throws on non-integer
  `grade` outside `0..5`.
- **AI grader returns garbage.** `normalizeGraderPayload` throws on
  non-object input or non-finite `score`; surface the error and
  re-prompt, do not coerce silently.
- **`combineScores` length mismatch.** Both arrays must be the same
  length; check before calling.
- **Determinism drift.** Two `pickQuestions(quiz, n, "shuffle")` calls
  on the same `quiz` must return the same subset in the same order.
  If they differ, stop and report.
