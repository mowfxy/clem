import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ankiState, ankiText, cloze, detectSeparator, parseQuizlet, renderTemplate } from "../core/flashcard-import.ts";

const fixture = (name: string) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");

test("Quizlet exports import with the separator found by itself", () => {
  const tab = parseQuizlet(fixture("quizlet-tab.txt"));
  assert.equal(tab.separator, "tab");
  assert.deepEqual(tab.cards, [{ question: "Mitochondria", answer: "Make most of the cell's ATP" }, { question: "Ribosome", answer: "Builds proteins" }, { question: "Golgi apparatus", answer: "Packages and ships proteins" }]);
  const csv = parseQuizlet(fixture("quizlet-comma.csv"));
  assert.equal(csv.separator, "comma");
  assert.deepEqual(csv.cards, [
    { question: "Osmosis", answer: "Diffusion of water, across a membrane" },
    { question: 'Active "pumping" transport', answer: "Uses ATP\nagainst a gradient" },
    { question: "Diffusion", answer: "High to low concentration" },
  ], "a header row is skipped; quoted commas, quotes and new lines stay in the card");
  assert.equal(detectSeparator("a - b\nc - d"), "dash");
  assert.equal(detectSeparator("a;b\nc;d"), "semicolon");
  assert.deepEqual(parseQuizlet("one\ttwo\nlonely\n\n\tno front", "tab"), { cards: [{ question: "one", answer: "two" }], separator: "tab", skipped: 2 });
  assert.equal(parseQuizlet("﻿term\tdef").cards[0].question, "term", "a byte-order mark is dropped");
  assert.equal(parseQuizlet("x\t" + "y".repeat(20_000)).cards[0].answer.length, 8000);
});

test("Anki fields, templates and clozes become plain cards", () => {
  assert.equal(ankiText('A<br>B<div>C</div>&amp; &lt;x&gt; &#x41;&#66; [sound:a.mp3]<img src="a b.png">'), "A\nB\nC\n& <x> AB [picture: a b.png]");
  assert.equal(renderTemplate("{{#Extra}}Extra: {{Extra}}{{/Extra}}{{^Extra}}none{{/Extra}} {{type:Back}}{{Front}}", { Front: "F", Extra: "" }), "none F");
  assert.equal(renderTemplate("{{FrontSide}}<hr id=answer>{{hint:Back}}", { Back: "B" }, { frontSide: "Q" }), "Q<hr id=answer>B");
  assert.equal(cloze("{{c1::a}} and {{c2::b::hint}} and {{c1::c}}", 1, "q"), "[…] and b and […]");
  assert.equal(cloze("{{c1::a}} and {{c2::b::hint}}", 2, "q"), "a and [hint]");
  assert.equal(cloze("{{c1::a}} and {{c2::b}}", 2, "a"), "a and <b>b</b>");
});

test("Anki review history is kept only when it maps onto FSRS", () => {
  const base = { type: 2, queue: 2, due: 10, ivl: 5, reps: 4, lapses: 1 };
  assert.equal(ankiState({ ...base, data: "{}" }, 1000), undefined, "SM-2 only");
  assert.equal(ankiState({ ...base, reps: 0, data: '{"s":3,"d":5}' }, 1000), undefined);
  assert.equal(ankiState({ ...base, type: 0, data: '{"s":3,"d":5}' }, 1000), undefined, "a new card");
  assert.equal(ankiState({ ...base, data: '{"s":3,"d":12}' }, 1000), undefined, "difficulty out of range");
  assert.equal(ankiState({ ...base, data: "not json" }, 1000), undefined);
  assert.deepEqual(ankiState({ ...base, data: '{"s":3,"d":5}' }, 1000), { due: 1_000_000 + 10 * 86_400_000, stability: 3, difficulty: 5, reps: 4, lapses: 1, last: 1_000_000 + 5 * 86_400_000 });
  // A card in (re)learning is due at a time in seconds.
  assert.equal(ankiState({ ...base, type: 3, due: 1_800_000_000, data: '{"s":1,"d":7}' }, 1000)!.due, 1_800_000_000_000);
});
