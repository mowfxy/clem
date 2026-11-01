import test from "node:test";
import assert from "node:assert/strict";
import { entry, forget, parseMemory, recall, remember, serializeMemory, MEMORY_LIMIT } from "../core/project-memory.ts";
import { coordinatorHistory, coordinatorTurn, emptyRoom, modelsOf, readReply, runThread, toggleReaction, type Ask, type Room } from "../core/coordinator.ts";
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

test("a reply that is only a reaction leaves just the reaction", async () => {
  const h = harness();
  const msg = say(h, "thanks!");
  await coordinatorTurn(space, runs, msg, h.io, async () => "[[react: 🙏]]", new AbortController().signal);
  assert.equal(h.room().messages.length, 1);
  assert.deepEqual(h.room().messages[0].reactions, [{ emoji: "🙏", by: "coordinator" }]);
});

test("the coordinator delegates, threads run in parallel, then it answers from their reports", async () => {
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
    if (messages.some((m) => m.content.startsWith("(Thread reports"))) return "Here is the plan: date confirmed, draft ready.";
    onText("On it: research");
    return "On it.\n[[thread: Researcher | Check facts | Check the facts for the launch]]\n[[delegate: Writer | Draft | Write the announcement]]\n[[react: 👀]]";
  };
  await coordinatorTurn(space, runs, msg, h.io, ask, new AbortController().signal);
  const room = h.room();
  assert.equal(most, 2, "both threads ran at once");
  assert.equal(room.threads.length, 2);
  assert.deepEqual(room.threads.map((t) => t.status), ["done", "done"]);
  assert.equal(room.threads[0].summary, "Confirmed the date");
  assert.deepEqual(room.threads.map((t) => t.agent), ["Researcher", "Writer"]);
  assert.deepEqual(room.threads[0].messages[0].reactions, [{ emoji: "✅", by: "Researcher" }]);
  assert.deepEqual(room.messages.map((m) => m.content), ["Plan the launch announcement", "On it.", "Here is the plan: date confirmed, draft ready."]);
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

test("a stopped turn marks the reply stopped and the threads stopped", async () => {
  const h = harness();
  const msg = say(h, "go");
  const stop = new AbortController();
  const ask: Ask = (messages, { chat, signal }) => chat.startsWith("thr-")
    ? new Promise((_, reject) => { setTimeout(() => stop.abort(), 5); signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError"))); })
    : Promise.resolve("[[thread: Researcher | Dig | Dig into it]]");
  await assert.rejects(coordinatorTurn(space, runs, msg, h.io, ask, stop.signal));
  assert.equal(h.room().threads[0].status, "stopped");
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
