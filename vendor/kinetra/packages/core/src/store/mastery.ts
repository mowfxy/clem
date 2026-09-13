/**
 * Per-topic mastery tracking.
 *
 * Mastery is computed from practice attempts and self-evaluation events.
 * Each topic has a score in [0, 1] with a recency-decayed value of how
 * recently it was last reinforced.
 */

import { KinetraError } from "../errors.js";
import type { SqliteDb } from "./sqlite.js";

export interface MasteryState {
  topicId: string;
  courseId: string | null;
  score: number;          // [0, 1]
  attempts: number;
  correct: number;
  mistakes: number;
  lastUpdated: string;    // ISO timestamp of last update
  lastRecency: string;    // ISO timestamp of last reinforcement
}

export const MASTERY_SCHEMA = `
CREATE TABLE IF NOT EXISTS mastery (
  topic_id TEXT PRIMARY KEY,
  course_id TEXT,
  score REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  mistakes INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL,
  last_recency TEXT NOT NULL
);
`;

export interface ApplyEventInput {
  topicId: string;
  courseId?: string | null;
  correct: boolean;
  ts?: string;
}

export class MasteryStore {
  constructor(db: SqliteDb) { this.db = db;
    db.exec(MASTERY_SCHEMA);
  }

  get(topicId: string): MasteryState | null {
    const row = this.db
      .prepare("SELECT * FROM mastery WHERE topic_id = ?")
      .get(topicId) as Record<string, unknown> | undefined;
    return row ? rowToState(row) : null;
  }

  /** Apply a single event (attempt or self-evaluation) and update the running score. */
  applyEvent(input: ApplyEventInput): MasteryState {
    if (!input.topicId) throw new KinetraError("validation", "topicId required");
    const ts = input.ts ?? new Date().toISOString();
    const existing = this.get(input.topicId);
    if (!existing) {
      const score = input.correct ? 0.6 : 0.2; // first-event prior
      const state: MasteryState = {
        topicId: input.topicId,
        courseId: input.courseId ?? null,
        score,
        attempts: 1,
        correct: input.correct ? 1 : 0,
        mistakes: input.correct ? 0 : 1,
        lastUpdated: ts,
        lastRecency: ts,
      };
      this.insertState(state);
      return state;
    }
    // Weighted running average: each new observation has weight 1/(n+1) of the prior sum.
    // score' = (score * attempts + (correct ? 1 : 0)) / (attempts + 1)
    const attempts = existing.attempts + 1;
    const correct = existing.correct + (input.correct ? 1 : 0);
    const mistakes = existing.mistakes + (input.correct ? 0 : 1);
    const score = (existing.score * existing.attempts + (input.correct ? 1 : 0)) / attempts;
    this.db.prepare(
      `UPDATE mastery SET score = ?, attempts = ?, correct = ?, mistakes = ?, last_updated = ?, last_recency = ?, course_id = COALESCE(?, course_id) WHERE topic_id = ?`,
    ).run(score, attempts, correct, mistakes, ts, ts, input.courseId ?? null, input.topicId);
    return this.get(input.topicId)!;
  }

  /** Forget a topic's mastery. */
  reset(topicId: string): void {
    this.db.prepare("DELETE FROM mastery WHERE topic_id = ?").run(topicId);
  }

  list(courseId?: string): MasteryState[] {
    const sql = courseId
      ? "SELECT * FROM mastery WHERE course_id = ? ORDER BY score ASC"
      : "SELECT * FROM mastery ORDER BY score ASC";
    const rows = this.db.prepare(sql).all(...(courseId ? [courseId] : [])) as Record<string, unknown>[];
    return rows.map(rowToState);
  }

  /** Topics with mastery < threshold, ordered by weakness. */
  weakTopics(threshold: number, courseId?: string): MasteryState[] {
    const all = this.list(courseId);
    return all.filter((s) => s.score < threshold);
  }

  private insertState(s: MasteryState): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO mastery
        (topic_id, course_id, score, attempts, correct, mistakes, last_updated, last_recency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(s.topicId, s.courseId, s.score, s.attempts, s.correct, s.mistakes, s.lastUpdated, s.lastRecency);
  }
}

function rowToState(row: Record<string, unknown>): MasteryState {
  return {
    topicId: String(row.topic_id),
    courseId: row.course_id ? String(row.course_id) : null,
    score: Number(row.score),
    attempts: Number(row.attempts),
    correct: Number(row.correct),
    mistakes: Number(row.mistakes),
    lastUpdated: String(row.last_updated),
    lastRecency: String(row.last_recency),
  };
}