import test from "node:test";
import assert from "node:assert/strict";
import { entry, forget, parseMemory, recall, remember, serializeMemory, MEMORY_LIMIT } from "../core/project-memory.ts";
import { coordinatorHistory, coordinatorTurn, emptyRoom, modelsOf, readReply, reportsWaiting, runThread, settleRoom, toggleReaction, workThread, type Ask, type Room } from "../core/coordinator.ts";
import type { ProjectRoom, Space } from "../core/types.ts";
import type { MemoryEntry } from "../core/project-memory.ts";

test("the memory file round-trips and keeps one line per fact", () => {
  const facts = [entry("Launch is on December 3.", ["launch", "#Deadline"], "2026-11-01"), entry("The budget is 4000 euros.", ["budget"], "2026-11-02")];
  const file = serializeMemory(facts);
  assert.match(file, /^- 2026-11-01 #launch #deadline \| Launch is on December 3\.$/m);
  assert.deepEqual(parseMemory(file), facts);
  assert.deepEqual(parseMemory(file + "\nnot a fact\n- \n"), facts);
});

test("a restated fact replaces the old one instead of adding a second", () => {
  let m = remember([], [entry("The launch date is December 3", ["launch"])]);
  m = remember(m, [entry("The launch date is December 10", ["date"])]);
  assert.equal(m.length, 1);
  assert.equal(m[0].text, "The launch date is December 10");
  assert.deepEqual(m[0].tags.sort(), ["date", "launch"]);
  assert.equal(forget(m, m[0].id).length, 0);
});

test("the file never grows past its limit; the oldest facts go first", () => {
  const many = Array.from({ length: MEMORY_LIMIT + 20 }, (_, i) => entry(`Fact number ${i} about item${i}`));
  const kept = remember([], many);
  assert.equal(kept.length, MEMORY_LIMIT);
  assert.equal(kept[0].text, "Fact number 20 about item20");
});

test("recall returns only matching lines, best first, inside the budget", () => {
  const m: MemoryEntry[] = [
    entry("The person prefers short answers with bullet points.", ["style"]),
    entry("Launch is on December 3 in Berlin.", ["launch", "deadline"]),
    entry("The budget for ads is 4000 euros.", ["budget", "ads"]),
    entry("Competitor pricing starts at 12 euros a month.", ["pricing"]),
  ];
  const hits = recall(m, "when do we launch?");
  assert.equal(hits[0].text, "Launch is on December 3 in Berlin.");
  assert.ok(!hits.some((e) => e.text.includes("bullet")));
  assert.deepEqual(recall(m, "the weather"), []);
  // Plural and tense still meet the stored word.
  assert.equal(recall(m, "launches")[0]?.tags[0], "launch");
  // The budget holds however many lines match.
  const big = Array.from({ length: 300 }, (_, i) => entry(`Launch note ${i}: ${"detail ".repeat(20)}`));
  const shown = recall(big, "launch note", { chars: 1200 });
  assert.ok(shown.reduce((n, e) => n + e.text.length + 24, 0) <= 1200);
  assert.ok(shown.length > 0);
});

test("directives are read and hidden, even half-written while streaming", () => {
  const { text, directives } = readReply("I'll get research on it.\n[[delegate: researcher | Market size | Estimate the EU market for X | include sources]]\n[[remember: launch, date | Launch is Dec 3]]\n[[react: 👍]]");
  assert.equal(text, "I'll get research on it.");
  assert.deepEqual(directives.delegate, [{ agent: "researcher", title: "Market size", task: "Estimate the EU market for X | include sources" }]);
  assert.deepEqual(directives.remember, [{ tags: ["launch", "date"], text: "Launch is Dec 3" }]);
  assert.equal(directives.react, "👍");
  assert.equal(readReply("Working on it [[delega", true).text, "Working on it");
  assert.equal(readReply("[[react: hello]]").directives.react, undefined);
  assert.equal(readReply("[[react: 🎉]]").text, "");
  // [[thread: …]] is read like [[delegate: …]]; a missing role becomes a plain subagent.
  assert.deepEqual(readReply("[[thread: Analyst | Numbers | Size it]]").directives.delegate, [{ agent: "Analyst", title: "Numbers", task: "Size it" }]);
  assert.deepEqual(readReply("[[thread: Say hello | Say hello to the person]]").directives.delegate, [{ agent: "Subagent", title: "Say hello", task: "Say hello to the person" }]);
});

test("subagents follow the coordinator's model and thinking unless set apart", () => {
  assert.deepEqual(modelsOf({}, "gpt"), { coordinator: { model: "gpt", effort: undefined }, agent: { model: "gpt", effort: undefined } });
  assert.deepEqual(modelsOf({ coordinatorModel: "a", coordinatorEffort: "high" }).agent, { model: "a", effort: "high" });
  assert.deepEqual(modelsOf({ coordinatorModel: "a", coordinatorEffort: "high", agentEffort: "low" }).agent, { model: "a", effort: "low" });
  assert.deepEqual(modelsOf({ coordinatorModel: "a", coordinatorEffort: "high", agentModel: "b" }).agent, { model: "b", effort: undefined });
});

test("reactions toggle per person and emoji", () => {
  let r = toggleReaction(undefined, "👍", "you");
  r = toggleReaction(r, "🎉", "you");
  r = toggleReaction(r, "👍", "you");
  assert.deepEqual(r, [{ emoji: "🎉", by: "you" }]);
});

const space: Space = { id: "p1", name: "Launch", kind: "project", description: "Product launch", memory: "", sources: [] };
const runs = modelsOf({ coordinatorModel: "claude:sonnet", coordinatorEffort: "high" });
function harness(start: MemoryEntry[] = []) {
  let room: ProjectRoom = emptyRoom("p1");
  let memory = start;
  const io: Room = { get: () => room, set: (fn) => { room = fn(room); }, memory: () => memory, saveMemory: (m) => { memory = m; } };
  return { io, room: () => room, memory: () => memory };
}
const say = (h: ReturnType<typeof harness>, content: string) => {
  const m = { id: crypto.randomUUID(), from: "you", content, at: Date.now() };
  h.io.set((r) => ({ ...r, messages: [...r.messages, m] }));
  return m;
};
/** A message through to quiet, as useProjects runs it: threads work on their own, then the coordinator answers their reports. */
async function untilQuiet(h: ReturnType<typeof harness>, msg: { id: string; from: string; content: string; at: number }, ask: Ask, signal = new AbortController().signal, own?: (id: string) => AbortSignal) {
  let opened = await coordinatorTurn(space, runs, msg, h.io, ask, signal);
  while (opened.length) {
    await Promise.all(opened.map((id) => workThread(space, runs.agent, id, h.io, ask, own?.(id) || signal)));
    if (!reportsWaiting(h.io.get())) break;
    opened = await coordinatorTurn(space, runs, null, h.io, ask, signal);
  }
}

test("a reply that is only a reaction leaves just the reaction", async () => {
  const h = harness();
  const msg = say(h, "thanks!");
  await coordinatorTurn(space, runs, msg, h.io, async () => "[[react: 🙏]]", new AbortController().signal);
  assert.equal(h.room().messages.length, 1);
  assert.deepEqual(h.room().messages[0].reactions, [{ emoji: "🙏", by: "coordinator" }]);
});

test("the coordinator delegates, threads run in parallel and text it, then it answers from their reports", async () => {
  const h = harness([entry("Launch is on December 3.", ["launch"])]);
  const msg = say(h, "Plan the launch announcement");
  const seen: string[][] = [];
  let open = 0, most = 0;
  const ask: Ask = async (messages, { chat, onText, model, effort }) => {
    assert.equal(model, "claude:sonnet");
    assert.equal(effort, "high");
    seen.push(messages.map((m) => m.content));
    if (chat.startsWith("thr-")) {
      open++; most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 20));
      open--;
      const brief = messages.at(-1)!.content;
      return brief.includes("facts") ? "Dec 3 confirmed. [[react: ✅]]\n[[summary: Confirmed the date]]\n[[remember: venue | The launch venue is Berlin]]" : "Draft: We launch Dec 3.\n[[summary: Wrote a draft]]";
    }
    if (messages.some((m) => m.content.startsWith("(Thread report"))) return "Here is the plan: date confirmed, draft ready.";
    onText("On it: research");
    return "On it.\n[[thread: Researcher | Check facts | Check the facts for the launch]]\n[[delegate: Writer | Draft | Write the announcement]]\n[[react: 👀]]";
  };
  await untilQuiet(h, msg, ask);
  const room = h.room();
  assert.equal(most, 2, "both threads ran at once");
  assert.equal(room.threads.length, 2);
  assert.deepEqual(room.threads.map((t) => t.status), ["done", "done"]);
  assert.equal(room.threads[0].summary, "Confirmed the date");
  assert.deepEqual(room.threads.map((t) => t.agent), ["Researcher", "Writer"]);
  assert.deepEqual(room.threads[0].messages[0].reactions, [{ emoji: "✅", by: "Researcher" }]);
  assert.deepEqual(room.messages.map((m) => m.content), ["Plan the launch announcement", "On it.", "Confirmed the date", "Wrote a draft", "Here is the plan: date confirmed, draft ready."]);
  assert.deepEqual(room.messages.slice(2, 4).map((m) => [m.from, m.report]), [["Researcher", room.threads[0].id], ["Writer", room.threads[1].id]]);
  assert.deepEqual(room.messages[0].reactions, [{ emoji: "👀", by: "coordinator" }]);
  assert.equal(room.messages[1].threads?.length, 2);
  assert.ok(h.memory().some((e) => e.text === "The launch venue is Berlin"));
  // Memory that matched was sent, and only as matching lines.
  assert.ok(seen[0][0].includes("Launch is on December 3."));
  // Later turns see one-line thread outcomes, not the thread text.
  const history = coordinatorHistory(room).map((t) => t.content).join("\n");
  assert.match(history, /Confirmed the date/);
  assert.doesNotMatch(history, /Dec 3 confirmed\./);
});

test("a recall looks in the memory file and asks once more", async () => {
  const h = harness([entry("The ad budget is 4000 euros.", ["budget"])]);
  const msg = say(h, "what did we decide?");
  let calls = 0;
  await coordinatorTurn(space, runs, msg, h.io, async (messages) => {
    calls++;
    if (calls === 1) return "[[recall: ad budget]]";
    assert.match(messages.at(-1)!.content, /4000 euros/);
    return "We set the ad budget at 4000 euros.";
  }, new AbortController().signal);
  assert.equal(calls, 2);
  assert.deepEqual(h.room().messages.map((m) => m.content), ["what did we decide?", "We set the ad budget at 4000 euros."]);
});

test("stopping everything stops the threads and asks the coordinator for nothing more", async () => {
  const h = harness();
  const msg = say(h, "go");
  const stop = new AbortController();
  const ask: Ask = (messages, { chat, signal }) => chat.startsWith("thr-")
    ? new Promise((_, reject) => { setTimeout(() => stop.abort(), 5); signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError"))); })
    : Promise.resolve("[[thread: Researcher | Dig | Dig into it]]");
  await untilQuiet(h, msg, ask, stop.signal);
  assert.equal(h.room().threads[0].status, "stopped");
  assert.equal(reportsWaiting(h.room()), false);
  assert.equal(h.room().messages.at(-1)!.content, "Stopped.");
});

test("the person can add to a thread and the agent answers there", async () => {
  const h = harness();
  h.io.set((r) => ({ ...r, threads: [{ id: "t1", agent: "writer", title: "Draft", status: "done", created: 1, updated: 1, messages: [{ id: "a", from: "coordinator", content: "Write it", at: 1 }, { id: "b", from: "writer", content: "Draft one", at: 2 }, { id: "c", from: "you", content: "Make it shorter", at: 3 }] }] }));
  const text = await runThread(space, runs.agent, "t1", h.io, async (messages) => {
    assert.equal(messages.at(-1)!.content, "(The person, not the coordinator:) Make it shorter");
    assert.equal(messages.at(-2)!.role, "assistant");
    return "Short draft. [[react: 👍]]";
  }, new AbortController().signal);
  assert.equal(text, "Short draft.");
  const t = h.room().threads[0];
  assert.deepEqual(t.messages.find((m) => m.id === "c")!.reactions, [{ emoji: "👍", by: "writer" }]);
});

test("recall folds accents, in words and in tags", () => {
  const m = [entry("Send the résumé by Friday."), entry("Budget is fixed.", ["café"])];
  assert.equal(recall(m, "resume")[0]?.text, "Send the résumé by Friday.");
  assert.equal(recall(m, "Résumé")[0]?.text, "Send the résumé by Friday.");
  assert.equal(recall(m, "café")[0]?.text, "Budget is fixed.");
});

test("a closing reply that is only a reaction still leaves the person an answer", async () => {
  const h = harness();
  const msg = say(h, "research it");
  let n = 0;
  await untilQuiet(h, msg, async (_, { chat }) => chat.startsWith("thr-") ? "Found it. [[summary: Found it]]" : n++ === 0 ? "On it.\n[[thread: Researcher | Dig | Dig in]]" : "[[react: 👍]]");
  const last = h.room().messages.at(-1)!;
  assert.equal(last.from, "coordinator");
  assert.equal(last.status, "error");
});

test("a memory file that cannot be saved does not lose the reply", async () => {
  const h = harness();
  h.io.saveMemory = async () => { throw Error("disk full"); };
  const msg = say(h, "launch is Dec 3");
  await coordinatorTurn(space, runs, msg, h.io, async () => "Noted.\n[[remember: launch | Launch is Dec 3]]", new AbortController().signal);
  const reply = h.room().messages.at(-1)!;
  assert.equal(reply.content, "Noted.");
  assert.equal(reply.status, undefined);
  assert.equal(reply.remembered, undefined);
});

test("one thread can be stopped alone; the coordinator answers from the rest", async () => {
  const h = harness();
  const own = new Map<string, AbortController>();
  const msg = say(h, "two things");
  let closing = "";
  await untilQuiet(h, msg, (messages, { chat, signal }) => {
    if (chat.startsWith("thr-")) {
      if (messages.at(-1)!.content === "slow") return new Promise((_, reject) => { signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError"))); own.get(chat.slice(4))!.abort(); });
      return Promise.resolve("Quick result. [[summary: Quick]]");
    }
    if (messages.some((m) => m.content.startsWith("(Thread report"))) { closing = messages.map((m) => m.content).join("\n"); return Promise.resolve("Done with what we have."); }
    return Promise.resolve("[[thread: A | Slow | slow]]\n[[thread: B | Fast | fast]]");
  }, undefined, (id) => { const c = new AbortController(); own.set(id, c); return c.signal; });
  assert.deepEqual(h.room().threads.map((t) => t.status), ["stopped", "done"]);
  assert.match(closing, /the person stopped this thread/);
  assert.equal(h.room().messages.at(-1)!.content, "Done with what we have.");
});

test("the coordinator does not wait for its threads, so the person can keep talking", async () => {
  const h = harness();
  const msg = say(h, "research it");
  let release = () => {};
  const held = new Promise<void>((r) => { release = r; });
  const ask: Ask = async (messages, { chat }) => {
    if (chat.startsWith("thr-")) { await held; return "Found it. [[summary: Found it]]"; }
    if (messages.some((m) => m.content.startsWith("(Thread report"))) return "It turned up.";
    return messages.at(-1)!.content === "research it" ? "On it.\n[[thread: Researcher | Dig | Dig in]]" : "Still here.";
  };
  const opened = await coordinatorTurn(space, runs, msg, h.io, ask, new AbortController().signal);
  assert.equal(h.room().threads[0].status, "working");
  const work = workThread(space, runs.agent, opened[0], h.io, ask, new AbortController().signal);
  await coordinatorTurn(space, runs, say(h, "how's the weather"), h.io, ask, new AbortController().signal);
  assert.equal(h.room().messages.at(-1)!.content, "Still here.");
  release();
  await work;
  assert.equal(reportsWaiting(h.room()), true);
  await coordinatorTurn(space, runs, null, h.io, ask, new AbortController().signal);
  assert.equal(h.room().messages.at(-1)!.content, "It turned up.");
  assert.equal(reportsWaiting(h.room()), false);
});

test("what the person adds in a thread comes back to the coordinator", async () => {
  const h = harness();
  const ask: Ask = async (messages, { chat }) => {
    if (chat.startsWith("thr-")) return "Reworked it. [[summary: Reworked the draft]]";
    assert.ok(messages.some((m) => m.content.includes("Reworked it.")), "the coordinator gets the thread's work");
    return "The draft is reworked.";
  };
  const id = crypto.randomUUID(), now = Date.now();
  h.io.set((r) => ({ ...r, threads: [{ id, agent: "Writer", title: "Draft", status: "done", created: now, updated: now, messages: [{ id: "a", from: "coordinator", content: "Write it", at: now }, { id: "b", from: "you", content: "Make it shorter", at: now }] }] }));
  await workThread(space, runs.agent, id, h.io, ask, new AbortController().signal);
  assert.equal(reportsWaiting(h.room()), true);
  await coordinatorTurn(space, runs, null, h.io, ask, new AbortController().signal);
  assert.equal(h.room().messages.at(-1)!.content, "The draft is reworked.");
});

test("a chain of threads stops after one more round", async () => {
  const h = harness();
  let opened = 0;
  await untilQuiet(h, say(h, "go"), async (_, { chat }) => {
    if (chat.startsWith("thr-")) return "Done. [[summary: Done]]";
    opened++;
    return "More.\n[[thread: Researcher | Again | Again]]";
  });
  assert.equal(h.room().threads.length, 2);
  assert.equal(opened, 3);
});

test("a room saved mid-run comes back stopped, not working forever", () => {
  const room: ProjectRoom = { spaceId: "p1", messages: [{ id: "u", from: "you", content: "go", at: 1 }, { id: "w", from: "coordinator", content: "", at: 2, status: "writing" }, { id: "x", from: "coordinator", content: "Half an ans", at: 3, status: "writing" }],
    threads: [{ id: "t", agent: "Researcher", title: "Dig", status: "working", created: 1, updated: 1, messages: [{ id: "b", from: "coordinator", content: "Dig", at: 1 }, { id: "r", from: "Researcher", content: "", at: 2, status: "writing" }] }] };
  const settled = settleRoom(room);
  assert.deepEqual(settled.messages.map((m) => [m.id, m.status]), [["u", undefined], ["x", "stopped"]]);
  assert.equal(settled.threads[0].status, "stopped");
  assert.deepEqual(settled.threads[0].messages.map((m) => m.id), ["b"]);
  const calm = emptyRoom("p2");
  assert.equal(settleRoom(calm), calm);
});
