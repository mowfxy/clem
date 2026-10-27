import test from "node:test";
import assert from "node:assert/strict";
import {
  explicitRemember,
  standingInstruction,
  learnMemories,
  confirmMemory,
  forgetMemory,
  forgetChat,
  mentionsSelf,
  parseExtraction,
  looksSecret,
  rememberedWords,
  retrieveMemory,
  type MemoryState,
} from "../../desktop/memory.ts";
import { mergeSync } from "../../core/sync.ts";

const base: MemoryState = { enabled: true, records: [] };

test("questions and topic requests that start with “remember” are not instructions to remember", () => {
  for (const m of ["Remember the Krebs cycle steps?", "Remember the formula for kinetic energy", "Do you remember the capital of France?", "Note the units in question 3", "Remember that?"]) assert.equal(explicitRemember(m), false, m);
  for (const m of ["Remember that I use SI units", "remember: my exam is on Friday", "Please remember I'm a nurse", "Remember to cite sources", "Keep in mind my professor wants APA", "تذكر أن اسمي أحمد", "Souviens-toi que je suis infirmier"]) assert.equal(explicitRemember(m), true, m);
  assert.equal(standingInstruction("From now on answer in Arabic"), true);
  assert.equal(standingInstruction("From now on, never use bullet points"), true);
  assert.equal(standingInstruction("What happens from now on in the story?"), false);
});

test("a standing instruction confirms its preferences but only learns the facts beside it", () => {
  const state = learnMemories(base, [
    { key: "language", text: "The user wants answers in Arabic.", kind: "preference", about: "user" },
    { key: "role", text: "The user is a pharmacist.", kind: "fact", about: "user" },
  ], { scope: "chat:a", sourceId: "chat:a", explicit: "preferences" });
  assert.deepEqual(state.records.map((m) => [m.key, m.confirmed]), [["pref:language", true], ["role", false]]);
});

test("people writing in other languages start a memory pass too", () => {
  for (const m of ["أنا طالب في السنة الثانية طب", "عندي امتحان يوم الخميس", "جاوب باللغة العربية دائما", "Je suis étudiant en droit", "Soy enfermera y prefiero respuestas cortas", "Ich studiere Physik"]) assert.ok(mentionsSelf(m), m);
  for (const m of ["ما هي عاصمة فرنسا؟", "Qu'est-ce que la photosynthèse ?", "¿Qué es la fotosíntesis?", "Was ist Photosynthese?"]) assert.ok(!mentionsSelf(m), m);
  assert.equal(parseExtraction('{"memories":[{"key":"التخصص","text":"المستخدم طالب طب.","kind":"fact","about":"user"}]}').length, 1);
  // Remembered words in another language keep distinct keys instead of all sharing "note:note".
  const [a] = rememberedWords("تذكر أن اسمي أحمد"), [b] = rememberedWords("تذكر أن تخصصي طب");
  assert.notEqual(a.key, b.key);
  assert.equal(a.text, "اسمي أحمد.");
});

test("a newer learned record outranks a kept one under the same key until the person decides", () => {
  let state = learnMemories(base, [{ key: "year", text: "The user is a second-year student.", kind: "fact", about: "user" }], { scope: "chat:a", sourceId: "chat:a", explicit: true, now: "2026-09-01T00:00:00.000Z" });
  state = learnMemories(state, [{ key: "year", text: "The user is a third-year student.", kind: "fact", about: "user" }], { scope: "chat:b", sourceId: "chat:b", explicit: false, now: "2026-09-10T00:00:00.000Z" });
  const now = Date.parse("2026-09-11");
  const learned = state.records.find((m) => !m.confirmed)!;
  assert.deepEqual(retrieveMemory(state, "chat:c", "anything", { now }).map((m) => m.text), ["The user is a third-year student."]);
  // Keeping it replaces the old kept one; forgetting it brings the old one back.
  const kept = confirmMemory(state, learned.id, "2026-09-12T00:00:00.000Z");
  assert.deepEqual(retrieveMemory(kept, "chat:c", "anything", { now }).map((m) => m.text), ["The user is a third-year student."]);
  assert.equal(kept.records.filter((m) => !m.supersededBy).length, 1);
  assert.deepEqual(retrieveMemory(forgetMemory(state, [learned.id]), "chat:c", "anything", { now }).map((m) => m.text), ["The user is a second-year student."]);
});

test("passwords, keys and card numbers are never kept, even when asked", () => {
  for (const m of ["My password is hunter22", "The API key is sk-ant-api03-abcdefghijklmnopqrstuvwx", "Card 4111 1111 1111 1111", "كلمة السر هي 12345", "ghp_abcdefghijklmnopqrstuvwxyz0123"]) assert.ok(looksSecret(m), m);
  for (const m of ["The user is a nurse.", "The exam is on 2026-10-12.", "Call me on 0123 456 7890", "Student ID 20231234", "The user prefers a pinned layout."]) assert.ok(!looksSecret(m), m);
  assert.deepEqual(rememberedWords("Remember that my password is hunter22"), []);
  assert.equal(learnMemories(base, [{ key: "pin", text: "The user's PIN code is 4821.", kind: "fact", about: "user" }], { scope: "chat:a", sourceId: "chat:a", explicit: true }).records.length, 0);
});

test("deleting a chat forgets what was only learned from it and keeps what the person kept", () => {
  let state = learnMemories(base, [{ key: "role", text: "The user is a nurse.", kind: "fact", about: "user" }], { scope: "chat:a", sourceId: "chat:a", explicit: false });
  state = learnMemories(state, [{ key: "units", text: "The user prefers SI units.", kind: "preference", about: "user" }], { scope: "chat:a", sourceId: "chat:a", explicit: true });
  state = learnMemories(state, [{ key: "city", text: "The user lives in Cairo.", kind: "fact", about: "user" }], { scope: "chat:b", sourceId: "chat:b", explicit: false });
  assert.deepEqual(forgetChat(state, "a").records.map((m) => m.text).sort(), ["The user lives in Cairo.", "The user prefers SI units."]);
});

test("a space's own facts apply without matching words; no kind crowds out the others", () => {
  let state = learnMemories(base, [{ key: "exam", text: "The cardiology exam is on 12 November.", kind: "fact", about: "space" }], { scope: "subject:med", sourceId: "chat:a", explicit: false, now: "2026-09-01T00:00:00.000Z" });
  for (let i = 0; i < 60; i++) state = learnMemories(state, [{ key: "fact" + i, text: `The user has hobby number ${i}, described here at some considerable length.`, kind: "fact", about: "user" }], { scope: "chat:x", sourceId: "chat:x", explicit: false, now: "2026-09-02T00:00:00.000Z" });
  const found = retrieveMemory(state, "subject:med", "Explain heart murmurs", { now: Date.parse("2026-09-03") });
  assert.ok(found.some((m) => /cardiology/.test(m.text)), "space fact included");
  assert.ok(found.filter((m) => m.scope === "user:me").reduce((n, m) => n + m.text.length, 0) <= 6000 * 0.35);
  // "user" is in every memory, so a question about users matches none of them by that word alone.
  let p = learnMemories(base, [{ key: "db", text: "The user is building a Postgres app.", kind: "fact", about: "space" }], { scope: "project:p", sourceId: "chat:a", explicit: false, now: "2026-09-01T00:00:00.000Z" });
  p = learnMemories(p, [{ key: "pet", text: "The user has a cat.", kind: "fact", about: "space" }], { scope: "project:p", sourceId: "chat:a", explicit: false, now: "2026-09-02T00:00:00.000Z" });
  assert.equal(retrieveMemory(p, "project:p", "how many users can postgres handle", { now: Date.parse("2026-09-03") })[0].text, "The user is building a Postgres app.");
});

test("keeping a dated memory keeps its date", () => {
  const state = learnMemories(base, [{ key: "exam", text: "The user has a biology exam on 12 October.", kind: "fact", about: "user", until: "2026-10-13" }], { scope: "chat:a", sourceId: "chat:a", explicit: false, now: "2026-09-01T00:00:00.000Z" });
  const kept = confirmMemory(state, state.records[0].id, "2026-09-02T00:00:00.000Z");
  assert.equal(kept.records[0].kind, "temporary");
  assert.equal(kept.records[0].confirmed, true);
  assert.ok(kept.records[0].expiresAt);
});

test("a device whose clock runs ahead does not win every sync conflict", () => {
  const record = (text: string, updatedAt: string) => ({ id: "m1", text, updatedAt });
  const base = [record("old", "2026-01-01T00:00:00.000Z")];
  const future = record("from a fast clock", "2099-01-01T00:00:00.000Z");
  const now = record("edited just now", new Date(Date.now() - 1000).toISOString());
  assert.equal(mergeSync(base, [future], [now])[0].text, "edited just now");
  assert.equal(mergeSync(base, [now], [future])[0].text, "edited just now");
  // Ordinary edits still go to the newest.
  assert.equal(mergeSync(base, [record("a", "2026-02-01T00:00:00.000Z")], [record("b", "2026-03-01T00:00:00.000Z")])[0].text, "b");
});

test("saying a learned fact again keeps it fresh instead of storing it twice", () => {
  const item = { key: "year", text: "The user is a second-year physics student.", kind: "fact" as const, about: "user" as const };
  let state = learnMemories(base, [item], { scope: "chat:a", sourceId: "chat:a", explicit: false, now: "2026-01-01T00:00:00.000Z" });
  state = learnMemories(state, [item], { scope: "chat:b", sourceId: "chat:b", explicit: false, now: "2026-06-01T00:00:00.000Z" });
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].updatedAt, "2026-06-01T00:00:00.000Z");
  assert.ok(state.records[0].confidence > 0.7 && state.records[0].confidence <= 0.95);
});

test("the same memory under two keys is sent to the model once", () => {
  let state = learnMemories(base, [{ key: "units", text: "The user wants answers in SI units.", kind: "fact", about: "user" }], { scope: "chat:a", sourceId: "chat:a", explicit: true, now: "2026-09-01T00:00:00.000Z" });
  state = learnMemories(state, [{ key: "si", text: "The user wants answers in SI units!", kind: "fact", about: "user" }], { scope: "chat:b", sourceId: "chat:b", explicit: true, now: "2026-09-02T00:00:00.000Z" });
  const found = retrieveMemory(state, "chat:c", "convert this speed", { now: Date.parse("2026-09-03") });
  assert.equal(found.filter((m) => /SI units/.test(m.text)).length, 1);
});

test("asking to save something to memory counts, in the words people use", async () => {
  const { explicitRemember, mentionsSelf, rememberedWords, memoryBlocks } = await import("../../desktop/memory.ts");
  for (const said of ["save this to the project memory: we use SI units", "can you add this to your memory?", "remember this: exams are open book", "memorize that I prefer short answers", "don't forget the lab is on Friday"])
    assert.ok(explicitRemember(said) && mentionsSelf(said), said);
  assert.equal(explicitRemember("Remember the Krebs cycle steps?"), false);
  const [space] = rememberedWords("save to the project memory that we use SI units");
  assert.equal(space.about, "space");
  assert.match(space.text, /^We use SI units/);
  const answer = 'Saved.\n\n```memory\n{"remember":[{"text":"In this course, R_th is found with independent sources off.","about":"space"},{"text":"The user prefers short answers.","about":"user","kind":"preference"}]}\n```';
  const items = memoryBlocks(answer);
  assert.deepEqual(items.map((m) => [m.about, m.kind]), [["space", "fact"], ["user", "preference"]]);
  assert.deepEqual(memoryBlocks('```memory\n{"remember":[{"text":"My password is hunter22","about":"user"}]}\n```'), []);
});
