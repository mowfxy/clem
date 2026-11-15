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
import { WorkerAgent } from "../desktop/engine/vps/agent.ts";
import { LocalLink } from "../desktop/engine/vps/local-link.ts";
import { VpsTools } from "../desktop/engine/vps/tools.ts";
import { WorkerWorkspace, type WsState } from "../desktop/engine/vps/workspace.ts";
import { sha256 } from "../desktop/engine/storage.ts";
import { callPath, serveWorker } from "../desktop/engine/vps/rpc.ts";
import { FileSecrets } from "../desktop/engine/vps/secrets.ts";
import { serveHooks } from "../desktop/engine/hooks.ts";

/** Bumped when the worker's endpoint or behaviour changes in a way the desktop must know about (it refreshes an older one). */
export const WORKER_VERSION = 2;
const here = typeof __filename === "string" ? dirname(__filename) : process.cwd();
type Config = { owner: string; accountService: string; publicHost?: string };

export async function startWorker(o: { config?: Config; key?: Uint8Array; env?: NodeJS.ProcessEnv; migrations?: string; backend?: Backend; beat?: number; /** Tests: the model. */ complete?: Complete; clock?: () => number } = {}) {
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
  const disk = new DeviceStore(files, { location: "vps", sub: "" });
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
    // A Telegram message answered here the way the window's main thread answers it (desktop/engine/vps/agent.ts).
    ...(complete ? { converse: (turn) => agent!.converse(turn) } : {}),
    fileStore: () => disk,
    fileStores: () => ({ vps: disk }),
    vps: () => ({ files: true }),
    hookBase: () => env.CLEM_HOOK_URL || `http://${config.publicHost || "YOUR-SERVER-ADDRESS"}:${hookPort}`,
  };
  const backend = o.backend || (env.DATABASE_URL ? await openPostgres(env.DATABASE_URL) : (await openPglite(join(data, "db"))).backend);
  engine = await Engine.open(config.owner, host, { backend, jobs: false, store: disk });
  ws = new WorkerWorkspace({ db: engine.db, owner: config.owner, clock: o.clock, log: (m) => log("warn", m) });
  const vpsTools = new VpsTools(async () => new LocalLink());
  if (complete) agent = new WorkerAgent({
    owner: config.owner, complete, engine: () => engine!, ws, files, clock: o.clock, log: (m) => log("warn", m),
    save: async (bytes, ext) => { const hash = sha256(bytes); await disk.put(hash, ext, bytes); return { sha256: hash, ext, size: bytes.length }; },
    // On the server itself; anything that could change it isn't run from here (no one can tap a card): said in words.
    vps: async (tool) => { const r = await vpsTools.run(config.owner, tool) as { needsConfirm?: boolean; reason?: string }; return r?.needsConfirm ? { error: `That could change the server (${r.reason || "not read-only"}), so Clem runs it only from Clem on the person's PC.` } : r; },
  });
  // While this worker runs Clem: the organizer's decisions go into the workspace copy, and due routines run.
  async function work() {
    if (draining) { again = true; return; }
    draining = true;
    try {
      do { again = false; if (engine!.isRunner && await ws!.ready()) { await ws!.drain(engine!.organizer); if (agent) while (await agent.routines()); } } while (again);
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
      call: async (path, args) => (path === "organizer.inbox" && await ws!.ready() ? { posts: [], apply: [], revert: [] } : callPath(engine!, path, args)),
      workspace: async (snap) => {
        // An older desktop sends the organizer's compact snapshot; a current one its whole (lean) workspace.
        if ((snap as { __snapshot?: boolean })?.__snapshot) await writeFile(workspaceFile, JSON.stringify(snap));
        else { await ws!.receive(snap as WsState); soon(); }
        void engine!.organizer.poke("workspace").catch(() => {});
      },
      ops: (cursor) => ws!.opsAfter(cursor),
      lease: () => lease("desktop"),
      health: async () => ({ ok: true, version: WORKER_VERSION, owner: config.owner, runner: engine!.isRunner ? "worker" : "desktop", model, db: env.DATABASE_URL ? "postgres" : "pglite", at: Date.now(), ws: await ws!.head().catch(() => null) }),
      notices: () => notices.splice(0),
    },
  });
  log("info", `[worker] listening on ${env.CLEM_BIND || "127.0.0.1"}:${env.CLEM_PORT || 7717}`);
  // Routines' webhooks, reachable from outside (CLEM_HOOK_PORT=0 turns them off). Only the runner answers them.
  const hooks = hookPort ? await serveHooks({ port: hookPort, host: env.CLEM_HOOK_BIND || "0.0.0.0", log: (m) => log("warn", m),
    target: async () => (engine!.isRunner ? (id, key, payload) => engine!.organizer.hook(id, key, payload) : undefined) }).catch((e) => { log("warn", "[worker] webhooks off: " + (e as Error).message); return undefined; }) : undefined;
  const stop = async () => { clearInterval(timer); if (soonTimer) clearTimeout(soonTimer); server.close(); hooks?.close(); await agent?.idle(); await engine!.close(); };
  return { engine, host, server, stop, model, ws, agent, port: (server.address() as { port: number }).port, work };
}

// Run directly (node index.cjs), not when imported by a test.
if (typeof require !== "undefined" && require.main === module) {
  startWorker().then(({ stop }) => {
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void stop().finally(() => process.exit(0)));
  }, (e) => { console.error("[worker] could not start:", (e as Error).message); process.exit(1); });
}
