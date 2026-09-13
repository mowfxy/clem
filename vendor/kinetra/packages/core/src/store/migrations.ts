/**
 * Versioned migration runner.
 */

import type { SqliteDb } from "./sqlite.js";

export interface Migration {
  version: number;
  name: string;
  apply: (db: SqliteDb) => void;
}

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export class MigrationRunner {
  private readonly migrations: Migration[];
  constructor(migrations: Migration[]) {
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].version !== i + 1) {
        throw new Error(
          `Migration versions must be 1..N contiguous; got ${sorted[i].version} at index ${i}`,
        );
      }
    }
    this.migrations = sorted;
  }

  applyAll(db: SqliteDb): { applied: number; current: number } {
    db.exec(MIGRATIONS_TABLE);
    const current = this.currentVersion(db);
    let applied = 0;
    for (const m of this.migrations) {
      if (m.version <= current) continue;
      m.apply(db);
      db.prepare(
        "INSERT OR REPLACE INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(m.version, m.name, new Date().toISOString());
      applied++;
    }
    return { applied, current: this.currentVersion(db) };
  }

  currentVersion(db: SqliteDb): number {
    try {
      // Use a portable query that works on both node:sqlite and the
      // in-memory shim: order by version desc, take the first row.
      const row = db
        .prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
        .get() as { version?: number } | undefined;
      return typeof row?.version === "number" ? row.version : 0;
    } catch {
      return 0;
    }
  }
}
