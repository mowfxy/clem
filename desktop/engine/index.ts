// Clem's background engine for one signed-in owner: its database, jobs and the GUC connector.
// Hosted in-process by desktop/main.ts; worker/ will host the same class headless.
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { gucNow, type FileText, type GucNow } from "../../core/guc/ai-tools.ts";
import { cairo, materialFile, type HubFile, type HubOverview } from "../../core/guc/hub.ts";
import { urls } from "../../core/guc/parse.ts";
import { AUTH_RETRY_MS, PASSWORD_SAID } from "../../core/guc/password.ts";
import { active, cronLines } from "../../core/guc/schedule-rules.ts";
import type { InboxItem, SettingsPatch, SubjectView } from "../../core/guc/settings.ts";
import { saveFiles, type SaveStats } from "./check.ts";
import { mirror, type MirrorResult } from "./drive-mirror.ts";
import { DeviceStore, type FileStore } from "./storage.ts";
import { extractText, textCache, type TextCacheOptions } from "./file-text.ts";
import type { SyncResult } from "./guc-sync.ts";
import type { GucErrorKind, GucProgress, GucStatus, GucSyncStats } from "../../core/guc/types.ts";
import { migrate, openPglite, type Db } from "./db.ts";
import { GucError, asGucError } from "./errors.ts";
import { GucClient, fetchFile, login, type Credentials, type Http } from "./guc-client.ts";
import * as read from "./guc-read.ts";
import * as subjects from "./subjects.ts";
import { syncGuc } from "./guc-sync.ts";
import type { EngineHost } from "./host.ts";
import { Jobs } from "./jobs.ts";
import { Organizer } from "./organizer.ts";
import { TelegramRelay } from "./telegram.ts";
import type { Backend } from "./db.ts";

const GUC_TABLES = ["guc_courses", "guc_schedule_slots", "guc_announcements", "guc_materials", "guc_grades", "guc_deadlines", "guc_snapshots", "guc_events", "subject_links", "guc_account", "guc_checks", "subject_drive"];
/** Every three hours, Cairo time. */
export const GUC_SYNC_CRON = "0 */3 * * *";
/** A settings change that saves or copies files waits this long for the next tap, so a few quick taps are one run. */
export const SETTLE_MS = 15_000;
export type CheckTrigger = "schedule" | "now" | "rules";
export type CheckOutcome = SaveStats & { trigger: CheckTrigger; pageChanged: boolean; uploaded: number; drive?: MirrorResult };

export class Engine {
  readonly owner: string;
  readonly db: Db;
  private backend: Backend;
  private deviceStore: FileStore;
  private runnerOn = false;
  private host: EngineHost;
  private jobs?: Jobs;
  private http?: Http;
  private sleep?: (ms: number) => Promise<void>;
  private clock: () => number;
  private running?: Promise<GucStatus>;
  private light?: Promise<GucStatus>;
  private reader?: GucClient;
  /** CMS files fetched for viewing: kept in a temp folder for this session only, never in the workspace. */
  private temp = new Map<string, Promise<HubFile & { path: string }>>();
  /** Where newly saved CMS files go: the VPS when the host says files live there (and it is reachable), else this PC. */
  get store(): FileStore { return this.host.fileStore?.() || this.deviceStore; }
  /** One check per subject at a time; a second waits for the first. */
  private checks = new Map<string, Promise<unknown>>();
  private settling = new Map<string, { timer: ReturnType<typeof setTimeout>; files: boolean }>();
  /** Text the AI read from CMS files (guc.read), kept briefly; this owner's only, since each owner has an engine. */
  private texts: ReturnType<typeof textCache>;
  private reading = new Map<string, Promise<FileText & { stored: boolean }>>();
  /** Bumped whenever GUC data changes (a sync, a check, marking read), so the Now card's cached rows are read again. */
  private version = 0;
  private nowCache?: { key: string; value: GucNow };
  /** Clem's organizer: sweeps, reminders, watches and notifications (docs/MAIN-THREAD.md "Proactivity"). */
  readonly organizer: Organizer;
  /** Telegram: the paired chat's messages answered, cards and files sent, the notifier's channel (docs/DESKTOP.md). */
  readonly telegram: TelegramRelay;

  private constructor(owner: string, host: EngineHost, backend: Backend, db: Db, o: { http?: Http; sleep?: (ms: number) => Promise<void>; store?: FileStore; text?: TextCacheOptions; clock?: () => number }) {
    this.owner = owner; this.host = host; this.backend = backend; this.db = db; this.http = o.http; this.sleep = o.sleep; this.texts = textCache(o.text); this.clock = o.clock || Date.now;
    this.organizer = new Organizer({ db, owner, host, clock: o.clock, guc: () => this.gucFacts() });
    this.telegram = new TelegramRelay({ db, owner, host, organizer: this.organizer, clock: o.clock, engine: { checkNow: (id) => this.check(id, "now"), file: (id) => this.file(id) } });
    if (host.account) this.organizer.telegram = this.telegram;
    this.deviceStore = o.store || new DeviceStore(host.paths.files || (host.paths.data ? join(host.paths.data, "..", "Files") : join(tmpdir(), "clem-guc-files", owner)));
  }

  /** `memory` keeps the database in memory (tests); `jobs: false` runs no background jobs (see `runner`); `backend`:
   *  the worker's Postgres (or any opened database) instead of this owner's PGlite folder. */
  static async open(owner: string, host: EngineHost, o: { http?: Http; sleep?: (ms: number) => Promise<void>; memory?: boolean; jobs?: boolean; store?: FileStore; text?: TextCacheOptions; clock?: () => number; backend?: Backend } = {}) {
    if (!/^[\w-]{1,100}$/.test(owner)) throw Error("Invalid account");
    if (!o.memory && !o.backend) await mkdir(host.paths.data, { recursive: true });
    const backend = o.backend || (await openPglite(o.memory ? undefined : host.paths.data)).backend;
    await migrate(backend, host.paths.migrations);
    const engine = new Engine(owner, host, backend, backend.db, o);
    if (o.jobs !== false) await engine.runner(true);
    return engine;
  }

  /** Whether this engine runs Clem's jobs (sync, checks, sweeps, the Telegram inbox). Exactly one engine does
   *  (core/vps/lease.ts): the desktop stops when the VPS worker holds the lease and starts again when it goes quiet. */
  async runner(on: boolean) {
    if (on === this.runnerOn) return;
    this.runnerOn = on;
    if (on) return this.startJobs();
    this.organizer.detach();
    await this.telegram.stop();
    await this.jobs?.stop().catch(() => {});
    this.jobs = undefined;
  }
  get isRunner() { return this.runnerOn; }

  private async startJobs() {
    this.jobs = new Jobs(this.backend, (m) => this.host.log("warn", m));
    await this.jobs.start();
    await this.jobs.queue("guc.sync", async () => {
      if (!(await this.credentials()) || await this.paused()) return;
      // A wrong password is not retried: it needs the person, and they have been told once.
      try { await this.syncNow(); } catch (e) { if (!(e instanceof GucError && e.kind === "auth")) throw e; }
    }, { retries: 3, delay: 120 });
    // A subject's own checks (its schedule rules): a light sync of its course.
    await this.jobs.queue("guc.check", async ({ subjectId }: { subjectId: string }) => {
      if (!(await this.credentials()) || await this.paused()) return;
      try { await this.check(subjectId, "schedule"); } catch (e) { if (!(e instanceof GucError && (e.kind === "auth" || e.detail === "not linked"))) throw e; }
    }, { retries: 2, delay: 120 });
    if (await this.credentials() && !(await this.paused())) await this.jobs.schedule("guc.sync", GUC_SYNC_CRON);
    await this.organizer.start(this.jobs);
    this.telegram.start();
    // First run without Telegram paired: the pair card, once, in the main thread.
    const offer = setTimeout(() => void this.organizer.offerTelegram("first").catch(() => {}), 30_000);
    offer.unref?.();
  }
  /** What the organizer reads from GUC: this week's classes, deadlines, links and the Now card (all local rows; empty
   *  once GUC is disconnected). */
  private async gucFacts() {
    const [slots, deadlines, links, now] = await Promise.all([read.schedule(this.db, this.owner, cairo(Date.now()).ymd).then((s) => s.slots), read.deadlines(this.db, this.owner), this.links(), this.now()]);
    return { slots, deadlines, links, now };
  }

  private key() { return "guc-" + this.owner; }
  private credentials() { return this.host.secrets.get<Credentials>(this.key()); }
  /** The credentials for a request to GUC; none while the password is needed, so nothing hammers GUC into a lockout. */
  private async signIn() {
    const credentials = await this.credentials();
    if (!credentials) throw new GucError("auth", "not connected");
    if (await this.paused()) throw new GucError("auth", "password needed", PASSWORD_SAID);
    return credentials;
  }

  // ---------- Password expiry (docs/GUC-VPS-ENGINE.md "Password expiry", core/guc/password.ts) ----------
  /** When GUC first stopped accepting the password, while it still doesn't. */
  async paused(): Promise<number | null> {
    const [row] = await this.db.query<{ at: Date | null }>("select password_needed as at from guc_account where owner_id = $1", [this.owner]);
    return row?.at ? new Date(row.at).getTime() : null;
  }
  /** The retry failed too: mark `password_needed`, pause every GUC job (no data or settings change), tell the person once. */
  private async passwordFailed() {
    await this.db.query("update guc_account set password_needed = coalesce(password_needed, $2), last_error = $3 where owner_id = $1", [this.owner, new Date(this.clock()), { kind: "auth", message: PASSWORD_SAID }]);
    await this.jobs?.unschedule("guc.sync").catch(() => {});
    for (const s of await this.jobs?.schedules("guc.check").catch(() => []) || []) await this.jobs?.unschedule("guc.check", s.key).catch(() => {});
    this.version++;
    this.host.changed?.();
    await this.organizer.gucPassword().catch((e) => this.host.log("warn", "[guc] password notice: " + (e as Error).message));
  }
  /** Settings → Connectors → GUC → New password: checked with GUC, kept in the Vault, the flag cleared, the jobs back,
   *  then a catch-up check (a sync, then each linked subject's save rules). A wrong one changes nothing. */
  async updatePassword(password: string, progress?: (p: GucProgress) => void) {
    const was = await this.credentials();
    if (!was) throw Error("Connect GUC first.");
    progress?.({ phase: "login", done: 0, total: 1, label: "Checking with GUC…" });
    const client = await login(was.domain ? `${was.domain}\\${was.username}` : was.username, password, urls.home, this.http, this.sleep).catch((e) => {
      throw e instanceof GucError && e.kind === "auth" ? new GucError("auth", e.detail, "GUC didn't accept that password. Check it and try again.") : e;
    });
    await this.host.secrets.set(this.key(), { username: client.username, password, domain: client.domain } satisfies Credentials);
    await this.db.query("update guc_account set password_needed = null, last_error = null where owner_id = $1", [this.owner]);
    this.reader = undefined;
    await this.jobs?.schedule("guc.sync", GUC_SYNC_CRON);
    const linked = await this.links();
    for (const l of linked) await this.reschedule(l.subjectId);
    this.version++;
    this.host.changed?.();
    this.catchUp = this.sync(progress, false, client).then(async () => { for (const l of linked) await this.check(l.subjectId, "rules").catch(() => null); }, () => {}).finally(() => { this.catchUp = undefined; });
    return this.status();
  }
  /** The catch-up after a new password (tests wait for it). */
  catchUp?: Promise<void>;

  async status(): Promise<GucStatus> {
    const [account] = await this.db.query<{ username: string; last_sync: Date | null; last_error: { kind: GucErrorKind; message: string } | null; stats: GucSyncStats | null }>(
      "select username, last_sync, last_error, stats from guc_account where owner_id = $1", [this.owner]);
    const connected = !!account && !!(await this.credentials());
    const [{ n: courses }] = await this.db.query<{ n: number }>("select count(*)::int as n from guc_courses where owner_id = $1 and active", [this.owner]);
    const [{ n: linked }] = await this.db.query<{ n: number }>("select count(*)::int as n from subject_links where owner_id = $1", [this.owner]);
    const passwordNeeded = connected && !!(await this.paused());
    return { connected, username: connected ? account.username : undefined, syncing: !!this.running, lastSync: account?.last_sync ? new Date(account.last_sync).getTime() : undefined, courses, linked, stats: account?.stats || undefined, error: connected ? account.last_error || undefined : undefined, ...(passwordNeeded ? { passwordNeeded } : {}) };
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

  /** One sync at a time; a second call while one runs waits for it. Light syncs of one course queue behind it. */
  sync(progress?: (p: GucProgress) => void, initial = false, client?: GucClient) {
    this.running ||= (this.light || Promise.resolve()).catch(() => {}).then(() => this.run(progress, initial, client)).finally(() => { this.running = undefined; });
    return this.running;
  }
  /** A light sync of one course (just linked, "Check now", its scheduled check): its page only. */
  syncCourse(courseKey: string, progress?: (p: GucProgress) => void, client?: GucClient, out?: { result?: SyncResult }) {
    const job = Promise.allSettled([this.running, this.light]).then(() => this.run(progress, false, client, courseKey, out));
    this.light = job.finally(() => { if (this.light === job) this.light = undefined; });
    return job;
  }
  private syncNow() { return this.sync(); }

  private async run(progress: ((p: GucProgress) => void) | undefined, initial: boolean, client?: GucClient, only?: string, out?: { result?: SyncResult }) {
    const credentials = await this.credentials();
    if (!credentials) throw Error("Connect GUC first.");
    if (await this.paused()) throw new GucError("auth", "password needed", PASSWORD_SAID);
    client ||= new GucClient(credentials, this.http, this.sleep);
    try {
      // A wrong password is tried once more after a short wait, to rule out a blip.
      const result = await syncGuc({ db: this.db, owner: this.owner, client, initial, only, progress }).catch(async (e) => {
        if (asGucError(e).kind !== "auth") throw e;
        await (this.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(AUTH_RETRY_MS);
        return syncGuc({ db: this.db, owner: this.owner, client: new GucClient(credentials, this.http, this.sleep), initial, only, progress });
      });
      if (out) out.result = result;
      this.version++;
      // PGlite has no autovacuum: fresh row counts after a sync that rewrote rows, so the planner keeps using the indexes.
      if (result.changed) await this.db.query("analyze guc_materials, guc_announcements, guc_events, file_objects").catch(() => {});
      const { eventList, warnings, ...stats } = result;
      if (warnings.length) this.host.log("warn", "[guc] skipped: " + warnings.join(", "));
      if (!only) await this.db.query("update guc_account set last_sync = now(), last_error = null, stats = $2 where owner_id = $1", [this.owner, stats]);
      await this.db.query("delete from notifications_sent where owner_id = $1 and event_key like 'guc-error:%'", [this.owner]);
      this.host.log("info", `[guc] synced: ${stats.requests} requests, ${stats.skipped} unchanged, ${stats.events} new, ${stats.ms} ms`);
      if (stats.events) void this.organizer.poke("sync").catch(() => {});
      return this.status();
    } catch (e) {
      const error = asGucError(e);
      this.host.log("warn", `[guc] sync failed: ${error.kind}${error.detail ? " (" + error.detail + ")" : ""}`);
      if (error.kind === "auth") { await this.passwordFailed(); throw new GucError("auth", error.detail, PASSWORD_SAID); }
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
    return { connected: status.connected, syncing: status.syncing, username: status.username, lastSync: status.lastSync, error: status.error, ...(status.passwordNeeded ? { passwordNeeded: true } : {}), counts };
  }
  courses() { return read.courses(this.db, this.owner); }
  schedule(weekStart: string) { return read.schedule(this.db, this.owner, weekStart); }
  announcements(o: { courseKey?: string; cursor?: string } = {}) { return read.announcements(this.db, this.owner, o); }
  markRead(ids: string[]) { this.version++; return read.markRead(this.db, this.owner, ids); }
  materials(courseKey: string) { return read.materials(this.db, this.owner, courseKey); }
  search(query: string) { return read.search(this.db, this.owner, query); }
  grades(courseKey?: string) { return read.grades(this.db, this.owner, courseKey); }
  deadlines() { return read.deadlines(this.db, this.owner); }

  // ---------- Subjects and their courses (core/guc/setup-flow.ts, src/guc/setup.ts) ----------
  links() { return subjects.links(this.db, this.owner); }
  subject(subjectId: string) { const v = this.host.vps?.(); return subjects.view(this.db, this.owner, subjectId, { vps: !!v, vpsFiles: !!v?.files }); }
  /** Links a course and reads it now (a light sync in the background); its checks follow its settings. */
  async link(subjectId: string, courseKey: string, progress?: (p: GucProgress) => void) {
    const { movedFrom } = await subjects.link(this.db, this.owner, subjectId, courseKey);
    if (movedFrom) await this.reschedule(movedFrom);
    await this.reschedule(subjectId);
    void this.syncCourse(courseKey, progress).catch((e) => this.host.log("warn", "[guc] light sync failed: " + asGucError(e).kind));
    return this.subject(subjectId);
  }
  async unlink(subjectId: string) { await subjects.unlink(this.db, this.owner, subjectId); await this.reschedule(subjectId); return this.subject(subjectId); }
  /** Changes settings. New save rules save what they now keep, and turning the Drive copy on (or a new folder) copies
   *  what is saved, once the taps settle; neither reads CMS pages again. */
  async setSettings(subjectId: string, patch: SettingsPatch) {
    const before = await subjects.settings(this.db, this.owner, subjectId);
    const after = await subjects.saveSettings(this.db, this.owner, subjectId, patch);
    if (patch.check) await this.reschedule(subjectId);
    const midSetup = !!after.setup && !after.setup.finished && !after.setup.done.save;
    const files = !!patch.save && !midSetup || (!!patch.setup?.done.save && !before.setup?.done.save);
    const copy = after.drive.enabled && (!before.drive.enabled || after.drive.folderId !== before.drive.folderId);
    if (files || copy) this.settle(subjectId, files);
    return this.subject(subjectId);
  }
  private settle(subjectId: string, files: boolean) {
    const was = this.settling.get(subjectId);
    if (was) clearTimeout(was.timer);
    const timer = setTimeout(() => {
      this.settling.delete(subjectId);
      void (files ? this.check(subjectId, "rules") : this.copyToDrive(subjectId)).then(() => this.host.changed?.(), (e) => this.host.log("warn", "[guc] settings run failed: " + asGucError(e).kind));
    }, SETTLE_MS);
    timer.unref?.();
    this.settling.set(subjectId, { timer, files: files || !!was?.files });
  }
  /** Reads the subject's course now ("Check now") and saves what its rules keep, then its fresh view. */
  async checkNow(subjectId: string, progress?: (p: GucProgress) => void) {
    await this.check(subjectId, "now", progress);
    return this.subject(subjectId);
  }
  /** One check of a subject: its course page (only when it changed, by ETag or hash), then the files its rules keep
   *  that aren't saved yet, then the Drive copy. "rules" skips the page. A scheduled check outside its date range does
   *  nothing. Each check is a guc_checks row. */
  check(subjectId: string, trigger: CheckTrigger, progress?: (p: GucProgress) => void): Promise<CheckOutcome | null> {
    const job = (this.checks.get(subjectId) || Promise.resolve()).catch(() => {}).then(() => this.runCheck(subjectId, trigger, progress));
    this.checks.set(subjectId, job);
    void job.finally(() => { if (this.checks.get(subjectId) === job) this.checks.delete(subjectId); }).catch(() => {});
    return job;
  }
  private async runCheck(subjectId: string, trigger: CheckTrigger, progress?: (p: GucProgress) => void): Promise<CheckOutcome | null> {
    const started = Date.now(), v = await this.subject(subjectId);
    if (!v.course) throw new GucError("unavailable", "not linked", "Link a CMS course first.");
    if (trigger === "schedule" && !active(v.settings.check, started)) return null;
    const credentials = await this.signIn();
    const client = new GucClient(credentials, this.http, this.sleep), out: { result?: SyncResult } = {};
    let stats: SaveStats = { requests: 0, bytes: 0, saved: 0, skipped: 0, deduped: 0, ms: 0 }, drive: MirrorResult | undefined, error: string | undefined;
    try {
      if (trigger !== "rules") await this.syncCourse(v.course.key, progress, client, out);
      stats = await saveFiles({ db: this.db, owner: this.owner, subjectId, courseKey: v.course.key, rules: v.settings.save, client: () => client, store: this.store });
      if (v.settings.drive.enabled && (stats.saved || trigger !== "schedule" || (await this.subject(subjectId)).drive.waiting)) drive = await this.copyToDrive(subjectId, v);
    } catch (e) {
      const err = asGucError(e);
      error = err.kind;
      if (err.kind === "auth" && !(await this.paused())) await this.passwordFailed();
      throw e;
    }
    finally {
      await this.db.query("insert into guc_checks (owner_id, subject_id, trigger, page_changed, requests, bytes, saved, skipped, deduped, uploaded, ms, error) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        [this.owner, subjectId, trigger, !!out.result?.changed, client.requests, stats.bytes, stats.saved, stats.skipped, stats.deduped, drive?.uploaded || 0, Date.now() - started, error ?? drive?.error ?? null]);
      await this.db.query("delete from guc_checks where owner_id = $1 and subject_id = $2 and id not in (select id from guc_checks where owner_id = $1 and subject_id = $2 order by id desc limit 200)", [this.owner, subjectId]);
    }
    this.version++;
    if (stats.saved > 10) await this.db.query("analyze file_objects").catch(() => {});
    this.host.log("info", `[guc] check ${trigger}: ${client.requests} requests, ${stats.bytes} bytes, ${stats.saved} saved, ${stats.deduped} deduped, ${Date.now() - started} ms`);
    if (stats.saved || out.result?.events) { this.host.changed?.(); void this.organizer.poke("check").catch(() => {}); }
    return { ...stats, requests: client.requests, ms: Date.now() - started, trigger, pageChanged: !!out.result?.changed, uploaded: drive?.uploaded || 0, drive };
  }
  /** Copies the subject's saved files Drive doesn't have yet (docs: Drive copy). */
  async copyToDrive(subjectId: string, view?: SubjectView) {
    const v = view || await this.subject(subjectId), d = v.settings.drive;
    return mirror({ db: this.db, owner: this.owner, subjectId, drive: this.host.drive, course: v.course ? `${v.course.code} ${v.course.name}`.trim() : "Subject", folderId: d.folderId || undefined, folderName: d.folderName });
  }
  /** Files saved and news found for linked subjects that the window hasn't shown yet (its Files and Setup chats). */
  inbox(): Promise<InboxItem[]> { return subjects.inbox(this.db, this.owner); }
  ackInbox(keys: string[]) { return subjects.ackInbox(this.db, this.owner, keys); }
  async forgetSubject(subjectId: string) { await subjects.forget(this.db, this.owner, subjectId); await this.reschedule(subjectId); }
  newCourses() { return subjects.newCourses(this.db, this.owner); }
  ackNewCourses(keys: string[]) { return subjects.ackNewCourses(this.db, this.owner, keys); }
  /** Reconciles a subject's pg-boss schedules ("guc.check", key "<subject>/<line>") with its check rules: only lines
   *  that changed are added or removed; none once unlinked or off. */
  private async reschedule(subjectId: string) {
    if (!this.jobs) return { added: 0, removed: 0 };
    const v = await this.subject(subjectId), paused = !!(await this.paused());
    const want = new Map((v.course && !paused ? cronLines(v.settings.check) : []).map((l) => [subjectId + "/" + l.key, l.cron]));
    const have = (await this.jobs.schedules("guc.check")).filter((s) => s.key?.startsWith(subjectId + "/"));
    let added = 0, removed = 0;
    for (const s of have) if (want.get(s.key) !== s.cron) { await this.jobs.unschedule("guc.check", s.key); removed++; }
    for (const [key, cron] of want) if (!have.some((s) => s.key === key && s.cron === cron)) { await this.jobs.schedule("guc.check", cron, { subjectId }, key); added++; }
    return { added, removed };
  }

  /** The main thread's Now card from GUC: today's classes, deadlines in the next 7 days and unread news. Cached until
   *  the data changes (sync, check, marking read) or the Cairo hour turns. */
  async now(t = Date.now()): Promise<GucNow> {
    const c = cairo(t), key = `${this.version}:${c.ymd}:${c.time.slice(0, 2)}`;
    if (this.nowCache?.key === key) return this.nowCache.value;
    const [slots, deadlines, counts] = await Promise.all([read.schedule(this.db, this.owner, c.ymd).then((s) => s.slots), read.deadlines(this.db, this.owner), read.counts(this.db, this.owner)]);
    const value = gucNow({ slots, deadlines, unread: counts.unread }, t);
    this.nowCache = { key, value };
    return value;
  }

  /** Where a saved CMS file's bytes are, in whichever store holds them: this PC now; a VPS or Drive store plugs in by
   *  its location. A copy in a store this host can't reach reads as not saved (fetched from CMS instead). */
  private stores(): Partial<Record<"device" | "vps" | "drive", FileStore>> { return { device: this.deviceStore, ...(this.host.fileStores?.() || {}) }; }
  private async savedBytes(materialId: string) {
    const rows = await this.db.query<{ location: "device" | "vps" | "drive"; path: string }>("select location, path from file_objects where owner_id = $1 and file_id = $2", [this.owner, "guc:" + materialId]);
    for (const r of rows) {
      const store = this.stores()[r.location];
      if (store && await store.has(r.path)) return store.read(r.path);
    }
    return undefined;
  }
  /** A CMS file's text for the AI (guc.read), whether or not it is saved: the saved copy, else the bytes fetched now
   *  into memory only (never written, never recorded as saved), extracted, then dropped. The text stays in a small
   *  LRU for TEXT_TTL_MS, so reading on costs no second download. */
  async fileText(materialId: string): Promise<FileText & { stored: boolean; cached: boolean }> {
    const [m] = await this.db.query<{ title: string; url: string; stored: boolean }>("select title, url, exists (select 1 from file_objects f where f.owner_id = $1 and f.file_id = 'guc:' || $2) as stored from guc_materials where owner_id = $1 and material_id = $2", [this.owner, materialId]);
    if (!m?.url) throw new GucError("unavailable", "no such file", "This file is no longer on the CMS.");
    const key = materialId + "\n" + m.url, hit = this.texts.get(key);
    if (hit) return { ...hit, stored: m.stored, cached: true };
    let job = this.reading.get(key);
    if (!job) {
      job = (async () => {
        const { name, type } = materialFile(m.url, m.title);
        let bytes = await this.savedBytes(materialId);
        const stored = !!bytes;
        if (!bytes) {
          // The viewer's temp copy when it has one, else straight from CMS into memory.
          const viewing = this.temp.get(materialId);
          const temp = viewing && await viewing.then((f) => readFile(f.path), () => undefined);
          if (temp) bytes = new Uint8Array(temp);
          else {
            this.reader ||= new GucClient(await this.signIn(), this.http, this.sleep);
            bytes = (await fetchFile(this.reader, m.url)).bytes;
          }
        }
        const text = await extractText(bytes, name, type);
        this.texts.set(key, text);
        return { ...text, stored };
      })().finally(() => this.reading.delete(key));
      this.reading.set(key, job);
    }
    return { ...(await job), cached: false };
  }

  private tempDir() { return this.host.paths.temp || join(tmpdir(), "clem-guc", this.owner); }
  /** A CMS file to view: the saved copy when there is one, else fetched now into a temp folder (once per file per session).
   *  What save rules keep is saved by checks (desktop/engine/check.ts); anything else is only ever a temp copy. */
  async file(materialId: string): Promise<HubFile & { path: string }> {
    const [m] = await this.db.query<{ title: string; url: string }>("select title, url from guc_materials where owner_id = $1 and material_id = $2", [this.owner, materialId]);
    if (!m?.url) throw new GucError("unavailable", "no such file", "This file is no longer on the CMS.");
    const { name, type } = materialFile(m.url, m.title);
    const [saved] = await this.db.query<{ path: string; size: string; location: "device" | "vps" | "drive" }>("select path, size, location from file_objects where owner_id = $1 and file_id = $2", [this.owner, "guc:" + materialId]);
    if (saved?.location === "device" && await stat(saved.path).then(() => true, () => false)) return { id: materialId, name, type, size: Number(saved.size), stored: true, path: saved.path };
    // Saved on the VPS: its checked bytes into this session's temp folder (the viewer reads a path).
    const elsewhere = saved && saved.location !== "device" && this.stores()[saved.location];
    if (elsewhere) {
      const bytes = await elsewhere.read(saved.path).catch(() => null);
      if (bytes) {
        await mkdir(this.tempDir(), { recursive: true });
        const path = join(this.tempDir(), materialId.replace(/[^\w-]/g, "_") + extname(name));
        await writeFile(path, bytes);
        return { id: materialId, name, type, size: bytes.length, stored: true, path };
      }
    }
    let job = this.temp.get(materialId);
    if (!job) {
      job = (async () => {
        this.reader ||= new GucClient(await this.signIn(), this.http, this.sleep);
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
  /** A CMS file's bytes as base64 (the desktop reads a worker's files this way through the tunnel). */
  async fileBytes(materialId: string) {
    const { path, ...f } = await this.file(materialId);
    return { ...f, data: (await readFile(path)).toString("base64") };
  }
  private async dropTemp() { this.temp.clear(); this.texts.clear(); this.reader = undefined; await rm(this.tempDir(), { recursive: true, force: true }).catch(() => {}); }

  /** Forgets the password and every GUC row of this owner. */
  async disconnect() {
    await Promise.allSettled([this.running, this.light]);
    await this.dropTemp();
    this.version++;
    await this.host.secrets.delete(this.key());
    await this.jobs?.unschedule("guc.sync").catch(() => {});
    for (const s of await this.jobs?.schedules("guc.check").catch(() => []) || []) await this.jobs?.unschedule("guc.check", s.key).catch(() => {});
    await this.db.tx(async (t) => {
      for (const table of GUC_TABLES) await t.query(`delete from ${table} where owner_id = $1`, [this.owner]);
      await t.query("delete from notifications_sent where owner_id = $1 and event_key like 'guc-%'", [this.owner]);
    });
    return this.status();
  }

  async close() {
    await this.catchUp;
    await this.organizer.close()?.catch(() => {});
    await this.telegram.stop();
    for (const { timer } of this.settling.values()) clearTimeout(timer);
    this.settling.clear();
    await Promise.allSettled([this.running, this.light, ...this.checks.values()]);
    await this.jobs?.stop().catch(() => {});
    await this.dropTemp();
    await this.backend.close();
  }
}
