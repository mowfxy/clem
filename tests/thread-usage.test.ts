import test from "node:test";
import assert from "node:assert/strict";
import { addUsage, costOf, money, rateOf, threadUsage } from "../core/thread-usage.ts";
import type { Chat, StoredFile } from "../core/types.ts";

const file = (id: string, name: string, made = false): StoredFile => ({ id, name, size: 1, type: "text/plain", created: 0, spaceId: null, made });

test("two reports for one reply add up and join the files they opened", () => {
  const a = { model: "grok:grok-4.6", tokens: { input: 100, cacheRead: 10, cacheWrite: 0, output: 5 }, calls: 2, ms: 1000, read: ["a.md"], web: 1 };
  const sum = addUsage(a, { tokens: { input: 50, cacheRead: 0, cacheWrite: 4, output: 5 }, calls: 1, ms: 500, read: ["a.md", "b.pdf"] });
  assert.deepEqual(sum.tokens, { input: 150, cacheRead: 10, cacheWrite: 4, output: 10 });
  assert.equal(sum.calls, 3);
  assert.equal(sum.ms, 1500);
  assert.deepEqual(sum.read, ["a.md", "b.pdf"]);
  assert.equal(sum.web, 1);
  assert.equal(sum.model, "grok:grok-4.6");
});

test("API prices come from the model family, cache reads at a tenth of input", () => {
  assert.deepEqual(rateOf("claude:opus"), [5, 25]);
  assert.deepEqual(rateOf("antigravity:gemini-3.8-flash"), [0.3, 2.5]);
  assert.deepEqual(rateOf("something-new"), [2, 10]);
  // 1M fresh input at $5, 1M cached at $0.50, 1M output at $25.
  assert.equal(costOf({ model: "claude:opus", tokens: { input: 1e6, cacheRead: 1e6, cacheWrite: 0, output: 1e6 } }), 30.5);
  assert.equal(money(0), "$0");
  assert.equal(money(0.004), "< $0.01");
  assert.equal(money(0.042), "$0.04");
  assert.equal(money(12.4), "$12");
});

test("a thread's summary counts files sent, opened and made, its visuals and only replies with counts", () => {
  const chat: Chat = { id: "c1", title: "Queues", spaceId: null, updated: 0, messages: [
    { id: "u1", role: "user", content: "explain", attachments: ["f1"], drive: [{ id: "d1", name: "Drive doc" } as any] },
    { id: "a1", role: "assistant", content: "old reply" },
    { id: "u2", role: "user", content: "a pdf please", context: ["f1"] },
    { id: "a2", role: "assistant", content: "Here.\n```visual\n{}\n```", model: "antigravity:gemini-3.8-flash", attachments: ["f2"],
      usage: { tokens: { input: 19_000, cacheRead: 0, cacheWrite: 0, output: 600 }, calls: 3, ms: 9000, read: ["Queues_Lecture_5_Notes.md"], web: 2 } },
  ] };
  const u = threadUsage(chat, { files: [file("f1", "notes.md"), file("f2", "Queues.pdf", true)], visuals: [], studySets: [] });
  assert.equal(u.messages, 2);
  assert.equal(u.replies, 2);
  assert.equal(u.counted, 1);
  assert.equal(u.total, 19_600);
  assert.deepEqual(u.sent.map((f) => f.name), ["notes.md"]);
  assert.deepEqual(u.made.map((f) => f.name), ["Queues.pdf"]);
  assert.deepEqual(u.read, ["Queues_Lecture_5_Notes.md"]);
  assert.equal(u.drive, 1);
  assert.equal(u.visuals, 1);
  assert.equal(u.web, 2);
  assert.ok(u.cost > 0.005 && u.cost < 0.01);
});
