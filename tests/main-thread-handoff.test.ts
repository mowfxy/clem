import test from "node:test";
import assert from "node:assert/strict";
import { organizerAsk, workAsk, resolveSpace, lastUsedModel, taskTitle, broughtText, HANDOFF_GUIDE } from "../core/main-thread/handoff.ts";
import { figureBlocks, withoutFigures, replyMessages } from "../core/telegram/render.ts";
import type { RouteSpace } from "../core/main-thread/route.ts";

const spaces: RouteSpace[] = [
  { id: "circ", name: "Circuits", kind: "subject", description: "ELCT 201 · Electric circuits" },
  { id: "ds", name: "Data Structures", kind: "subject", description: "CSEN 301" },
  { id: "web", name: "Portfolio website", kind: "project" },
];

test("the organizer's own business stays in the main thread, subject work does not", () => {
  for (const t of ["remind me about the Circuits quiz tomorrow", "stop telling me about new files in Data Structures", "when is the Circuits midterm", "what's due in CSEN 301 this week", "send me the Circuits lecture 3 slides", "watch for grades in Circuits"])
    assert.equal(organizerAsk(t), true, t);
  for (const t of ["make me a PDF summary of Circuits lecture 3", "explain Kirchhoff's laws from Circuits", "draw a visual of a binary heap for Data Structures", "make flashcards for CSEN 301 chapter 4"])
    assert.equal(organizerAsk(t), false, t);
});

test("only work on the material is handed off by rule; plain questions about a subject stay", () => {
  for (const t of ["whats my quiz 2 math about", "what does the Circuits midterm cover", "what's on the Data Structures final", "what is lecture 4 in Circuits", "how many lectures does Circuits have", "remind me about the Circuits quiz"])
    assert.equal(workAsk(t), false, t);
  for (const t of ["make me a PDF summary of Circuits lecture 3", "explain Kirchhoff's laws from Circuits", "quiz me on Data Structures chapter 4", "/visual a binary heap for CSEN 301", "help me study for Circuits"])
    assert.equal(workAsk(t), true, t);
});

test("clem.handoff finds the space by id, name, course code or a clear spelling", () => {
  assert.equal(resolveSpace("circ", spaces)?.id, "circ");
  assert.equal(resolveSpace("data structures", spaces)?.id, "ds");
  assert.equal(resolveSpace("CSEN 301", spaces)?.id, "ds");
  assert.equal(resolveSpace("Circuts", spaces)?.id, "circ");
  assert.equal(resolveSpace("Biology", spaces), undefined);
  assert.equal(resolveSpace("", spaces), undefined);
});

test("the AI used last runs the hand-off: newest chat with a connected model, never the main thread's", () => {
  const chats = [
    { kind: "main" as const, model: "organizer", updated: 50 },
    { model: "claude:opus", reasoning: "high", updated: 30 },
    { model: "gpt:5", updated: 40 },
    { model: "grok:4", updated: 45, temporary: true },
  ];
  const on = (m: string) => m !== "gpt:5";
  assert.deepEqual(lastUsedModel(chats, on, { model: "default" }), { model: "claude:opus", reasoning: "high" });
  assert.deepEqual(lastUsedModel(chats, () => true, { model: "default" }), { model: "gpt:5", reasoning: undefined });
  assert.deepEqual(lastUsedModel([], () => true, { model: "default", reasoning: "low" }), { model: "default", reasoning: "low" });
});

test("a hand-off's title and what it brings back", () => {
  assert.equal(taskTitle("/visual   a binary heap"), "a binary heap");
  assert.equal(taskTitle("x".repeat(100)).length, 70);
  assert.equal(broughtText("  Here it is.  ", "Circuits"), "Here it is.");
  assert.match(broughtText("", "Circuits"), /ended without an answer/);
  assert.match(HANDOFF_GUIDE, /clem\.handoff/);
});

test("Telegram gets visuals as photos, never their JSON as text", () => {
  const answer = "Here is the heap.\n\n```visual\n{\"title\":\"Heap\"}\n```\n\nAnd a circuit:\n```kinetra\n{\"module\":\"m\",\"fn\":\"f\",\"args\":[]}\n```\nDone.";
  assert.deepEqual(figureBlocks(answer).map((b) => b.lang), ["visual", "kinetra"]);
  assert.equal(figureBlocks(answer)[0].body.trim(), "{\"title\":\"Heap\"}");
  assert.doesNotMatch(withoutFigures(answer), /```|title|module/);
  const html = replyMessages(answer).map((m) => m.html).join("\n");
  assert.match(html, /Here is the heap/);
  assert.doesNotMatch(html, /<pre>|"title"/);
  assert.deepEqual(replyMessages("```visual\n{}\n```"), []);
});
