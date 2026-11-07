import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { ClaudeProvider } from "../../desktop/claude.ts";
import { Codex } from "../../desktop/codex.ts";
import { COMPACT_AT_TOKENS, ChatSessions, END_AT_TOKENS, HARD_COMPACT_AT_TOKENS, RESUMABLE_KEEP_MS, conversationPrint, type SavedSession } from "../../desktop/chat-sessions.ts";
import { REPLAY_HISTORY, replayBudget } from "../../core/chat-context.ts";
import { contextBudget } from "../../core/context-budget.ts";
import { SPILL_CHARS, spilled } from "../../desktop/kinetra-turn.ts";
import { markStage, turnTimer } from "../../desktop/turn-timing.ts";
import { AntigravityProvider, antigravityModels, thoughtStatus } from "../../desktop/antigravity.ts";

const session = (over: Record<string, unknown> = {}) => ({ provider: "claude", account: "a", model: "claude:sonnet", session: "s", history: "h", sent: new Set(["x"]), context: 10, end: () => {}, ...over });
const want = { provider: "claude", account: "a", model: "claude:sonnet", history: "h" };

test("a chat changes model on the session it has, whichever AI it is", () => {
  const store = new ChatSessions();
  store.keep("u:c", session());
  assert.equal(store.take("u:c", { ...want, model: "claude:opus" })?.session, "s");
  store.keep("u:c", session({ provider: "codex", model: "gpt-a" }));
  assert.equal(store.take("u:c", { ...want, provider: "codex", model: "gpt-b" })?.session, "s");
});

test("every AI's session outlives a long break and a restart, and only the person's own are saved", () => {
  let now = 1000;
  const store = new ChatSessions(() => now);
  store.keep("u:c", session({ native: "agent-1" }));
  store.keep("u:t", session({ provider: "codex", session: "thread" }));
  store.keep("v:c", session({ session: "other person" }));
  const saved = JSON.parse(JSON.stringify(store.snapshot("u:"))) as SavedSession[];
  assert.deepEqual(saved.map((s) => s.session), ["s", "thread"]);
  assert.deepEqual(saved[0].sent, ["x"]);
  assert.equal(saved[0].native, "agent-1");

  now += RESUMABLE_KEEP_MS / 2;
  const next = new ChatSessions(() => now), ended: string[] = [];
  next.restore(saved, (s) => ended.push(s.session));
  const taken = next.take("u:c", want);
  assert.equal(taken?.session, "s");
  assert.ok(taken?.sent.has("x"), "what the session has been sent is remembered");
  taken?.end();
  assert.deepEqual(ended, ["s"]);
  assert.equal(next.take("u:t", { ...want, provider: "codex" })?.session, "thread");

  const late = new ChatSessions(() => now + RESUMABLE_KEEP_MS);
  const gone: string[] = [];
  late.restore(saved, (s) => gone.push(s.session));
  assert.equal(late.size, 0);
  assert.deepEqual(gone, ["s", "thread"]);
});

test("every change to the kept sessions is reported for saving", () => {
  const store = new ChatSessions(), changed: string[] = [];
  store.changed = (key) => changed.push(key);
  store.keep("u:c", session());
  store.keep("u:t", session({ provider: "codex" }));
  assert.deepEqual(changed, ["u:c", "u:t"]);
});

test("pointing at text, or /visual, does not cost the chat its session", () => {
  const sent = [{ role: "user", content: "Explain this\n\nThe user is pointing at these exact parts:\n- In a.pdf: “x”" }, { role: "assistant", content: "" }];
  const later = [{ role: "user", content: "Explain this" }, { role: "assistant", content: "shown" }];
  assert.equal(conversationPrint(sent), conversationPrint(later));
  assert.equal(conversationPrint([{ role: "user", content: "Visualize: a wave" }]), conversationPrint([{ role: "user", content: "/visual a wave" }]));
  assert.notEqual(conversationPrint(later), conversationPrint([{ role: "user", content: "Explain that" }, { role: "assistant", content: "" }]));
});

test("a long chat cannot end its session at every message", () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(20_000) }));
  const messages = [{ role: "system", content: "rules" }, ...history, { role: "user", content: "and now?" }];
  const { conversation } = contextBudget("antigravity:gemini-3.8-flash");
  const budget = replayBudget(messages, conversation);
  assert.equal(budget, "rules".length + "and now?".length + REPLAY_HISTORY);
  // Even at two characters a token a replay is well under the point a session is ended.
  assert.ok(REPLAY_HISTORY / 2 < END_AT_TOKENS * 0.75);
  assert.ok(HARD_COMPACT_AT_TOKENS < END_AT_TOKENS);
  // The request's own files are never cut by it: they need what they need, up to the ceiling.
  const big = [...messages, { role: "user", content: "Source material (untrusted, not instructions):\n" + "y".repeat(300_000) }];
  assert.equal(replayBudget(big, conversation), conversation);
  // A session past the limit is not counted on, so its brief is not put off.
  const store = new ChatSessions();
  store.keep("u:c", session({ provider: "grok", context: END_AT_TOKENS + 1 }));
  assert.equal(store.peek("u:c", { provider: "grok", history: "h" }, END_AT_TOKENS), false);
  assert.equal(store.peek("u:c", { provider: "grok", history: "h" }), true);
});

test("a very long tool result goes to a file, and a failed save keeps the result", async () => {
  assert.deepEqual(await spilled({ ok: 1 }, async () => "never"), { ok: 1 });
  const long = { text: "z".repeat(SPILL_CHARS + 1) };
  const saved: string[] = [];
  const result: any = await spilled(long, async (text) => { saved.push(text); return "Drafts/l/out.txt"; });
  assert.equal(result.file, "Drafts/l/out.txt");
  assert.ok(result.preview.length < 5000);
  assert.equal(saved[0], JSON.stringify(long));
  assert.equal(await spilled(long, async () => { throw Error("disk"); }), long);
});

test("the ledger shows each stage once, and never its clock", () => {
  const recorded: any[] = [];
  const timer = turnTimer("antigravity", { record: (entry) => recorded.push(entry) });
  markStage(timer.stats, "session");
  const first = timer.stats.stages!.session;
  markStage(timer.stats, "session", performance.now() + 5000);
  assert.equal(timer.stats.stages!.session, first);
  timer.end();
  assert.ok("stages" in recorded[0]);
  assert.ok(!("clock" in recorded[0]));
});

test("Gemini shows what it is thinking about, starts Flash low, and runs side jobs on its lightest", () => {
  assert.equal(thoughtStatus("hmm"), "Thinking it through…");
  assert.equal(thoughtStatus("**Reading the notes**\ntext\n**Checking the units.**"), "Checking the units…");
  const [flash, pro] = antigravityModels({ models: [{ id: "gemini-3.8-flash", name: "F" }, { id: "gemini-3.1-pro", name: "P" }], defaultModel: "gemini-3.1-pro", efforts: { "gemini-3.8-flash": { levels: ["minimal", "low", "high"], default: "high" }, "gemini-3.1-pro": { levels: ["low", "high"], default: "high" } } }).sort((a) => /flash/.test(a.id) ? -1 : 1);
  assert.equal(flash.defaultReasoningEffort, "low");
  assert.equal(pro.defaultReasoningEffort, "high");
  const provider: any = new AntigravityProvider("C:/fixture", {} as any);
  provider.statusCache = { at: Date.now(), value: { models: [{ id: "gemini-3.1-pro" }, { id: "gemini-3.8-flash" }], efforts: { "gemini-3.8-flash": { levels: ["minimal", "low"] } } } };
  assert.deepEqual(provider.lightest("antigravity:gemini-3.1-pro"), { model: "antigravity:gemini-3.8-flash", effort: "minimal" });
});

/** A Claude Code that stays open: each line on stdin is answered with a result, and it exits only when killed. */
function openClaude() {
  const provider: any = new ClaudeProvider("fixture", "C:/fixture");
  provider.status = async () => ({ connected: true });
  provider.knownStatus = () => ({ connected: true });
  provider.readUsage = async () => {};
  const started: string[][] = [], lines: any[] = [], children: any[] = [];
  provider.start = async (args: string[]) => {
    started.push(args);
    const child: any = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.exitCode = null;
    child.kill = () => { child.exitCode = 1; child.emit("close", 1); };
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", (line: string) => {
      lines.push(JSON.parse(line));
      queueMicrotask(() => child.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: "Answer " + lines.length, is_error: false }) + "\n"));
    });
    children.push(child);
    return child;
  };
  return { provider, started, lines, children };
}
const folder = { root: "C:/fixture/work", readOnly: [] };
const noCall = async () => ({ result: {}, pictures: [] });

test("a chat's messages go on one open Claude Code, which only a changed setup replaces", async () => {
  const { provider, started, lines, children } = openClaude();
  const id = "11111111-1111-1111-1111-111111111111";
  const answer = async (reply: string, resume: boolean, effort = "low") => {
    const events: any[] = [];
    await provider.run(reply, "Hello", "claude:sonnet", effort, (event: any) => events.push(event), [], { id, resume }, noCall, { system: "rules", workspace: folder });
    return events;
  };
  const first = await answer("one", false);
  assert.equal(first.find((e) => e.type === "delta").text, "Answer 1");
  assert.equal(first.find((e) => e.stage === "session").spare, false);
  assert.ok(started[0].includes("--session-id"));

  const second = await answer("two", true);
  assert.equal(started.length, 1, "no new process");
  assert.equal(second.find((e) => e.type === "delta").text, "Answer 2");
  assert.equal(second.find((e) => e.stage === "session").spare, true);
  assert.equal(lines.length, 2);

  await answer("three", true, "high");
  assert.equal(started.length, 2, "a new thinking level starts it again");
  assert.ok(started[1].includes("--resume"));
  assert.equal(children[0].exitCode, 1, "and closes the old one");

  await provider.endSession(id);
  assert.equal(children[1].exitCode, 1, "an ended session closes its process");
  assert.equal(provider.held.size, 0);
});

test("only a few chats hold a process, and a failed answer does not keep one", async () => {
  const { provider, started, children } = openClaude();
  const uuid = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-1111-1111-1111-111111111111`;
  for (let n = 1; n <= 6; n++) await provider.run("r" + n, "Hi", "claude:sonnet", undefined, () => {}, [], { id: uuid(n), resume: false }, noCall, { system: "rules", workspace: folder });
  assert.equal(started.length, 6);
  assert.equal(provider.held.size, 4);
  assert.equal(children[0].exitCode, 1, "the longest idle goes first");
  provider.stop();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(provider.held.size, 0);
});

const THREAD = "01a1b7ce-519d-76e2-a2b0-c853beeca7a7";
/** A Codex app-server that holds the threads saved in `saved` and records what it is asked. */
function codexServer(saved: Set<string>, { replies = [] as string[], refuse = false, compactFails = false } = {}) {
  const child: any = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => { child.exitCode = 1; child.emit("close", 1); };
  const sent: any[] = [];
  let buffer = "", made = 0;
  const write = (m: any) => queueMicrotask(() => child.stdout.write(JSON.stringify(m) + "\n"));
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (text: string) => {
    buffer += text;
    for (let at; (at = buffer.indexOf("\n")) >= 0;) {
      const req = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1);
      sent.push(req);
      if (req.method === "initialize") write({ id: req.id, result: {} });
      if (req.method === "thread/start") { const id = made++ ? "new-thread-" + made : THREAD; if (!req.params.ephemeral) saved.add(id); write({ id: req.id, result: { thread: { id } } }); }
      if (req.method === "thread/resume") refuse || !saved.has(req.params.threadId)
        ? write({ id: req.id, error: { code: -32600, message: "no rollout found for thread id " + req.params.threadId } })
        : write({ id: req.id, result: { thread: { id: req.params.threadId } } });
      if (req.method === "thread/delete") { saved.delete(req.params.threadId); write({ id: req.id, result: {} }); }
      if (req.method === "thread/compact/start") {
        const threadId = req.params.threadId;
        write({ id: req.id, result: {} });
        write({ method: "turn/completed", params: { threadId, turn: compactFails ? { status: "failed", error: { message: "nope" } } : { status: "completed" } } });
      }
      if (req.method === "turn/start") {
        const threadId = req.params.threadId;
        write({ id: req.id, result: { turn: { id: "turn" } } });
        write({ method: "thread/tokenUsage/updated", params: { threadId, tokenUsage: { last: { inputTokens: child.context ?? 500, cachedInputTokens: 0, outputTokens: 10 } } } });
        write({ method: "item/agentMessage/delta", params: { threadId, itemId: "i" + Math.random(), delta: replies.shift() ?? "Done." } });
        write({ method: "turn/completed", params: { threadId, turn: { status: "completed" } } });
      }
    }
  });
  return { child, sent };
}
const codexWith = (next: () => any, home = "fixture") => {
  const codex: any = new Codex("fixture", home, "fixture");
  codex.models = async () => [];
  codex.validate = async () => {};
  codex.start = async () => next().child;
  return codex;
};
const keepIn = (store: ChatSessions, extra: Record<string, unknown> = {}) => ({ key: "u:c", history: "h", after: "h", blocks: [], continuation: () => "ONLY THE NEW MESSAGE", store, account: "a", ...extra });
const answerOf = (events: any[]) => events.filter((e) => e.type === "delta").map((e) => e.text).join("");
const put = (store: ChatSessions, over: Record<string, unknown> = {}) => store.restore([{ provider: "codex", account: "a", model: "", session: THREAD, history: "h", at: Date.now(), key: "u:c", sent: [], ...over } as any], () => {});

test("a chat's Codex thread is saved; a temporary chat's and a side job's stay ephemeral", async () => {
  const servers: any[] = [], saved = new Set<string>();
  const codex = codexWith(() => { const s = codexServer(saved); servers.push(s); return s; });
  const store = new ChatSessions();
  await codex.run("a", "first", () => {}, [], undefined, undefined, "guide", undefined, undefined, undefined, undefined, keepIn(store));
  const start = servers[0].sent.find((r: any) => r.method === "thread/start");
  assert.equal(start.params.ephemeral, false);
  await codex.run("b", "temporary", () => {});
  assert.equal(servers[0].sent.filter((r: any) => r.method === "thread/start")[1].params.ephemeral, true);
  codex.stop();
});

test("after a restart a chat goes on by id: only the new message is sent, and Kinetra still works on the thread", async () => {
  const saved = new Set([THREAD]);
  const server = codexServer(saved, { replies: ['{"kinetra":{"action":"recipes"}}', "Final answer."] });
  const codex = codexWith(() => server), store = new ChatSessions(), events: any[] = [];
  put(store);
  const asked: any[] = [];
  await codex.run("a", "THE WHOLE CONVERSATION", (e: any) => events.push(e), [], undefined, undefined, "guide", async (request: any) => { asked.push(request); return { recipes: "yes" }; }, undefined, undefined, undefined, keepIn(store));
  const resume = server.sent.find((r: any) => r.method === "thread/resume");
  assert.equal(resume.params.threadId, THREAD);
  assert.ok(resume.params.config["mcp_servers.kinetra.url"], "the resumed thread gets this run's tool endpoint");
  assert.equal(server.sent.some((r: any) => r.method === "thread/start"), false);
  const turns = server.sent.filter((r: any) => r.method === "turn/start");
  assert.equal(turns[0].params.threadId, THREAD);
  assert.match(turns[0].params.input[0].text, /ONLY THE NEW MESSAGE/);
  assert.doesNotMatch(turns[0].params.input[0].text, /THE WHOLE CONVERSATION/);
  assert.deepEqual(asked, [{ action: "recipes" }], "a tool request runs");
  assert.equal(turns[1].params.threadId, THREAD, "and its result goes on the same thread");
  assert.equal(answerOf(events), "Final answer.");
  assert.equal(store.take("u:c", { provider: "codex", account: "a", model: "", history: "h" })?.session, THREAD);
  codex.stop();
});

test("a thread that cannot be resumed costs nothing: the message starts a new one with everything", async () => {
  const server = codexServer(new Set(), { replies: ["Final answer."] });
  const codex = codexWith(() => server), store = new ChatSessions(), events: any[] = [];
  put(store);
  await codex.run("a", "THE WHOLE CONVERSATION", (e: any) => events.push(e), [], undefined, undefined, "guide", undefined, undefined, undefined, undefined, keepIn(store));
  assert.ok(server.sent.some((r: any) => r.method === "thread/resume"));
  const turn = server.sent.find((r: any) => r.method === "turn/start");
  assert.match(turn.params.input[0].text, /THE WHOLE CONVERSATION/);
  assert.equal(answerOf(events), "Final answer.");
  codex.stop();
});

test("a thread past the limit is compacted before the message, and a failed compaction starts a new thread", async () => {
  for (const compactFails of [false, true]) {
    const server = codexServer(new Set([THREAD]), { compactFails, replies: ["Final answer."] });
    const codex = codexWith(() => server), store = new ChatSessions(), events: any[] = [], stats: any = {};
    put(store, { context: HARD_COMPACT_AT_TOKENS + 1, sent: ["guide-print"] });
    await codex.run("a", "THE WHOLE CONVERSATION", (e: any) => events.push(e), [], undefined, undefined, "guide", undefined, undefined, stats, undefined, keepIn(store));
    const order = server.sent.map((r: any) => r.method);
    assert.ok(order.indexOf("thread/resume") < order.indexOf("thread/compact/start"));
    assert.ok(order.indexOf("thread/compact/start") < order.indexOf("turn/start"));
    assert.equal(answerOf(events), "Final answer.");
    assert.equal(!!stats.compacted, !compactFails);
    const turn = server.sent.find((r: any) => r.method === "turn/start");
    assert.equal(order.includes("thread/start"), compactFails);
    assert.match(turn.params.input[0].text, compactFails ? /THE WHOLE CONVERSATION/ : /ONLY THE NEW MESSAGE/);
    codex.stop();
  }
});

test("a large thread asks for idle compaction, and it reopens with its tools when the app-server has gone", async () => {
  const saved = new Set<string>(), servers: any[] = [];
  const codex = codexWith(() => { const s = codexServer(saved); s.child.context = COMPACT_AT_TOKENS + 1; servers.push(s); return s; });
  const store = new ChatSessions(), idle: string[] = [];
  await codex.run("a", "hi", () => {}, [], { model: "gpt" }, undefined, "guide", async () => ({}), undefined, undefined, undefined, keepIn(store, { idle: (model: string) => idle.push(model) }));
  assert.deepEqual(idle, ["gpt"]);
  const mcp = servers[0].sent.find((r: any) => r.method === "thread/start").params.config["mcp_servers.kinetra.url"];
  assert.ok(mcp);

  assert.equal(await codex.compact(THREAD, "gpt"), 0);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].sent.some((r: any) => r.method === "thread/resume"), false, "still open: no resume");

  servers[0].child.kill();
  assert.equal(await codex.compact(THREAD, "gpt"), 0);
  const resume = servers[1].sent.find((r: any) => r.method === "thread/resume");
  assert.equal(resume.params.config["mcp_servers.kinetra.url"], mcp, "the same tools");
  assert.ok(servers[1].sent.some((r: any) => r.method === "thread/compact/start"));
  assert.equal(await codex.compact("not-a-thread-held-here", "gpt"), undefined);
  codex.stop();
});

test("ending a chat's thread removes its saved copy", async () => {
  const home = await mkdtemp(join(tmpdir(), "clem-codex-"));
  try {
    const day = join(home, "sessions", "2026", "11", "07");
    await mkdir(day, { recursive: true });
    const mine = join(day, `rollout-2026-11-07T22-58-34-${THREAD}.jsonl`), other = join(day, "rollout-2026-11-07T22-58-34-11111111-1111-1111-1111-111111111111.jsonl");
    await writeFile(mine, "{}"); await writeFile(other, "{}");
    await codexWith(() => codexServer(new Set()), home).endSession(THREAD);
    assert.equal(existsSync(mine), false);
    assert.equal(existsSync(other), true);
  } finally { await rm(home, { recursive: true, force: true }); }
});
