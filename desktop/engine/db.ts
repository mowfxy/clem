// The engine's database: PGlite on the desktop, Postgres on the VPS worker, both behind `Db` (and `Backend` for the
// engine's own needs: migrations, pg-boss and closing).
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type Db = {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
};
/** What the engine holds: its Db, raw SQL for migrations, what pg-boss runs on, and close. */
export type Backend = { db: Db; exec(sql: string): Promise<void>; pglite?: PGlite; connectionString?: string; close(): Promise<void> };

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
  const backend: Backend = { db, pglite: pg, exec: async (sql) => { await pg.exec(sql); }, close: () => pg.close() };
  return { pg, db, backend };
}

/** Postgres (the worker's, in Docker or on the host): a small pool. */
export async function openPostgres(connectionString: string): Promise<Backend> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString, max: 5 });
  await pool.query("select 1");
  const db: Db = {
    query: async <T>(sql: string, params: unknown[] = []) => (await pool.query(sql, params as unknown[])).rows as T[],
    tx: async (fn) => {
      const client = await pool.connect();
      const inner: Db = { query: async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params as unknown[])).rows as T[], tx: (f) => f(inner) };
      try { await client.query("begin"); const r = await fn(inner); await client.query("commit"); return r; }
      catch (e) { await client.query("rollback").catch(() => {}); throw e; }
      finally { client.release(); }
    },
  };
  return { db, connectionString, exec: async (sql) => { await pool.query(sql); }, close: () => pool.end() };
}

/** Applies desktop/engine/migrations/NNN_*.sql in order, each once, recorded in engine_migrations. */
export async function migrate(target: PGlite | Backend, dir: string) {
  const b: Backend = "db" in target && "exec" in target && !(target instanceof PGlite) ? target as Backend : (() => { const pg = target as PGlite; const db: Db = { query: run(pg), tx: (fn) => pg.transaction((t) => { const inner: Db = { query: run(t), tx: (f) => f(inner) }; return fn(inner); }) }; return { db, exec: async (s: string) => { await pg.exec(s); }, close: () => pg.close() }; })();
  await b.exec("create table if not exists engine_migrations (id text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await b.db.query<{ id: string }>("select id from engine_migrations")).map((r) => r.id));
  const files = (await readdir(dir)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    // One simple query: atomic on PGlite and Postgres alike (a multi-statement query is one implicit transaction).
    await b.exec(`begin;
${sql}
;insert into engine_migrations (id) values ('${file}');
commit;`).catch(async (e) => { await b.exec("rollback").catch(() => {}); throw e; });
  }
  return files.filter((f) => !done.has(f));
}
