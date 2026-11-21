// The connection to the VPS never leaves the app confused (docs/GUC-VPS-ENGINE.md "Connection"): every call has a
// time limit and a plain sentence, a lost connection backs off and reconnects, the first beat after the laptop slept
// reconnects before deciding anything, a worker that stops answering is started again, a worker on another protocol
// is refreshed, the install survives a dropped link, and the lease hands over both ways. All on the fake VPS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPglite, migrate } from "../desktop/engine/db.ts";
import { DROPPED, plain, timed, type VpsLink } from "../desktop/engine/vps/link.ts";
import { serveWorker, WorkerClient } from "../desktop/engine/vps/rpc.ts";
import { INSTALL_DROPPED, VpsManager, type VpsVault } from "../desktop/engine/vps/manager.ts";
import type { Engine } from "../desktop/engine/index.ts";
import { step, type Lease } from "../core/vps/lease.ts";
import { WORKER_PROTOCOL } from "../core/vps/types.ts";
import { FakeLocal, FakeVps } from "./vps-fake.ts";

const OWNER = "owner-1", RPC = "a".repeat(32), MIN = 60_000;

/** A fake VPS that answers the install's probe (Docker is there) and tunnels to `port`. */
class Server2 extends FakeVps {
  port = 0;
  constructor(shared?: Map<string, Uint8Array>) { super(); if (shared) this.files = shared; }
  async exec(cmd: string, o: { cap?: number } = {}) {
    if (cmd.includes('echo "os=')) { if (this.offline) throw Error("connect ECONNRESET"); this.commands.push("probe"); return { code: 0, stdout: "os=Debian\ndf=1000000 500000\ndocker=yes\nsystemd=yes\nnode=v22.1.0\nuid=1000 gid=1000\nadmin=no\n", stderr: "" }; }
    return super.exec(cmd, o);
  }
  async tunnel() { if (this.offline) throw Error("connect ECONNRESET"); return { port: this.port, close() {} }; }
  get closed() { return this.offline; }
}

/** A worker endpoint the test controls: its lease follows core/vps/lease.ts, it can be stopped and started. */
async function fakeWorker(o: { clock: () => number; version?: number }) {
  let lease: Lease | null = null, server: Server | undefined, port = 0;
  const w = {
    version: o.version ?? WORKER_PROTOCOL,
    get lease() { return lease; },
    /** The worker's own beat. */
    beat() { lease = step(lease, "worker", o.clock()).lease; },
    async start() {
      server = await serveWorker({ token: RPC, port, handlers: {
        call: async () => null, workspace: async () => {},
        lease: async () => { const next = step(lease, "desktop", o.clock()); lease = next.lease; return next; },
        health: async () => ({ ok: true, version: w.version, model: "cli", ws: null }), notices: () => [],
      } });
      port = (server.address() as { port: number }).port;
      return port;
    },
    async stop() { await new Promise((r) => server!.close(r)); server = undefined; },
  };
  return w;
}

async function desk(o: { link: () => VpsLink | Promise<VpsLink>; clock: () => number; vault?: Partial<VpsVault>; bundle?: string; version?: string }) {
  const { backend, db } = await openPglite();
  await migrate(backend, "desktop/engine/migrations");
  const runs: boolean[] = [];
  const engine = { db, isRunner: false, async runner(on: boolean) { engine.isRunner = on; runs.push(on); }, telegram: { start() {} }, organizer: { announce: async () => {}, settings: async () => ({}) }, links: async () => [] } as unknown as Engine & { isRunner: boolean };
  const kept = new Map<string, unknown>([["vps-" + OWNER, { config: { host: "vps.test", port: 22, user: "u", auth: "key", fingerprint: "SHA256:pinned" }, privateKey: "k", worker: { enabled: true, kind: "docker", key: Buffer.alloc(32, 1).toString("base64"), rpc: RPC, installedAt: 1, version: "0.0.1" }, ...o.vault }]]);
  let connects = 0;
  const logs: string[] = [];
  const m = new VpsManager({ owner: OWNER, secrets: { get: async <T,>(k: string) => kept.get(k) as T, set: async (k, v) => { kept.set(k, v); }, delete: async (k) => { kept.delete(k); } }, local: new FakeLocal(), files: tmpdir(), engine: async () => engine, bundle: o.bundle || "", version: o.version, accountService: "http://x", clock: o.clock, log: (l) => logs.push(l),
    connect: async () => { connects++; return o.link(); } });
  return { m, engine, runs, kept, logs, connects: () => connects, close: async () => { await m.close(); await backend.close(); } };
}

test("every call has a time limit and a plain sentence", async () => {
  // A hung SFTP step (a dead link never answers): one sentence, not a hang.
  await assert.rejects(timed(new Promise(() => {}), 50, "sending a file"), /^Error: The server stopped answering while sending a file\.$/);
  assert.equal(plain(Error("read ECONNRESET")), DROPPED);
  assert.equal(plain(Error("put: No response from server")), DROPPED);
  // The worker's endpoint: one that never answers, and one that isn't there.
  const silent = createServer(() => {}).listen(0, "127.0.0.1");
  await new Promise((r) => silent.once("listening", r));
  const slow = new WorkerClient(`http://127.0.0.1:${(silent.address() as { port: number }).port}`, RPC);
  await assert.rejects((slow as any).req("/health", { timeout: 200 }), /didn't answer in time/);
  silent.close();
  await assert.rejects(new WorkerClient("http://127.0.0.1:9", RPC).health(), /isn't answering/);
});

test("a lost connection backs off, the desktop takes the jobs only once the worker is stale, and hands them back when it returns", async () => {
  let now = 1_000_000;
  const clock = () => now, w = await fakeWorker({ clock });
  const vps = new Server2(); vps.port = await w.start();
  w.beat();
  let down = false;
  const d = await desk({ clock, link: () => { if (down) throw Error("connect ETIMEDOUT"); vps.offline = false; return vps; } });
  try {
    await d.m.heartbeat();
    assert.equal(d.engine.isRunner, false, "the worker holds the lease");
    // The VPS disappears: tries back off (1, 2, 4, 8, then at most 10 minutes between tries).
    down = true; vps.offline = true;
    const tries: number[] = [];
    for (let i = 1; i <= 30; i++) { now += MIN; const before = d.connects(); await d.m.heartbeat(); if (d.connects() > before) tries.push(i); }
    assert.deepEqual(tries.slice(0, 5), [1, 2, 4, 8, 16], "reconnects back off");
    assert.ok(tries.slice(5).every((t, i, a) => i === 0 || t - a[i - 1] <= 10), "never more than ten minutes apart");
    assert.equal(d.engine.isRunner, true, "the worker has been out of reach for longer than 10 minutes: the desktop runs the jobs");
    // It comes back and beats: on the desktop's next try the lease goes back to the worker.
    down = false; w.beat();
    now += 10 * MIN;
    await d.m.heartbeat();
    assert.equal(d.engine.isRunner, false);
    assert.equal(w.lease!.holder, "worker");
    // Any action tries at once, whatever the back-off.
    assert.equal((await d.m.status()).worker.runner, "worker");
  } finally { await d.close(); await w.stop(); }
});

test("the first beat after the laptop slept reconnects before deciding, so it never runs jobs the worker is running", async () => {
  let now = 5_000_000;
  const clock = () => now, w = await fakeWorker({ clock });
  const vps = new Server2(); vps.port = await w.start();
  w.beat();
  let failNext = 0;
  const d = await desk({ clock, link: () => { if (failNext-- > 0) throw Error("connect ECONNRESET"); vps.offline = false; return vps; } });
  try {
    d.m.startHeartbeat(); await d.m.heartbeat();
    assert.equal(d.engine.isRunner, false);
    // Two hours asleep; the worker kept beating; the old connection is dead.
    now += 120 * MIN; w.beat(); vps.offline = true;
    const before = d.connects();
    await d.m.heartbeat();
    assert.ok(d.connects() > before, "a fresh connection, not the one the sleep broke");
    assert.equal(d.engine.isRunner, false);
    // Asleep again, and this time the network isn't back yet on the first beat: still no jobs here.
    now += 120 * MIN; failNext = 5; vps.offline = true;
    await d.m.heartbeat();
    assert.equal(d.engine.isRunner, false, "decides on the next beat, not on a connection the sleep broke");
    // Still unreachable a minute later: the two hours asleep don't count as the worker being away.
    now += MIN; await d.m.heartbeat();
    assert.equal(d.engine.isRunner, false);
    // wake() (powerMonitor's resume) beats at once.
    failNext = 0; now += 5_000; w.beat();
    d.m.wake(); await d.m.heartbeat();
    assert.equal(d.engine.isRunner, false);
    // Unreachable for more than ten minutes while awake: then the desktop runs the jobs, as before.
    failNext = 1000; for (let i = 0; i < 12; i++) { now += MIN; await d.m.heartbeat(); }
    assert.equal(d.engine.isRunner, true);
  } finally { await d.close(); await w.stop(); }
});

test("a worker that stops answering while SSH works is started again, at most once in ten minutes", async () => {
  let now = 9_000_000;
  const clock = () => now, w = await fakeWorker({ clock });
  const vps = new Server2(); vps.port = await w.start();
  w.beat();
  const d = await desk({ clock, link: () => { vps.offline = false; return vps; } });
  try {
    await d.m.heartbeat();
    await w.stop();
    for (let i = 0; i < 20; i++) { now += MIN; await d.m.heartbeat(); }
    const revives = vps.commands.filter((c) => c.includes("docker compose up -d"));
    assert.equal(revives.length, 2, "started again, then again ten minutes later: " + revives.length);
    assert.match((await d.m.status()).worker.error || "", /isn't answering/);
  } finally { await d.close(); }
});

test("while the worker is rebuilt after an update it isn't called broken, nor restarted half-way", async () => {
  let now = 15_000_000;
  const clock = () => now, w = await fakeWorker({ clock });
  const vps = new Server2(); vps.port = await w.start();
  w.beat();
  const d = await desk({ clock, link: () => { vps.offline = false; return vps; } });
  try {
    await d.m.heartbeat();
    (d.m as unknown as { updating: boolean }).updating = true; // refreshWorker() is running `docker compose up -d --build`
    await w.stop();
    for (let i = 0; i < 6; i++) { now += MIN; await d.m.heartbeat(); }
    const s = await d.m.status();
    assert.equal(s.worker.updating, true);
    assert.equal(s.worker.error, undefined, "Settings says Updating, not \"isn't answering\"");
    assert.equal(vps.commands.filter((c) => c.includes("docker compose up -d")).length, 0, "no restart racing the rebuild");
  } finally { await d.close(); }
});

test("the VPS gets the AI this PC uses: Gemini stays Gemini (Google's Antigravity agent), never swapped for Claude", async () => {
  const d = await desk({ clock: () => 1, link: () => new Server2() });
  try {
    const m = d.m as unknown as { serverCli(c?: string): string | undefined; workerUses(c: string): boolean; workerAiError?: string; workerModel: string; workerClis: string[] };
    m.workerAiError = "Gemini on your VPS couldn't answer.";
    assert.equal(m.serverCli("antigravity"), "antigravity");
    assert.equal(m.serverCli("codex"), "codex");
    // A worker answering with Claude Code is not using the person's Gemini, so it gets set up.
    m.workerModel = "cli"; m.workerClis = ["claude"];
    assert.equal(m.workerUses("antigravity"), false);
    m.workerClis = ["antigravity", "claude"];
    assert.equal(m.workerUses("antigravity"), true);
  } finally { await d.close(); }
});

test("a worker on another protocol is refreshed with this desktop's bundle, whole, keeping its database", async () => {
  let now = 20_000_000;
  const clock = () => now, w = await fakeWorker({ clock, version: WORKER_PROTOCOL - 1 });
  const vps = new Server2(); vps.port = await w.start();
  const bundle = await mkdtemp(join(tmpdir(), "clem-bundle-"));
  await writeFile(join(bundle, "index.cjs"), "// worker v" + WORKER_PROTOCOL);
  await writeFile(join(bundle, "docker-compose.yml"), "services: {}");
  w.beat();
  const d = await desk({ clock, bundle, link: () => { vps.offline = false; return vps; } });
  try {
    await d.m.heartbeat();
    for (let i = 0; i < 50 && !vps.files.has(`clem/${OWNER}/worker/index.cjs`); i++) await new Promise((r) => setTimeout(r, 20));
    await d.m.refreshWorker(true);
    assert.equal(new TextDecoder().decode(vps.files.get(`clem/${OWNER}/worker/index.cjs`)), "// worker v" + WORKER_PROTOCOL);
    assert.ok(![...vps.files.keys()].some((k) => k.includes(".part-")), "no half-sent file is left");
    assert.ok(vps.commands.some((c) => c.includes("docker compose up -d --build")), "started again with the new bundle");
    assert.ok(!vps.commands.some((c) => /rm -rf|down -v/.test(c)), "its database is kept");
  } finally { await d.close(); await w.stop(); await rm(bundle, { recursive: true, force: true }); }
});

test("a connection that drops mid-install picks up on a fresh one, or fails with one plain sentence", async () => {
  let now = 30_000_000;
  const clock = () => now, w = await fakeWorker({ clock });
  const shared = new Map<string, Uint8Array>();
  const bundle = await mkdtemp(join(tmpdir(), "clem-bundle-"));
  for (const f of ["index.cjs", "a.js", "b.js", "c.js"]) await writeFile(join(bundle, f), "// " + f);
  const port = await w.start();
  let drops = [3], made = 0;
  const fresh = () => { const v = new Server2(shared); v.port = port; v.dropAfter = drops[made++]; return v; };
  const d = await desk({ clock, bundle, link: fresh, vault: { modelKey: { provider: "anthropic", key: "k" } } });
  try {
    await d.m.enableWorker();
    assert.equal(made, 2, "a second connection finished it");
    assert.equal(new TextDecoder().decode(shared.get(`clem/${OWNER}/worker/index.cjs`)), "// index.cjs");
    assert.ok(![...shared.keys()].some((k) => k.includes(".part-")));
    // Dropping on both tries: one sentence the person can act on.
    await d.m.disableWorker();
    drops = [2, 2, 2, 2]; made = 0; shared.clear();
    (d.m as any).current?.close?.(); await (d.m as any).drop();
    await assert.rejects(d.m.enableWorker(), (e: Error) => e.message === INSTALL_DROPPED);
  } finally { await d.close(); await w.stop(); await rm(bundle, { recursive: true, force: true }); }
});
