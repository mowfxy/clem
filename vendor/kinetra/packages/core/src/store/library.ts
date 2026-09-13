/**
 * Document registry (library).
 *
 * Tracks every document imported into Kinetra: source identity, content
 * hash, import timestamps, indexing state, and which course/topic owns
 * the document. Documents can be re-imported (same hash, no-op), updated
 * (different hash, supersedes), or removed.
 *
 * Versioning: a re-import with a different hash creates a new row and
 * marks the prior row as superseded. Both rows survive; only the
 * non-superseded row counts as the "current" version.
 */

import { KinetraError } from "../errors.js";
import { sha256 } from "../utils/hash.js";
import type { SqliteDb } from "./sqlite.js";

export type DocumentKind = "pdf" | "markdown" | "text" | "json" | "image" | "code" | "other";

export interface LibraryEntry {
  sourceId: string;
  version: number;
  title: string;
  kind: DocumentKind;
  hash: string;
  byteLength: number;
  importedAt: string;
  lastIndexedAt: string | null;
  courseId: string | null;
  topicId: string | null;
  path: string | null;
  metadata: Record<string, string>;
  supersededBy: string | null;
}

export const LIBRARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS library (
  source_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  last_indexed_at TEXT,
  course_id TEXT,
  topic_id TEXT,
  path TEXT,
  metadata TEXT,
  superseded_by TEXT,
  PRIMARY KEY (source_id, version)
);
CREATE INDEX IF NOT EXISTS library_hash ON library(hash);
CREATE INDEX IF NOT EXISTS library_course ON library(course_id);
`;

export interface UpsertInput {
  sourceId: string;
  title: string;
  kind: DocumentKind;
  content: string | Uint8Array;
  courseId?: string | null;
  topicId?: string | null;
  path?: string | null;
  metadata?: Record<string, string>;
}

export class DocumentLibrary {
  private db: SqliteDb;

  constructor(db: SqliteDb) {
    this.db = db;
    db.exec(LIBRARY_SCHEMA);
  }

  upsert(input: UpsertInput): LibraryEntry {
    if (!input.sourceId) throw new KinetraError("validation", "sourceId required");
    if (!input.title) throw new KinetraError("validation", "title required");
    const hash = sha256(input.content);
    const byteLength = typeof input.content === "string"
      ? Buffer.byteLength(input.content, "utf8")
      : input.content.byteLength;
    const now = new Date().toISOString();

    const current = this.currentVersion(input.sourceId);
    const sameHash = current && current.hash === hash;
    if (current && sameHash) {
      // No-op: same content re-imported. Just bump last_indexed_at and metadata.
      this.db.prepare(
        "UPDATE library SET last_indexed_at = ?, metadata = ?, course_id = ?, topic_id = ? WHERE source_id = ? AND version = ?",
      ).run(now, JSON.stringify(input.metadata ?? {}), input.courseId ?? null, input.topicId ?? null, input.sourceId, current.version);
      return this.get(input.sourceId, current.version)!;
    }

    const nextVersion = (current?.version ?? 0) + 1;
    if (current) {
      // Mark old row superseded; new row points to it.
      this.db.prepare(
        "UPDATE library SET superseded_by = ? WHERE source_id = ? AND version = ?",
      ).run(String(nextVersion), input.sourceId, current.version);
    }
    this.db.prepare(
      `INSERT INTO library
        (source_id, version, title, kind, hash, byte_length, imported_at, last_indexed_at, course_id, topic_id, path, metadata, superseded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.sourceId,
      nextVersion,
      input.title,
      input.kind,
      hash,
      byteLength,
      now,
      now,
      input.courseId ?? null,
      input.topicId ?? null,
      input.path ?? null,
      JSON.stringify(input.metadata ?? {}),
      null,
    );
    return this.get(input.sourceId, nextVersion)!;
  }

  get(sourceId: string, version?: number): LibraryEntry | null {
    const sql = version === undefined
      ? "SELECT * FROM library WHERE source_id = ? ORDER BY version DESC LIMIT 1"
      : "SELECT * FROM library WHERE source_id = ? AND version = ?";
    const row = version === undefined
      ? this.db.prepare(sql).get(sourceId)
      : this.db.prepare(sql).get(sourceId, version);
    return row ? rowToEntry(row as Record<string, unknown>) : null;
  }

  currentVersion(sourceId: string): LibraryEntry | null {
    return this.get(sourceId);
  }

  byHash(hash: string): LibraryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM library WHERE hash = ?")
      .all(hash) as Record<string, unknown>[];
    return rows.map(rowToEntry);
  }

  list(filter?: { courseId?: string; kind?: DocumentKind; includeSuperseded?: boolean }): LibraryEntry[] {
    const where = [];
    const params = [];
    if (filter?.courseId) { where.push("course_id = ?"); params.push(filter.courseId); }
    if (filter?.kind) { where.push("kind = ?"); params.push(filter.kind); }
    if (!filter?.includeSuperseded) where.push("(superseded_by IS NULL OR superseded_by = '0')");
    const sql = "SELECT * FROM library" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY imported_at DESC";
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToEntry);
  }

  remove(sourceId: string): boolean {
    const r = this.db.prepare("DELETE FROM library WHERE source_id = ?").run(sourceId);
    return (r as { changes: number }).changes > 0;
  }

  removeAllVersions(sourceId: string): number {
    const r = this.db.prepare("DELETE FROM library WHERE source_id = ?").run(sourceId);
    return (r as { changes: number }).changes;
  }

  markIndexed(sourceId: string, version?: number): void {
    if (version === undefined) {
      this.db.prepare("UPDATE library SET last_indexed_at = ? WHERE source_id = ? AND superseded_by = ?")
        .run(new Date().toISOString(), sourceId, "0");
    } else {
      this.db.prepare("UPDATE library SET last_indexed_at = ? WHERE source_id = ? AND version = ?")
        .run(new Date().toISOString(), sourceId, version);
    }
  }
}

function rowToEntry(row: Record<string, unknown>): LibraryEntry {
  return {
    sourceId: String(row.source_id),
    version: Number(row.version),
    title: String(row.title),
    kind: String(row.kind) as DocumentKind,
    hash: String(row.hash),
    byteLength: Number(row.byte_length),
    importedAt: String(row.imported_at),
    lastIndexedAt: row.last_indexed_at ? String(row.last_indexed_at) : null,
    courseId: row.course_id ? String(row.course_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null,
    path: row.path ? String(row.path) : null,
    metadata: row.metadata ? JSON.parse(String(row.metadata)) : {},
    supersededBy: row.superseded_by && String(row.superseded_by) !== "0" ? String(row.superseded_by) : null,
  };
}