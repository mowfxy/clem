import test from "node:test";
import assert from "node:assert/strict";
import {
  putMemory,
  forgetSource,
  retrieveMemory,
  type MemoryState,
  type Memory,
} from "../../desktop/memory.ts";
const base: MemoryState = { enabled: true, records: [] };
const input = (
  scope = "project:a",
): Omit<Memory, "id" | "createdAt" | "updatedAt" | "supersededBy"> => ({
  scope,
  key: "units",
  text: "Use metres for length",
  kind: "preference",
  confirmed: true,
  confidence: 1,
  source: {
    id: "message:1",
    locator: "chat:1/message:1",
    at: "2026-09-19T00:00:00Z",
  },
  derivedFrom: [],
  sharedWith: [],
});
test("memory prevents cross-project leakage and disabled retrieval", () => {
  const state = putMemory(base, input());
  assert.equal(retrieveMemory(state, "project:b", "length").length, 0);
  assert.equal(retrieveMemory(state, "project:a", "length").length, 1);
  assert.equal(
    retrieveMemory({ ...state, enabled: false }, "project:a", "length").length,
    0,
  );
});
test("confirmed correction supersedes old facts and removal never revives them", () => {
  let state = putMemory(base, input());
  state = putMemory(state, {
    ...input(),
    text: "Use centimetres for length",
    source: { ...input().source, id: "message:2" },
  });
  assert.equal(
    retrieveMemory(state, "project:a", "length")[0].text,
    "Use centimetres for length",
  );
  state = forgetSource(state, "message:2");
  assert.equal(retrieveMemory(state, "project:a", "length").length, 0);
});
test("deleting source cascades into derived memory, including embeddings", () => {
  let state = putMemory(base, input());
  state = putMemory(state, {
    ...input(),
    key: "derived",
    text: "The report uses metric units",
    derivedFrom: [state.records[0].id],
    embedding: [1, 0],
    source: { ...input().source, id: "derived" },
  });
  assert.equal(forgetSource(state, "message:1").records.length, 0);
});
test("untrusted facts are rejected; temporary information expires; budgets are enforced", () => {
  assert.throws(() => putMemory(base, { ...input(), confirmed: false }));
  const state = putMemory(base, {
    ...input(),
    kind: "temporary",
    expiresAt: "2020-01-01T00:00:00Z",
  });
  assert.equal(retrieveMemory(state, "project:a", "length").length, 0);
  assert.equal(
    retrieveMemory(putMemory(base, input()), "project:a", "length", {
      budget: 2,
    }).length,
    0,
  );
});
test("hybrid retrieval accepts supplied semantic vectors and deduplicates", () => {
  const state = putMemory(base, { ...input(), embedding: [1, 0] });
  assert.equal(
    retrieveMemory(state, "project:a", "distance", { embedding: [1, 0] })
      .length,
    1,
  );
  assert.equal(putMemory(state, input()).records.length, 1);
});

test('preferences apply without repeating keywords and sharing changes replace prior records',()=>{
 let state=putMemory(base,input());
 assert.equal(retrieveMemory(state,'project:a','Describe the experiment').length,1);
 state=putMemory(state,{...input(),sharedWith:['project:b']});
 assert.equal(retrieveMemory(state,'project:b','anything').length,1);
 state=putMemory(state,{...input(),sharedWith:[]});
 assert.equal(retrieveMemory(state,'project:b','anything').length,0);
});

test("learned answer preferences apply everywhere, come first, and merge instead of piling up", async () => {
  const { learnMemories, retrieveMemory, memoryLines, correctsStyle, parseExtraction } = await import("../../desktop/memory.ts");
  let state = { enabled: true, records: [] as any[] };
  const ctx = { scope: "chat:a", sourceId: "chat:1", explicit: false, now: "2026-09-01T00:00:00.000Z" };
  state = learnMemories(state, [{ key: "answer-length", text: "The user wants short answers without bullet points.", kind: "preference", about: "user" }], ctx);
  state = learnMemories(state, [{ key: "role", text: "The user is a nurse.", kind: "fact", about: "user" }], ctx);
  const found = retrieveMemory(state, "project:x", "Explain the Krebs cycle", { now: Date.parse("2026-09-02") });
  assert.equal(found.length, 2);
  assert.match(memoryLines(found), /^How the user wants answers[\s\S]*short answers[\s\S]*About the user[\s\S]*nurse/);
  // Same wish said differently under another key: the old one is superseded (kept, not deleted).
  state = learnMemories(state, [{ key: "brevity", text: "The user wants short answers, no bullet points.", kind: "preference", about: "user" }], { ...ctx, now: "2026-09-03T00:00:00.000Z" });
  assert.equal(state.records.length, 3);
  assert.equal(retrieveMemory(state, "chat:a", "anything", { now: Date.parse("2026-09-04") }).filter((m) => /short answers/.test(m.text)).length, 1);
  assert.equal(correctsStyle("way too long, shorter answers please"), true);
  assert.equal(correctsStyle("stop using bullet points"), true);
  assert.equal(correctsStyle("What is 2+2?"), false);
  assert.equal(parseExtraction('{"memories":[{"key":"exam","text":"The user has a biology exam on 12 October.","kind":"fact","about":"user","until":"2026-10-13"}]}')[0].until, "2026-10-13");
});

test("time-bound memories stop applying after their date", async () => {
  const { learnMemories, retrieveMemory } = await import("../../desktop/memory.ts");
  const state = learnMemories({ enabled: true, records: [] }, [{ key: "exam", text: "The user has a biology exam on 12 October.", kind: "fact", about: "user", until: "2026-10-13" }], { scope: "chat:a", sourceId: "chat:1", explicit: false, now: "2026-09-01T00:00:00.000Z" });
  assert.equal(state.records[0].kind, "temporary");
  assert.equal(retrieveMemory(state, "chat:a", "biology exam", { now: Date.parse("2026-10-01") }).length, 1);
  assert.equal(retrieveMemory(state, "chat:a", "biology exam", { now: Date.parse("2026-10-20") }).length, 0);
  assert.equal(state.records.length, 1, "expired memories stay stored");
});
