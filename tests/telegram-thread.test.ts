// Telegram is the main thread only (docs/MAIN-THREAD.md "Telegram"): the laptop's window and the VPS worker answer with
// the same loop, guide and actions, so a set of management requests gives the same answers and the same workspace on
// both; study questions and files are declined in one message on both, and nothing can make them; Clem says once what
// Telegram is for; a lease hand-over loses and doubles nothing; and chats typed in the app stay on the laptop.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../desktop/engine/index.ts";
import { WorkerAgent } from "../desktop/engine/vps/agent.ts";
import type { WorkerWorkspace } from "../desktop/engine/vps/workspace.ts";
import { heldAsk, runThreadTool } from "../desktop/engine/thread-tools.ts";
import { ownTurn, telegramTurn, THREAD_FAILED } from "../desktop/telegram-thread.ts";
import { windowTelegram, type WindowThread } from "../src/telegram/thread.ts";
import { LEARNED_HEAD, NOT_ON_TELEGRAM, TELEGRAM_DECLINE, TELEGRAM_DECLINE_SHORT, TELEGRAM_INTRO, telegramAllows, telegramGuide } from "../core/telegram/thread.ts";
import { MAIN_THREAD_NOTE } from "../core/main-thread/guide.ts";
import { putMessage } from "../core/workspace/apply.ts";
import type { TelegramTurn } from "../desktop/engine/host.ts";
import { host as fakeHost } from "./guc-fake.ts";
import { account, fakeTelegram, hook, msg, workerEnv } from "./telegram-fake.ts";

const T0 = Date.parse("2026-11-15T08:00:00Z");
const req = (o: object) => JSON.stringify({ kinetra: o });
const asked = (input: string) => [...input.matchAll(/\[From Telegram\] (.+)/g)].at(-1)?.[1] || "";
const mainOf = (s: any) => s.chats.find((c: any) => c.kind === "main");

/** What Clem learned about the person (desktop/memory.ts memoryLines): the PC recalls it; the worker gets it sealed. */
const LEARNED = "How the user wants answers (follow these every time unless they ask otherwise now):\n- Answers: short, no emoji";
/** A workspace both sides start from: one subject, the main thread with one message typed in the app. */
const startState = () => ({
  name: "Sam", memory: "Call me Sam.", skills: [], visuals: [], automations: [], studySets: [], plans: [],
  spaces: [{ id: "math", name: "Math", kind: "subject" as const, description: "MATH 301", memory: "", sources: [] }],
  files: [{ id: "f1", name: "Sheet 3.pdf", size: 4, type: "application/pdf", created: 1, spaceId: "math" }],
  chats: [{ id: "main", kind: "main" as const, title: "Clem", spaceId: null, updated: 1, messages: [{ id: "m0", role: "user" as const, content: "I moved my Physics lab to Monday.", at: 1 }, { id: "m1", role: "assistant" as const, content: "Noted.", at: 2 }] }],
});

/** The scripted model: a tool request first, then the answer once it has the results. Records what it was sent. */
function scripted(seen: { system: string; user: string }[]) {
  return async ({ system, user }: { system: string; user: string }) => {
    seen.push({ system, user });
    const q = asked(user), after = /Tool exchanges/.test(user);
    if (/remind me/.test(q)) return after ? "I'll remind you tomorrow at 9:00." : req({ action: "clem.remind", text: "Submit Sheet 3", at: "2026-11-16 09:00" });
    if (/new files/.test(q)) return after ? "Okay, no more news about new files." : req({ action: "clem.mute", kind: "files" });
    if (/exam is on/.test(q)) return after ? "Saved: Math exam on 20 December." : req({ action: "ws.subject", name: "Math", examDate: "2026-12-20" });
    if (/what's on today/.test(q)) return after ? "Nothing from GUC today." : req({ action: "guc.schedule", range: "today" });
    if (/plan two/.test(q)) return "Two sessions are in your plan.\n\n```plan\n" + JSON.stringify({ action: "create", space: "Math", title: "Math study plan", tasks: [{ id: "a", title: "Study: limits", due: "2026-11-17", time: "18:00" }, { id: "b", title: "Study: derivatives", due: "2026-11-19", time: "18:00" }] }) + "\n```";
    // A study question or a file: the model declines it under the guide (the long words once, then the short ones).
    if (/explain the chain rule|PDF of lecture|summari[sz]e (lecture|Lecture)|flashcards from/i.test(q)) return /On Telegram I help you run your day/.test(user.slice(0, user.lastIndexOf("[From Telegram]"))) ? TELEGRAM_DECLINE_SHORT : TELEGRAM_DECLINE;
    // Tries everything Telegram doesn't have.
    if (/sneak/.test(q)) return after ? "Done." : [req({ action: "clem.handoff", space: "Math", task: "Explain limits" }), req({ action: "pdf", title: "Limits", sections: [] }), req({ action: "ws.note", name: "x.md", content: "x" }), req({ action: "ws.flashcards", subject: "Math" }), req({ action: "guc.read", file: "Sheet 3" })].join("\n");
    return "Okay.";
  };
}
const MANAGEMENT = ["remind me to submit Sheet 3 tomorrow at 9", "stop telling me about new files", "the Math exam is on 2026-12-20", "what's on today?", "plan two study sessions for Math this week"];

async function openEngine() {
  const h = fakeHost();
  return Engine.open("owner-1", h, { memory: true, jobs: false, clock: () => T0 });
}

/** The laptop's window: its state, the main process's actions (desktop/main.ts tgTool, tgComplete, tgAsk…, tgMemory) over the
 *  engine, and the window's Telegram queue (src/telegram/thread.ts). */
async function laptop(complete: (r: { system: string; user: string }) => Promise<string>) {
  const engine = await openEngine();
  let state: any = startState();
  const vault = new Map<string, unknown>(), answers: { id: string; text: string }[] = [];
  const invoke = async (r: any): Promise<any> => {
    if (r.action === "tgComplete") return complete({ system: r.system, user: r.user });
    if (r.action === "tgTool") return runThreadTool({ engine, owner: "owner-1", subjects: state.spaces.filter((s: any) => s.kind === "subject") }, r.tool);
    if (r.action.startsWith("tgAsk")) {
      const asks = heldAsk({ get: async () => vault.get("ask") as any, set: async (a) => { if (a) vault.set("ask", a); else vault.delete("ask"); } }, async () => ({ error: "no VPS" }), () => T0);
      return r.action === "tgAskPending" ? asks.pending() : r.action === "tgAskApprove" ? asks.approve(r.at) : asks.drop(r.at);
    }
    if (r.action === "tgMemory") return LEARNED;
    if (r.action === "gucNow") return engine.now().catch(() => null);
    throw Error("unexpected " + r.action);
  };
  const w: WindowThread = { state: () => state, patch: (fn) => { state = fn(state); }, invoke, model: () => "claude:sonnet", clock: () => T0 };
  const send = windowTelegram({ ...w, answer: (id, text) => answers.push({ id, text }), undo: async () => true, confirm: async () => true });
  return { engine, state: () => state, send, answers, invoke };
}
/** The VPS worker's agent over its copy of the workspace (the same shape the WorkerWorkspace keeps). */
async function vps(complete: (r: { system: string; user: string }) => Promise<string>) {
  const engine = await openEngine();
  let state: any = startState();
  const ws = { state: async () => state, change: async (fn: (s: any) => any) => { state = fn(state); return { state, ops: [] }; }, ready: async () => true, drain: async () => {} } as unknown as WorkerWorkspace;
  const root = await mkdtemp(join(tmpdir(), "clem-tg-"));
  const agent = new WorkerAgent({ owner: "owner-1", complete: (r) => complete(r), engine: () => engine, ws, files: root, clock: () => T0, learned: async () => LEARNED });
  return { engine, state: () => state, agent, root };
}
const shape = (s: any) => ({ messages: mainOf(s).messages.map((m: any) => [m.role, m.content.replace(/\n```plan[\s\S]*```/, " [plan]"), m.via || null]), plans: (s.plans || []).map((p: any) => [p.spaceId, p.title, p.tasks.map((t: any) => [t.title, t.due, t.time])]), spaces: s.spaces.map((x: any) => [x.name, x.examDate || null]), chats: s.chats.length, files: s.files.length, studySets: s.studySets.length });

test("the same management requests give the same answers and the same workspace from the laptop's window and from the VPS worker", { timeout: 60_000 }, async () => {
  const seenL: { system: string; user: string }[] = [], seenW: { system: string; user: string }[] = [];
  const L = await laptop(scripted(seenL)), W = await vps(scripted(seenW));
  try {
    const fromLaptop: string[] = [], fromVps: string[] = [];
    for (const [i, text] of MANAGEMENT.entries()) {
      await L.send({ id: "m" + (i + 1), text });
      fromLaptop.push(L.answers.at(-1)!.text);
      fromVps.push((await W.agent.converse({ id: "m" + (i + 1), text })).text);
    }
    assert.deepEqual(fromLaptop, fromVps, "word for word the same");
    assert.deepEqual(fromLaptop, ["I'll remind you tomorrow at 9:00.", "Okay, no more news about new files.", "Saved: Math exam on 20 December.", "Nothing from GUC today.", "Two sessions are in your plan."]);
    assert.deepEqual(shape(L.state()), shape(W.state()), "the same main thread, plans and subjects");
    const s = shape(L.state());
    assert.deepEqual(s.plans[0][2], [["Study: limits", "2026-11-17", "18:00"], ["Study: derivatives", "2026-11-19", "18:00"]]);
    assert.deepEqual(s.spaces, [["Math", "2026-12-20"]]);
    assert.equal(s.messages.length, 2 + MANAGEMENT.length * 2, "each message and answer once, in order");
    assert.ok(s.messages.slice(2).every((m: any, i: number) => m[0] === (i % 2 ? "assistant" : "user") && (i % 2 || m[2] === "telegram")));
    // The organizer did the same on both engines.
    assert.deepEqual((await L.engine.organizer.reminders()).map((r: any) => r.text), (await W.engine.organizer.reminders()).map((r: any) => r.text));
    assert.equal((await L.engine.organizer.reminders()).length, 1);
    assert.deepEqual((await L.engine.organizer.mutesList()).map((m: any) => m.kind), (await W.engine.organizer.mutesList()).map((m: any) => m.kind));
    // The same guide and prompt on both: no hand-off, no file tools; the app's own messages are known.
    assert.equal(seenL[0].system, seenW[0].system);
    assert.equal(seenL[0].system, telegramGuide());
    assert.doesNotMatch(seenL[0].system, /"action":"clem\.handoff"|"action":"pdf"|ws\.note|ws\.flashcards|makeFile/);
    assert.equal(seenL[0].user, seenW[0].user);
    assert.match(seenW[0].user, /I moved my Physics lab to Monday/, "the app's main-thread messages are known to the worker");
    assert.match(seenW[0].user, /Call me Sam/, "and the person's memory");
    assert.ok(seenW[0].user.includes(LEARNED_HEAD + "\n" + LEARNED), "and what Clem learned about them, as the app's main thread gets it");
  } finally { await L.engine.close(); await W.engine.close(); await rm(W.root, { recursive: true, force: true }); }
});

test("a study question and a file reach the model on both sides, which declines them (the long message once, then briefly); nothing can make them", { timeout: 60_000 }, async () => {
  const seenL: { system: string; user: string }[] = [], seenW: { system: string; user: string }[] = [];
  const L = await laptop(scripted(seenL)), W = await vps(scripted(seenW));
  try {
    for (const [i, text] of ["explain the chain rule", "make me a PDF of lecture 3", "summarize lecture 2 please"].entries()) {
      await L.send({ id: "d" + i, text });
      const w = await W.agent.converse({ id: "d" + i, text });
      assert.equal(L.answers.at(-1)!.text, w.text);
      assert.equal(w.text, i === 0 ? TELEGRAM_DECLINE : TELEGRAM_DECLINE_SHORT, "the whole message once, then short");
    }
    assert.equal(seenL.length, 3, "no rule answered before the model: it decided each one");
    assert.equal(seenW.length, 3);
    // An old lecture message's Summarize button goes to the model the same way.
    const tap: TelegramTurn = { id: "t1", tap: { t: "summarize", subjectId: "math", fileId: "m3", name: "Lecture 3" } as any };
    assert.equal((await W.agent.converse(tap)).text, TELEGRAM_DECLINE_SHORT);
    // A model that tries anyway finds none of it: no hand-off, no file, no deck.
    const w = await W.agent.converse({ id: "s1", text: "sneak a few things" });
    assert.equal(w.text, "Done.");
    const results = seenW.at(-1)!.user;
    assert.equal((results.match(/Not available on Telegram/g) || []).length, 4, "each request was refused");
    const s = W.state();
    assert.equal(s.chats.length, 1, "no subject chat");
    assert.equal(s.files.length, 1, "no file");
    assert.equal(s.studySets.length, 0, "no deck");
    for (const a of ["clem.handoff", "pdf", "docx", "pptx", "xlsx", "image", "file", "call", "look", "crop", "ws.note", "ws.flashcards", "ws.files", "read"]) assert.equal(telegramAllows(a), false, a);
    for (const a of ["clem.remind", "clem.undo", "guc.read", "guc.grades", "guc.correct", "guc.resync", "telegram.sendFile", "vps.keep", "vps.run_command", "ws.subject"]) assert.equal(telegramAllows(a), true, a);
    assert.deepEqual(await runThreadTool({ engine: W.engine, owner: "owner-1", subjects: [] }, { action: "pdf" }), NOT_ON_TELEGRAM, "the engine's side refuses too");
  } finally { await L.engine.close(); await W.engine.close(); await rm(W.root, { recursive: true, force: true }); }
});

test("a question about the course or their marks is answered, reading the marks and the first lecture; unasked, no file is read", { timeout: 60_000 }, async () => {
  const q = "whats my highest achievable rn in math, look at the first lecture where it says the components.";
  const asks: string[] = [];
  let state: any = startState();
  const deps = { ws: { state: () => state, change: (fn: any) => { state = fn(state); } }, clock: () => T0, run: async (t: any) => { asks.push(t.action); return t.action + " result"; },
    complete: async ({ user }: { user: string }) => /Tool exchanges/.test(user) ? "96.5% is the most you can still get." : [req({ action: "guc.grades", subject: "Math" }), req({ action: "guc.read", file: "Lecture 1", subject: "Math" })].join("\n") };
  assert.equal((await telegramTurn(deps, q)).text, "96.5% is the most you can still get.");
  assert.deepEqual(asks, ["guc.grades", "guc.read"]);
  assert.match(telegramGuide(), /highest achievable in Math/);
  // The engine's side runs it too (no GUC here, so it says so instead of refusing).
  const W = await vps(scripted([]));
  try { assert.notDeepEqual(await runThreadTool({ engine: W.engine, owner: "owner-1", subjects: [] }, { action: "guc.read", file: "Lecture 1" }), NOT_ON_TELEGRAM); }
  finally { await W.engine.close(); await rm(W.root, { recursive: true, force: true }); }
  asks.length = 0;
  await ownTurn(deps, { key: "k1", brief: "A new lecture is out." });
  assert.deepEqual(asks, ["guc.grades"], "speaking by itself, Clem reads no file");
});

test("the decline is the model's: the guide gives it the words, and no rule answers before it", async () => {
  const src = await readFile("desktop/telegram-thread.ts", "utf8") + await readFile("core/telegram/thread.ts", "utf8");
  assert.doesNotMatch(src, /telegramDeclines|declineReply/, "no pre-model decline");
  assert.ok(telegramGuide().includes(TELEGRAM_DECLINE) && telegramGuide().includes(TELEGRAM_DECLINE_SHORT), "the model is told the same words");
  assert.ok(!MAIN_THREAD_NOTE.includes(TELEGRAM_DECLINE), "the app's main thread still does everything");
  assert.match(MAIN_THREAD_NOTE, /clem\.handoff/, "including the hand-off");
});

test("a failed turn is tried once more; a second failure is told in one plain sentence, once, in the main thread too", async () => {
  let calls = 0;
  let state: any = startState();
  const deps = { ws: { state: () => state, change: (fn: any) => { state = fn(state); } }, complete: async () => { if (++calls === 1) throw Error("network"); return "All set."; }, run: async () => ({}), clock: () => T0 };
  assert.equal((await telegramTurn(deps, "anything due?")).text, "All set.");
  assert.equal(calls, 2, "retried once");
  calls = 0;
  const failing = { ...deps, complete: async () => { calls++; throw Error("down"); } };
  assert.equal((await telegramTurn(failing, "and tomorrow?")).text, THREAD_FAILED);
  assert.equal(calls, 2);
  const msgs = mainOf(state).messages.slice(2).map((m: any) => m.content);
  assert.deepEqual(msgs, ["anything due?", "All set.", "and tomorrow?", THREAD_FAILED]);
});

test("the window answers Telegram one at a time, in order, each once; never through the app's chats", async () => {
  const order: string[] = [];
  let release!: () => void;
  const first = new Promise<void>((r) => { release = r; });
  const complete = async ({ user }: { system: string; user: string }) => { const q = asked(user); if (q === "one") await first; order.push(q); return "ok " + q; };
  const L = await laptop(complete);
  try {
    const a = L.send({ id: "m1", text: "one" }), b = L.send({ id: "m2", text: "two" });
    L.send({ id: "m1", text: "one" }); // delivered twice: answered once
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(order, [], "the second waits for the first");
    release();
    await a; await b;
    assert.deepEqual(order, ["one", "two"]);
    assert.deepEqual(L.answers.map((x) => [x.id, x.text]), [["m1", "ok one"], ["m2", "ok two"]]);
    assert.equal(L.state().chats.length, 1, "no other chat touched");
  } finally { await L.engine.close(); }
  // Source: the window's Telegram never goes through `send` (the app's chat pipeline, its working folder and tools).
  const app = await readFile("src/App.tsx", "utf8");
  assert.ok(!/tgQueue|telegramTurns|turn\?\.tg|telegramOut/.test(app), "no Telegram turn is queued into the app's chats");
  assert.match(app, /desktop\.onTelegram\(\(turn\)=>\{void telegramIn\.current!\(turn\);\}\)/);
});

test("Clem says once what Telegram is for: after pairing, to people already paired, never twice, not again from the other side", async () => {
  const env = workerEnv(), tg = fakeTelegram();
  const open = async (main: { content: string }[]) => {
    const h = Object.assign(fakeHost(), { account: account(env, tg, "owner-1"), converse: async () => ({ text: "ok" }) });
    h.workspace = async () => ({ spaces: [], plans: [], files: [], studySets: [], automations: [], chats: [{ id: "main", kind: "main", messages: main }] });
    return Engine.open("owner-1", h, { memory: true, jobs: false });
  };
  const pc = await open([]);
  try {
    const p = await pc.telegram.pair(); await hook(env, tg, msg(42, p.code)); await pc.telegram.status(true);
    const intros = () => tg.said().filter((b) => b.text === TELEGRAM_INTRO).length;
    await pc.telegram.introduce();
    assert.equal(intros(), 1, "told once after pairing");
    const posts = (await pc.organizer.inbox()).posts.map((x) => x.content);
    assert.ok(posts.includes(TELEGRAM_INTRO), "the same words land in the main thread");
    await pc.telegram.introduce();
    assert.equal(intros(), 1, "never twice");
    // The VPS (its own database) sees the main thread already has it.
    const worker = await open([{ content: TELEGRAM_INTRO }]);
    try { await worker.telegram.introduce(); assert.equal(intros(), 1, "not again from the other side"); } finally { await worker.close(); }
    assert.ok(!/ask anything/i.test((await import("../cloudflare/telegram.js" as string)).PAIRED), "the pairing message no longer promises answers to anything");
  } finally { await pc.close(); }
});

test("a lease hand-over: what one side pulled is answered by it or by the other, never both, never neither", async () => {
  const env = workerEnv(), tg = fakeTelegram();
  const answered: string[] = [];
  let release!: () => void;
  const slow = new Promise<void>((r) => { release = r; });
  const open = (who: string, wait?: Promise<void>) => {
    const h = Object.assign(fakeHost(), { account: account(env, tg, "owner-1"), converse: async (t: TelegramTurn) => { if ("text" in t && t.text === "first" && wait) await wait; answered.push(who + ":" + ("text" in t ? t.text : "tap")); return { text: "ok" }; } });
    return Engine.open("owner-1", h, { memory: true, jobs: false });
  };
  const pc = await open("pc", slow), worker = await open("vps");
  try {
    const p = await pc.telegram.pair(); await hook(env, tg, msg(42, p.code)); await pc.telegram.status(true); await worker.telegram.status(true);
    for (const t of ["first", "second", "third"]) await hook(env, tg, msg(42, t));
    // The PC pulls all three and starts on the first (slowly); the lease moves to the VPS meanwhile.
    const pulling = pc.telegram.pullOnce();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(await worker.telegram.pullOnce(), 0, "what the PC is answering stays with it");
    await pc.telegram.stop();
    release();
    await pulling;
    // What the PC pulled and hadn't started went back at once: the VPS answers it.
    assert.equal(await worker.telegram.pullOnce(), 2);
    assert.deepEqual(answered, ["pc:first", "vps:second", "vps:third"], "each once, in order");
    assert.equal(await pc.telegram.pullOnce(), 0);
    assert.equal(await worker.telegram.pullOnce(), 0, "nothing left, nothing twice");
    const rows = env.DB.db.prepare("SELECT id FROM telegram_inbox").all();
    assert.equal(rows.length, 0, "every message acknowledged");
  } finally { await pc.close(); await worker.close(); }
});

test("chats typed in the app run on the laptop: nothing in their path waits for or goes to the VPS", async () => {
  const app = await readFile("src/App.tsx", "utf8"), main = await readFile("desktop/main.ts", "utf8");
  // The chat request (every chat typed in the app: main thread, subject, project, temporary, hand-offs) answers with
  // the laptop's own AI: no worker call in it, no Telegram, no lease check.
  const chat = main.slice(main.indexOf('if (request.action === "chat") {'), main.indexOf('ipcMain.handle("clem:request"'));
  assert.ok(chat.length > 1000);
  assert.ok(!/\.remote\(\)|vpsRunsJobs|workerRuns|converse\(/.test(chat.replace(/clem\.run_routine[\s\S]*?\n {10}\}/, "")), "no reroute to the worker");
  assert.match(chat, /answerWith\(user\.id, request\.id, request\.model/, "the chat's own model on this PC");
  // The window's send never asks whether the worker runs jobs; only the scheduled routine tick does.
  const send = app.slice(app.indexOf("async function send("), app.indexOf("function documentsIn("));
  assert.ok(send.length > 1000 && !/vpsRunsJobs|onTelegram|tgComplete/.test(send));
  assert.equal((app.match(/vpsRunsJobs/g) || []).length, 1, "only the scheduled routines defer to the worker");
  // GUC's Now card never holds a message back for long while it comes from the worker.
  assert.match(send, /await gucNowQuick\(\)/);
  assert.match(app, /GUC_NOW_WAIT_MS = 1200/);
  // A routine run by hand from a chat here is thought by the laptop's AI even while the worker keeps the routines.
  assert.match(main, /clem\.run_routine" && typeof tool\.id === "string" && await vpsManagers\.get\(user\.id\)\?\.remote\(\)/);
  assert.match(main, /engineHost\(user\.id\)\.complete!\(\{ \.\.\.prompt, model: request\.model/);
});

test("a routine run by hand: the prompt comes from where the routines are, the words from the AI that was asked", async () => {
  let asks = 0;
  const h = Object.assign(fakeHost(), { complete: async () => { asks++; return '{"say":"from the server"}'; } });
  const engine = await Engine.open("owner-1", h, { memory: true, jobs: false, clock: () => T0 });
  h.speaker = engine.organizer;
  try {
    const made = await engine.organizer.tool({ action: "clem.routine", title: "Evening prep", instructions: "Say what tomorrow needs.", trigger: { type: "schedule", cron: "0 20 * * *" } }, {}) as { id: string };
    const prompt = await engine.organizer.routinePrompt(made.id);
    assert.match(prompt!.user, /Routine: Evening prep/);
    const r = await engine.organizer.runRoutine(made.id, { kind: "manual" }, { reply: '{"say":"Tomorrow: Sheet 3 is due at 9."}' }) as { said?: string };
    assert.equal(r.said, "Tomorrow: Sheet 3 is due at 9.", "the laptop's words");
    assert.equal(asks, 0, "the server's model wasn't asked");
    await engine.organizer.runRoutine(made.id);
    assert.equal(asks, 1, "a scheduled run still thinks where it runs");
  } finally { await engine.close(); }
});

test("long answers reach Telegram split at paragraphs; the worker sends no photos", async () => {
  const env = workerEnv(), tg = fakeTelegram();
  const h = Object.assign(fakeHost(), { account: account(env, tg, "owner-1") });
  const engine = await Engine.open("owner-1", h, { memory: true, jobs: false });
  try {
    const p = await engine.telegram.pair(); await hook(env, tg, msg(42, p.code)); await engine.telegram.status(true);
    const long = Array.from({ length: 40 }, (_, i) => `Item ${i}: ` + "due soon ".repeat(25)).join("\n\n") + "\n\n```visual\n{\"title\":\"x\"}\n```";
    const before = tg.calls.length;
    await engine.telegram.post(long);
    const sent = tg.calls.slice(before);
    assert.ok(sent.filter((c) => c.method === "sendMessage").length > 1, "split");
    assert.ok(sent.every((c) => c.method === "sendMessage" && c.body.text.length <= 4096), "every part fits, and nothing is a photo");
    assert.ok(sent.map((c) => c.body.text).join("\n").includes("Item 39"), "nothing lost");
    assert.ok(!sent.some((c) => /visual/.test(c.body.text)), "a stray visual block is never sent as text");
  } finally { await engine.close(); }
  const worker = await readFile("worker/index.ts", "utf8"), docker = await readFile("worker/Dockerfile", "utf8");
  assert.ok(!/chromium|setPageOpener|PageTasks|kinetraCall/i.test(worker + docker), "no headless browser or file making on the worker");
});

void putMessage;

test("the window's answer to a briefing Clem speaks by itself (own-<uuid>) passes the request check, as a Telegram item's does", async () => {
  const { requestSchema } = await import("../desktop/contracts.ts");
  for (const id of ["m123", "t9", "own-" + crypto.randomUUID()]) assert.doesNotThrow(() => requestSchema.parse({ action: "tgAnswered", id, text: "x" }), id);
  assert.throws(() => requestSchema.parse({ action: "tgAnswered", id: "../x", text: "x" }));
  for (const r of [{ action: "tgMemory", text: "hi" }, { action: "tgAskPending" }, { action: "tgAskApprove", at: 5 }, { action: "tgAskDrop", at: 5 }]) assert.doesNotThrow(() => requestSchema.parse(r), r.action);
});
