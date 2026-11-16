// The engine's database: PGlite on the desktop, Postgres on the VPS worker, both behind `Db` (and `Backend` for the
// engine's own needs: migrations, pg-boss and closing).
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type Db = {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
};
/** What the engine holds: its Db, raw SQL for migrations, what pg-boss runs on, and close. */
export type Backend = { db: Db; exec(sql: string): Promise<void>; pglite?: PGlite; connectionString?: string; close(): Promise<void>;
  /** PGlite crashed (its WebAssembly aborted): every later query fails the same way, so the host opens it again. */
  broken?: boolean };

const run = (q: PGlite | Transaction) => async <T>(sql: string, params: unknown[] = []) => (await q.query<T>(sql, params)).rows;

/** PGlite's WebAssembly stopped (a Postgres PANIC, out of memory): that instance can't run anything again. */
export const isAbort = (e: unknown) => e instanceof WebAssembly.RuntimeError || /Aborted\(/.test(String((e as Error)?.message ?? e));

/** Opens (or creates) the database in `dir`; no dir is in memory, for tests. `load`: a snapshot (snapshotPglite) to
 *  start an empty `dir` from. */
export async function openPglite(dir?: string, load?: Uint8Array) {
  const options = load ? { loadDataDir: new Blob([load as BlobPart], { type: "application/x-gzip" }) } : undefined;
  const pg = dir ? new PGlite(dir, options) : new PGlite(options);
  await pg.waitReady.catch((e) => { release(pg); throw e; });
  const backend: Backend = { db: undefined as unknown as Db, pglite: pg, exec: async (sql) => { await pg.exec(sql).catch(fail); },
    close: async () => { if (backend.broken) release(pg); else await pg.close(); } };
  function fail(e: unknown): never { if (isAbort(e)) backend.broken = true; throw e; }
  const watched = (q: PGlite | Transaction) => { const r = run(q); return <T>(sql: string, params?: unknown[]) => r<T>(sql, params).catch(fail); };
  const db: Db = {
    query: watched(pg),
    // A transaction inside a transaction joins it.
    tx: (fn) => pg.transaction((t) => { const inner: Db = { query: watched(t), tx: (f) => f(inner) }; return fn(inner); }).catch(fail),
  };
  backend.db = db;
  return { pg, db, backend };
}

/** Lets go of the files a crashed PGlite still holds open: it can't close itself, and on Windows an open file keeps its
 *  folder from being moved or deleted. */
function release(pg: PGlite) {
  const fs = (pg as unknown as { mod?: { FS?: { streams: unknown[]; close(stream: unknown): void } } }).mod?.FS;
  for (const stream of fs?.streams.filter(Boolean) ?? []) { try { fs!.close(stream); } catch { /* already closed */ } }
}

/** The last good copy of an engine folder, kept beside it ("engine" → "engine-snapshot.tar.gz"). */
export const snapshotPath = (dir: string) => join(dirname(dir), basename(dir) + "-snapshot.tar.gz");

/** Saves a consistent copy of the open database beside its folder: a checkpoint, then the folder read in one go (no
 *  query runs in between), written to a temporary file and renamed so a crash never leaves half a snapshot. */
export async function snapshotPglite(pg: PGlite, dir: string) {
  await pg.exec("checkpoint");
  const bytes = new Uint8Array(await (await pg.dumpDataDir("gzip")).arrayBuffer());
  const to = snapshotPath(dir), part = to + ".part";
  await writeFile(part, bytes);
  await rename(part, to);
  return bytes.length;
}

const exists = (path: string) => stat(path).then(() => true, () => false);

/** Opens the engine's folder, and repairs it when Postgres can't start there (a crash or a second copy of Clem left it
 *  damaged: "could not locate a valid checkpoint record"). The damaged folder is kept aside (the newest two), and the
 *  database starts again from the last snapshot, or empty when there is none: GUC fills in again at the next sync. */
export async function openPgliteRepairing(dir: string, log: (message: string) => void = () => {}) {
  try {
    return { ...(await openPglite(dir)), repaired: undefined };
  } catch (error) {
    if (!isAbort(error) || !(await exists(join(dir, "PG_VERSION")))) throw error;
    const aside = `${dir}-damaged-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await rename(dir, aside);
    log(`[engine] the database would not start (${(error as Error).message}); kept it as ${basename(aside)} and repairing`);
    const parent = dirname(dir), prefix = basename(dir) + "-damaged-";
    const older = (await readdir(parent).catch(() => [] as string[])).filter((f) => f.startsWith(prefix)).sort().slice(0, -2);
    for (const f of older) await rm(join(parent, f), { recursive: true, force: true }).catch(() => {});
    const snapshot = await readFile(snapshotPath(dir)).catch(() => undefined);
    if (snapshot) {
      try {
        const opened = await openPglite(dir, new Uint8Array(snapshot));
        await opened.db.query("select 1");
        log("[engine] restored from the last snapshot");
        return { ...opened, repaired: "snapshot" as const };
      } catch (e) {
        log("[engine] the snapshot would not start either: " + (e as Error).message);
        await rm(dir, { recursive: true, force: true });
      }
    }
    log("[engine] started a new database; GUC fills it again at the next sync");
    return { ...(await openPglite(dir)), repaired: "fresh" as const };
  }
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
