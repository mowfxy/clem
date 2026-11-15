// Clem on the VPS with the laptop off (docs/GUC-VPS-ENGINE.md "Workspace on the VPS"): a Telegram request is carried
// out by the worker's own agent (the same loop, hand-off, plans and flashcards as the window), its changes kept in the
// worker's copy of the workspace, and they appear in the desktop's workspace when it opens and syncs. The worker runs
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
import { studyInstructions } from "../core/study.ts";
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

test("with no window, a Telegram request is carried out on the VPS and lands in the desktop's workspace after it syncs", { timeout: 180_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "clem-agent-"));
  const data = join(root, "worker", "state"), files = join(root, "files");
  await mkdir(join(data, "secrets"), { recursive: true }); await mkdir(files, { recursive: true });
  const key = randomBytes(32), rpc = randomBytes(16).toString("hex"), port = await freePort();
  await writeFile(join(data, "secrets", secretFile("rpc")), seal(key, "rpc", rpc));

  // The person's Math notes, kept on the VPS (content-addressed, as VpsStore keeps them).
  const notes = new TextEncoder().encode("# Limits\nA limit describes what f(x) approaches as x approaches a.\n\n# Derivatives\nThe derivative is the limit of the difference quotient.");
  const hash = sha256(notes);
  await writeFile(join(files, hash + ".blob"), notes);

  // The server's model, scripted: the main thread hands the deck to Math and plans Thursday itself; the deck is
  // written from the notes the worker read.
  const thursday = nextThursday();
  const seen: { system: string; user: string }[] = [];
  let mainSteps = 0;
  const complete = async ({ system, user }: { system: string; user: string }) => {
    seen.push({ system, user });
    if (system === studyInstructions) {
      assert.match(user, /difference quotient/, "the deck is written from the notes on the VPS");
      return JSON.stringify({ title: "Math: limits and derivatives", items: [{ question: "What is a limit?", answer: "What f(x) approaches as x approaches a." }, { question: "What is a derivative?", answer: "The limit of the difference quotient." }, { question: "Limit notation?", answer: "lim x→a f(x)" }] });
    }
    assert.match(system, /main thread/);
    mainSteps++;
    if (mainSteps === 1) {
      assert.match(user, /\[From Telegram\] make me flashcards from my Math notes and add a study plan for Thursday/);
      assert.match(user, /Subjects: Math/, "the Now card is in the context");
      return '{"kinetra":{"action":"clem.handoff","space":"Math","task":"Make flashcards from my Math notes"}}';
    }
    assert.match(user, /A new chat in Math is doing it/, "the hand-off's result came back to the loop");
    return `On it in Math. I added a study session on Thursday.\n\n\`\`\`plan\n${JSON.stringify({ action: "create", space: "Math", title: "Math study plan", tasks: [{ id: "t1", title: "Study session: limits and derivatives", due: thursday, time: "18:00" }] })}\n\`\`\``;
  };

  const { backend: wb } = await openPglite();
  const worker = await startWorker({ config: { owner: OWNER, accountService: "http://127.0.0.1:9" }, key, env: { CLEM_DATA: data, CLEM_FILES: files, CLEM_PORT: String(port), CLEM_HOOK_PORT: "0", PATH: process.env.PATH }, migrations: "desktop/engine/migrations", backend: wb, beat: 3_600_000, complete });

  // The desktop: its engine's database (where the router keeps file rows), its Vault and a fake VPS whose tunnel
  // reaches the worker.
  const { backend: db0, db } = await openPglite();
  await migrate(db0, "desktop/engine/migrations");
  const engine = { db, runner: async () => {}, telegram: { start() {} }, organizer: { announce: async () => {} } } as unknown as Engine;
  const link = new (class extends FakeVps { async tunnel() { return { port, close() {} }; } })();
  const kept = new Map<string, unknown>();
  kept.set("vps-" + OWNER, { config: { host: "vps.test", port: 22, user: "u", auth: "key", fingerprint: "SHA256:x" }, privateKey: "k", storage: { mode: "vps" }, worker: { enabled: true, kind: "docker", key: key.toString("base64"), rpc, installedAt: 1 } } satisfies VpsVault);
  const changed: string[] = [];
  const m = new VpsManager({ owner: OWNER, secrets: { get: async <T,>(k: string) => kept.get(k) as T, set: async (k, v) => { kept.set(k, v); }, delete: async (k) => { kept.delete(k); } }, local: new FakeLocal(), files: root, engine: async () => engine, bundle: "", accountService: "", connect: async () => link, changed: (w) => changed.push(w) });
  await m.ready();
  (await m.router()).markVps("notes", `${vpsRoot(OWNER)}/${hash}.blob`, hash, notes.length, false);

  // The desktop's workspace, sent once while the laptop was on.
  let desk: any = {
    name: "Sam", memory: "", skills: [], visuals: [], automations: [], studySets: [], plans: [],
    spaces: [{ id: "math", name: "Math", kind: "subject", description: "MATH 301", memory: "", sources: [] }],
    files: [{ id: "notes", name: "Math notes.md", size: notes.length, type: "text/markdown", created: 1, spaceId: "math" }],
    chats: [{ id: "main", kind: "main", title: "Clem", spaceId: null, updated: 1, messages: [{ id: "m0", role: "assistant", content: "Good morning.", at: 1 }] }],
  };
  try {
    await m.pushWorkspace(true, desk);
    assert.ok(await worker.ws.ready(), "the worker holds a copy of the workspace");

    // The laptop is off. Telegram's message reaches the worker (the relay calls host.converse, as it does here).
    const reply = await worker.host.converse!({ id: "tg-1", text: "make me flashcards from my Math notes and add a study plan for Thursday" });
    assert.match(reply.text, /On it in Math/);
    assert.doesNotMatch(reply.text, /```plan/, "Telegram gets the words, not the plan's JSON");
    await worker.agent!.idle();

    // The worker's copy has the deck in Math, the plan with Thursday's session, and the conversation.
    const copy = (await worker.ws.state())!;
    assert.equal(copy.studySets.length, 1);
    assert.equal(copy.plans![0].tasks[0].due, thursday);

    // The laptop opens: its beat sees the worker changed things, the window pulls with its inbox and applies them.
    await m.heartbeat().catch(() => {});
    assert.ok(changed.includes("workspace"), "the window is told to pull");
    const batch = (await m.pullOps(desk.vpsSync))!;
    desk = applyPull(desk, batch);
    const deck = desk.studySets.find((s: any) => s.spaceId === "math");
    assert.equal(deck?.title, "Math: limits and derivatives");
    assert.equal(deck.items.length, 3);
    const plan = desk.plans.find((p: any) => p.spaceId === "math");
    assert.equal(plan.title, "Math study plan");
    assert.deepEqual(plan.tasks.map((t: any) => [t.title, t.due, t.time]), [["Study session: limits and derivatives", thursday, "18:00"]]);
    // The main thread shows the Telegram conversation, the plan marked as saved, and the hand-off's result.
    const main = desk.chats.find((c: any) => c.kind === "main");
    const asked = main.messages.find((x: any) => x.role === "user");
    assert.equal(asked.via, "telegram");
    const answer = main.messages.find((x: any) => x.content.startsWith("On it in Math"));
    assert.equal(answer.edits["plan-0"].status, "applied");
    assert.ok(main.messages.some((x: any) => x.brought?.space === "math" && /3 flashcards/.test(x.content)), "the hand-off's result is back in the main thread");
    assert.ok(desk.chats.some((c: any) => c.spaceId === "math" && c.messages.length === 2), "the deck was made in a new chat in Math");
    assert.deepEqual(desk.vpsSync.id, batch.id);

    // Syncing again changes nothing; the desktop's next push doesn't double anything on the worker.
    assert.equal((await m.pullOps(desk.vpsSync))!.ops.length, 0);
    await m.pushWorkspace(true, desk);
    const after = (await worker.ws.state())!;
    assert.equal(after.studySets.length, 1); assert.equal(after.plans!.length, 1);
    assert.ok(seen.length >= 3);
  } finally {
    await worker.stop();
    await m.close();
    await db0.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
