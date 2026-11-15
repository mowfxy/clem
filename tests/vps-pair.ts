// A desktop and its VPS worker for tests (as in tests/vps-agent.test.ts): the worker runs in-process on PGlite, the
// desktop's VpsManager reaches it through a fake VPS whose tunnel is the worker's port, and the fake VPS's files are
// the worker's files folder (so a byte the desktop puts there is one the worker reads, and the reverse).
import { mkdtemp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { vpsRoot } from "../desktop/engine/vps/store.ts";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPglite, migrate } from "../desktop/engine/db.ts";
import { seal, secretFile } from "../desktop/engine/vps/secrets.ts";
import { VpsManager, type VpsVault } from "../desktop/engine/vps/manager.ts";
import type { Engine } from "../desktop/engine/index.ts";
import type { Complete } from "../desktop/engine/vps/headless.ts";
import type { DiskSize } from "../core/vps/limit.ts";
import { startWorker } from "../worker/index.ts";
import { FakeLocal, FakeVps } from "./vps-fake.ts";

export const OWNER = "owner-1";
const freePort = () => new Promise<number>((r) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });

export function baseDesk(extra: Record<string, unknown> = {}): any {
  return {
    name: "Sam", memory: "", skills: [], visuals: [], automations: [], studySets: [], plans: [],
    spaces: [{ id: "math", name: "Math", kind: "subject", description: "MATH 301", memory: "", sources: [] }],
    files: [],
    chats: [{ id: "main", kind: "main", title: "Clem", spaceId: null, updated: 1, messages: [{ id: "m0", role: "assistant", content: "Good morning.", at: 1 }] }],
    ...extra,
  };
}

export async function startPair(o: { complete?: Complete; disk?: () => Promise<DiskSize>; clock?: () => number; manager?: Partial<ConstructorParameters<typeof VpsManager>[0]> } = {}) {
  const root = await mkdtemp(join(tmpdir(), "clem-pair-"));
  const data = join(root, "worker", "state"), files = join(root, "files");
  await mkdir(join(data, "secrets"), { recursive: true }); await mkdir(files, { recursive: true });
  const key = randomBytes(32), rpc = randomBytes(16).toString("hex"), port = await freePort();
  await writeFile(join(data, "secrets", secretFile("rpc")), seal(key, "rpc", rpc));
  const { backend: wb } = await openPglite();
  const worker = await startWorker({ config: { owner: OWNER, accountService: "http://127.0.0.1:9" }, key, env: { CLEM_DATA: data, CLEM_FILES: files, CLEM_PORT: String(port), CLEM_HOOK_PORT: "0", PATH: process.env.PATH }, migrations: "desktop/engine/migrations", backend: wb, beat: 3_600_000, complete: o.complete, disk: o.disk, clock: o.clock });
  const { backend: db0, db } = await openPglite();
  await migrate(db0, "desktop/engine/migrations");
  const engine = { db, runner: async () => {}, telegram: { start() {}, post: async () => {} }, organizer: { announce: async () => {} } } as unknown as Engine;
  // The fake VPS's files folder IS the worker's (what the desktop deletes there, the worker no longer has).
  const root2 = vpsRoot(OWNER) + "/", on = (path: string) => (path.startsWith(root2) ? join(files, path.slice(root2.length)) : undefined);
  const link = new (class extends FakeVps {
    async tunnel() { return { port, close() {} }; }
    async get(path: string) { const d = on(path); if (!d) return super.get(path); this.check2(); return new Uint8Array(await readFile(d)); }
    async put(path: string, bytes: Uint8Array) { const d = on(path); if (!d) return super.put(path, bytes); this.check2(); await writeFile(d, bytes); }
    async size(path: string) { const d = on(path); if (!d) return super.size(path); this.check2(); return stat(d).then((x) => x.size, () => null); }
    async rename(from: string, to: string) { const a = on(from), b = on(to); if (!a || !b) return super.rename(from, to); this.check2(); await rename(a, b); }
    async remove(path: string) { const d = on(path); if (!d) return super.remove(path); this.check2(); await rm(d, { force: true }); }
    async hash(path: string) { const d = on(path); if (!d) return super.hash(path); this.check2(); return createHash("sha256").update(await readFile(d)).digest("hex"); }
    check2() { if (this.offline) throw Error("connect ECONNRESET"); }
  })();
  const kept = new Map<string, unknown>();
  kept.set("vps-" + OWNER, { config: { host: "vps.test", port: 22, user: "u", auth: "key", fingerprint: "SHA256:x" }, privateKey: "k", storage: { mode: "vps" }, worker: { enabled: true, kind: "docker", key: key.toString("base64"), rpc, installedAt: 1 } } satisfies VpsVault);
  const changed: string[] = [];
  const local = new FakeLocal();
  const m = new VpsManager({ owner: OWNER, secrets: { get: async <T,>(k: string) => kept.get(k) as T, set: async (k, v) => { kept.set(k, v); }, delete: async (k) => { kept.delete(k); } }, local, files: root, engine: async () => engine, bundle: "", accountService: "", connect: async () => link, changed: (w) => changed.push(w), ...(o.manager || {}) });
  await m.ready();
  const stop = async () => {
    await worker.stop();
    await m.close();
    await db0.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  };
  const stored = async () => (await readdir(files).catch(() => [] as string[])).filter((n) => /^[a-f0-9]{64}/.test(n));
  return { root, data, files, worker, m, link, local, kept, changed, engine, db, stop, stored };
}
