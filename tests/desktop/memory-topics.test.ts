import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_SCOPE, addMemory, applyTidy, changedTopics, confirmMemory, extractionInstructions, forgetChat, forgetMemory, forgetNotes, learnMemories, memoryLines,
  parseExtraction, pruneMemory, putMemory, retrieveMemory, shorten, tidyInput, topicGuide, topicsFrom, untidyScopes, updateMemory, type Memory, type MemoryState,
} from "../../desktop/memory.ts";
import { isLearned, isTopicKey, mergeTopicEdits, notesOf, topicName } from "../../core/memory-topics.ts";
import { memoryRecord, mergeSync, validateSync } from "../../core/sync.ts";
import { memoryPrints } from "../../desktop/chat-sessions.ts";

const base: MemoryState = { enabled: true, records: [] };
const chat = (id: string, now = "2026-09-01T00:00:00.000Z") => ({ scope: "chat:" + id, sourceId: "chat:" + id, explicit: false as const, now });
const topics = (s: MemoryState) => s.records.filter((m) => !m.supersededBy).map((m) => [topicName(m.key), m.text]);
const old = (id: string, scope: string, key: string, text: string, extra: Partial<Memory> = {}): Memory => ({
  id, scope, key, text, kind: "fact", confirmed: true, confidence: 1, source: { id: "chat:" + id, locator: "x", at: "2026-01-01T00:00:00.000Z" },
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", derivedFrom: [], sharedWith: [], ...extra,
});

test("a later chat on the same topic joins its entry instead of adding one", () => {
  let state = learnMemories(base, [{ key: "Exams", text: "DSA midterm Oct 22", kind: "fact", about: "user", until: "2026-10-23" }], chat("a"));
  state = learnMemories(state, [{ key: "exams", text: "Physics 3 Oct 25", kind: "fact", about: "user", until: "2026-10-26" }], chat("b", "2026-09-05T00:00:00.000Z"));
  assert.deepEqual(topics(state), [["Exams", "DSA midterm Oct 22; Physics 3 Oct 25"]]);
  assert.equal(state.records[0].updatedAt, "2026-09-05T00:00:00.000Z");
  assert.doesNotThrow(() => memoryRecord.parse(state.records[0]));
  // Said again from a third chat: nothing new, and the topic stays one line.
  state = learnMemories(state, [{ key: "Exams", text: "DSA midterm Oct 22.", kind: "fact", about: "user" }], chat("c"));
  assert.equal(notesOf(state.records[0].text).length, 2);
});

test("a correction replaces the note it corrects; a different date is a different note", () => {
  let state = learnMemories(base, [{ key: "Studies", text: "2nd-year physics", kind: "fact", about: "user" }], chat("a"));
  state = learnMemories(state, [{ key: "Studies", text: "3rd-year physics", kind: "fact", about: "user", replaces: "2nd-year physics" }], chat("b"));
  assert.deepEqual(topics(state), [["Studies", "3rd-year physics"]]);
  state = learnMemories(state, [{ key: "Studies", text: "Thesis defence Oct 22", kind: "fact", about: "user" }, { key: "Studies", text: "Thesis defence Oct 25", kind: "fact", about: "user" }], chat("c"));
  assert.equal(notesOf(state.records[0].text).length, 3);
});

test("what is stored and sent is far shorter than the old sentences", () => {
  const sentences = ["The user is a second-year physics student.", "The user prefers short answers without bullet points.", "The user's calculus exam is on 12 November."];
  assert.deepEqual(sentences.map(shorten), ["second-year physics student.", "short answers without bullet points.", "calculus exam is on 12 November."]);
  const state = learnMemories(base, [
    { key: "Answer style", text: "short answers; no bullet points", kind: "preference", about: "user" },
    { key: "Studies", text: "2nd-year physics", kind: "fact", about: "user" },
    { key: "Entropy", text: "mixes up ΔS and ΔH", kind: "fact", about: "space" },
  ], chat("a"));
  state.records.forEach((m) => { m.scope = m.scope === "chat:a" ? "subject:phys" : m.scope; });
  const lines = memoryLines(retrieveMemory(state, "subject:phys", "anything", { now: Date.parse("2026-09-02") }), "subject:phys");
  assert.equal(lines, "How the user wants answers (follow these every time unless they ask otherwise now):\n- Answer style: short answers; no bullet points\nAbout the user:\n- Studies: 2nd-year physics\nThis subject:\n- Entropy: mixes up ΔS and ΔH");
  assert.ok(!/learned from conversation|confirmed|2026-/.test(lines));
  assert.match(extractionInstructions, /Never write "The user"/);
  assert.ok(!/one sentence/.test(extractionInstructions));
});

test("the extraction reads the new shape and says how finely each place divides memory", () => {
  const [m] = parseExtraction('{"memories":[{"topic":"Ch 3 integrals","note":"struggles with substitution","replaces":"old note","kind":"fact","about":"space"}]}');
  assert.deepEqual(m, { key: "Ch 3 integrals", text: "struggles with substitution", kind: "fact", about: "space", replaces: "old note" });
  assert.equal(parseExtraction('{"memories":[{"topic":"الأهداف","note":"طبيب قلب","kind":"fact","about":"user"}]}')[0].key, "الأهداف");
  assert.match(topicGuide("subject:x"), /narrow: one chapter, concept or skill/);
  assert.match(topicGuide("project:x"), /one area of the project's work/);
  assert.match(topicGuide("chat:x"), /broad/);
});

test("old memories move into topics with every word that carries a fact, once", () => {
  const records = [
    old("1", PROFILE_SCOPE, "role", "The user is a second-year physics student."),
    old("2", PROFILE_SCOPE, "pref:length", "The user prefers short answers.", { kind: "preference" }),
    old("3", PROFILE_SCOPE, "pref:language", "The user wants answers in Arabic.", { kind: "inference", confirmed: false }),
    old("4", PROFILE_SCOPE, "exam-dates", "The user has exams: DSA midterm on October 22; Physics 3 on October 25.", { kind: "temporary", expiresAt: "2027-10-26T00:00:00.000Z" }),
    old("5", "subject:phys", "entropy-confusion", "The user mixes up entropy and enthalpy."),
    old("6", "subject:phys", "note:the-lab-partner", "The lab partner is Sara.", { sharedWith: ["project:lab"] }),
    old("7", PROFILE_SCOPE, "city", "The user lived in Cairo.", { supersededBy: "1" }),
    old("8", PROFILE_SCOPE, "trip", "The user is in Rome.", { kind: "temporary", expiresAt: "2026-01-02T00:00:00.000Z" }),
  ];
  const state = { enabled: true, records };
  const next = topicsFrom(state, "2026-09-01T00:00:00.000Z");
  assert.notEqual(next, state);
  assert.equal(state.records.length, 8, "the input is not touched");
  const live = next.records.filter((m) => isTopicKey(m.key));
  assert.deepEqual(live.map((m) => [m.scope, topicName(m.key), m.text]).sort(), [
    ["subject:phys", "Entropy confusion", "mixes up entropy and enthalpy"],
    ["subject:phys", "Lab partner Sara", "The lab partner is Sara"],
    ["user:me", "Answer style", "short answers"],
    ["user:me", "Exams", "exams: DSA midterm on October 22; Physics 3 on October 25"],
    ["user:me", "Language", "answers in Arabic"],
    ["user:me", "Studies", "second-year physics student"],
  ]);
  assert.ok(live.every((m) => memoryRecord.safeParse(m).success));
  // Each keeps how far it reaches and whether the person kept it, and the dated one still expires.
  assert.deepEqual(live.find((m) => /Sara/.test(m.text))!.sharedWith, ["project:lab"]);
  assert.equal(live.find((m) => topicName(m.key) === "Language")!.confirmed, false);
  assert.equal(live.find((m) => topicName(m.key) === "Exams")!.expiresAt, "2027-10-26T00:00:00.000Z");
  assert.equal(live.find((m) => topicName(m.key) === "Language")!.key, "pref:topic:Language");
  // Replaced and expired records stay as they were, for pruning.
  assert.deepEqual(next.records.filter((m) => !isTopicKey(m.key)).map((m) => m.id).sort(), ["7", "8"]);
  // Running it again changes nothing.
  assert.equal(topicsFrom(next, "2026-09-01T00:00:00.000Z"), next);
});

test("a huge old memory set keeps every note, across parts of a topic", () => {
  const records = Array.from({ length: 300 }, (_, i) => old("r" + i, PROFILE_SCOPE, "note:" + i, `Note number ${i} with quite a few words so the topic fills up well before the end`));
  const next = topicsFrom({ enabled: true, records }, "2026-09-01T00:00:00.000Z");
  const all = next.records.flatMap((m) => notesOf(m.text));
  assert.equal(all.length, 300);
  assert.ok(next.records.length > 1 && next.records.every((m) => m.text.length <= 2000));
  assert.doesNotThrow(() => validateSync("memory", next.records));
});

test("a sentence too long for one topic still moves whole", () => {
  const long = "x".repeat(1999);
  const next = topicsFrom({ enabled: true, records: [old("a", "subject:s", "big", long), old("b", "subject:s", "big", "y".repeat(1999))] }, "2026-09-01T00:00:00.000Z");
  assert.equal(next.records.length, 2);
  assert.doesNotThrow(() => validateSync("memory", next.records));
});

test("records from a PC on an older Clem join the topics, and two copies of one topic become one", () => {
  let state = learnMemories(base, [{ key: "Exams", text: "DSA midterm Oct 22", kind: "fact", about: "user" }], chat("a"));
  const twin = { ...state.records[0], id: "ffffffff-ffff-4fff-8fff-ffffffffffff", text: "Physics 3 Oct 25; DSA midterm Oct 22" };
  state = { ...state, records: [...state.records, twin, old("legacy", PROFILE_SCOPE, "exam", "The user has a Maths exam on Oct 29.")] };
  const next = topicsFrom(state, "2026-09-01T00:00:00.000Z");
  assert.deepEqual(topics(next), [["Exams", "DSA midterm Oct 22; Physics 3 Oct 25; Maths exam on Oct 29"]]);
  // Both PCs reach the same record.
  assert.deepEqual(topicsFrom({ ...state, records: [...state.records].reverse() }, "2026-09-01T00:00:00.000Z").records.map((m) => m.id), next.records.map((m) => m.id));
});

test("a deleted chat takes only the notes it taught, and what was kept stays", () => {
  let state = learnMemories(base, [{ key: "Background", text: "Nurse", kind: "fact", about: "user" }], chat("a"));
  state = learnMemories(state, [{ key: "Background", text: "Lives in Cairo", kind: "fact", about: "user" }], chat("b"));
  state = learnMemories(state, [{ key: "Background", text: "Speaks French", kind: "fact", about: "user" }], { ...chat("c"), explicit: true });
  // Said in two chats, a note stays until both are gone.
  state = learnMemories(state, [{ key: "Background", text: "Lives in Cairo", kind: "fact", about: "user" }], chat("d"));
  assert.equal(state.records[0].confirmed, true);
  let next = forgetChat(state, "a");
  assert.deepEqual(notesOf(next.records[0].text), ["Lives in Cairo", "Speaks French"]);
  next = forgetChat(next, "b");
  assert.deepEqual(notesOf(next.records[0].text), ["Lives in Cairo", "Speaks French"]);
  next = forgetChat(next, "d");
  assert.deepEqual(notesOf(next.records[0].text), ["Speaks French"]);
  // A topic only learned from one chat goes with it.
  const only = learnMemories(base, [{ key: "Goals", text: "Cardiology", kind: "fact", about: "user" }], chat("z"));
  assert.equal(forgetChat(only, "z").records.length, 0);
});

test("old memories keep their link to the chat that taught them", () => {
  const moved = topicsFrom({ enabled: true, records: [
    old("a", PROFILE_SCOPE, "field", "The user is a nurse.", { kind: "inference", confirmed: false, source: { id: "chat:one", locator: "x", at: "2026-01-01T00:00:00.000Z" } }),
    old("b", PROFILE_SCOPE, "job", "The user works nights.", { source: { id: "chat:two", locator: "x", at: "2026-01-01T00:00:00.000Z" } }),
  ] }, "2026-09-01T00:00:00.000Z");
  assert.deepEqual(topics(moved), [["Background", "nurse"], ["Work", "works nights"]]);
  assert.deepEqual(topics(forgetChat(moved, "one")), [["Work", "works nights"]]);
  assert.deepEqual(topics(forgetChat(moved, "two")), [["Background", "nurse"], ["Work", "works nights"]]);
});

test("a dated note stops applying on its own; the rest of the topic stays", () => {
  let state = learnMemories(base, [{ key: "Exams", text: "Midterm Oct 22", kind: "fact", about: "user", until: "2026-10-23" }, { key: "Exams", text: "Finals in June", kind: "fact", about: "user" }], chat("a"));
  assert.equal(state.records[0].expiresAt, undefined, "a topic with a lasting note does not expire");
  const after = Date.parse("2026-10-24");
  assert.equal(retrieveMemory(state, "chat:x", "exam", { now: after })[0].text, "Finals in June");
  assert.equal(pruneMemory(state, after).records[0].text, "Finals in June");
  state = learnMemories(base, [{ key: "Trips", text: "Rome in May", kind: "fact", about: "user", until: "2026-10-23" }], chat("a"));
  assert.equal(retrieveMemory(state, "chat:x", "rome", { now: after }).length, 0);
  // Kept, a dated note keeps its date.
  const kept = confirmMemory(state, state.records[0].id, "2026-09-02T00:00:00.000Z");
  assert.equal(kept.records[0].confirmed, true);
  assert.equal(kept.records[0].expiresAt, "2026-10-23T00:00:00.000Z");
});

test("editing, renaming, moving and sharing a topic", () => {
  const ctx = chat("a");
  let state = learnMemories(base, [{ key: "Entropy", text: "mixes up ΔS", kind: "fact", about: "space" }], { ...ctx, scope: "subject:a" });
  const id = state.records[0].id;
  state = updateMemory(state, id, { text: "mixes up ΔS; fine with ΔH", topic: "Entropy basics" }, "2026-09-02T00:00:00.000Z");
  assert.deepEqual(topics(state), [["Entropy basics", "mixes up ΔS; fine with ΔH"]]);
  assert.equal(state.records[0].id, id, "the same record");
  assert.equal(state.records[0].confirmed, true);
  assert.ok(!isLearned("mixes up ΔS", state.records[0].derivedFrom));
  state = updateMemory(state, id, { sharedWith: ["project:b", "chat:x", "subject:a"] });
  assert.deepEqual(state.records[0].sharedWith, ["project:b"]);
  assert.equal(retrieveMemory(state, "project:b", "x").length, 1);
  // Moved to where that topic already exists, it joins it.
  state = learnMemories(state, [{ key: "Entropy basics", text: "got Q3 wrong", kind: "fact", about: "space" }], { ...ctx, scope: "subject:b", explicit: true });
  const other = state.records.find((m) => m.scope === "subject:b")!;
  state = updateMemory(state, id, { scope: "subject:b" });
  assert.deepEqual(topics(state), [["Entropy basics", "got Q3 wrong; mixes up ΔS; fine with ΔH"]]);
  assert.equal(state.records[0].id, other.id);
  assert.deepEqual(state.records[0].sharedWith, ["project:b"]);
  // Moving to the person drops sharing; secrets are refused in an edit too.
  state = updateMemory(state, other.id, { scope: PROFILE_SCOPE });
  assert.deepEqual(state.records[0].sharedWith, []);
  assert.throws(() => updateMemory(state, other.id, { text: "password is hunter22" }), /never keeps/);
  assert.throws(() => updateMemory(state, other.id, { text: " ; " }), /needs some words/);
  // Renaming onto an existing topic joins it too.
  let two = learnMemories(base, [{ key: "One", text: "alpha", kind: "fact", about: "user" }, { key: "Two", text: "beta", kind: "fact", about: "user" }], chat("a"));
  two = updateMemory(two, two.records[1].id, { topic: "One" });
  assert.deepEqual(topics(two), [["One", "alpha; beta"]]);
  assert.deepEqual(topics(forgetMemory(two, [two.records[0].id])), []);
});

test("the note Clem shows after saving covers only what was added, and its Delete takes only that", () => {
  const before = learnMemories(base, [{ key: "Exams", text: "Midterm Oct 22", kind: "fact", about: "user" }], { ...chat("a"), explicit: true });
  const after = learnMemories(before, [{ key: "Exams", text: "Finals Dec 3", kind: "fact", about: "user" }], chat("b"));
  const [change] = changedTopics(before, after);
  assert.deepEqual(change, { id: before.records[0].id, text: "Exams: Finals Dec 3", confirmed: true, notes: ["Finals Dec 3"] });
  assert.deepEqual(changedTopics(after, after), []);
  assert.deepEqual(topics(forgetNotes(after, change.id, change.notes)), [["Exams", "Midterm Oct 22"]]);
  assert.deepEqual(topics(forgetNotes(before, change.id, ["Midterm Oct 22"])), []);
});

test("what the person types finds its topic; a name before a colon sets it", () => {
  let state = addMemory(base, { scope: "subject:a", text: "Exam format: two essays", kind: "fact", sharedWith: [], source: "Added by you in memory settings" });
  state = addMemory(state, { scope: "subject:a", text: "Exam format: closed book", kind: "fact", sharedWith: [], source: "Added by you in memory settings" });
  assert.deepEqual(topics(state), [["Exam format", "two essays; closed book"]]);
  state = addMemory(state, { scope: "subject:a", text: "The exam format allows a calculator", kind: "fact", sharedWith: [], source: "x" });
  assert.equal(state.records.length, 1, "joins the topic it talks about");
  assert.throws(() => addMemory(state, { scope: "subject:a", text: "password is hunter22", kind: "fact", sharedWith: [], source: "x" }), /never keeps/);
  assert.throws(() => addMemory({ enabled: false, records: [] }, { scope: "subject:a", text: "hello there", kind: "fact", sharedWith: [], source: "x" }), /disabled/);
});

test("a tidy pass shortens moved memories; a doubtful answer changes nothing", () => {
  const moved = topicsFrom({ enabled: true, records: [
    old("1", "subject:phys", "entropy-confusion", "The user mixes up entropy and enthalpy when working through thermodynamics problems.", { kind: "inference", confirmed: false }),
    old("2", "subject:phys", "calculator", "The user is allowed to use a calculator in the exam for this subject."),
    old("3", "subject:phys", "shared", "Shared notes stay out of this.", { sharedWith: ["project:p"] }),
  ] }, "2026-09-01T00:00:00.000Z");
  assert.deepEqual(untidyScopes(moved), ["subject:phys"]);
  // Something learned first does not take a moved topic out of the tidy pass.
  const topic = topicName(moved.records.find((m) => /calculator/.test(m.text))!.key);
  assert.deepEqual(untidyScopes(learnMemories(moved, [{ key: topic, text: "open book too", kind: "fact", about: "space" }], { ...chat("q"), scope: "subject:phys" })), ["subject:phys"]);
  const input = tidyInput(moved, "subject:phys")!;
  assert.equal(input.notes.length, 2);
  assert.match(input.prompt, /narrow: one chapter, concept or skill/);
  const good = '{"topics":[{"topic":"Entropy","notes":[{"text":"mixes up entropy and enthalpy","from":[1]}]},{"topic":"Exam format","notes":[{"text":"calculator allowed","from":[0]}]}]}';
  const order = input.notes[0].text.includes("calculator") ? good : good.replace('"from":[1]', '"from":[9]').replace('"from":[0]', '"from":[1]').replace('"from":[9]', '"from":[0]');
  const next = applyTidy(moved, input, order, "2026-09-02T00:00:00.000Z")!;
  assert.deepEqual(topics(next).sort(), [["Entropy", "mixes up entropy and enthalpy"], ["Exam format", "calculator allowed"], [topics(moved).find(([, t]) => /Shared/.test(t))![0], "Shared notes stay out of this"]].sort());
  assert.deepEqual(untidyScopes(next), [], "a second PC finds nothing left to do");
  const entropy = next.records.find((m) => topicName(m.key) === "Entropy")!;
  assert.equal(entropy.confirmed, false);
  assert.deepEqual(topics(forgetChat(next, "1")).map(([t]) => t).includes("Entropy"), false, "still tied to the chat that taught it");
  // A note left out, a longer result, bad JSON, or memory changed meanwhile: nothing happens.
  assert.equal(applyTidy(moved, input, '{"topics":[{"topic":"Entropy","notes":[{"text":"short","from":[0]}]}]}'), undefined);
  assert.equal(applyTidy(moved, input, `{"topics":[{"topic":"Entropy","notes":[{"text":"${"long ".repeat(40)}","from":[0,1]}]}]}`), undefined);
  assert.equal(applyTidy(moved, input, "sorry, I cannot"), undefined);
  const changed = { ...moved, records: moved.records.map((m) => ({ ...m, updatedAt: "2026-09-03T00:00:00.000Z" })) };
  assert.equal(applyTidy(changed, input, order), undefined);
});

test("the same topic changed on two PCs keeps what each added; removals stay removed", () => {
  const stamp = (text: string, at: string, from = base0) => ({ ...from, text, updatedAt: at });
  const base0 = learnMemories(base, [{ key: "Exams", text: "A", kind: "fact", about: "user" }, { key: "Exams", text: "Gone", kind: "fact", about: "user" }], { ...chat("a"), explicit: true }).records[0];
  const b = stamp("Alpha one; Gone", "2026-09-01T00:00:00.000Z");
  const left = stamp("Alpha one; Gone; Beta two", "2026-09-02T00:00:00.000Z"), right = stamp("Alpha one; Gamma three", "2026-09-03T00:00:00.000Z");
  const [merged] = mergeSync([b], [left], [right], mergeTopicEdits as never) as unknown as Memory[];
  assert.equal(merged.text, "Alpha one; Gamma three; Beta two");
  assert.equal(merged.updatedAt, right.updatedAt);
  assert.doesNotThrow(() => validateSync("memory", [merged]));
  // Without a topic on both sides, newest still wins.
  assert.equal(mergeTopicEdits(undefined, { ...right, key: "role" }, left), undefined);
});

test("older Clem can still read every record: the sync format is unchanged", () => {
  const state = topicsFrom({ enabled: true, records: [old("x", PROFILE_SCOPE, "exam", "The user has an exam on Oct 9.", { kind: "inference", confirmed: false, expiresAt: "2027-01-01T00:00:00.000Z", source: { id: "chat:" + "a".repeat(80), locator: "x", at: "2026-01-01T00:00:00.000Z" } })] }, "2026-09-01T00:00:00.000Z");
  assert.doesNotThrow(() => validateSync("memory", state.records));
  assert.deepEqual(Object.keys(memoryRecord.shape).sort(), ["confidence", "confirmed", "createdAt", "derivedFrom", "expiresAt", "id", "key", "kind", "scope", "sharedWith", "source", "supersededBy", "text", "updatedAt"]);
  assert.equal(state.records[0].derivedFrom.length, 1);
});

test("a topic whose words changed counts as new on a kept session", () => {
  const state = learnMemories(base, [{ key: "Exams", text: "Midterm Oct 22", kind: "fact", about: "user" }], chat("a"));
  const next = learnMemories(state, [{ key: "Exams", text: "Finals Dec 3", kind: "fact", about: "user" }], chat("b"));
  assert.notEqual(memoryPrints("Sam", state.records).items[0], memoryPrints("Sam", next.records).items[0]);
});

test("records saved the old way keep working next to topics", () => {
  const state = putMemory(base, { scope: "project:a", key: "units", text: "Use metres", kind: "preference", confirmed: true, confidence: 1, source: { id: "m", locator: "x", at: "2026-09-01T00:00:00Z" }, derivedFrom: [], sharedWith: [] });
  assert.match(memoryLines(retrieveMemory(state, "project:a", "metres"), "project:a"), /^How the user[^\n]*\n- Use metres$/);
});
