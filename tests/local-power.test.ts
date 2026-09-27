import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { searchDocs, snippet, queryTerms, fold } from "../core/search.ts";
import { packStudy, unpackStudy, cardCount, packFileName, type StudyPack } from "../core/study-pack.ts";

test("search requires every term, ranks titles and phrases, and marks matches", () => {
  const now = Date.UTC(2026, 8, 24);
  const docs = [
    { id: "a", kind: "chat" as const, title: "Thermodynamics review", text: "Entropy always increases in an isolated system.", updated: now },
    { id: "b", kind: "file" as const, title: "notes.md", text: "The isolated system keeps its energy. Entropy is discussed later.", updated: now - 400 * 86400000 },
    { id: "c", kind: "card" as const, title: "What is enthalpy?", text: "Heat content at constant pressure." },
  ];
  const hits = searchDocs(docs, "isolated entropy", 10, now);
  assert.deepEqual(hits.map((h) => h.doc.id), ["a", "b"]);
  assert.equal(searchDocs(docs, "thermodynamics", 10, now)[0].doc.id, "a");
  assert.equal(searchDocs(docs, "nothing-here", 10, now).length, 0);
  const s = hits[0].snippet;
  const marked = s.marks.map(([a, b]) => s.text.slice(a, b).toLowerCase());
  assert.ok(marked.includes("entropy") && marked.includes("isolated"));
  assert.deepEqual(queryTerms("  A  b2 Ω-field "), ["b2", "ω-field"]);
  assert.equal(fold("İstanbul").length, "İstanbul".length);
});

test("snippets collapse whitespace, keep offsets and report the line", () => {
  const text = "first line\n\nsecond   line has the KEYWORD here\nthird";
  const s = snippet(text, ["keyword"], 20);
  const [a, b] = s.marks[0];
  assert.equal(s.text.slice(a, b), "KEYWORD");
  assert.equal(s.line, 3);
  assert.ok(!/\s{2,}/.test(s.text));
});

const pack: StudyPack = {
  format: "mowr-study-pack", version: 1, title: "Cell biology", description: "Unit 2", author: "Sam", created: 1,
  sets: [
    { kind: "flashcards", title: "Organelles", items: [{ question: "Powerhouse?", answer: "Mitochondria" }] },
    { kind: "quiz", title: "Check", items: [{ question: "Makes protein?", answer: "Ribosome", choices: ["Ribosome", "Golgi"], correct: 0 }] },
  ],
  files: [{ id: "f1", name: "slides.txt", type: "text/plain", size: 5 }],
};

test("study packs round-trip and carry only study content", async () => {
  const bytes = await packStudy(pack, { f1: strToU8("hello") });
  const { pack: back, files } = await unpackStudy(bytes);
  assert.deepEqual(back, pack);
  assert.equal(new TextDecoder().decode(files.f1), "hello");
  assert.equal(cardCount(back), 2);
  assert.equal(packFileName('a/b:"c"'), "a-b--c-.mowrpack");
  assert.ok(!("attempts" in back.sets[0]) && !("chats" in back));
});

test("study packs reject damaged, oversized or foreign content", async () => {
  await assert.rejects(packStudy(pack, {}), /Missing file/);
  await assert.rejects(packStudy({ ...pack, sets: [{ kind: "quiz", title: "Bad", items: [{ question: "Q", answer: "A" }] }], files: [] }), /incomplete quiz/);
  await assert.rejects(unpackStudy(strToU8("not a zip")), /not a Mowr study pack/);
  await assert.rejects(unpackStudy(zipSync({ "pack.json": strToU8("{}") })), /newer Mowr or is damaged/);
  await assert.rejects(unpackStudy(zipSync({ "pack.json": strToU8(JSON.stringify(pack)), "../evil.exe": strToU8("x") })), /unsupported/);
  await assert.rejects(unpackStudy(zipSync({ "pack.json": strToU8(JSON.stringify(pack)), "files/f1": strToU8("hi") })), /missing or damaged/);
});

import { planEdits, lines } from "../core/pdf-edit.ts";
test("pdf edits find text on one line and re-set only the items they touch", () => {
  const page = [
    { str: "Worksheet 2", x: 50, y: 780, width: 80, size: 18 },
    { str: "1. A ball is thrown at ", x: 50, y: 700, width: 120, size: 11 },
    { str: "20 m/s", x: 170, y: 700, width: 30, size: 11 },
    { str: " at 30°.", x: 200, y: 700, width: 40, size: 11 },
    { str: "2. Find the range.", x: 50, y: 680, width: 90, size: 11 },
  ];
  assert.deepEqual(lines(page).map((l) => l.text), ["Worksheet 2", "1. A ball is thrown at 20 m/s at 30°.", "2. Find the range."]);
  const [p] = planEdits([page], [{ page: 1, find: "20 m/s", replace: "25 m/s" }]);
  assert.equal(p.text, "25 m/s");
  assert.equal(p.x, 170);
  const [q] = planEdits([page], [{ page: 1, find: "thrown at 20", replace: "kicked at 25" }]);
  assert.equal(q.text, "1. A ball is kicked at 25 m/s");
  assert.equal(q.before, "1. A ball is thrown at 20 m/s");
  assert.throws(() => planEdits([page], [{ page: 1, find: "missing", replace: "x" }]), /Could not find/);
  assert.throws(() => planEdits([page], [{ page: 1, find: "at", replace: "x" }]), /appears 2 times/);
  assert.throws(() => planEdits([page], [{ page: 2, find: "a", replace: "b" }]), /Page 2 is not/);
  assert.equal(planEdits([page], [{ page: 1, find: "Find  the range", replace: "Find the maximum height" }])[0].text, "2. Find the maximum height.");
  // Runs that share an item would be drawn twice over each other, even when they start on different items.
  assert.throws(() => planEdits([page], [{ page: 1, find: "thrown at 20", replace: "kicked at 25" }, { page: 1, find: "m/s at", replace: "km/h at" }]), /same line/);
  assert.equal(planEdits([page], [{ page: 1, find: "A ball", replace: "One ball" }, { page: 1, find: "at 30", replace: "at 45" }]).length, 2, "separate runs on one line are fine");
});
