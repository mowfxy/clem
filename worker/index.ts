// Clem's background worker on the person's VPS (docs/GUC-VPS-ENGINE.md "Background worker"): the same engine as the
// desktop, headless. Postgres when DATABASE_URL is set (Docker), else PGlite under CLEM_DATA (systemd with Node).
// Secrets come from an AES-256-GCM store under a key file the desktop wrote at install; none is ever logged.
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GUC_GUIDE } from "../core/guc/ai-tools.ts";
import { TELEGRAM_GUIDE } from "../core/telegram/guide.ts";
import { BEAT_MS, step, type Lease } from "../core/vps/lease.ts";
import { runGucTool, runTelegramTool } from "../desktop/engine/ai-tools.ts";
import { openPglite, openPostgres, type Backend } from "../desktop/engine/db.ts";
import type { EngineHost } from "../desktop/engine/host.ts";
import { Engine } from "../desktop/engine/index.ts";
import { DeviceStore } from "../desktop/engine/storage.ts";
import { apiComplete, cliComplete, headlessConverse, type Complete, type ModelKey } from "../desktop/engine/vps/headless.ts";
import { callPath, serveWorker } from "../desktop/engine/vps/rpc.ts";
import { FileSecrets } from "../desktop/engine/vps/secrets.ts";

export const WORKER_VERSION = 1;
const here = typeof __filename === "string" ? dirname(__filename) : process.cwd();
type Config = { owner: string; accountService: string };

export async function startWorker(o: { config?: Config; key?: Uint8Array; env?: NodeJS.ProcessEnv; migrations?: string; backend?: Backend; beat?: number } = {}) {
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
  const modelKey = await secrets.get<ModelKey>("model");
  const cli = modelKey ? undefined : await cliComplete();
  const complete: Complete | undefined = modelKey ? apiComplete(modelKey) : cli?.complete;
  const model = modelKey ? "api" : cli ? "cli" : "none";
  log("info", `[worker] model: ${model}${cli ? " (" + cli.name + ")" : ""}`);

  const notices: { key: string; title: string; body: string; open?: object }[] = [];
  const disk = new DeviceStore(files, { location: "vps", sub: "" });
  const workspaceFile = join(data, "workspace.json");
  let engine: Engine | undefined;
  const subjects = async () => {
    const snap = JSON.parse(await readFile(workspaceFile, "utf8").catch(() => "{}"));
    return (snap.spaces || []).filter((s: { kind: string }) => s.kind === "subject").map((s: { id: string; name: string; code?: string; examDate?: string }) => ({ id: s.id, name: s.name, description: s.code, examDate: s.examDate }));
  };
  const host: EngineHost = {
    secrets: { get: (k) => secrets.get(k), set: (k, v) => secrets.set(k, v), delete: (k) => secrets.delete(k) },
    // No screen here: the desktop pulls these and shows them; Telegram gets its own pushes through the notifier.
    notify: (n) => { notices.push(n); if (notices.length > 50) notices.shift(); },
    paths: { data, migrations: o.migrations || join(here, "migrations"), files, temp: join(data, "tmp") },
    log,
    changed: () => {},
    workspace: async () => JSON.parse(await readFile(workspaceFile, "utf8").catch(() => "null")),
    ...(complete ? { complete: ({ system, user, model: m }) => complete({ system, user, model: m }) } : {}),
    account: async (path, init, signal, timeout = 30_000) => {
      const t = await secrets.get<string>("engine-token");
      if (!t) throw Error("No relay token yet.");
      return fetch(config.accountService + path, { ...init, headers: { ...(init?.headers || {}), authorization: "Engine " + t }, signal: signal || AbortSignal.timeout(timeout) });
    },
    ...(complete ? {
      converse: headlessConverse({
        complete,
        guide: GUC_GUIDE + "\n\n" + TELEGRAM_GUIDE,
        context: async () => "Now: " + JSON.stringify(await engine!.now().catch(() => null)),
        tools: async (tool) => {
          const ctx = { engine: engine!, owner: config.owner, subjects: await subjects() };
          return String(tool.action || "").startsWith("telegram.") ? runTelegramTool(ctx, tool) : runGucTool(ctx, tool);
        },
      }),
    } : {}),
    store: () => disk,
    stores: () => ({ vps: disk }),
    vps: () => ({ files: true }),
  };
  const backend = o.backend || (env.DATABASE_URL ? await openPostgres(env.DATABASE_URL) : (await openPglite(join(data, "db"))).backend);
  engine = await Engine.open(config.owner, host, { backend, jobs: false, store: disk });

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
      // Without a model, Telegram messages stay with the desktop's window (it answers as before).
      if (run && !complete) await engine!.telegram.stop();
    } catch (e) { log("warn", "[worker] heartbeat: " + (e as Error).message); }
  };
  await beat();
  const timer = setInterval(beat, o.beat || BEAT_MS);

  const server = await serveWorker({
    token, port: Number(env.CLEM_PORT || 7717), host: env.CLEM_BIND || "127.0.0.1", log: (m) => log("warn", m),
    handlers: {
      call: (path, args) => callPath(engine!, path, args),
      workspace: async (snap) => { await writeFile(workspaceFile, JSON.stringify(snap)); void engine!.organizer.poke("workspace").catch(() => {}); },
      lease: () => lease("desktop"),
      health: async () => ({ ok: true, version: WORKER_VERSION, owner: config.owner, runner: engine!.isRunner ? "worker" : "desktop", model, db: env.DATABASE_URL ? "postgres" : "pglite", at: Date.now() }),
      notices: () => notices.splice(0),
    },
  });
  log("info", `[worker] listening on ${env.CLEM_BIND || "127.0.0.1"}:${env.CLEM_PORT || 7717}`);
  const stop = async () => { clearInterval(timer); server.close(); await engine!.close(); };
  return { engine, server, stop, model };
}

// Run directly (node index.cjs), not when imported by a test.
if (typeof require !== "undefined" && require.main === module) {
  startWorker().then(({ stop }) => {
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void stop().finally(() => process.exit(0)));
  }, (e) => { console.error("[worker] could not start:", (e as Error).message); process.exit(1); });
}
