// One owner's VPS connector on the desktop (docs/GUC-VPS-ENGINE.md "VPS"): the connection and its secrets, the
// storage router and the mover, the worker (install, tunnel, heartbeat, hand-over) and the AI's vps.* tools. No
// electron: secrets, the engine and the local Files folder come in, so tests drive it with fakes.
import { randomBytes } from "node:crypto";
import type { Db } from "../db.ts";
import type { Engine } from "../index.ts";
import { DeviceStore } from "../storage.ts";
import { desktopRunsOffline, STALE_MS, BEAT_MS } from "../../../core/vps/lease.ts";
import { DEFAULT_CACHE_CAP, MIN_CACHE_CAP, type StorageMode, type VpsConfig, type VpsStatus, type VpsTest, type WorkerView } from "../../../core/vps/types.ts";
import { snapshotOf } from "../../../core/proactivity/snapshot.ts";
import { generateKey, publicOf } from "./keys.ts";
import { SshLink, type LinkConfig, type VpsLink } from "./link.ts";
import { installWorker, sendSecret, stopWorker, testServer, WORKER_PORT } from "./install.ts";
import { Migrator } from "./migrate.ts";
import { StorageRouter, type LocalBlobs } from "./router.ts";
import { VpsStore, vpsRoot } from "./store.ts";
import { WorkerClient } from "./rpc.ts";
import { VpsTools } from "./tools.ts";

/** Everything kept in the Vault under vps-<owner>: the connection, its key or password, and the worker's secrets. */
export type VpsVault = {
  config?: VpsConfig; privateKey?: string; passphrase?: string; password?: string; allowPassword?: boolean;
  storage?: { mode: StorageMode; cap?: number };
  worker?: { enabled: boolean; kind?: "docker" | "systemd"; key: string; rpc: string; installedAt?: number };
  modelKey?: { provider: "anthropic"; key: string; model?: string };
};
export type Secrets = { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> };
export type ManagerDeps = {
  owner: string; secrets: Secrets; local: LocalBlobs; files: string;
  engine: () => Promise<Engine>;
  /** The worker bundle on this device (desktop-dist/worker). */
  bundle: string; accountService: string;
  /** A fresh relay token for the worker (POST /engine/token as the signed-in person). */
  engineToken?: () => Promise<string | undefined>;
  connect?: (c: LinkConfig) => Promise<VpsLink & { fingerprint?: string; firstTime?: boolean }>;
  log?: (m: string) => void;
  changed?: (what: "status" | "migration" | "worker") => void;
  notify?: (n: { key: string; title: string; body: string; open?: object }) => void;
};

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
  constructor(d: ManagerDeps) {
    this.d = d; this.owner = d.owner;
    this.tools = new VpsTools(() => this.link());
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
  link(): Promise<VpsLink> {
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
      return new StorageRouter({ db: engine.db as Db, owner: this.owner, local: this.d.local, remote: () => this.vpsStore(), mode: () => this.modeNow, cap: v.storage?.cap || DEFAULT_CACHE_CAP, log: (m) => this.log(m) }).init();
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
      this.migrator = new Migrator({ db: engine.db, owner: this.owner, router: await this.router(), local: this.d.local, remote: () => this.vpsStore(), device: new DeviceStore(this.d.files), log: (m) => this.log(m),
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
    const v = await this.vault();
    const l = await this.link();
    const key = v.worker?.key || randomBytes(32).toString("base64"), rpc = v.worker?.rpc || randomBytes(32).toString("hex");
    const engineToken = await this.d.engineToken?.().catch(() => undefined);
    const guc = await this.d.secrets.get("guc-" + this.owner);
    const secrets: Record<string, unknown> = { rpc, ...(guc ? { ["guc-" + this.owner]: guc } : {}), ...(engineToken ? { "engine-token": engineToken } : {}), ...(v.modelKey ? { model: v.modelKey } : {}) };
    const r = await installWorker({ link: l, owner: this.owner, bundle: this.d.bundle, key: Buffer.from(key, "base64"), secrets, accountService: this.d.accountService, progress });
    await this.save({ worker: { enabled: true, kind: r.kind, key, rpc, installedAt: Date.now() } });
    // Its database starts empty: subject links and settings, the organizer's settings, watches and mutes follow.
    await this.handover().catch((e) => this.log("[vps] handover: " + (e as Error).message));
    this.startHeartbeat();
    await this.pushWorkspace(true);
    return this.status();
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
    if (!this.workerRunner || Date.now() - this.lastWorker > STALE_MS) return undefined;
    return this.worker().catch(() => undefined);
  }
  /** One beat: step the lease on the worker; this engine runs jobs only when the lease says so, or when the worker
   *  has been unreachable for longer than STALE_MS. Pulls the worker's notices; Telegram stays here without its model. */
  async heartbeat() {
    const engine = await this.d.engine();
    let desktopRuns: boolean;
    try {
      const c = await this.worker();
      const [{ lease, run }, health] = await Promise.all([c.lease(), c.health()]);
      this.lastWorker = lease.seen.worker || 0;
      this.workerRunner = lease.holder === "worker";
      this.workerModel = (health.model as WorkerView["model"]) || "none";
      this.workerError = undefined;
      desktopRuns = run;
      for (const n of await c.notices().catch(() => [])) this.d.notify?.(n);
    } catch (e) {
      this.client = undefined; this.tunnel?.close(); this.tunnel = undefined; this.linkJob = undefined;
      this.workerError = (e as Error).message;
      desktopRuns = desktopRunsOffline(this.lastWorker, Date.now());
      if (desktopRuns) this.workerRunner = false;
    }
    await engine.runner(desktopRuns);
    if (!desktopRuns && this.workerModel === "none") engine.telegram.start();
    this.d.changed?.("worker");
  }
  startHeartbeat() { if (this.beat) return; void this.heartbeat(); this.beat = setInterval(() => void this.heartbeat(), BEAT_MS); this.beat.unref?.(); }
  stopHeartbeat() { if (this.beat) clearInterval(this.beat); this.beat = undefined; }
  /** The compact workspace snapshot the organizer reads, sent when the workspace changes (at most every 20 s). */
  async pushWorkspace(now = false, state?: unknown) {
    if (!(await this.vault()).worker?.enabled) return;
    const send = async () => {
      this.pushTimer = undefined;
      try { await (await this.worker()).pushWorkspace({ __snapshot: true, ...snapshotOf(state ?? await this.workspaceState?.(), Date.now()) }); }
      catch (e) { this.log("[vps] workspace push: " + (e as Error).message); }
    };
    if (now) return send();
    if (!this.pushTimer) { this.pushTimer = setTimeout(() => void send(), 20_000); this.pushTimer.unref?.(); }
  }
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
    const storage = v.config ? await this.router().then((r) => r.usage(), () => none) : none;
    const migration = v.config ? await this.migratorFor().then((m) => m.view(), () => undefined) : undefined;
    const worker: WorkerView = { enabled: !!v.worker?.enabled, installed: !!v.worker?.installedAt, ...(v.worker?.kind ? { kind: v.worker.kind } : {}), runner: !v.worker?.enabled ? "desktop" : this.lastWorker ? (this.workerRunner ? "worker" : "desktop") : "unknown", ...(this.lastWorker ? { heartbeat: this.lastWorker } : {}), model: v.modelKey ? "api" : this.workerModel, ...(this.workerError && v.worker?.enabled ? { error: this.workerError } : {}) };
    return { connected: !!v.config?.host && !!(v.privateKey || v.password), ...(v.config ? { config: v.config } : {}), ...(this.online !== undefined ? { online: this.online } : {}), ...(this.lastTest ? { lastTest: this.lastTest } : {}), storage, ...(migration ? { migration } : {}), worker, passwordAllowed: !!v.allowPassword };
  }
  async close() { this.stopHeartbeat(); if (this.pushTimer) clearTimeout(this.pushTimer); await this.migrator?.abort().catch(() => {}); await this.drop(); }
}
