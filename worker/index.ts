// Clem's background worker on the person's VPS (docs/GUC-VPS-ENGINE.md "Background worker"): the same engine as the
// desktop, headless. Postgres when DATABASE_URL is set (Docker), else PGlite under CLEM_DATA (systemd with Node).
// Secrets come from an AES-256-GCM store under a key file the desktop wrote at install; none is ever logged.
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BEAT_MS, step, type Lease } from "../core/vps/lease.ts";
import { openPglite, openPostgres, type Backend } from "../desktop/engine/db.ts";
import type { EngineHost } from "../desktop/engine/host.ts";
import { Engine } from "../desktop/engine/index.ts";
import { DeviceStore } from "../desktop/engine/storage.ts";
import { apiComplete, cliComplete, type Complete, type ModelKey } from "../desktop/engine/vps/headless.ts";
import { PENDING_SENDS, WorkerAgent, type PendingSend } from "../desktop/engine/vps/agent.ts";
import { LocalLink } from "../desktop/engine/vps/local-link.ts";
import { SshLink, type VpsLink } from "../desktop/engine/vps/link.ts";
import { VpsTools } from "../desktop/engine/vps/tools.ts";
import { WorkerWorkspace, type WsState } from "../desktop/engine/vps/workspace.ts";
import { WorkerState } from "../desktop/engine/vps/state.ts";
import { FullNotice } from "../desktop/engine/vps/full.ts";
import { roomOn } from "../core/vps/limit.ts";
import { DiskLimit, LimitedStore, Waiting, localDisk } from "../desktop/engine/vps/limit.ts";
import type { DiskSize } from "../core/vps/limit.ts";
import { callPath, serveWorker } from "../desktop/engine/vps/rpc.ts";
import { FileSecrets } from "../desktop/engine/vps/secrets.ts";
import { serveHooks } from "../desktop/engine/hooks.ts";
import { WORKER_PROTOCOL } from "../core/vps/types.ts";
import { StudyReminders } from "../desktop/study-reminders.ts";

/** The endpoint and behaviour this bundle has (core/vps/types.ts WORKER_PROTOCOL): a desktop expecting another refreshes it. */
export const WORKER_VERSION = WORKER_PROTOCOL;
const here = typeof __filename === "string" ? dirname(__filename) : process.cwd();
type Config = { owner: string; accountService: string; publicHost?: string };

export async function startWorker(o: { config?: Config; key?: Uint8Array; env?: NodeJS.ProcessEnv; migrations?: string; backend?: Backend; beat?: number; /** Tests: the model. */ complete?: Complete; clock?: () => number; /** Tests: the disk's size. */ disk?: () => Promise<DiskSize> } = {}) {
  const env = o.env || process.env;
  const config: Config = o.config || JSON.parse(readFileSync(join(process.cwd(), "config.json"), "utf8"));
  if (!/^[\w-]{1,100}$/.test(config.owner)) throw Error("Invalid owner in config.json");
  const data = env.CLEM_DATA || join(process.cwd(), "state"), files = env.CLEM_FILES || join(data, "..", "..", "files");
  const key = o.key || Buffer.from(readFileSync(env.CLEM_KEY_FILE || join(process.cwd(), ".key"), "utf8").trim(), "base64");
  const secrets = new FileSecrets(join(data, "secrets"), key);
  const token = await secrets.get<string>("rpc");
  if (!token) throw Error("No RPC token: install the worker from Clem's Settings → Connectors → VPS.");
  await mkdir(data, { recursive: true });
  const log = (level: "info" | "warn" | "error", m: string) => console[level === "info" ? "log" : level](new Date().toISOString(), m);

  // The model: an API key typed for the worker, else a CLI signed in on this server, else rules only.
  const modelKey = o.complete ? undefined : await secrets.get<ModelKey>("model");
  const cli = modelKey || o.complete ? undefined : await cliComplete({ data });
  const complete: Complete | undefined = o.complete || (modelKey ? apiComplete(modelKey) : cli?.complete);
  const model = modelKey ? "api" : cli || o.complete ? "cli" : "none";
  log("info", `[worker] model: ${model}${cli ? " (" + cli.name + ")" : ""}`);

  const notices: { key: string; title: string; body: string; open?: object }[] = [];
  const hookPort = Number(env.CLEM_HOOK_PORT || 7718);
  // At most 82% of this server's disk full because of Clem (core/vps/limit.ts), measured on the files folder.
  await mkdir(files, { recursive: true });
  const limit = new DiskLimit({ measure: o.disk || localDisk(files), clock: o.clock });
  const plainDisk = new DeviceStore(files, { location: "vps", sub: "" });
  // "Keep a copy of my files on the VPS" (the PC sends the person's choice, sealed): off, the VPS keeps no file.
  let copiesOn = (await secrets.get<boolean>("copies")) !== false;
  const disk = new LimitedStore({ inner: plainDisk, limit, root: files, off: () => !copiesOn });
  const workspaceFile = join(data, "workspace.json");
  let engine: Engine | undefined, ws: WorkerWorkspace | undefined, agent: WorkerAgent | undefined;
  let draining = false, again = false, soonTimer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => { if (soonTimer) return; soonTimer = setTimeout(() => { soonTimer = undefined; void work(); }, 2000); soonTimer.unref?.(); };
  const host: EngineHost = {
    secrets: { get: (k) => secrets.get(k), set: (k, v) => secrets.set(k, v), delete: (k) => secrets.delete(k) },
    // No screen here: the desktop pulls these and shows them; Telegram gets its own pushes through the notifier.
    notify: (n) => { notices.push(n); if (notices.length > 50) notices.shift(); },
    paths: { data, migrations: o.migrations || join(here, "migrations"), files, temp: join(data, "tmp") },
    log,
    // Something changed (a sweep posted, an action waits): applied to the workspace copy here when this worker runs.
    changed: () => soon(),
    // The workspace copy (desktop/engine/vps/workspace.ts); before any desktop sent one, an older desktop's snapshot.
    workspace: async () => (await ws?.state()) ?? JSON.parse(await readFile(workspaceFile, "utf8").catch(() => "null")),
    ...(complete ? { complete: ({ system, user, model: m }) => complete({ system, user, model: m }) } : {}),
    account: async (path, init, signal, timeout = 30_000) => {
      const t = await secrets.get<string>("engine-token");
      if (!t) throw Error("No relay token yet.");
      return fetch(config.accountService + path, { ...init, headers: { ...(init?.headers || {}), authorization: "Engine " + t }, signal: signal || AbortSignal.timeout(timeout) });
    },
    // A Telegram message answered here by the Telegram main thread, as the window answers it (desktop/engine/vps/agent.ts).
    ...(complete ? { converse: (turn) => agent!.converse(turn) } : {}),
    fileStore: () => disk,
    fileStores: () => ({ vps: disk }),
    vps: () => ({ files: true }),
    hookBase: () => env.CLEM_HOOK_URL || `http://${config.publicHost || "YOUR-SERVER-ADDRESS"}:${hookPort}`,
  };
  const backend = o.backend || (env.DATABASE_URL ? await openPostgres(env.DATABASE_URL) : (await openPglite(join(data, "db"))).backend);
  engine = await Engine.open(config.owner, host, { backend, jobs: false, store: disk });
  ws = new WorkerWorkspace({ db: engine.db, owner: config.owner, clock: o.clock, log: (m) => log("warn", m) });
  const waiting = disk.waiting = new Waiting(engine.db, config.owner);
  // On the server itself; a change to it is asked in words, once (core/vps/ask.ts), and runs when the person says yes.
  // Under systemd the worker is the person's user on the host already; in Docker it signs in to the host over SSH with
  // its own key (install.ts authorizeWorker), so commands run on the server, not in the container.
  const hostSsh = await secrets.get<{ user: string; port: number; fingerprint?: string; privateKey: string }>("host-ssh");
  let ssh: SshLink | undefined;
  const selfLink = async (): Promise<VpsLink> => {
    if (!hostSsh || !env.DATABASE_URL) return new LocalLink();
    if (!ssh || ssh.closed) ssh = await SshLink.connect({ host: env.CLEM_HOST_ADDR || "host.docker.internal", port: hostSsh.port || 22, user: hostSsh.user, privateKey: hostSsh.privateKey, fingerprint: hostSsh.fingerprint });
    return ssh;
  };
  const vpsTools = new VpsTools(selfLink, { words: true });
  const state = new WorkerState(engine.db, config.owner);
  // Full: told once (desktop/engine/vps/full.ts), nothing asked; checked whenever something is left off and on each beat.
  const full = new FullNotice({ state, waiting, ws, clock: o.clock, log: (m) => log("warn", m),
    full: () => { const d = limit.last; return !!d && roomOn({ total: d.total, free: d.free }) <= 0; },
    post: async (text) => { if ((await engine!.telegram.status().catch(() => null))?.paired) await engine!.telegram.post(text); } });
  waiting.onAdd = () => { void full.check().catch((e) => log("warn", "[worker] full: " + (e as Error).message)); };
  /** A file's bytes leave the store when nothing else uses them; the room counts at once. */
  const dropBytes = async (blob: { sha256: string; ext: string; size: number }, stillUsed: boolean) => {
    if (stillUsed || !/^[a-f0-9]{64}$/.test(blob.sha256)) return 0;
    const path = join(files, blob.sha256 + (blob.ext ? "." + blob.ext : ""));
    if (!(await plainDisk.has(path))) return 0;
    await plainDisk.remove(path);
    limit.freed(blob.size);
    return blob.size;
  };
  // Telegram's main thread here (no study answers, no files: those are done in the app on the PC).
  if (complete) agent = new WorkerAgent({
    owner: config.owner, complete, engine: () => engine!, ws, files, clock: o.clock, log: (m) => log("warn", m),
    vps: (tool) => vpsTools.run(config.owner, tool),
    vpsPerform: (ask) => vpsTools.perform(config.owner, ask),
    state, waiting: () => waiting.items(),
  });
  // The flashcards-due reminder (desktop/study-reminders.ts), as the laptop sends it, while this worker runs Clem's jobs:
  // to the PC as a notice and to Telegram when paired. The person's time and switch come from the PC (a sealed secret).
  const studyReminders = new StudyReminders({
    vault: { read: async <T,>(k: string, fallback: T) => (await secrets.get<T>(k)) ?? fallback, write: (k, v) => secrets.set(k, v) },
    workspace: async () => ws!.state(),
    notify: ({ title, body, spaceId }) => {
      host.notify({ key: "study-due:" + spaceId, title, body, open: { route: "#/app" } });
      void engine!.organizer.push("study-due:" + new Date((o.clock || Date.now)()).toISOString().slice(0, 10), title, body, {}, undefined, { channels: ["telegram"] }).catch(() => {});
    },
  });
  // While this worker runs Clem: the organizer's decisions go into the workspace copy, and due routines run.
  async function work() {
    if (draining) { again = true; return; }
    draining = true;
    try {
      do { again = false; if (engine!.isRunner && await ws!.ready()) { await ws!.drain(engine!.organizer); if (agent) while (await agent.routines()); await full.check(); await studyReminders.tick(config.owner, cairoWall((o.clock || Date.now)())).catch((e) => log("warn", "[worker] reminders: " + (e as Error).message)); } } while (again);
    } catch (e) { log("warn", "[worker] workspace: " + (e as Error).message); } finally { draining = false; }
  }

  // Single runner (core/vps/lease.ts): the worker beats every minute and runs jobs while it holds the lease.
  const lease = async (who: "worker" | "desktop") => engine!.db.tx(async (t) => {
    const [row] = await t.query<{ lease: Lease }>("select lease from engine_lease where owner_id = $1 for update", [config.owner]);
    const next = step(row?.lease || null, who, Date.now());
    await t.query("insert into engine_lease (owner_id, lease) values ($1, $2) on conflict (owner_id) do update set lease = excluded.lease", [config.owner, next.lease]);
    return next;
  });
  const beat = async () => {
    try {
      copiesOn = (await secrets.get<boolean>("copies").catch(() => undefined)) !== false;
      const { run } = await lease("worker");
      await engine!.runner(run);
      if (run) await work();
      // Without a model, Telegram messages stay with the desktop's window (it answers as before).
      if (run && !complete) await engine!.telegram.stop();
    } catch (e) { log("warn", "[worker] heartbeat: " + (e as Error).message); }
  };
  await beat();
  const timer = setInterval(beat, o.beat || BEAT_MS);

  const server = await serveWorker({
    token, port: Number(env.CLEM_PORT || 7717), host: env.CLEM_BIND || "127.0.0.1", log: (m) => log("warn", m),
    handlers: {
      // With a workspace copy here, this worker applies the organizer's decisions itself (work above): the window
      // gets them as workspace changes, never twice.
      call: async (path, args) => {
        if (path === "organizer.inbox" && await ws!.ready()) return { posts: [], apply: [], revert: [] };
        // What the worker left off the VPS at its limit (the PC fetches CMS files among them by itself).
        if (path === "worker.waiting") return { items: (await waiting.items()).filter((i) => !i.item.startsWith("pc:")), cms: (await waiting.items()).filter((i) => i.item.startsWith("cms:") || i.item.startsWith("pc:")) };
        // The person said in words, with the PC off, to keep (or stop keeping) copies of files on the VPS: the PC applies it.
        if (path === "worker.copiesDone") { await state.delete("copies-wish"); return { ok: true }; }
        // The PC fetched these CMS files itself and keeps them: they wait no more, and the worker knows where they are.
        if (path === "worker.waitingDone") {
          const done = (Array.isArray(args[0]) ? args[0] : []) as { item: string; path: string; sha256: string; size: number }[];
          for (const d of done) if (d.item.startsWith("cms:") || d.item.startsWith("pc:")) await engine!.db.query("insert into file_objects (owner_id, file_id, location, path, sha256, size, material_id, saved_at) values ($1, $2, 'device', $3, $4, $5, $6, now()) on conflict (owner_id, file_id) do nothing", [config.owner, "guc:" + d.item.replace(/^(cms|pc):/, ""), d.path, d.sha256, d.size, d.item.replace(/^(cms|pc):/, "")]);
          await waiting.clear(done.map((d) => d.item));
          return { ok: true };
        }
        // The content this worker's copy still uses, so a delete the PC made offline never removes bytes re-added since.
        // Files asked for on Telegram while only on the PC: the PC sends them when it is online, then says so here.
        if (path === "worker.pendingSends") return (await state.get<PendingSend[]>(PENDING_SENDS)) || [];
        if (path === "worker.sendsDone") { const done = new Set((Array.isArray(args[0]) ? args[0] : []).map(String)); await state.set(PENDING_SENDS, ((await state.get<PendingSend[]>(PENDING_SENDS)) || []).filter((x) => !done.has(x.id))); return { ok: true }; }
        if (path === "worker.blobs") return (((await ws!.state())?.files || []) as { blob?: { sha256: string } }[]).map((f) => f.blob?.sha256).filter(Boolean);
        return callPath(engine!, path, args);
      },
      workspace: async (snap) => {
        // An older desktop sends the organizer's compact snapshot; a current one its whole (lean) workspace.
        if ((snap as { __snapshot?: boolean })?.__snapshot) await writeFile(workspaceFile, JSON.stringify(snap));
        else {
          // Files the PC deleted: their bytes here go too (when the PC couldn't remove them), and the room counts at once.
          const before = ((await ws!.state())?.files || []) as { id: string; blob?: { sha256: string; ext: string; size: number } }[];
          await ws!.receive(snap as WsState); soon();
          const after = ((await ws!.state())?.files || []) as { id: string; blob?: { sha256: string } }[];
          const kept = new Set(after.map((f) => f.id)), used = new Set(after.map((f) => f.blob?.sha256).filter(Boolean));
          for (const f of before.filter((x) => !kept.has(x.id))) {
            if (f.blob) await dropBytes(f.blob, used.has(f.blob.sha256)).catch(() => {});
            await waiting.clear(["ws:" + f.id]).catch(() => {});
          }
          // Files the desktop now holds aren't waiting for it any more.
          await waiting.clear(((snap as WsState).files || []).map((f) => "ws:" + f.id)).catch(() => {});
        }
        void engine!.organizer.poke("workspace").catch(() => {});
      },
      ops: (cursor) => ws!.opsAfter(cursor),
      lease: () => lease("desktop"),
      health: async () => ({ ok: true, version: WORKER_VERSION, owner: config.owner, runner: engine!.isRunner ? "worker" : "desktop", model, db: env.DATABASE_URL ? "postgres" : "pglite", at: Date.now(), ws: await ws!.head().catch(() => null), waiting: await waiting.sentences().catch(() => []), disk: limit.last || null,
        copiesWish: (await state.get<boolean>("copies-wish").catch(() => undefined)) ?? null, waitingCms: (await waiting.items().catch(() => [])).filter((i) => i.item.startsWith("cms:") || i.item.startsWith("pc:")).length,
        pendingSends: ((await state.get<PendingSend[]>(PENDING_SENDS).catch(() => undefined)) || []).length }),
      notices: () => notices.splice(0),
    },
  });
  log("info", `[worker] listening on ${env.CLEM_BIND || "127.0.0.1"}:${env.CLEM_PORT || 7717}`);
  // Routines' webhooks, reachable from outside (CLEM_HOOK_PORT=0 turns them off). Only the runner answers them.
  const hooks = hookPort ? await serveHooks({ port: hookPort, host: env.CLEM_HOOK_BIND || "0.0.0.0", log: (m) => log("warn", m),
    target: async () => (engine!.isRunner ? (id, key, payload) => engine!.organizer.hook(id, key, payload) : undefined) }).catch((e) => { log("warn", "[worker] webhooks off: " + (e as Error).message); return undefined; }) : undefined;
  const stop = async () => { await ssh?.close().catch(() => {}); clearInterval(timer); if (soonTimer) clearTimeout(soonTimer); server.close(); hooks?.close(); await agent?.idle(); await engine!.close(); };
  return { engine, host, server, stop, model, ws, agent, port: (server.address() as { port: number }).port, work, full, waiting, limit, state, studyReminders, notices };
}

/** The time as Cairo's wall clock in this machine's local fields: the reminder's hour is the person's (a server often
 *  runs on UTC), as on their laptop. */
export function cairoWall(t: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(t).map((x) => [x.type, x.value]));
  return new Date(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
}

// Run directly (node index.cjs), not when imported by a test.
if (typeof require !== "undefined" && require.main === module) {
  startWorker().then(({ stop }) => {
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void stop().finally(() => process.exit(0)));
  }, (e) => { console.error("[worker] could not start:", (e as Error).message); process.exit(1); });
}
