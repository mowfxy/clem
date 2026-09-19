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
