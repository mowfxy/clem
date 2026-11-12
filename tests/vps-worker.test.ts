// The VPS worker's bundle (scripts/build-worker.mjs) builds and runs: the engine headless on PGlite (the no-Docker
// path), its secrets from the sealed store, the localhost endpoint behind its token, and the lease handing jobs to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal, secretFile } from "../desktop/engine/vps/secrets.ts";
import { WorkerClient } from "../desktop/engine/vps/rpc.ts";

const freePort = () => new Promise<number>((r) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });

test("the worker bundle builds, starts on PGlite, takes the lease and answers only with its token", { timeout: 240_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "clem-worker-"));
  const bundle = join(root, "worker"), files = join(root, "files");
  // @ts-expect-error a plain .mjs build script
  const { buildWorker } = await import("../scripts/build-worker.mjs");
  await buildWorker(bundle);
  const key = randomBytes(32), rpc = randomBytes(16).toString("hex"), port = await freePort();
  await mkdir(join(bundle, "state", "secrets"), { recursive: true }); await mkdir(files, { recursive: true });
  await writeFile(join(bundle, ".key"), key.toString("base64"));
  await writeFile(join(bundle, "config.json"), JSON.stringify({ owner: "owner-1", accountService: "http://127.0.0.1:9" }));
  await writeFile(join(bundle, "state", "secrets", secretFile("rpc")), seal(key, "rpc", rpc));
  const child = spawn(process.execPath, ["index.cjs"], { cwd: bundle, env: { ...process.env, CLEM_PORT: String(port), CLEM_FILES: files, PATH: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (b) => { log += b; }); child.stderr.on("data", (b) => { log += b; });
  try {
    const c = new WorkerClient(`http://127.0.0.1:${port}`, rpc);
    let health: Record<string, unknown> | undefined;
    for (const end = Date.now() + 120_000; !health && Date.now() < end; await new Promise((r) => setTimeout(r, 500))) health = await c.health().catch(() => undefined);
    assert.ok(health, "the worker answered; log:\n" + log);
    assert.equal(health!.ok, true); assert.equal(health!.db, "pglite"); assert.equal(health!.runner, "worker"); assert.equal(health!.model, "none");
    // Without the token: nothing.
    await assert.rejects(new WorkerClient(`http://127.0.0.1:${port}`, "wrong").health(), /Not allowed/);
    // The desktop's beat: the worker holds the lease, so the desktop doesn't run jobs.
    const { lease, run } = await c.lease();
    assert.equal(run, false); assert.equal(lease.holder, "worker");
    // The engine's reads work through the endpoint; methods outside the list don't.
    assert.deepEqual(await c.call("links"), []);
    assert.equal((await c.call<{ connected: boolean }>("status")).connected, false);
    await assert.rejects(c.call("disconnectEverything"), /Not allowed/);
    // The workspace snapshot the organizer sweeps read.
    await c.pushWorkspace({ __snapshot: true, spaces: [], plans: [], study: [], loose: [], rooms: [], said: [], automations: [] });
    assert.doesNotMatch(log, new RegExp(rpc), "the token never reaches the log");
  } finally {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
