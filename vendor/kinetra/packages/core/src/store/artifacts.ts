/**
 * Artifact storage.
 *
 * Serializes Kinetra artifacts (K-maps, circuits, PDFs, scenes, etc.) into
 * SQLite so they survive restarts and can be re-rendered or exported.
 */

import { KinetraError } from "../errors.js";
import type { SqliteDb } from "./sqlite.js";

export interface ArtifactRecord {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  courseId: string | null;
  topicId: string | null;
  model: Record<string, unknown>;
  renderings: Record<string, unknown>;
  tags: string[];
  hash: string;
}

export const ARTIFACTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  course_id TEXT,
  topic_id TEXT,
  model TEXT NOT NULL,
  renderings TEXT,
  tags TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_kind ON artifacts(kind);
CREATE INDEX IF NOT EXISTS artifacts_course ON artifacts(course_id);
CREATE INDEX IF NOT EXISTS artifacts_topic ON artifacts(topic_id);
`;

export interface UpsertArtifactInput {
  id: string;
  kind: string;
  title: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  courseId?: string | null;
  topicId?: string | null;
  model: Record<string, unknown>;
  renderings?: Record<string, unknown>;
  tags?: string[];
  hash: string;
}

export class ArtifactStore {
  constructor(db: SqliteDb) { this.db = db;
    db.exec(ARTIFACTS_SCHEMA);
  }

  upsert(input: UpsertArtifactInput): ArtifactRecord {
    if (!input.id) throw new KinetraError("validation", "artifact id required");
    this.db.prepare(
      `INSERT OR REPLACE INTO artifacts
        (id, kind, title, description, created_at, updated_at, course_id, topic_id, model, renderings, tags, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id, input.kind, input.title, input.description ?? null,
      input.createdAt, input.updatedAt, input.courseId ?? null, input.topicId ?? null,
      JSON.stringify(input.model), JSON.stringify(input.renderings ?? {}),
      JSON.stringify(input.tags ?? []), input.hash,
    );
    return this.get(input.id)!;
  }

  get(id: string): ArtifactRecord | null {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  byKind(kind: string, courseId?: string): ArtifactRecord[] {
    const where: string[] = ["kind = ?"];
    const params: unknown[] = [kind];
    if (courseId) { where.push("course_id = ?"); params.push(courseId); }
    const rows = this.db.prepare(
      `SELECT * FROM artifacts WHERE ${where.join(" AND ")} ORDER BY updated_at DESC`,
    ).all(...params) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  listForCourse(courseId: string): ArtifactRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM artifacts WHERE course_id = ? ORDER BY updated_at DESC",
    ).all(courseId) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  remove(id: string): boolean {
    const r = this.db.prepare("DELETE FROM artifacts WHERE id = ?").run(id);
    return Number((r as { changes: number }).changes) > 0;
  }
}

function rowToRecord(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    courseId: row.course_id ? String(row.course_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null,
    model: row.model ? JSON.parse(String(row.model)) : {},
    renderings: row.renderings ? JSON.parse(String(row.renderings)) : {},
    tags: row.tags ? JSON.parse(String(row.tags)) : [],
    hash: String(row.hash),
  };
}