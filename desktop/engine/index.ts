// Clem's background engine for one signed-in owner: its database, jobs and the GUC connector.
// Hosted in-process by desktop/main.ts; worker/ will host the same class headless.
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { materialFile, type HubFile, type HubOverview } from "../../core/guc/hub.ts";
import { urls } from "../../core/guc/parse.ts";
import type { GucErrorKind, GucProgress, GucStatus, GucSyncStats } from "../../core/guc/types.ts";
import { migrate, openPglite, type Db } from "./db.ts";
import { GucError, asGucError } from "./errors.ts";
import { GucClient, fetchFile, login, type Credentials, type Http } from "./guc-client.ts";
import * as read from "./guc-read.ts";
import { syncGuc } from "./guc-sync.ts";
import type { EngineHost } from "./host.ts";
import { Jobs } from "./jobs.ts";
import type { PGlite } from "@electric-sql/pglite";

const GUC_TABLES = ["guc_courses", "guc_schedule_slots", "guc_announcements", "guc_materials", "guc_grades", "guc_deadlines", "guc_snapshots", "guc_events", "subject_links", "guc_account"];
/** Every three hours, Cairo time. */
export const GUC_SYNC_CRON = "0 */3 * * *";

export class Engine {
  readonly owner: string;
  readonly db: Db;
  private pg: PGlite;
  private host: EngineHost;
  private jobs?: Jobs;
  private http?: Http;
  private sleep?: (ms: number) => Promise<void>;
  private running?: Promise<GucStatus>;
  private reader?: GucClient;
  /** CMS files fetched for viewing: kept in a temp folder for this session only, never in the workspace. */
  private temp = new Map<string, Promise<HubFile & { path: string }>>();

  private constructor(owner: string, host: EngineHost, pg: PGlite, db: Db, o: { http?: Http; sleep?: (ms: number) => Promise<void> }) {
    this.owner = owner; this.host = host; this.pg = pg; this.db = db; this.http = o.http; this.sleep = o.sleep;
  }

  /** `memory` keeps the database in memory (tests); `jobs: false` runs no background jobs. */
  static async open(owner: string, host: EngineHost, o: { http?: Http; sleep?: (ms: number) => Promise<void>; memory?: boolean; jobs?: boolean } = {}) {
    if (!/^[\w-]{1,100}$/.test(owner)) throw Error("Invalid account");
    if (!o.memory) await mkdir(host.paths.data, { recursive: true });
    const { pg, db } = await openPglite(o.memory ? undefined : host.paths.data);
    await migrate(pg, host.paths.migrations);
    const engine = new Engine(owner, host, pg, db, o);
    if (o.jobs !== false) await engine.startJobs();
    return engine;
  }

  private async startJobs() {
    this.jobs = new Jobs(this.pg, (m) => this.host.log("warn", m));
    await this.jobs.start();
    await this.jobs.queue("guc.sync", async () => {
      if (!(await this.credentials())) return;
      // A wrong password is not retried: it needs the person, and they have been told once.
      try { await this.syncNow(); } catch (e) { if (!(e instanceof GucError && e.kind === "auth")) throw e; }
    }, { retries: 3, delay: 120 });
    if (await this.credentials()) await this.jobs.schedule("guc.sync", GUC_SYNC_CRON);
  }

  private key() { return "guc-" + this.owner; }
  private credentials() { return this.host.secrets.get<Credentials>(this.key()); }

  async status(): Promise<GucStatus> {
    const [account] = await this.db.query<{ username: string; last_sync: Date | null; last_error: { kind: GucErrorKind; message: string } | null; stats: GucSyncStats | null }>(
      "select username, last_sync, last_error, stats from guc_account where owner_id = $1", [this.owner]);
    const connected = !!account && !!(await this.credentials());
    const [{ n: courses }] = await this.db.query<{ n: number }>("select count(*)::int as n from guc_courses where owner_id = $1 and active", [this.owner]);
    const [{ n: linked }] = await this.db.query<{ n: number }>("select count(*)::int as n from subject_links where owner_id = $1", [this.owner]);
    return { connected, username: connected ? account.username : undefined, syncing: !!this.running, lastSync: account?.last_sync ? new Date(account.last_sync).getTime() : undefined, courses, linked, stats: account?.stats || undefined, error: connected ? account.last_error || undefined : undefined };
  }

  /** Checks the username and password with GUC, keeps them encrypted, then runs the first sync. */
  async connect(username: string, password: string, progress?: (p: GucProgress) => void) {
    progress?.({ phase: "login", done: 0, total: 1, label: "Signing in to GUC…" });
    const client = await login(username, password, urls.home, this.http, this.sleep);
    await this.host.secrets.set(this.key(), { username: client.username, password, domain: client.domain } satisfies Credentials);
    await this.db.query("insert into guc_account (owner_id, username) values ($1, $2) on conflict (owner_id) do update set username = excluded.username, connected_at = now(), last_error = null", [this.owner, client.username]);
    await this.jobs?.schedule("guc.sync", GUC_SYNC_CRON);
    return this.sync(progress, true, client).catch(() => this.status());
  }

  /** One sync at a time; a second call while one runs waits for it. */
  sync(progress?: (p: GucProgress) => void, initial = false, client?: GucClient) {
    this.running ||= this.run(progress, initial, client).finally(() => { this.running = undefined; });
    return this.running;
  }
  private syncNow() { return this.sync(); }

  private async run(progress: ((p: GucProgress) => void) | undefined, initial: boolean, client?: GucClient) {
    const credentials = await this.credentials();
    if (!credentials) throw Error("Connect GUC first.");
    client ||= new GucClient(credentials, this.http, this.sleep);
    try {
      const result = await syncGuc({ db: this.db, owner: this.owner, client, initial, progress });
      const { eventList, warnings, ...stats } = result;
      if (warnings.length) this.host.log("warn", "[guc] skipped: " + warnings.join(", "));
      await this.db.query("update guc_account set last_sync = now(), last_error = null, stats = $2 where owner_id = $1", [this.owner, stats]);
      await this.db.query("delete from notifications_sent where owner_id = $1 and event_key like 'guc-error:%'", [this.owner]);
      this.host.log("info", `[guc] synced: ${stats.requests} requests, ${stats.skipped} unchanged, ${stats.events} new, ${stats.ms} ms`);
      return this.status();
    } catch (e) {
      const error = asGucError(e);
      this.host.log("warn", `[guc] sync failed: ${error.kind}${error.detail ? " (" + error.detail + ")" : ""}`);
      await this.db.query("update guc_account set last_error = $2 where owner_id = $1", [this.owner, { kind: error.kind, message: error.message }]);
      // One notice per kind of failure until a sync works again.
      const fresh = await this.db.query("insert into notifications_sent (owner_id, event_key, channel) values ($1, $2, 'desktop') on conflict do nothing returning 1", [this.owner, "guc-error:" + error.kind]);
      if (fresh.length) this.host.notify({ key: "guc-error", title: "GUC", body: error.message });
      throw error;
    }
  }

  // ---------- The GUC hub's reads (src/guc/GucHub.tsx) ----------
  async overview(): Promise<HubOverview> {
    const [status, counts] = await Promise.all([this.status(), read.counts(this.db, this.owner)]);
    return { connected: status.connected, syncing: status.syncing, username: status.username, lastSync: status.lastSync, error: status.error, counts };
  }
  courses() { return read.courses(this.db, this.owner); }
  schedule(weekStart: string) { return read.schedule(this.db, this.owner, weekStart); }
  announcements(o: { courseKey?: string; cursor?: string } = {}) { return read.announcements(this.db, this.owner, o); }
  markRead(ids: string[]) { return read.markRead(this.db, this.owner, ids); }
  materials(courseKey: string) { return read.materials(this.db, this.owner, courseKey); }
  search(query: string) { return read.search(this.db, this.owner, query); }
  grades(courseKey?: string) { return read.grades(this.db, this.owner, courseKey); }
  deadlines() { return read.deadlines(this.db, this.owner); }

  private tempDir() { return this.host.paths.temp || join(tmpdir(), "clem-guc", this.owner); }
  /** A CMS file to view: the saved copy when there is one, else fetched now into a temp folder (once per file per session).
   *  Save rules (a later step) decide what is kept for good; until then nothing is. */
  async file(materialId: string): Promise<HubFile & { path: string }> {
    const [m] = await this.db.query<{ title: string; url: string }>("select title, url from guc_materials where owner_id = $1 and material_id = $2", [this.owner, materialId]);
    if (!m?.url) throw new GucError("unavailable", "no such file", "This file is no longer on the CMS.");
    const { name, type } = materialFile(m.url, m.title);
    const [saved] = await this.db.query<{ path: string; size: string }>("select path, size from file_objects where owner_id = $1 and file_id = $2 and location = 'device'", [this.owner, "guc:" + materialId]);
    if (saved && await stat(saved.path).then(() => true, () => false)) return { id: materialId, name, type, size: Number(saved.size), stored: true, path: saved.path };
    let job = this.temp.get(materialId);
    if (!job) {
      job = (async () => {
        const credentials = await this.credentials();
        if (!credentials) throw new GucError("auth", "not connected");
        this.reader ||= new GucClient(credentials, this.http, this.sleep);
        const file = await fetchFile(this.reader, m.url);
        await mkdir(this.tempDir(), { recursive: true });
        const path = join(this.tempDir(), materialId.replace(/[^\w-]/g, "_") + extname(name));
        await writeFile(path, file.bytes);
        return { id: materialId, name, type: type === "application/octet-stream" && file.type ? file.type : type, size: file.bytes.length, stored: false, path };
      })();
      this.temp.set(materialId, job);
      job.catch(() => this.temp.delete(materialId));
    }
    return job;
  }
  private async dropTemp() { this.temp.clear(); this.reader = undefined; await rm(this.tempDir(), { recursive: true, force: true }).catch(() => {}); }

  /** Forgets the password and every GUC row of this owner. */
  async disconnect() {
    await this.running?.catch(() => {});
    await this.dropTemp();
    await this.host.secrets.delete(this.key());
    await this.jobs?.unschedule("guc.sync").catch(() => {});
    await this.db.tx(async (t) => {
      for (const table of GUC_TABLES) await t.query(`delete from ${table} where owner_id = $1`, [this.owner]);
      await t.query("delete from notifications_sent where owner_id = $1 and event_key like 'guc-%'", [this.owner]);
    });
    return this.status();
  }

  async close() {
    await this.running?.catch(() => {});
    await this.jobs?.stop().catch(() => {});
    await this.dropTemp();
    await this.pg.close();
  }
}
