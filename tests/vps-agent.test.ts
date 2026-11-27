// Clem on the VPS with the laptop off (docs/GUC-VPS-ENGINE.md "Workspace on the VPS"): a Telegram message is answered by
// the worker's Telegram main thread (the same loop, guide and actions as the window's: the day and term, never study
// questions or files), its changes kept in the worker's copy of the workspace, and they appear in the desktop's
// workspace when it opens and syncs. The worker runs
// in-process on PGlite; the desktop reaches it through a fake VPS whose tunnel is the worker's port.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPglite, migrate } from "../desktop/engine/db.ts";
import { sha256 } from "../desktop/engine/storage.ts";
import { seal, secretFile } from "../desktop/engine/vps/secrets.ts";
import { VpsManager, type VpsVault } from "../desktop/engine/vps/manager.ts";
import { vpsRoot } from "../desktop/engine/vps/store.ts";
import type { Engine } from "../desktop/engine/index.ts";
import { applyPull } from "../core/workspace/ops.ts";
import { TELEGRAM_DECLINE } from "../core/telegram/thread.ts";
import { MAIN_MEMORY } from "../core/vps/types.ts";
import { startWorker } from "../worker/index.ts";
import { FakeLocal, FakeVps } from "./vps-fake.ts";

const OWNER = "owner-1";
const freePort = () => new Promise<number>((r) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
/** The next Thursday in Cairo, as the model would compute it from "Today is …". */
function nextThursday(now = Date.now()) {
  for (let d = 1; d <= 7; d++) {
    const t = now + d * 86_400_000;
    if (new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", weekday: "long" }).format(t) === "Thursday") return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(t);
  }
  throw Error("no Thursday");
}

test("with no window, a Telegram management request is carried out on the VPS and lands in the desktop's workspace after it syncs; a study request is declined", { timeout: 180_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "clem-agent-"));
  const data = join(root, "worker", "state"), files = join(root, "files");
  await mkdir(join(data, "secrets"), { recursive: true }); await mkdir(files, { recursive: true });
  const key = randomBytes(32), rpc = randomBytes(16).toString("hex"), port = await freePort();
  await writeFile(join(data, "secrets", secretFile("rpc")), seal(key, "rpc", rpc));
  const notes = new TextEncoder().encode("# Limits");
  const hash = sha256(notes);
  await writeFile(join(files, hash + ".blob"), notes);

  // The server's model, scripted: the plan for Thursday is a plan block (management, carried out here).
  const thursday = nextThursday();
  const seen: { system: string; user: string }[] = [];
  const complete = async ({ system, user }: { system: string; user: string }) => {
    seen.push({ system, user });
    assert.match(system, /main thread/);
    // A study request: the model declines it under the guide (nothing on this path can make a deck).
    if (/\[From Telegram\] make me flashcards/.test(user)) return TELEGRAM_DECLINE;
    assert.doesNotMatch(system, /"action":"clem\.handoff"/, "no hand-off on Telegram");
    assert.match(user, /\[From Telegram\] add a study session for Math on Thursday/);
    assert.match(user, /Subjects: Math/, "the Now card is in the context");
    assert.match(user, /What Clem knows about the person[^\n]*\n- Answers: short, in English/, "and what Clem learned about them, sent by the PC");
    return `Added a study session on Thursday.\n\n\`\`\`plan\n${JSON.stringify({ action: "create", space: "Math", title: "Math study plan", tasks: [{ id: "t1", title: "Study session: limits and derivatives", due: thursday, time: "18:00" }] })}\n\`\`\``;
  };

  const { backend: wb } = await openPglite();
  const worker = await startWorker({ config: { owner: OWNER, accountService: "http://127.0.0.1:9" }, key, env: { CLEM_DATA: data, CLEM_FILES: files, CLEM_PORT: String(port), CLEM_HOOK_PORT: "0", PATH: process.env.PATH }, migrations: "desktop/engine/migrations", backend: wb, beat: 3_600_000, complete });
  const { backend: db0, db } = await openPglite();
  await migrate(db0, "desktop/engine/migrations");
  const engine = { db, runner: async () => {}, telegram: { start() {} }, organizer: { announce: async () => {} } } as unknown as Engine;
  const link = new (class extends FakeVps { async tunnel() { return { port, close() {} }; } })();
  const kept = new Map<string, unknown>();
  kept.set("vps-" + OWNER, { config: { host: "vps.test", port: 22, user: "u", auth: "key", fingerprint: "SHA256:x" }, privateKey: "k", storage: { mode: "vps" }, worker: { enabled: true, kind: "docker", key: key.toString("base64"), rpc, installedAt: 1 } } satisfies VpsVault);
  const changed: string[] = [];
  const m = new VpsManager({ owner: OWNER, learned: async () => "- Answers: short, in English", secrets: { get: async <T,>(k: string) => kept.get(k) as T, set: async (k, v) => { kept.set(k, v); }, delete: async (k) => { kept.delete(k); } }, local: new FakeLocal(), files: root, engine: async () => engine, bundle: "", accountService: "", connect: async () => link, changed: (w) => changed.push(w) });
  await m.ready();
  (await m.router()).markVps("notes", `${vpsRoot(OWNER)}/${hash}.blob`, hash, notes.length, false);
  let desk: any = {
    name: "Sam", memory: "", skills: [], visuals: [], automations: [], studySets: [], plans: [],
    spaces: [{ id: "math", name: "Math", kind: "subject", description: "MATH 301", memory: "", sources: [] }],
    files: [{ id: "notes", name: "Math notes.md", size: notes.length, type: "text/markdown", created: 1, spaceId: "math" }],
    chats: [{ id: "main", kind: "main", title: "Clem", spaceId: null, updated: 1, messages: [{ id: "m0", role: "assistant", content: "Good morning.", at: 1 }] }],
  };
  try {
    await m.pushWorkspace(true, desk);
    assert.ok(await worker.ws.ready(), "the worker holds a copy of the workspace");
    // What Clem learned about the person went with it, sealed (the fake VPS holds it; on a real one it lands in the
    // worker's secrets folder, as here); unchanged, it isn't sent again.
    const isMemory = (p: string) => p.endsWith("/secrets/" + secretFile(MAIN_MEMORY));
    const sealed = [...link.files].filter(([p]) => isMemory(p));
    assert.equal(sealed.length, 1);
    await writeFile(join(data, "secrets", secretFile(MAIN_MEMORY)), sealed[0][1]);
    const put = link.put.bind(link);
    let resent = 0;
    link.put = async (p: string, b: Uint8Array) => { if (isMemory(p)) resent++; return put(p, b); };
    await m.pushWorkspace(true, desk);
    assert.equal(resent, 0, "unchanged: not sent again");

    // A study request: the model decides, and declines it in one message; nothing made.
    const no = await worker.host.converse!({ id: "tg-0", text: "make me flashcards from my Math notes" });
    assert.equal(no.text, TELEGRAM_DECLINE);
    assert.equal(seen.length, 1, "the model, not a rule, declined it");
    assert.equal((await worker.ws.state())!.studySets.length, 0);

    // The laptop is off. Telegram's message reaches the worker (the relay calls host.converse, as it does here).
    const reply = await worker.host.converse!({ id: "tg-1", text: "add a study session for Math on Thursday" });
    assert.match(reply.text, /Added a study session on Thursday/);
    assert.doesNotMatch(reply.text, /```plan/, "Telegram gets the words, not the plan's JSON");
    const copy = (await worker.ws.state())!;
    assert.equal(copy.plans![0].tasks[0].due, thursday);
    assert.equal(copy.studySets.length, 0, "no deck: Telegram makes no files");

    // The laptop opens: its beat sees the worker changed things, the window pulls and applies them.
    await m.heartbeat().catch(() => {});
    assert.ok(changed.includes("workspace"), "the window is told to pull");
    const batch = (await m.pullOps(desk.vpsSync))!;
    desk = applyPull(desk, batch);
    const plan = desk.plans.find((p: any) => p.spaceId === "math");
    assert.deepEqual(plan.tasks.map((t: any) => [t.title, t.due, t.time]), [["Study session: limits and derivatives", thursday, "18:00"]]);
    // The main thread shows the Telegram conversation in order, once, with the plan marked as saved.
    const main = desk.chats.find((c: any) => c.kind === "main");
    assert.deepEqual(main.messages.slice(1).map((x: any) => [x.role, x.via || null]), [["user", "telegram"], ["assistant", null], ["user", "telegram"], ["assistant", null]]);
    const answer = main.messages.find((x: any) => x.content.startsWith("Added a study session"));
    assert.equal(answer.edits["plan-0"].status, "applied");
    assert.equal(desk.chats.length, 1, "no subject chat was opened");
    // Syncing again changes nothing; the desktop's next push doesn't double anything on the worker.
    assert.equal((await m.pullOps(desk.vpsSync))!.ops.length, 0);
    await m.pushWorkspace(true, desk);
    assert.equal((await worker.ws.state())!.plans!.length, 1);
    assert.equal(mainOfState((await worker.ws.state())!).messages.length, 5, "each message once");
  } finally {
    await worker.stop();
    await m.close();
    await db0.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
const mainOfState = (s: any) => s.chats.find((c: any) => c.kind === "main");

test("the worker's loop reads and routes every GUC action, the corrections too (guc.correct, guc.resync)", async () => {
  const { toolRequests } = await import("../desktop/kinetra-turn.ts");
  const { isGucAction, GUC_GUIDE } = await import("../core/guc/ai-tools.ts");
  for (const action of ["guc.correct", "guc.resync", "guc.learn", "guc.uncorrect"]) {
    const req = toolRequests(`{"kinetra":{"action":"${action}","item":"Quiz 2","do":"remove"}}`);
    assert.equal(req?.[0]?.action, action, action + " is a request the loop runs");
    assert.ok(isGucAction(action), action + " goes to runGucTool, as in the window");
  }
  assert.match(GUC_GUIDE, /guc\.correct/, "the worker's prompt (GUC_GUIDE) tells the model about corrections");
});
