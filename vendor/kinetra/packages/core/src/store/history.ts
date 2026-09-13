/**
 * Long-term study history.
 *
 * Records every study-relevant event: imports, sessions, questions,
 * practice attempts, mistakes, and mastery updates. Events are append-only
 * and timestamped with millisecond resolution.
 */

import { KinetraError } from "../errors.js";
import type { SqliteDb } from "./sqlite.js";

export type HistoryEventType =
  | "import"
  | "study-session-start"
  | "study-session-end"
  | "question-asked"
  | "practice-attempt"
  | "mistake"
  | "mastery-update"
  | "artifact-created"
  | "course-created"
  | "topic-created"
  | "preference-changed";

export interface HistoryEvent {
  id: number;
  ts: string;
  type: HistoryEventType;
  courseId: string | null;
  topicId: string | null;
  sourceId: string | null;
  artifactId: string | null;
  payload: Record<string, unknown>;
  correct: boolean | null;
}

export const HISTORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  course_id TEXT,
  topic_id TEXT,
  source_id TEXT,
  artifact_id TEXT,
  payload TEXT,
  correct INTEGER
);
CREATE INDEX IF NOT EXISTS history_ts ON history(ts);
CREATE INDEX IF NOT EXISTS history_type ON history(type);
CREATE INDEX IF NOT EXISTS history_course ON history(course_id);
CREATE INDEX IF NOT EXISTS history_topic ON history(topic_id);
`;

export interface RecordInput {
  type: HistoryEventType;
  courseId?: string | null;
  topicId?: string | null;
  sourceId?: string | null;
  artifactId?: string | null;
  payload?: Record<string, unknown>;
  correct?: boolean | null;
  ts?: string;
}

export class HistoryStore {
  constructor(db: SqliteDb) { this.db = db;
    db.exec(HISTORY_SCHEMA);
  }

  record(input: RecordInput): HistoryEvent {
    const ts = input.ts ?? new Date().toISOString();
    const payload = JSON.stringify(input.payload ?? {});
    const correct = input.correct === undefined ? null : input.correct ? 1 : 0;
    const r = this.db.prepare(
      `INSERT INTO history (ts, type, course_id, topic_id, source_id, artifact_id, payload, correct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ts, input.type, input.courseId ?? null, input.topicId ?? null,
      input.sourceId ?? null, input.artifactId ?? null, payload, correct,
    );
    const id = Number((r as unknown as { lastInsertRowid?: number }).lastInsertRowid ?? 0);
    return {
      id, ts, type: input.type,
      courseId: input.courseId ?? null,
      topicId: input.topicId ?? null,
      sourceId: input.sourceId ?? null,
      artifactId: input.artifactId ?? null,
      payload: input.payload ?? {},
      correct: input.correct ?? null,
    };
  }

  list(filter?: { courseId?: string; topicId?: string; type?: HistoryEventType; since?: string; limit?: number }): HistoryEvent[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.courseId) { where.push("course_id = ?"); params.push(filter.courseId); }
    if (filter?.topicId) { where.push("topic_id = ?"); params.push(filter.topicId); }
    if (filter?.type) { where.push("type = ?"); params.push(filter.type); }
    if (filter?.since) { where.push("ts >= ?"); params.push(filter.since); }
    const limit = filter?.limit ?? 1000;
    const sql = where.length
      ? `SELECT * FROM history WHERE ${where.join(" AND ")} ORDER BY ts DESC LIMIT ${Math.max(1, Math.min(10000, limit))}`
      : `SELECT * FROM history ORDER BY ts DESC LIMIT ${Math.max(1, Math.min(10000, limit))}`;
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  /** Count of attempts on a given topic. */
  attemptsByTopic(topicId: string): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM history WHERE topic_id = ? AND type = 'practice-attempt'")
      .get(topicId) as { n: number };
    return r.n;
  }

  /** Count of mistakes on a given topic. */
  mistakesByTopic(topicId: string): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM history WHERE topic_id = ? AND type = 'mistake'")
      .get(topicId) as { n: number };
    return r.n;
  }

  /** Wipe history for a topic. Used when the user resets progress. */
  resetTopic(topicId: string): number {
    const r = this.db.prepare("DELETE FROM history WHERE topic_id = ?").run(topicId);
    return (r as unknown as { changes: number }).changes ?? 0;
  }

  size(): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM history").get() as { n: number };
    return r.n;
  }
}

function rowToEvent(row: Record<string, unknown>): HistoryEvent {
  return {
    id: Number(row.id),
    ts: String(row.ts),
    type: String(row.type) as HistoryEventType,
    courseId: row.course_id ? String(row.course_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null,
    sourceId: row.source_id ? String(row.source_id) : null,
    artifactId: row.artifact_id ? String(row.artifact_id) : null,
    payload: row.payload ? JSON.parse(String(row.payload)) : {},
    correct: row.correct === null || row.correct === undefined ? null : Number(row.correct) === 1,
  };
}