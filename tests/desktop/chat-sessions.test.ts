import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatSessions, COMPACT_AT_TOKENS, KEEP_MS, MAX_KEPT, blockPrint, conversationPrint, instructionsPrint, sentAfter } from "../../desktop/chat-sessions.ts";
import { runKinetraTurn, SessionLost, BATCH_NOTE, LONE_STEPS, batchParts } from "../../desktop/kinetra-turn.ts";
import { StepCounter } from "../../desktop/tool-status.ts";
import { fileIndex } from "../../core/source-context.ts";
import { mirrorFor, workspaceNote } from "../../desktop/ai-workspace.ts";

const want = { provider: "claude", account: "a1", model: "claude:sonnet", history: "h1" };
const session = (over: Partial<Parameters<ChatSessions["keep"]>[1]> = {}, ended: string[] = []) =>
  ({ provider: "claude", account: "a1", model: "claude:sonnet", session: "s1", history: "h1", sent: new Set<string>(), end: () => ended.push(over.session || "s1"), ...over });

test("a chat's next message goes on its kept session only when nothing about it changed", () => {
  let now = 1000;
  const store = new ChatSessions(() => now);
  const ended: string[] = [];
  store.keep("u:c1", session({}, ended));
  // Taken by the answer that continues it: a second answer at the same time never shares it.
  assert.equal(store.take("u:c1", want)?.session, "s1");
  assert.equal(store.take("u:c1", want), undefined);
  // A different AI, account, model or conversation starts a new session, and the old one is removed.
  for (const change of [{ provider: "grok" }, { account: "a2" }, { model: "claude:opus" }, { history: "edited" }]) {
    store.keep("u:c1", session({ session: "s-" + Object.keys(change)[0] }, ended));
    assert.equal(store.take("u:c1", { ...want, ...change }), undefined);
  }
  assert.deepEqual(ended, ["s-provider", "s-account", "s-model", "s-history"]);
  // Idle past the providers' prompt cache: replaying it would cost more than the text it saves.
  store.keep("u:c1", session({ session: "old" }, ended));
  now += KEEP_MS;
  assert.equal(store.take("u:c1", want), undefined);
  assert.equal(ended.at(-1), "old");
  // A session whose context grew large is still continued, with its size, so the caller compacts it first.
  store.keep("u:c1", session({ session: "big", context: COMPACT_AT_TOKENS + 1 }, ended));
  assert.equal(store.take("u:c1", want)?.context, COMPACT_AT_TOKENS + 1);
});

test("kept sessions are ended when idle, beyond the limit, on delete and on sign-out", () => {
  let now = 0;
  const store = new ChatSessions(() => now);
  const ended: string[] = [];
  for (let i = 0; i < MAX_KEPT + 2; i++) store.keep("u:c" + i, session({ session: "s" + i }, ended));
  assert.equal(store.size, MAX_KEPT);
  assert.deepEqual(ended, ["s0", "s1"]);
  store.drop("u:c5");
  assert.equal(ended.at(-1), "s5");
  now = KEEP_MS;
  store.sweep();
  assert.equal(store.size, 0);
  store.keep("u:c1", session({ session: "x" }, ended));
  store.clear();
  assert.equal(ended.at(-1), "x");
});

test("a kept session remembers only the instructions it last received", () => {
  const a = instructionsPrint("Plan A"), b = instructionsPrint("Plan B"), note = blockPrint("note");
  const first = sentAfter([], [note, a]);
  assert.ok(first.has(a) && first.has(note));
  // Unchanged instructions stay as received; changed ones replace them, so going back to A sends A again.
  const second = sentAfter(first, [b]);
  assert.deepEqual([...second].sort(), [note, b].sort());
  assert.equal(sentAfter(second, [note]).has(b), true);
});

test("each part of the instructions is remembered on its own, so only the part that changed goes again", () => {
  const stable = instructionsPrint("RULES", 0), quiz = instructionsPrint("Quiz playbook", 1), plan = instructionsPrint("Plan playbook", 1);
  assert.notEqual(instructionsPrint("Same", 0), instructionsPrint("Same", 1));
  const first = sentAfter([], [stable, quiz]);
  // The next message changes only its own part: the stable part stays as received, the old playbook is forgotten.
  const second = sentAfter(first, [stable, plan]);
  assert.deepEqual([...second].sort(), [stable, plan].sort());
  assert.equal(second.has(quiz), false);
});

test("the conversation fingerprint follows the person's words and the order of answers, not how answers are shown", () => {
  const before = [{ role: "user", content: "Explain RC circuits" }];
  const after = conversationPrint([...before, { role: "assistant", content: "" }]);
  // The next message sees the answer as the chat stored it (file cards, folded notes): still the same conversation.
  assert.equal(conversationPrint([...before, { role: "assistant", content: "**RC circuits** … [file card]" }]), after);
  assert.notEqual(conversationPrint([{ role: "user", content: "Explain RL circuits" }, { role: "assistant", content: "" }]), after);
  assert.notEqual(conversationPrint(before), after);
  assert.equal(blockPrint("a"), blockPrint("a"));
});

test("a continued answer sends only this message, and a lost session falls back to the whole prompt", async () => {
  const calls: { input: string; followUp: boolean }[] = [];
  const stats = { steps: 0, calls: 0, broken: 0, continued: true };
  let lose = true;
  const answer = await runKinetraTurn("THIS MESSAGE", "", async (input, followUp) => {
    calls.push({ input, followUp });
    if (followUp && lose) { lose = false; throw new SessionLost("gone"); }
    return "Answer";
  }, async () => 1, () => false, { stateful: true, continued: true, fresh: "WHOLE CONVERSATION", stats });
  assert.equal(answer, "Answer");
  // The kept session is resumed first with only the message; when it is gone, a new session gets everything.
  assert.deepEqual(calls.map((c) => c.followUp), [true, false]);
  assert.match(calls[0].input, /THIS MESSAGE/);
  assert.match(calls[1].input, /WHOLE CONVERSATION/);
  assert.equal(stats.continued, false);
  // A continued answer that works needs one step and no fallback.
  const one: boolean[] = [];
  await runKinetraTurn("M", "", async (_i, followUp) => { one.push(followUp); return "A"; }, async () => 1, () => false, { stateful: true, continued: true, fresh: "F" });
  assert.deepEqual(one, [true]);
});

test("a kept session that lost its guide gets it back with the whole prompt", async () => {
  const inputs: string[] = [];
  await runKinetraTurn("M", "", async (input, followUp) => { inputs.push(input); if (followUp) throw new SessionLost("gone"); return "A"; }, async () => 1, () => false, { stateful: true, continued: true, fresh: "F", freshInstructions: "GUIDE" });
  assert.match(inputs[1], /^GUIDE\n\nOriginal request and context:\nF$/);
});

test("several requests in one batch call run as separate requests, in either protocol", async () => {
  assert.equal(batchParts({ action: "call" }), null);
  assert.deepEqual(batchParts({ action: "batch", requests: [{ action: "read" }, { action: "batch" }, 3, { nope: 1 }] }), [{ action: "read" }]);
  const ran: string[] = [];
  const tool = async (r: any) => { ran.push(r.file); return { text: "of " + r.file }; };
  let native: any;
  await runKinetraTurn("q", "", async (_i, _f, _p, n) => {
    native = n;
    if (!ran.length) {
      const out = await n({ action: "batch", requests: [{ action: "read", file: "a" }, { action: "read", file: "b" }] });
      assert.deepEqual(out.result, { results: [{ text: "of a" }, { text: "of b" }] });
      return "done";
    }
    return "done";
  }, tool, () => false, { stateful: true });
  assert.deepEqual(ran, ["a", "b"]);
  assert.ok(native);
  // The text protocol: a batch envelope runs its parts.
  ran.length = 0;
  const replies = ['{"kinetra":{"action":"batch","requests":[{"action":"read","file":"x"},{"action":"read","file":"y"}]}}', "final"];
  await runKinetraTurn("q", "", async () => replies.shift()!, tool, () => false);
  assert.deepEqual(ran.sort(), ["x", "y"]);
});

test("a model that asks for one quick request per step is reminded to batch, a few times at most", async () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const notes: (string | undefined)[] = [];
  await runKinetraTurn("q", "", async (_i, _f, _p, native) => {
    // Seven steps of one read each, the model "writing" between them.
    for (let i = 0; i < 7; i++) { await sleep(450); const out: any = await native({ action: "read", file: "f" + i }); notes.push(out.result?.note); }
    // Then a step that batches: two calls together get no reminder.
    await sleep(450);
    const [a, b]: any[] = await Promise.all([native({ action: "read", file: "g" }), native({ action: "read", file: "h" })]);
    notes.push(a.result?.note, b.result?.note);
    return "done";
  }, async () => ({ ok: true }), () => false, { stateful: true });
  const reminded = notes.map((n) => n === BATCH_NOTE);
  // Not on the first steps; then on every (LONE_STEPS + 1)th lone step; never on the batched calls.
  assert.equal(reminded.slice(0, LONE_STEPS).some(Boolean), false);
  assert.equal(reminded[LONE_STEPS], true);
  assert.deepEqual(reminded.slice(-2), [false, false]);
  assert.ok(reminded.filter(Boolean).length <= 3);
});

test("steps and calls are counted the same way for every CLI's stream", () => {
  const counter = new StepCounter();
  const msg = (id: string, ...parts: any[]) => ({ type: "assistant", message: { id, content: parts } });
  counter.read(msg("m1", { type: "tool_use", id: "t1", name: "Read" }));
  counter.read(msg("m1", { type: "tool_use", id: "t2", name: "Read" }));
  counter.read(msg("m1", { type: "tool_use", id: "t2", name: "Read" }));
  counter.read(msg("m2", { type: "text", text: "hi" }));
  counter.read(msg("m3", { type: "tool_use", id: "t3", name: "mcp__kinetra__kinetra" }));
  // A subagent's own calls are its work, not the answer's steps.
  counter.read({ ...msg("m4", { type: "tool_use", id: "t4", name: "Read" }), parent_tool_use_id: "t9" });
  assert.deepEqual([counter.steps, counter.calls], [2, 3]);
});

test("PDFs are read as drawn by every CLI: no PDF text pasted in, and Codex is told to look at the pages", () => {
  const index = fileIndex([{ name: "Lab.pdf", text: "short pdf text" }, { name: "notes.txt", text: "short note" }], [0, 1]);
  assert.doesNotMatch(index, /\[Source: Lab\.pdf; complete file\]/);
  assert.match(index, /\[Source: notes\.txt; complete file\]/);
  const state: any = { files: [{ id: "p", name: "Lab.pdf", size: 10, type: "application/pdf", created: 1, spaceId: null }], spaces: [], chats: [{ id: "c", messages: [{ role: "user", attachments: ["p"] }] }] };
  const library = [{ name: "Lab.pdf", text: "[Lab.pdf, page 1]\ntext" }];
  const codex = mirrorFor({ state, scope: "workspace", chat: "c", lane: "l", blob: (id) => id, library }).files.map((f) => f.path);
  const claude = mirrorFor({ state, scope: "workspace", chat: "c", lane: "l", blob: (id) => id, library, pdfText: false }).files.map((f) => f.path);
  assert.ok(codex.includes("_text/Files/Lab.pdf.txt") && !claude.includes("_text/Files/Lab.pdf.txt"));
  assert.match(workspaceNote("C:/w", codex, [], { nativePdf: false }), /no PDF viewer of your own[^]*look/);
  assert.match(workspaceNote("C:/w", claude, []), /PDFs and pictures open natively, every page as drawn/);
  assert.doesNotMatch(workspaceNote("C:/w", claude, []), /no PDF viewer/);
});

test("Codex's steps are its model outputs, and the tool calls after each belong to it", async () => {
  const { streamTurn } = await import("../../desktop/codex-stream.ts");
  let listener: any;
  const server: any = {
    ready: Promise.resolve(), activeThreads: 1, close() {},
    subscribe(_id: string, l: any) { listener = l; return () => {}; },
    async request(method: string) { return method === "turn/start" ? { turn: { id: "t" } } : {}; },
  };
  const steps = new StepCounter();
  const turn = streamTurn(server, { threadId: "th" }, "hi", undefined, [], () => {}, () => false, { steps }, 1000);
  await new Promise((r) => setTimeout(r, 0));
  const started = (item: any) => listener.onMessage("item/started", { item });
  started({ id: "r1", type: "reasoning" });
  started({ id: "k1", type: "mcpToolCall", tool: "kinetra", arguments: {} });
  started({ id: "k2", type: "mcpToolCall", tool: "kinetra", arguments: {} });
  started({ id: "x1", type: "commandExecution" });
  started({ id: "r2", type: "reasoning" });
  started({ id: "k3", type: "mcpToolCall", tool: "kinetra", arguments: {} });
  started({ id: "m", type: "agentMessage", phase: "final_answer", text: "" });
  listener.onMessage("turn/completed", { turn: { status: "completed" } });
  await turn;
  assert.deepEqual([steps.steps, steps.calls], [2, 4]);
});
