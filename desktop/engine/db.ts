// The engine's database: PGlite on the desktop, Postgres on a VPS later, both behind `Db`.
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type Db = {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
};

const run = (q: PGlite | Transaction) => async <T>(sql: string, params: unknown[] = []) => (await q.query<T>(sql, params)).rows;

/** Opens (or creates) the database in `dir`; no dir is in memory, for tests. */
export async function openPglite(dir?: string) {
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  const db: Db = {
    query: run(pg),
    // A transaction inside a transaction joins it.
    tx: (fn) => pg.transaction((t) => { const inner: Db = { query: run(t), tx: (f) => f(inner) }; return fn(inner); }),
  };
  return { pg, db };
}

/** Applies desktop/engine/migrations/NNN_*.sql in order, each once, recorded in engine_migrations. */
export async function migrate(pg: PGlite, dir: string) {
  await pg.exec("create table if not exists engine_migrations (id text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await pg.query<{ id: string }>("select id from engine_migrations")).rows.map((r) => r.id));
  const files = (await readdir(dir)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    await pg.transaction(async (t) => { await t.exec(sql); await t.query("insert into engine_migrations (id) values ($1)", [file]); });
  }
  return files.filter((f) => !done.has(f));
}
