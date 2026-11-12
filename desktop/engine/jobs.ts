// Background jobs: pg-boss on the engine's own PGlite (proven in step 1; see docs/GUC-VPS-ENGINE.md → Jobs).
// Jobs, retries and schedules live in the owner's database, so they survive a restart.
import type { PGlite } from "@electric-sql/pglite";
import { PgBoss, fromPglite } from "pg-boss";
import type { Backend } from "./db.ts";

export const TIMEZONE = "Africa/Cairo";
export type JobHandler = (data: any) => Promise<void>;

export class Jobs {
  private boss: PgBoss;
  private log: (message: string) => void;
  /** On the desktop's PGlite, or on Postgres (the worker) by connection string. */
  constructor(pg: PGlite | Backend, log: (message: string) => void = () => {}) {
    this.log = log;
    const b = pg as Backend;
    this.boss = b.connectionString ? new PgBoss({ connectionString: b.connectionString, schema: "pgboss", supervise: true })
      : new PgBoss({ db: fromPglite(b.pglite || (pg as PGlite)), backend: "pglite", schema: "pgboss", supervise: true });
    this.boss.on("error", (e: Error) => this.log("[jobs] " + e.message));
  }
  start() { return this.boss.start(); }
  stop() { return this.boss.stop({ graceful: true, timeout: 5000, close: false }); }
  /** A queue whose failed jobs retry up to `retries` times, with exponential backoff from `delay` seconds. */
  async queue(name: string, handler: JobHandler, o: { retries?: number; delay?: number; poll?: number } = {}) {
    await this.boss.createQueue(name, { retryLimit: o.retries ?? 3, retryDelay: o.delay ?? 60, retryBackoff: true });
    await this.boss.work(name, { pollingIntervalSeconds: o.poll ?? 15 }, async ([job]) => handler(job.data));
  }
  send(name: string, data: object = {}, o: { singletonKey?: string; startAfter?: number } = {}) { return this.boss.send(name, data, o); }
  /** `key` keeps several schedules on one queue (a subject's checks: "guc.check", "<subject>/1015"). */
  schedule(name: string, cron: string, data: object = {}, key?: string) { return this.boss.schedule(name, cron, data, { tz: TIMEZONE, ...(key ? { key } : {}) }); }
  unschedule(name: string, key?: string) { return this.boss.unschedule(name, key); }
  job(name: string, id: string) { return this.boss.getJobById(name, id); }
  schedules(name?: string) { return this.boss.getSchedules(name); }
}
