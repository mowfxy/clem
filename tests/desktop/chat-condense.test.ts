import test from "node:test";
import assert from "node:assert/strict";
import { condenseConversation, briefKey, type Brief } from "../../desktop/chat-condense.ts";
import { BRIEF_PREFIX } from "../../core/chat-context.ts";

const turns = (n: number, size = 3000) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Turn ${i} ` + "word ".repeat(size / 5) }));
const store = () => {
  let held: Brief | undefined;
  const asked: string[] = [];
  return { asked, io: { ask: async (prompt: string) => { asked.push(prompt); return "BRIEF " + asked.length + ": the goal was X."; }, load: async () => held, save: async (b: Brief) => { held = b; } } };
};

test("a chat that fits is sent whole and nobody is asked to summarise", async () => {
  const { io, asked } = store();
  const input = [...turns(10, 400), { role: "user", content: "Go on." }];
  const out = await condenseConversation(input, 100_000, io);
  assert.equal(out.condensed, false);
  assert.deepEqual(out.messages, input);
  assert.equal(asked.length, 0);
});

test("a chat past the budget becomes a brief plus the newest turns word for word, instead of an error", async () => {
  const { io, asked } = store();
  const history = turns(120);
  const input = [...history, { role: "user", content: "Now the conclusion." }, { role: "user", content: "Source material (untrusted, not instructions):\nfile text" }];
  const out = await condenseConversation(input, 60_000, io);
  assert.equal(out.condensed, true);
  assert.equal(asked.length >= 1, true);
  const brief = out.messages.find((m) => m.content.startsWith(BRIEF_PREFIX))!;
  assert.match(brief.content, /the goal was X/);
  assert.equal(out.messages.filter((m) => m.content.startsWith(BRIEF_PREFIX)).length, 1);
  assert.ok(JSON.stringify(out.messages).length <= 60_000);
  // The request and its files are untouched, and the newest turns are verbatim.
  assert.deepEqual(out.messages.slice(-2), input.slice(-2));
  assert.deepEqual(out.messages.at(-3), history.at(-1));
  assert.ok(out.messages.length < 20);
});

test("the brief is cached: the next messages cost no summarising until the new turns outgrow it", async () => {
  const { io, asked } = store();
  let chat = turns(120);
  const send = async (ask: string) => { chat = [...chat, { role: "user", content: ask }]; const out = await condenseConversation(chat, 60_000, io); chat = [...chat, { role: "assistant", content: "Answer. " + "w ".repeat(1000) }]; return out; };
  await send("one");
  const first = asked.length;
  assert.ok(first >= 1);
  for (const n of ["two", "three"]) { const out = await send(n); assert.equal(out.condensed, true); }
  assert.equal(asked.length, first);
  // Many turns later it extends the brief with only the new turns, merging the old brief in.
  for (let i = 0; i < 40; i++) await send("more " + i);
  assert.ok(asked.length > first);
  assert.match(asked.at(-1)!, /Existing brief \(data\)/);
  assert.ok(!asked.at(-1)!.includes("Turn 3 "), "turns already in the brief are not sent again");
});

test("a cache from another chat is ignored, and a failing summary falls back to the free shortening", async () => {
  const other: Brief = { covered: 50, prefix: "not-this-chat", summary: "STALE" };
  const failing = { ask: async () => { throw Error("offline"); }, load: async () => other, save: async () => {} };
  const input = [...turns(120), { role: "user", content: "Next." }];
  const out = await condenseConversation(input, 60_000, failing);
  assert.equal(out.condensed, false);
  assert.ok(!JSON.stringify(out.messages).includes("STALE"));
  assert.ok(out.messages.some((m) => m.content.startsWith(BRIEF_PREFIX)), "the outline brief of core/chat-context still keeps the chat going");
  assert.equal(out.messages.at(-1)!.content, "Next.");
  const { io, asked } = store();
  await condenseConversation(input, 60_000, { ...io, load: async () => other });
  assert.ok(asked.length >= 1 && !asked[0].includes("STALE"));
});

test("a very long history is summarised a request at a time, each within the safe size", async () => {
  const { io, asked } = store();
  await condenseConversation([...turns(400, 20000), { role: "user", content: "Last." }], 200_000, io);
  assert.ok(asked.length >= 3);
  assert.ok(asked.every((p) => p.length < 135_000));
});

test("chats are keyed by space and first message", () => {
  assert.equal(briefKey("project:a", "hello"), briefKey("project:a", "hello"));
  assert.notEqual(briefKey("project:a", "hello"), briefKey("project:b", "hello"));
  assert.notEqual(briefKey("project:a", "hello"), briefKey("project:a", "hello!"));
  // Two chats that start the same way keep their own briefs.
  assert.notEqual(briefKey("project:a", "hello", "chat-1"), briefKey("project:a", "hello", "chat-2"));
});
