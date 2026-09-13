---
name: kinetra-study-plan
description: Build a spaced-repetition study plan from a topic list, track per-topic mastery over time, and emit a printable PDF schedule using Kinetra's deterministic TypeScript core. Use when the user wants a study plan, syllabus tracker, revision schedule, or a mastery dashboard over a topic list. Do not use for general calendar management, calendar sync, or hosted LMS integrations.
---

# Kinetra Study Plan

Convert a topic list into a spaced-repetition study plan, persist mastery
scores, and emit a PDF schedule. Everything is local and deterministic.

## When to activate

- User posts a topic list ("cover chapters 1-8 by exam day") and wants
  a study plan, schedule, or revision cadence.
- User wants to track per-topic mastery over time and surface weak
  topics for review.
- User wants a printable PDF that summarizes the plan.

Do not activate for general calendar/email sync, hosted LMS, or
multi-user scheduling (this is single-user, in-process).

## Core entry points

All paths are relative to the repo root.

```ts
import { HistoryStore, type HistoryEvent } from "../../../../core/src/store/history.js";
import { MasteryStore, type MasteryState } from "../../../../core/src/store/mastery.js";
import { updateMastery, isMastered, isWeak } from "../../../../core/src/assessment/mastery_rules.js";
import { createDocument, validateDocument } from "../../../../core/src/pdf/document.js";
import { InMemorySqlite } from "../../../../core/src/store/sqlite.js";
```

`InMemorySqlite` is a class - instantiate it to back a store:

```ts
const db = new InMemorySqlite();
const mastery = new MasteryStore(db);
```

There are two mastery APIs in the codebase. Pick deliberately:

- `assessment/mastery_rules.ts` exposes pure functions
  (`updateMastery`, `isMastered`, `isWeak`) that return new immutable
  `MasteryState` objects. Use these when reasoning about mastery in
  isolation (no persistence).
- `store/mastery.ts` exposes `MasteryStore` (wraps an
  `InMemorySqlite` or `openSqlite`) with `applyEvent`,
  `get(topicId)`, `list(courseId?)`, `weakTopics(threshold, courseId?)`,
  `reset(topicId)`. Use these when persisting mastery across runs.

## Workflow

1. **Normalize topics.** Derive a stable `topicId` per topic (slug or
   hash). For each session, record a `HistoryStore.record({ type:
   'study-session-start', courseId, payload: { topics } })` event so
   downstream analytics can join.
2. **Schedule.** Compute the spaced-repetition schedule deterministically
   (e.g. `intervals = [1, 3, 7, 14, 30]` days from "today"). Each
   review turns into an `MasteryStore.applyEvent({ topicId, courseId,
   correct })` call.
3. **Persist mastery.** After applying events, call
   `mastery.list(courseId)` and `mastery.weakTopics(0.5, courseId)`
   to surface weak topics ordered by lowest score first.
4. **Emit PDF.** `createDocument({ title, author?, subject?, pageSize?: "letter" | "a4" })` then `doc.addHeading(text, level?: 1|2|3)`,
   `doc.addParagraph(text, opts?: { fontSize?, color? })`,
   `doc.addFigure({ svg, caption?, widthPt, aspectRatio })`,
   `doc.addEquation(text)`, and `doc.build()` -> `Uint8Array`.
   Call `validateDocument(bytes)`; it throws a `KinetraError("validation", ...)` on a missing `%PDF-` header or undersized body. The PDF is byte-stable for the same input.


## Pure-rules path (no persistence)

If the user wants a stateless analysis, use the rules module:

```ts
let state: MasteryState | null = null;
state = updateMastery(state, { correct: true });
state = updateMastery(state, { correct: false });
isMastered(state); // -> score >= 0.8 by default
isWeak(state);     // -> score < 0.5 by default
```

`updateMastery` is a Bayesian-style running mean with a difficulty
prior; do not implement your own. Treat its return as immutable.

## What to hand back

- A summary of the topic list with today's plan and next review dates.
- A weak-topic list ordered by lowest score first.
- A path to the generated PDF.

## Common failure modes

- **Non-deterministic date math.** Use UTC and a fixed "today" for
  reproducible plans when the user asks for a snapshot.
- **Mixing the two mastery APIs.** The store's `applyEvent` returns a
  `MasteryState` with `attempts`/`correct`/`mistakes`/`lastRecency`;
  the rules' `updateMastery` returns one with `score`/`n`/`lastUpdated`.
  They are not interchangeable.
- **Score drift from manual edits.** Always go through the chosen API;
  never mutate `MasteryState` directly.
- **PDF validator rejection.** `validateDocument` throws on malformed
  bytes; surface the error and rebuild, do not retry with the same
  bytes.
- **Empty topic list.** Refuse and ask for at least one topic before
  building a plan.
