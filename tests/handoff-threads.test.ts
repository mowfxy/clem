// Hand-offs that continue a space's existing thread, go to several places, and come back exactly once
// (core/main-thread/handoff.ts; src/App.tsx startHandoff, handoffTool, finishHandoff).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spaceThreads, threadLines, spaceHints, carriedFrom, carriedLabel, handoffResult, HANDOFF_GUIDE, SPACE_POST_GUIDE } from "../core/main-thread/handoff.ts";
import type { RouteSpace } from "../core/main-thread/route.ts";

const H = 3_600_000, now = 100 * 24 * H;
const msg = (role: "user" | "assistant", content: string) => ({ role, content });
const chats = [
  { id: "c1", title: "Nodal analysis", spaceId: "circ", updated: now - 2 * H, summary: "Working through nodal analysis on sheet 3.", messages: [msg("user", "explain nodal analysis")] },
  { id: "c2", title: "Thevenin", spaceId: "circ", updated: now - 30 * H, messages: [msg("user", "first"), msg("assistant", "a"), msg("user", "make a PDF of Thevenin equivalents ```x``` please")] },
  { id: "old", title: "Archived", spaceId: "circ", updated: now, archived: "earlier", messages: [msg("user", "x")] },
  { id: "tmp", title: "Temp", spaceId: "circ", updated: now, temporary: true, messages: [msg("user", "x")] },
  { id: "setup", title: "Setup", spaceId: "circ", updated: now, setup: {}, messages: [msg("user", "x")] },
  { id: "empty", title: "New", spaceId: "circ", updated: now, messages: [] },
  { id: "main", title: "Main", kind: "main" as const, spaceId: "circ", updated: now, messages: [msg("user", "x")] },
  { id: "d1", title: "Heaps", spaceId: "ds", updated: now, messages: [msg("user", "heaps")] },
];

test("a space's threads: real ones only, newest first, with a short gist", () => {
  const list = spaceThreads(chats, "circ");
  assert.deepEqual(list.map((t) => t.id), ["c1", "c2"], "archived, temporary, setup, empty and main threads are left out");
  assert.equal(list[0].gist, "Working through nodal analysis on sheet 3.", "the chat's summary first");
  assert.equal(list[1].gist, "make a PDF of Thevenin equivalents please", "else its latest request, without code");
  assert.deepEqual(spaceThreads(chats, "circ", { exclude: "c1" }).map((t) => t.id), ["c2"], "a chat never lists itself");
  const lines = threadLines(list, now);
  assert.match(lines, /^- c1: "Nodal analysis" \(2 h ago\) · Working through/);
  assert.match(lines, /\n- c2: "Thevenin" \(1 d ago\)/);
  assert.equal(threadLines([], now), "");
});

test("the main-thread AI sees the hinted spaces' threads, so it can continue one", () => {
  const spaces: RouteSpace[] = [{ id: "circ", name: "Circuits", kind: "subject" }, { id: "ds", name: "Data Structures", kind: "subject" }];
  const hints = spaceHints("more practice on Circuits nodal analysis", spaces, [], (id) => threadLines(spaceThreads(chats, id), now));
  assert.match(hints, /Threads in "Circuits" \(newest first\):\n- c1: "Nodal analysis"/);
  assert.doesNotMatch(hints, /Data Structures/, "only the spaces the message may be about");
  assert.equal(spaceHints("plan my day", spaces, [], () => "- x"), "", "no space, no threads");
});

test("the guides: continue a thread on the same topic, a new one only when none fits, one call per place", () => {
  assert.match(HANDOFF_GUIDE, /"thread":"<the id of its thread to continue, or leave out for a new one>"/);
  assert.match(HANDOFF_GUIDE, /Not every request needs a new thread/);
  assert.match(HANDOFF_GUIDE, /clem\.threads/);
  assert.match(HANDOFF_GUIDE, /several subjects or projects gets one call per place/);
  assert.match(SPACE_POST_GUIDE, /"action":"clem\.handoff","thread":"<its id>"/);
  assert.match(SPACE_POST_GUIDE, /Everything else you answer here yourself/);
});

test("the receiving thread is told where the message came from; the note's label says so", () => {
  const fromMain = carriedFrom("the person's main thread", "You: hi\nClem: hello");
  assert.equal(fromMain, "Sent here from the person's main thread.\nWhat was said there just before:\nYou: hi\nClem: hello");
  assert.equal(carriedLabel(fromMain), "From your main thread");
  assert.equal(carriedLabel(carriedFrom('their "Nodal analysis" thread in Circuits', "")), "From “Nodal analysis” in Circuits");
  assert.equal(carriedLabel("You: an older note"), "From your main thread", "notes from before stay labelled as before");
});

test("what comes back is that thread's answer to the handed message, never an older one, and a lost message is said", () => {
  const thread = [
    { id: "u0", role: "user", content: "earlier question" }, { id: "a0", role: "assistant", content: "Earlier answer." },
    { id: "u1", role: "user", content: "the hand-off" }, { id: "a1", role: "assistant", content: "Here it is.", attachments: ["pdf-1"] },
    { id: "u2", role: "user", content: "a later message the person typed there" }, { id: "a2", role: "assistant", content: "Later answer." },
  ];
  assert.deepEqual(handoffResult(thread, "u1", "Circuits", "make the PDF"), { ran: true, content: "Here it is.", attachments: ["pdf-1"] });
  const lost = handoffResult(thread.slice(0, 2), "u1", "Circuits", "make the PDF of sheet 3");
  assert.equal(lost.ran, false);
  assert.match(lost.content, /couldn't pass this to Circuits/);
  assert.match(lost.content, /“make the PDF of sheet 3”/, "the request is kept, not lost");
  assert.match(handoffResult([{ id: "u1", role: "user", content: "x" }], "u1", "Circuits", "x").content, /ended without an answer/);
});

test("the window: hand-offs keyed by their own message, waiting for busy threads, passed on once per turn", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  assert.match(app, /id: turn\?\.userId \|\| uid\(\)/, "the handed message gets the id its result is found by");
  assert.match(app, /findIndex\(\(q\) => !q\.turn\.into \|\| !\(q\.turn\.into\.id in runs\)\)/, "the queue sends only into threads that aren't answering");
  assert.match(app, /if \(into\) \{ handoffQueue\.current\.push\(/, "a hand-off that meets a busy thread goes back in the queue, not dropped");
  assert.match(app, /if\(r!=="waiting"&&turn\?\.userId\)finishHandoff\(turn\.userId\)/, "and its result is not posted until it ran");
  assert.match(app, /if \(o\.done\?\.has\(key\)\) return o\.done\.get\(key\)/, "the same hand-off asked twice in a turn runs once");
  assert.match(app, /From this chat you can post only into/, "a subject chat posts only into its own space's threads");
  assert.match(app, /thread && connectedModel\(thread\.model\)/, "an existing thread keeps its own AI");
  assert.match(app, /user\.carried \? `Context carried with this message/, "the main thread sees where a sent-up message came from");
  assert.doesNotMatch(app, /sentUp\b/, "one record for every hand-off, sent up or down");
  const { ACTIONS } = await import("../desktop/kinetra-turn.ts");
  assert.ok(ACTIONS.has("clem.threads"));
  const { telegramAllows } = await import("../core/telegram/thread.ts");
  for (const a of ["clem.handoff", "clem.threads", "clem.toMain"]) assert.equal(telegramAllows(a), false, `${a} stays off Telegram`);
});
