import test from "node:test";
import assert from "node:assert/strict";
import { PROFILE_SCOPE, forgetBlocks, forgetWords, learnMemories, mayConcernUser, memoryBlocks, memoryLines, parseExtraction, retrieveMemory, type MemoryState } from "../../desktop/memory.ts";
import { looksSecret } from "../../core/secrets.ts";

const empty = (): MemoryState => ({ enabled: true, records: [] });
const now = "2026-11-27T10:00:00.000Z";

test("the AI decides what the person stated: kept items are confirmed, the rest stay learned", () => {
  const items = parseExtraction(JSON.stringify({ memories: [
    { topic: "Studies", note: "3rd-year CS", kind: "fact", about: "user", kept: true },
    { topic: "Studies", note: "likes graphs", kind: "fact", about: "user" },
  ] }));
  assert.equal(items[0].kept, true);
  assert.equal(items[1].kept, undefined);
  const state = learnMemories(empty(), items, { scope: "chat:a", sourceId: "chat:a", explicit: false, now });
  const lines = memoryLines(retrieveMemory(state, "chat:a", "studies", { now: Date.parse(now) }), "chat:a");
  assert.match(lines, /Studies: 3rd-year CS \| inferred: likes graphs/);
});

test("the cost filter lets anything in the first person reach the AI", () => {
  assert.ok(mayConcernUser("I'm 3rd year now"));
  assert.ok(mayConcernUser("my exam moved to Friday"));
  assert.ok(mayConcernUser("forget that I'm vegetarian"));
  assert.ok(!mayConcernUser("explain entropy with an example"));
});

test("forget in words: the AI's forget list removes the note wherever the chat sees it", () => {
  let state = learnMemories(empty(), [
    { key: "Background", text: "vegetarian", kind: "fact", about: "user", kept: true },
    { key: "Background", text: "lives in Cairo", kind: "fact", about: "user", kept: true },
  ], { scope: "chat:a", sourceId: "chat:a", explicit: false, now });
  const asked = forgetBlocks('Done.\n```memory\n{"forget":["Background: vegetarian"]}\n```');
  assert.deepEqual(asked, ["Background: vegetarian"]);
  assert.deepEqual(memoryBlocks('```memory\n{"forget":["vegetarian"]}\n```'), []);
  const out = forgetWords(state, "subject:x", asked);
  assert.deepEqual(out.removed, ["vegetarian"]);
  state = out.state;
  const notes = state.records.filter((m) => m.scope === PROFILE_SCOPE).map((m) => m.text).join(" ");
  assert.doesNotMatch(notes, /vegetarian/);
  assert.match(notes, /lives in Cairo/);
});

test("forgetting never reaches another subject's notes", () => {
  const state = learnMemories(empty(), [{ key: "Exam", text: "midterm Oct 22", kind: "fact", about: "space", kept: true }], { scope: "subject:phys", sourceId: "chat:a", explicit: false, now });
  assert.deepEqual(forgetWords(state, "subject:chem", ["midterm Oct 22"]).removed, []);
  assert.deepEqual(forgetWords(state, "subject:phys", ["midterm Oct 22"]).removed, ["midterm Oct 22"]);
});

test("secrets stay out of every memory, from the shared core check", () => {
  assert.ok(looksSecret("my password is hunter22"));
  const state = learnMemories(empty(), [{ key: "Work", text: "api key = sk-live-abcdefghijklmnop1234", kind: "fact", about: "user", kept: true }], { scope: "chat:a", sourceId: "chat:a", explicit: false, now });
  assert.equal(state.records.length, 0);
});
