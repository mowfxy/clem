import test from "node:test";
import assert from "node:assert/strict";
import { spaceHints, resolveSpace, lastUsedModel, taskTitle, broughtText, HANDOFF_GUIDE } from "../core/main-thread/handoff.ts";
import { figureBlocks, withoutFigures, replyMessages } from "../core/telegram/render.ts";
import type { RouteSpace } from "../core/main-thread/route.ts";

const spaces: RouteSpace[] = [
  { id: "circ", name: "Circuits", kind: "subject", description: "ELCT 201 · Electric circuits" },
  { id: "ds", name: "Data Structures", kind: "subject", description: "CSEN 301" },
  { id: "web", name: "Portfolio website", kind: "project" },
];

test("the main-thread AI is told which spaces a message may be about; nothing is handed off for it", () => {
  assert.match(spaceHints("explain Kirchhoff's laws from Circuits", spaces), /"Circuits" \(subject\)/);
  assert.match(spaceHints("help with the CSEN 301 sheet", spaces), /"Data Structures"/);
  assert.equal(spaceHints("plan my day please", spaces), "", "no space named, no hint");
  const mentioned = spaceHints("summarize lecture 5", spaces, ["web"]);
  assert.match(mentioned, /@mentioned "Portfolio website" \(project\)[^.]*: their choice of space/);
  assert.equal(spaceHints("anything", spaces, ["gone"]), "", "a mention of a space that no longer exists is ignored");
  assert.doesNotMatch(spaceHints("Circuits", spaces, ["circ"]), /may be about/, "a mentioned space isn't listed twice");
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

test("no rule hands a main-thread message off before the AI answers (owner, 2026-11-27)", async () => {
  const handoff = await import("../core/main-thread/handoff.ts");
  for (const gone of ["handsOff", "workAsk", "organizerAsk", "mainOnly"]) assert.equal(gone in handoff, false, gone);
  const route = await import("../core/main-thread/route.ts");
  assert.equal("routeMessage" in route, false);
  const app = await import("node:fs/promises").then((f) => f.readFile("src/App.tsx", "utf8"));
  assert.doesNotMatch(app, /handsOff\(|mainOnly\(|isEditRequest\(/, "the window decides nothing about what a message means");
  assert.match(app, /spaceHints\(prompt, /, "the AI gets the spaces as context");
  assert.match(app, /if \(op === "handoff"\) return Promise\.resolve\(\{ data: handoffTool\(chat, args, \{ attachments: user\.attachments/, "the AI's hand-off carries the message's files");
  assert.match(app, /You mentioned|@mentioned \$\{chosen/, "an @mention stays the person's choice of space");
  assert.match(HANDOFF_GUIDE, /Naming a subject is never by itself a reason to hand off/);
  assert.match(HANDOFF_GUIDE, /@mentioned is their own choice of space/);
});

test("a hand-off's result in the main thread: its files posted with it, its visuals left in the chat it opened", async () => {
  const { broughtMessage } = await import("../core/main-thread/handoff.ts");
  assert.deepEqual(broughtMessage({ content: "Here is your summary.", attachments: ["pdf-1", "deck-2"] }, "Circuits"), { content: "Here is your summary.", attachments: ["pdf-1", "deck-2"] }, "files come into the main thread");
  const visual = broughtMessage({ content: "A heap, drawn:\n\n```visual\n{\"title\":\"Heap\"}\n```" }, "Data Structures");
  assert.doesNotMatch(visual.content, /```visual/);
  assert.match(visual.content, /^A heap, drawn:\n\nDone: the visual is in the Data Structures chat\. Open it to see it\.$/);
  assert.equal(broughtMessage({ content: "```kinetra\n{}\n```" }, "Physics").content, "Done: the visual is in the Physics chat. Open it to see it.");
  assert.equal("attachments" in visual, false);
  const app = await import("node:fs/promises").then((f) => f.readFile("src/App.tsx", "utf8"));
  assert.match(app, /const brought = broughtMessage\(reply, h\.name\)/, "the window posts exactly that");
  assert.match(app, /type: "handoff", spaceId: space\.id[^\n]*chatId: id/, "the card links the chat the person can open");
});
