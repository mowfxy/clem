// One owner's VPS connector on the desktop (docs/GUC-VPS-ENGINE.md "VPS"): the connection and its secrets, the
// storage router and the mover, the worker (install, tunnel, heartbeat, hand-over) and the AI's vps.* tools. No
// electron: secrets, the engine and the local Files folder come in, so tests drive it with fakes.
import { randomBytes } from "node:crypto";
import type { Db } from "../db.ts";
import type { Engine } from "../index.ts";
import { DeviceStore, sha256 } from "../storage.ts";
import { desktopRunsOffline, STALE_MS, BEAT_MS } from "../../../core/vps/lease.ts";
import { DEFAULT_CACHE_CAP, MIN_CACHE_CAP, WORKER_PROTOCOL, type StorageMode, type VpsConfig, type VpsStatus, type VpsTest, type WorkerView } from "../../../core/vps/types.ts";
import { leanState, type WsBatch, type WsCursor } from "../../../core/workspace/ops.ts";
import { generateKey, publicOf } from "./keys.ts";
import { DROPPED, SshLink, isDrop, plain, type LinkConfig, type VpsLink } from "./link.ts";
import { installDocker, installWorker, reviveWorker, sendSecret, stopWorker, testServer, WORKER_PORT } from "./install.ts";
import { Migrator } from "./migrate.ts";
import { claudeSignIn, cliSignedIn, codexSignIn, installCli, restartWorker, type ServerCli } from "./cli.ts";
import { StorageRouter, type LocalBlobs } from "./router.ts";
import { VpsStore, vpsRoot } from "./store.ts";
import { WorkerClient } from "./rpc.ts";
import { VpsTools } from "./tools.ts";
import { DiskLimit, sshDisk } from "./limit.ts";

/** Everything kept in the Vault under vps-<owner>: the connection, its key or password, and the worker's secrets. */
export type VpsVault = {
  config?: VpsConfig; privateKey?: string; passphrase?: string; password?: string; allowPassword?: boolean;
  storage?: { mode: StorageMode; cap?: number };
  worker?: { enabled: boolean; kind?: "docker" | "systemd"; key: string; rpc: string; installedAt?: number; /** The app version whose bundle it runs. */ version?: string };
  modelKey?: { provider: "anthropic"; key: string; model?: string };
};
export type Secrets = { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> };
export type ManagerDeps = {
  owner: string; secrets: Secrets; local: LocalBlobs; files: string;
  engine: () => Promise<Engine>;
  /** The worker bundle on this device (desktop-dist/worker). */
  bundle: string; accountService: string;
  /** This app's version: a worker installed by another version is refreshed with this one's bundle. */
  version?: string;
  /** A fresh relay token for the worker (POST /engine/token as the signed-in person). */
  engineToken?: () => Promise<string | undefined>;
  connect?: (c: LinkConfig) => Promise<VpsLink & { fingerprint?: string; firstTime?: boolean }>;
  log?: (m: string) => void;
  changed?: (what: "status" | "migration" | "worker" | "workspace") => void;
  notify?: (n: { key: string; title: string; body: string; open?: object }) => void;
  /** A sign-in window on this PC for a CLI signing in on the server; `landed` hears each address it reaches. */
  openSignIn?: (url: string, landed: (url: string) => void) => () => void;
  /** The AI this PC uses (its signed-in CLI), so the VPS gets the same one. */
  preferredCli?: () => Promise<ServerCli | undefined>;
  /** Tests: the time. */
  clock?: () => number;
};
/** Reconnecting after a failure waits one beat, then two, four, eight, at most ten minutes (any action tries at once). */
export const RETRY_MAX_MS = 10 * 60_000;
/** Beats in a row the worker didn't answer while SSH did, before Clem starts it again (at most once in 10 minutes). */
export const REVIVE_AFTER = 3;
/** What the person reads when the connection drops during the switch and a second try didn't help either. */
export const INSTALL_DROPPED = "The connection to your VPS dropped while Clem was setting it up. Nothing was left half-done: turn it on again and Clem picks up where it stopped.";

export class VpsManager {
  readonly owner: string;
  private d: ManagerDeps;
  private linkJob?: Promise<VpsLink>;
  private routerJob?: Promise<StorageRouter>;
  private migrator?: Migrator;
  private client?: WorkerClient; private tunnel?: { port: number; close(): void };
  private lastWorker = 0; private workerRunner = false; private workerModel: WorkerView["model"] = "none"; private workerError?: string;
  private beat?: ReturnType<typeof setInterval>;
  private lastTest?: VpsTest; private online?: boolean;
  private pushTimer?: ReturnType<typeof setTimeout>;
  readonly tools: VpsTools;
  /** At most 82% of the VPS disk full because of Clem (core/vps/limit.ts): measured with df there, every 5 minutes. */
  readonly limit: DiskLimit;
  constructor(d: ManagerDeps) {
    this.d = d; this.owner = d.owner;
    this.tools = new VpsTools(() => this.link());
    this.limit = new DiskLimit({ measure: sshDisk(() => this.link(), vpsRoot(d.owner)), clock: d.clock });
  }
  private key() { return "vps-" + this.owner; }
  async vault(): Promise<VpsVault> { return (await this.d.secrets.get<VpsVault>(this.key())) || {}; }
  private async save(patch: Partial<VpsVault>) { const v = { ...(await this.vault()), ...patch }; await this.d.secrets.set(this.key(), v); return v; }
  private log(m: string) { this.d.log?.(m); }

  // ---------- Connection ----------
  private linkConfig(v: VpsVault): LinkConfig {
    if (!v.config) throw Error("Set up the VPS first.");
    return { host: v.config.host, port: v.config.port, user: v.config.user, fingerprint: v.config.fingerprint, ...(v.privateKey ? { privateKey: v.privateKey, passphrase: v.passphrase } : {}), ...(v.allowPassword && v.password ? { password: v.password } : {}) };
  }
  private now() { return (this.d.clock || Date.now)(); }
  link(): Promise<VpsLink> {
    // A connection that died (the server closed it, the PC slept) is never handed out again.
    if (this.current?.closed) { this.linkJob = undefined; this.current = undefined; this.tunnel?.close(); this.tunnel = undefined; this.client = undefined; }
    this.linkJob ||= (async () => {
      const c = this.linkConfig(await this.vault());
      const l = await (this.d.connect || SshLink.connect)(c);
      this.online = true; this.current = l;
      return l;
    })().catch((e) => { this.linkJob = undefined; this.online = false; throw e; });
    return this.linkJob;
  }
  private async drop() { const j = this.linkJob; this.linkJob = undefined; this.current = undefined; this.tunnel?.close(); this.tunnel = undefined; this.client = undefined; await j?.then((l) => l.close()).catch(() => {}); }

  /** Host, port and user (and password only with the advanced toggle). A changed host forgets the old fingerprint. */
  async setup(c: { host: string; port: number; user: string; auth: "key" | "password"; password?: string; allowPassword?: boolean }) {
    const v = await this.vault();
    const same = v.config && v.config.host === c.host && v.config.port === c.port;
    if (c.auth === "password" && !c.allowPassword) throw Error("Password sign-in is off. Turn it on under Advanced, or use a key.");
    await this.save({ config: { host: c.host, port: c.port, user: c.user, auth: c.auth, ...(same && v.config?.fingerprint ? { fingerprint: v.config.fingerprint } : {}), ...(v.config?.publicKey ? { publicKey: v.config.publicKey } : {}) }, allowPassword: !!c.allowPassword, ...(c.password ? { password: c.password } : c.auth === "key" ? { password: undefined } : {}) });
    await this.drop();
    return this.status();
  }
  /** A new ed25519 key: the private half stays in the Vault; the window gets only the public line. */
  async generate() {
    const k = generateKey("clem-" + this.owner.slice(0, 8));
    const v = await this.vault();
    await this.save({ privateKey: k.privateKey, passphrase: undefined, config: { ...(v.config || { host: "", port: 22, user: "", auth: "key" }), auth: "key", publicKey: k.publicKey } });
    await this.drop();
    return { publicKey: k.publicKey };
  }
  async pasteKey(privateKey: string, passphrase?: string) {
    const publicKey = publicOf(privateKey, passphrase);
    const v = await this.vault();
    await this.save({ privateKey: privateKey.trim() + "\n", passphrase: passphrase || undefined, config: { ...(v.config || { host: "", port: 22, user: "", auth: "key" }), auth: "key", publicKey } });
    await this.drop();
    return { publicKey };
  }
  /** Test connection: trust on first use stores the fingerprint; a changed one is refused with a plain message. */
  async test(): Promise<VpsTest> {
    await this.drop();
    try {
      const v = await this.vault();
      const l = await this.link() as SshLink;
      const t = await testServer(l);
      if (!v.config?.fingerprint && t.fingerprint) await this.save({ config: { ...v.config!, fingerprint: t.fingerprint } });
      this.lastTest = t;
    } catch (e) {
      this.lastTest = { ok: false, error: (e as Error).message, ...((e as { fingerprint?: string }).fingerprint ? { fingerprint: (e as { fingerprint?: string }).fingerprint } : {}) };
    }
    this.d.changed?.("status");
    return this.lastTest;
  }
  /** Forgets the server, its key, the worker's secrets here and the stored fingerprint. Files on the VPS stay there
   *  (moving them back first is the person's call; Settings asks). */
  async forget() {
    this.stopHeartbeat();
    await this.drop();
    const v = await this.vault();
    if (v.storage?.mode === "vps") throw Error("Move your files back to this device first.");
    await this.d.secrets.delete(this.key());
    this.lastTest = undefined; this.online = undefined;
    await (await this.d.engine()).runner(true);
    return this.status();
  }

  // ---------- Storage ----------
  private store?: VpsStore;
  /** The VPS store while connected (reads and writes fail plainly when the server can't be reached). */
  vpsStore(): VpsStore | undefined {
    if (!this.store) this.store = new VpsStore(() => { if (!this.current) throw Error("Your VPS isn't reachable right now."); return this.current; }, vpsRoot(this.owner), { onExpose: (id, path) => this.adopt(id, path) });
    return this.current ? this.store : undefined;
  }
  /** The live link, for the synchronous store getters (kept fresh by `link()` calls and the heartbeat). */
  private current?: VpsLink;
  async ready() { try { this.current = await this.link(); return true; } catch { this.current = undefined; return false; } }
  private async adopt(fileId: string, path: string) {
    const r = await this.router(), size = await this.current?.size(path) || 0;
    await r.markVps(fileId, path, VpsStore.hashOf(path), size, false);
  }
  async mode(): Promise<StorageMode> { return (await this.vault()).storage?.mode || "device"; }
  private modeNow: StorageMode = "device";
  router(): Promise<StorageRouter> {
    this.routerJob ||= (async () => {
      const v = await this.vault(); this.modeNow = v.storage?.mode || "device";
      const engine = await this.d.engine();
      return new StorageRouter({ db: engine.db as Db, owner: this.owner, local: this.d.local, remote: () => this.vpsStore(), mode: () => this.modeNow, cap: v.storage?.cap || DEFAULT_CACHE_CAP, log: (m) => this.log(m), limit: this.limit }).init();
    })().catch((e) => { this.routerJob = undefined; throw e; });
    return this.routerJob;
  }
  async setCap(bytes: number) {
    const cap = Math.max(MIN_CACHE_CAP, Math.round(bytes));
    const v = await this.vault();
    await this.save({ storage: { mode: v.storage?.mode || "device", cap } });
    (await this.router()).setCap(cap);
    return this.status();
  }
  private async migratorFor() {
    if (!this.migrator) {
      const engine = await this.d.engine();
      this.migrator = new Migrator({ db: engine.db, owner: this.owner, router: await this.router(), local: this.d.local, remote: () => this.vpsStore(), device: new DeviceStore(this.d.files), log: (m) => this.log(m), limit: this.limit,
        onProgress: (m) => { this.d.changed?.("migration"); if (m && ["done", "failed"].includes(m.status)) void this.moved(m.direction, m.done, m.bytesDone, m.failed); } });
    }
    return this.migrator;
  }
  /** "Move everything to my VPS" (up) or "Move back to device" (down). Writes go to the new place from now on. */
  async move(direction: "up" | "down") {
    if (direction === "up" && !(await this.ready())) throw Error("Your VPS isn't reachable right now. Test the connection first.");
    const v = await this.vault();
    this.modeNow = direction === "up" ? "vps" : "device";
    await this.save({ storage: { mode: this.modeNow, cap: v.storage?.cap } });
    const m = await this.migratorFor();
    const view = await m.start(direction);
    this.d.changed?.("migration");
    return view;
  }
  /** Stops moving. Files already moved stay where they were checked; the rest stay where they are. */
  async abortMove() {
    const m = await this.migratorFor(), view = await m.view();
    if (view?.direction === "up") { const v = await this.vault(); this.modeNow = "device"; await this.save({ storage: { mode: "device", cap: v.storage?.cap } }); }
    return m.abort();
  }
  /** After a restart: carry on a move that was running or paused. */
  async resumeMove() { if (!(await this.vault()).config) return; if (await this.ready()) await (await this.migratorFor()).resume(); }
  async pin(id: string, on: boolean) { return (await this.router()).pin(id, on); }
  private async moved(direction: "up" | "down", files: number, bytes: number, failed: number) {
    const engine = await this.d.engine();
    await engine.organizer.announce("```clem-card\n" + JSON.stringify({ type: "vps_moved", direction, files, bytes, ...(failed ? { failed } : {}) }) + "\n```", `vps-moved:${direction}:${Date.now()}`).catch(() => {});
  }

  // ---------- Worker ----------
  /** "Run Clem's background jobs on my VPS": install or refresh the worker, send its secrets sealed, start the
   *  heartbeat. The desktop keeps running jobs until the worker's first beat takes the lease. */
  async enableWorker(progress?: (label: string) => void) {
    // One switch does it all: Docker first when the server can take it (else systemd with Node, as before)…
    const installed = await installDocker(await this.link(), progress).catch((e) => { this.log("[vps] docker: " + (e as Error).message); return false; });
    if (installed) await this.drop(); // the docker group counts only on a new SSH session
    await this.retryDropped(() => this.install(progress));
    // Its database starts empty: subject links and settings, the organizer's settings, watches and mutes follow.
    await this.handover().catch((e) => this.log("[vps] handover: " + (e as Error).message));
    this.startHeartbeat();
    await this.pushWorkspace(true);
    // …then the same AI as this PC, installed and signed in on the server (one sign-in window, once).
    const v = await this.vault();
    if (!v.modelKey && this.workerModel !== "cli") await this.connectCli((await this.d.preferredCli?.().catch(() => undefined)) || "claude").catch((e) => this.log("[vps] ai: " + (e as Error).message));
    return this.status();
  }
  /** Uploads this app's worker bundle with the worker's key and secrets, and starts it (its database is kept). */
  private async install(progress?: (label: string) => void) {
    const v = await this.vault();
    const l = await this.link();
    const key = v.worker?.key || randomBytes(32).toString("base64"), rpc = v.worker?.rpc || randomBytes(32).toString("hex");
    const engineToken = await this.d.engineToken?.().catch(() => undefined);
    const guc = await this.d.secrets.get("guc-" + this.owner);
    const secrets: Record<string, unknown> = { rpc, ...(guc ? { ["guc-" + this.owner]: guc } : {}), ...(engineToken ? { "engine-token": engineToken } : {}), ...(v.modelKey ? { model: v.modelKey } : {}) };
    const r = await installWorker({ link: l, owner: this.owner, bundle: this.d.bundle, key: Buffer.from(key, "base64"), secrets, accountService: this.d.accountService, publicHost: v.config?.host, progress, ...(v.config ? { hostAccess: { user: v.config.user, port: v.config.port, ...(v.config.fingerprint ? { fingerprint: v.config.fingerprint } : {}) } } : {}) });
    await this.save({ worker: { enabled: true, kind: r.kind, key, rpc, installedAt: Date.now(), ...(this.d.version ? { version: this.d.version } : {}) } });
  }
  /** A step over SSH that the connection dropping in the middle of shouldn't break: tried again once on a fresh
   *  connection (every step of the install can run twice), then one plain sentence. */
  private async retryDropped<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) {
      if (!isDrop(e) && !this.current?.closed) throw Error(plain(e));
      this.log("[vps] connection dropped; trying once more");
      await this.drop();
      try { return await fn(); } catch (e2) { throw Error(isDrop(e2) || this.current?.closed ? INSTALL_DROPPED : plain(e2)); }
    }
  }
  private refreshing?: Promise<void>; private refreshFailed = 0;
  /** After an app update the worker on the VPS still runs the old version's code (its GUC reading, its jobs), and a
   *  worker whose health names another protocol than this desktop's (WORKER_PROTOCOL) may not understand it: either
   *  is refreshed with this version's bundle once, in the background, keeping its database. The desktop keeps the
   *  lease meanwhile as usual (an unreachable worker is covered by desktopRunsOffline). A failed refresh waits 30 minutes. */
  refreshWorker(force = false) {
    if (!this.refreshing && this.now() - this.refreshFailed < 30 * 60_000) return Promise.resolve();
    this.refreshing ||= (async () => {
      const v = await this.vault();
      if (!v.worker?.enabled) return;
      if (!force && (!this.d.version || v.worker.version === this.d.version)) return;
      this.log("[vps] refreshing the worker" + (this.d.version ? " to " + this.d.version : ""));
      await this.retryDropped(() => this.install());
      this.client = undefined; this.tunnel?.close(); this.tunnel = undefined;
      await this.pushWorkspace(true);
    })().then(() => { this.refreshing = undefined; }, (e) => { this.log("[vps] worker refresh: " + (e as Error).message); this.refreshing = undefined; this.refreshFailed = this.now(); });
    return this.refreshing;
  }
  async disableWorker() {
    const v = await this.vault();
    if (v.worker?.kind) await stopWorker(await this.link(), this.owner, v.worker.kind).catch((e) => this.log("[vps] stop worker: " + (e as Error).message));
    await this.save({ worker: v.worker ? { ...v.worker, enabled: false } : undefined });
    this.stopHeartbeat(); this.tunnel?.close(); this.tunnel = undefined; this.client = undefined;
    this.workerRunner = false;
    await (await this.d.engine()).runner(true);
    return this.status();
  }
  /** A changed secret (a new GUC password; GUC disconnected) for an installed worker. */
  async secretChanged(name: string, value: unknown) {
    const v = await this.vault();
    if (!v.worker?.enabled) return;
    await sendSecret(await this.link(), this.owner, Buffer.from(v.worker.key, "base64"), name, value);
  }
  // ---------- AI on the VPS ----------
  private signIn?: NonNullable<WorkerView["signIn"]>; private pasteCode?: (code: string) => void;
  /** "Use Claude / ChatGPT on my VPS": installs the CLI inside the worker, signs it in there with the person's own
   *  account (a window on this PC for Claude, a device code for Codex), then restarts the worker so it uses it.
   *  Returns at once; progress is in `status().worker.signIn`. */
  async connectCli(cli: ServerCli) {
    const v = await this.vault();
    if (!v.worker?.enabled || !v.worker.kind) throw Error("Turn on background jobs on your VPS first.");
    if (this.signIn && ["installing", "waiting", "finishing"].includes(this.signIn.step)) return this.status();
    const kind = v.worker.kind, owner = this.owner;
    const step = (s: NonNullable<WorkerView["signIn"]>) => { this.signIn = s; this.d.changed?.("worker"); };
    step({ cli, step: "installing" });
    void (async () => {
      const l = await this.link();
      await installCli(l, kind, owner, cli);
      if (!(await cliSignedIn(l, kind, owner, cli))) {
        let done: Promise<boolean>;
        if (cli === "codex") { const c = await codexSignIn(l, kind, owner); step({ cli, step: "waiting", url: c.url, code: c.code }); done = c.done; }
        else {
          if (!this.d.openSignIn) throw Error("Sign-in windows need the Clem desktop app.");
          const c = await claudeSignIn(l, kind, owner, this.d.openSignIn);
          this.pasteCode = c.paste; step({ cli, step: "waiting", url: c.url }); done = c.done;
        }
        const ok = await done; this.pasteCode = undefined;
        if (!ok || !(await cliSignedIn(l, kind, owner, cli))) throw Error("The sign-in on your VPS didn't finish. Try again.");
      }
      step({ cli, step: "finishing" });
      await restartWorker(l, kind, owner);
      this.client = undefined; this.tunnel?.close(); this.tunnel = undefined;
      // It answers again within seconds; the next heartbeat reads its model.
      for (let i = 0; i < 12 && this.workerModel !== "cli"; i++) { await new Promise((r) => setTimeout(r, 5000)); await this.heartbeat().catch(() => {}); }
      this.signIn = undefined; this.d.changed?.("worker");
    })().catch((e) => { this.pasteCode = undefined; step({ cli, step: "failed", error: (e as Error).message }); });
    return this.status();
  }
  /** A code the person copied from Claude's page, if the window didn't hand it over by itself. */
  pasteCliCode(code: string) { if (!this.pasteCode) throw Error("No sign-in is waiting for a code."); this.pasteCode(code); return { ok: true }; }

  async setModelKey(k?: { key: string; model?: string }) { await this.save({ modelKey: k?.key ? { provider: "anthropic", key: k.key.trim(), ...(k.model ? { model: k.model } : {}) } : undefined }); await this.secretChanged("model", k?.key ? (await this.vault()).modelKey : undefined); return this.status(); }

  private async worker(): Promise<WorkerClient> {
    if (this.client) return this.client;
    const v = await this.vault();
    if (!v.worker?.enabled) throw Error("The worker is off.");
    this.tunnel ||= await (await this.link()).tunnel(WORKER_PORT);
    this.client = new WorkerClient(`http://127.0.0.1:${this.tunnel.port}`, v.worker.rpc);
    return this.client;
  }
  /** The worker's engine, while it is the one running jobs (the window's requests go there). */
  async remote(): Promise<WorkerClient | undefined> {
    if (!this.workerRunner || this.now() - this.lastWorker > STALE_MS) return undefined;
    return this.worker().catch(() => undefined);
  }
  private beating?: Promise<void>; private lastBeat = 0; private awakeSince = 0; private failures = 0; private retryAt = 0; private workerDown = 0; private revivedAt = 0;
  /** One beat: step the lease on the worker; this engine runs jobs only when the lease says so, or when the worker
   *  has been unreachable for longer than STALE_MS. Pulls the worker's notices; Telegram stays here without its model.
   *  Beats never overlap; after a failure the next tries back off (RETRY_MAX_MS); the first beat after the PC slept
   *  reconnects before deciding anything, so a laptop that wakes never runs jobs the worker is already running. */
  heartbeat() { return (this.beating ||= this.beatOnce().finally(() => { this.beating = undefined; })); }
  private async beatOnce() {
    const engine = await this.d.engine(), now = this.now();
    const slept = this.lastBeat > 0 && now - this.lastBeat > 3 * BEAT_MS;
    this.lastBeat = now;
    // Time asleep doesn't count as the worker being out of reach: only time awake without reaching it does.
    if (slept) { this.log("[vps] back after a pause: reconnecting"); this.retryAt = 0; this.awakeSince = now; await this.drop(); }
    let desktopRuns: boolean;
    try {
      if (now < this.retryAt) throw Error(this.workerError || DROPPED);
      const { c, health } = await this.connected();
      const { lease, run } = await c.lease();
      this.lastWorker = lease.seen.worker || 0;
      this.workerRunner = lease.holder === "worker";
      this.workerModel = (health.model as WorkerView["model"]) || "none";
      this.workerError = undefined; this.failures = 0; this.retryAt = 0; this.workerDown = 0;
      // What the worker couldn't keep on the VPS past the limit, waiting for this PC (shown with the storage).
      if (Array.isArray(health.waiting)) void this.router().then((r) => { r.waiting = (health.waiting as unknown[]).map(String).slice(0, 5); }).catch(() => {});
      // Deletes made while the VPS was out of reach are applied now, once, never on bytes the worker uses again.
      void this.sweepDeletes(c).catch((e) => this.log("[vps] deletes: " + (e as Error).message));
      // The person's standing answer is "send them to my PC": CMS files the worker skipped at the limit are fetched here.
      if (health.fullAnswer === "send" && Number(health.waitingCms) > 0) void this.fetchWaiting(c).catch((e) => this.log("[vps] waiting: " + (e as Error).message));
      // A worker with another protocol than this desktop's is brought up to date (it keeps its database).
      if (health.version !== WORKER_PROTOCOL) void this.refreshWorker(true);
      // The worker changed the workspace (Telegram, a sweep, a routine) since this PC last pulled: the window pulls.
      const head = health.ws as { id: string; seq: number } | null | undefined;
      if (head && (head.seq > this.pulled || head.id !== this.wsHead?.id)) { this.wsHead = head; this.d.changed?.("workspace"); }
      // Reached again after a while (the laptop woke): the worker gets this PC's workspace first.
      if (Date.now() - this.pushedAt > 10 * 60_000) void this.pushWorkspace(true);
      desktopRuns = run;
      for (const n of await c.notices().catch(() => [])) this.d.notify?.(n);
    } catch (e) {
      this.client = undefined; this.tunnel?.close(); this.tunnel = undefined;
      this.workerError = (e as Error).message;
      if (now >= this.retryAt) { this.failures++; this.retryAt = now + Math.min(RETRY_MAX_MS, BEAT_MS * 2 ** (this.failures - 1)) - 1000; }
      // Just woke and still can't reach it: decide on the next beat, not on a connection the sleep broke.
      desktopRuns = slept ? engine.isRunner : desktopRunsOffline(Math.max(this.lastWorker, this.awakeSince), now);
      if (desktopRuns) this.workerRunner = false;
    }
    await engine.runner(desktopRuns);
    if (!desktopRuns && this.workerModel === "none") engine.telegram.start();
    this.d.changed?.("worker");
  }
  /** The worker's client through a live connection. SSH answering while the worker doesn't, beat after beat, means
   *  the worker is down (stopped, crashed, hung): Clem starts it again, at most once in ten minutes. */
  private async connected(): Promise<{ c: WorkerClient; health: Record<string, unknown> }> {
    const l = await this.link();
    try {
      const c = await this.worker();
      return { c, health: await c.health() };
    } catch (e) {
      const unreachable = (e as { unreachable?: boolean }).unreachable || /Not allowed|refused|isn't answering|didn't answer/i.test((e as Error).message);
      if (!unreachable || l.closed) throw e;
      this.workerDown++;
      const v = await this.vault();
      if (this.workerDown >= REVIVE_AFTER && v.worker?.kind && this.now() - this.revivedAt > 10 * 60_000) {
        this.revivedAt = this.now();
        this.log("[vps] the worker isn't answering; starting it again");
        await reviveWorker(l, this.owner, v.worker.kind).catch((err) => this.log("[vps] revive: " + (err as Error).message));
        this.client = undefined; this.tunnel?.close(); this.tunnel = undefined;
      }
      throw e;
    }
  }
  startHeartbeat() { if (this.beat) return; void this.refreshWorker(); void this.heartbeat(); this.beat = setInterval(() => void this.heartbeat(), BEAT_MS); this.beat.unref?.(); }
  /** The PC woke from sleep or came back online (main hears powerMonitor): beat now instead of within the minute. */
  wake() { if (this.beat) { this.lastBeat = 1; void this.heartbeat(); } }
  stopHeartbeat() { if (this.beat) clearInterval(this.beat); this.beat = undefined; }
  /** The workspace the worker's agent and organizer work on (core/workspace/ops.ts leanState: chats cut to their
   *  latest messages, files as metadata with where their bytes are on the VPS), sent when it changes (at most every
   *  20 s) and when the worker is reached again. The worker keeps its own changes the desktop hasn't saved on top. */
  async pushWorkspace(now = false, state?: unknown) {
    if (!(await this.vault()).worker?.enabled) return;
    const send = async () => {
      this.pushTimer = undefined;
      try {
        const lean = leanState(state ?? await this.workspaceState?.());
        await (await this.worker()).pushWorkspace({ ...lean, files: await this.withBlobs(lean.files) });
        this.pushedAt = Date.now();
      } catch (e) { this.log("[vps] workspace push: " + (e as Error).message); }
    };
    if (now) return send();
    if (!this.pushTimer) { this.pushTimer = setTimeout(() => void send(), 20_000); this.pushTimer.unref?.(); }
  }
  private pushedAt = 0;
  /** Each file with where its bytes are on the VPS (content-addressed: the worker reads the same name on its disk). */
  private async withBlobs(files: { id: string }[]) {
    const engine = await this.d.engine();
    const rows = await engine.db.query<{ file_id: string; path: string; size: string; sha256: string }>("select file_id, path, size, sha256 from file_objects where owner_id = $1 and location = 'vps' and (file_id like 'ws:%' or file_id like 'guc:%')", [this.owner]);
    const at = new Map(rows.map((r) => [r.file_id, r]));
    return files.map((f) => {
      const r = at.get(f.id.startsWith("guc_") ? "guc:" + f.id.slice(4) : "ws:" + f.id);
      if (!r) return f;
      const ext = (r.path.split("/").pop() || "").split(".")[1] || "";
      return { ...f, blob: { sha256: r.sha256, ext, size: Number(r.size) } };
    });
  }
  /** Deletes the PC made while the VPS was out of reach (router vps_deletes), applied now: bytes the worker's copy
   *  uses again (the same content re-added) are left. */
  private async sweepDeletes(c: WorkerClient) {
    const r = await this.router();
    const [pending] = await (await this.d.engine()).db.query<{ n: number }>("select count(*)::int as n from vps_deletes where owner_id = $1", [this.owner]);
    if (!pending?.n) return 0;
    const used = new Set(await c.call<string[]>("worker.blobs").catch(() => null) || []);
    return r.sweepDeletes((path) => used.has((path.split("/").pop() || "").split(".")[0]));
  }
  /** vps.waiting from the window's AI: what waits past the storage limit, and (with `send`) the standing answer. */
  async waiting(send?: boolean) {
    const w = await (await this.worker()).call<{ answer: "send" | "keep" | null; items: { item: string; name: string; bytes: number }[] }>("worker.waiting", send === undefined ? [] : [send]);
    if (send) void this.worker().then((c) => this.fetchWaiting(c)).catch(() => {});
    return w;
  }
  /** CMS files the worker couldn't keep past the limit, fetched by this PC (through the worker, from the CMS) and kept in
   *  its own Files, once the person said to send waiting files to the PC. */
  private fetching?: Promise<void>;
  private fetchWaiting(c: WorkerClient) {
    return (this.fetching ||= (async () => {
      const w = await c.call<{ answer: string | null; items: { item: string; name: string }[] }>("worker.waiting");
      if (w.answer !== "send") return;
      const engine = await this.d.engine(), store = new DeviceStore(this.d.files), done: { item: string; path: string; sha256: string; size: number }[] = [];
      for (const it of w.items.filter((i) => i.item.startsWith("cms:")).slice(0, 25)) {
        const id = it.item.slice(4);
        try {
          const f = await c.call<{ data: string; name: string; type: string }>("fileBytes", [id]);
          const bytes = new Uint8Array(Buffer.from(f.data, "base64")), hash = sha256(bytes), ext = /\.([a-z0-9]{1,5})$/i.exec(f.name)?.[1]?.toLowerCase() || "";
          const path = await store.put(hash, ext, bytes);
          await engine.db.query("insert into file_objects (owner_id, file_id, location, path, sha256, size, material_id, name, mime, saved_at) values ($1, $2, 'device', $3, $4, $5, $6, $7, $8, now()) on conflict (owner_id, file_id) do update set location = 'device', path = excluded.path, sha256 = excluded.sha256, size = excluded.size", [this.owner, "guc:" + id, path, hash, bytes.length, id, f.name, f.type]);
          done.push({ item: it.item, path, sha256: hash, size: bytes.length });
        } catch (e) { this.log("[vps] waiting: " + (e as Error).message); }
      }
      if (done.length) await c.call("worker.waitingDone", [done]);
    })().finally(() => { this.fetching = undefined; }));
  }
  /** vps.keep from the window's AI: where one file is kept (router.keepOn). */
  async keep(fileId: string, where: "pc" | "vps" | "auto") { return (await this.router()).keepOn(fileId, where === "auto" ? undefined : where); }

  /** What the worker changed in the workspace since `cursor` (the window's own `State.vpsSync`): files it made are
   *  known to this PC's router as files on the VPS before the window sees them. Null without a worker copy. */
  async pullOps(cursor?: WsCursor | null): Promise<WsBatch | null> {
    const v = await this.vault();
    if (!v.worker?.enabled) return null;
    const batch = await (await this.worker()).ops(cursor);
    if (!batch) return null;
    const r = await this.router(), keeps: [string, "pc" | "vps" | undefined][] = [];
    for (const op of batch.ops) {
      // A file the AI deleted on the VPS is deleted here too: its bytes, its row and its cache entry (once: the cursor).
      if (op.t === "del" && op.kind === "file") { await r.deleteFile(op.id).catch((e) => this.log("[vps] pull: " + (e as Error).message)); continue; }
      // Where the person said it's kept (vps.keep on the VPS): this PC moves it.
      if (op.t === "put" && op.kind === "file" && typeof op.item.keep === "string") keeps.push([String(op.item.id), op.item.keep === "pc" || op.item.keep === "vps" ? op.item.keep : undefined]);
      // A file the worker couldn't keep on the VPS past its storage limit came with its bytes: kept on this PC now.
      if (op.t === "put" && op.kind === "file" && typeof op.item.inline === "string") {
        const { inline, blob: _b, ...file } = op.item as { id: string; inline: string; blob?: unknown };
        await r.writeFile(file.id, new Uint8Array(Buffer.from(inline, "base64"))).catch((e) => this.log("[vps] pull: " + (e as Error).message));
        (op as { item: unknown }).item = file;
        continue;
      }
      if (op.t !== "put" || op.kind !== "file" || !op.item.blob) continue;
      const { blob, ...file } = op.item as { id: string; blob: { sha256: string; ext: string; size: number } };
      const store = this.vpsStore();
      if (!/^[a-f0-9]{64}$/.test(blob.sha256)) continue;
      const path = store ? store.pathOf(blob.sha256, blob.ext) : `${vpsRoot(this.owner)}/${blob.sha256}${blob.ext ? "." + blob.ext : ""}`;
      if (!file.id.startsWith("guc_")) await r.markVps(file.id, path, blob.sha256, blob.size, false).catch((e) => this.log("[vps] pull: " + (e as Error).message));
      (op as { item: unknown }).item = file;
    }
    // After the files are known where they are: the person's word on where each is kept is carried out.
    for (const [id, where] of keeps) await r.keepOn(id, where).catch((e) => this.log("[vps] keep: " + (e as Error).message));
    this.pulled = Math.max(this.pulled, batch.last);
    return batch;
  }
  private pulled = 0; private wsHead?: { id: string; seq: number };
  /** The worker runs Clem's jobs (and the person's routines) right now: the window leaves them to it. */
  workerRuns() { return this.workerRunner && Date.now() - this.lastWorker <= STALE_MS; }
  /** The saved workspace (main sets this to the window's state.json reader). */
  workspaceState?: () => Promise<unknown>;
  /** Copies what the worker's empty database needs from this engine's. */
  private async handover() {
    const engine = await this.d.engine(), c = await this.worker();
    for (const l of await engine.links()) {
      const view = await engine.subject(l.subjectId);
      await c.call("link", [l.subjectId, l.courseKey]).catch(() => {});
      await c.call("setSettings", [l.subjectId, { save: view.settings.save, check: view.settings.check, drive: view.settings.drive, storage: view.settings.storage }]).catch(() => {});
    }
    await c.call("organizer.setSettings", [await engine.organizer.settings()]).catch(() => {});
  }

  async status(): Promise<VpsStatus> {
    const v = await this.vault();
    const none = { mode: v.storage?.mode || "device" as const, device: 0, vps: 0, cache: 0, cap: v.storage?.cap || DEFAULT_CACHE_CAP, pinned: 0, files: { device: 0, vps: 0 } };
    // The disk is measured (again every 5 minutes) while the VPS answers; Settings shows Clem's share of it.
    if (v.config && this.current && !this.current.closed) await this.limit.size().catch(() => undefined);
    const storage = v.config ? await this.router().then((r) => r.usage(), () => none) : none;
    const migration = v.config ? await this.migratorFor().then((m) => m.view(), () => undefined) : undefined;
    const worker: WorkerView = { enabled: !!v.worker?.enabled, installed: !!v.worker?.installedAt, ...(v.worker?.kind ? { kind: v.worker.kind } : {}), runner: !v.worker?.enabled ? "desktop" : this.lastWorker ? (this.workerRunner ? "worker" : "desktop") : "unknown", ...(this.lastWorker ? { heartbeat: this.lastWorker } : {}), model: v.modelKey ? "api" : this.workerModel, ...(this.workerError && v.worker?.enabled ? { error: this.workerError } : {}), ...(this.signIn && v.worker?.enabled ? { signIn: this.signIn } : {}) };
    return { connected: !!v.config?.host && !!(v.privateKey || v.password), ...(v.config ? { config: v.config } : {}), ...(this.online !== undefined ? { online: this.online } : {}), ...(this.lastTest ? { lastTest: this.lastTest } : {}), storage, ...(migration ? { migration } : {}), worker, passwordAllowed: !!v.allowPassword };
  }
  async close() { this.stopHeartbeat(); if (this.pushTimer) clearTimeout(this.pushTimer); await this.migrator?.abort().catch(() => {}); await this.drop(); }
}
