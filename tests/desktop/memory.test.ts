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

test("the learner reads the person's message, not a Drive note sent after it", async () => {
  const { retrievalQuery, boundedConversation, SOURCE_PREFIX } = await import("../../core/chat-context.ts");
  const { mentionsSelf } = await import("../../desktop/memory.ts");
  const messages = boundedConversation([{ role: "system", content: "You are Clem." }, { role: "user", content: "I'm writing my thesis on muon decay." }, { role: "user", content: `${SOURCE_PREFIX}\nThis project is linked to the Google Drive folder "Thesis".` }]);
  assert.equal(retrievalQuery(messages), "I'm writing my thesis on muon decay.");
  assert.ok(mentionsSelf(retrievalQuery(messages)));
});

test("everyday self-descriptions start a memory pass; plain questions do not", async () => {
  const { mentionsSelf } = await import("../../desktop/memory.ts");
  for (const m of ["I have an exam on Friday", "I need this for my thesis", "My professor wants APA", "I'd like shorter answers"]) assert.ok(mentionsSelf(m), m);
  for (const m of ["What is the derivative of sin x?", "How do I use numpy?", "Explain photosynthesis"]) assert.ok(!mentionsSelf(m), m);
});

test("“remember that…” keeps the person's words when extraction finds nothing", async () => {
  const { rememberedWords, learnMemories } = await import("../../desktop/memory.ts");
  const learned = rememberedWords("Remember that I prefer metric units.");
  assert.deepEqual(learned.map((l) => [l.text, l.kind, l.about]), [["I prefer metric units.", "preference", "user"]]);
  const state = learnMemories(base, learned, { scope: "chat:a", sourceId: "chat:1", explicit: true });
  assert.equal(state.records[0].scope, "user:me");
  assert.equal(state.records[0].confirmed, true);
  assert.deepEqual(rememberedWords("remember"), []);
});
test("memory stays well under the sync limit: old replaced and expired records are dropped", async () => {
  const { pruneMemory, MEMORY_LIMIT } = await import("../../desktop/memory.ts");
  const now = Date.parse("2026-09-27T00:00:00Z"), day = 86_400_000;
  const record = (i: number, extra: Partial<Memory> = {}): Memory => ({ ...input(), id: "m" + i, key: "k" + i, text: "Fact " + i, createdAt: new Date(now - i * 1000).toISOString(), updatedAt: new Date(now - i * 1000).toISOString(), ...extra });
  const records = [
    ...Array.from({ length: 700 }, (_, i) => record(i)),
    ...Array.from({ length: 300 }, (_, i) => record(1000 + i, { supersededBy: "m0", updatedAt: new Date(now - (i < 50 ? 1 : 40) * day).toISOString() })),
    record(2000, { expiresAt: new Date(now - 40 * day).toISOString(), kind: "temporary" }),
    record(2001, { expiresAt: new Date(now - 2 * day).toISOString(), kind: "temporary" }),
  ];
  const pruned = pruneMemory({ enabled: true, records }, now);
  assert.ok(pruned.records.length <= MEMORY_LIMIT && MEMORY_LIMIT < 1000);
  assert.equal(pruned.records.filter((m) => !m.supersededBy && m.id.length < 5).length, 700);
  assert.ok(!pruned.records.some((m) => m.id === "m2000"));
  assert.ok(pruned.records.some((m) => m.id === "m2001"));
  const many = pruneMemory({ enabled: true, records: Array.from({ length: 1200 }, (_, i) => record(i, { confirmed: i % 2 === 0 })) }, now);
  assert.equal(many.records.length, MEMORY_LIMIT);
  assert.equal(many.records.filter((m) => m.confirmed).length, 600, "learned records go before confirmed ones");
});
import { updateMemory, unshareScope, memoryLines, PROFILE_SCOPE, learnMemories } from "../../desktop/memory.ts";
test("editing a memory keeps it, confirms a learned one and refuses secrets", () => {
  let state = learnMemories(base, [{ key: "exam", text: "The user has a chemistry exam soon.", kind: "fact", about: "space" }], { scope: "subject:chem", sourceId: "chat:1", explicit: false, now: "2026-10-01T00:00:00Z" });
  const learned = state.records[0];
  assert.equal(learned.confirmed, false);
  state = updateMemory(state, learned.id, { text: "The user's chemistry exam is on 12 November." }, "2026-10-02T00:00:00Z");
  const live = state.records.filter((m) => !m.supersededBy);
  assert.equal(live.length, 1);
  assert.equal(live[0].text, "The user's chemistry exam is on 12 November.");
  assert.equal(live[0].confirmed, true);
  assert.equal(live[0].kind, "fact");
  assert.throws(() => updateMemory(state, live[0].id, { text: "My password is hunter22" }), /never keeps/);
  assert.throws(() => updateMemory(state, "00000000-0000-4000-8000-000000000000", { text: "x y z" }), /no longer exists/);
});
test("a memory moved into another space never replaces one that shares its key", () => {
  let state = putMemory(base, input("project:a"));
  state = putMemory(state, { ...input("project:b"), text: "Use feet for length" });
  const fromA = state.records.find((m) => m.scope === "project:a")!;
  state = updateMemory(state, fromA.id, { scope: "project:b" });
  const inB = state.records.filter((m) => m.scope === "project:b" && !m.supersededBy).map((m) => m.text).sort();
  assert.deepEqual(inB, ["Use feet for length", "Use metres for length"]);
  assert.equal(retrieveMemory(state, "project:a", "length").length, 0);
});
test("sharing applies a space's memory in the spaces it is shared with only, and labels it", () => {
  let state = putMemory(base, input("project:a"));
  state = updateMemory(state, state.records[0].id, { sharedWith: ["project:b", "chat:x", "project:a"] });
  const shared = state.records.find((m) => !m.supersededBy)!;
  assert.deepEqual(shared.sharedWith, ["project:b"]);
  const inB = retrieveMemory(state, "project:b", "length");
  assert.equal(inB.length, 1);
  assert.equal(retrieveMemory(state, "project:c", "length").length, 0);
  assert.match(memoryLines(inB, "project:b"), /shared by the user from another project/);
  assert.match(memoryLines(retrieveMemory(state, "project:a", "length"), "project:a"), /this project/);
  // Moving it to the person makes it apply everywhere, so it is no longer shared one by one.
  const everywhere = updateMemory(state, shared.id, { scope: PROFILE_SCOPE });
  assert.deepEqual(everywhere.records.find((m) => !m.supersededBy)!.sharedWith, []);
  assert.equal(retrieveMemory(everywhere, "project:c", "length").length, 1);
  // A deleted space stops receiving what was shared with it.
  assert.equal(retrieveMemory(unshareScope(state, "project:b"), "project:b", "length").length, 0);
});
