import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readApkg } from "../../desktop/anki.ts";

// Fixtures come from scripts/fixtures/anki-fixtures.mjs, in Anki's own table layouts.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL("../fixtures/" + name, import.meta.url)));
const crt = 1_700_000_000, day = 86_400_000;

for (const [label, file] of [["older export (collection.anki2)", "anki-legacy.apkg"], ["Anki 2.1.50+ export (zstd collection.anki21b)", "anki-latest.apkg"]]) {
  test(`an Anki deck imports: ${label}`, () => {
    const deck = readApkg(fixture(file), "Biology.apkg");
    assert.equal(deck.name, "Cells", "named after its deck");
    assert.deepEqual(deck.cards.map(({ question, answer }) => [question, answer]), [
      ["What is the powerhouse of the cell?", "The mitochondria"],
      ["osmosis", "diffusion of water across a membrane"],
      ["diffusion of water across a membrane", "osmosis"],
      ["[…] build proteins; the Golgi apparatus ships them.", "Ribosomes build proteins; the Golgi apparatus ships them.\nWeek 3"],
      ["Ribosomes build proteins; the [organelle] ships them.", "Ribosomes build proteins; the Golgi apparatus ships them.\nWeek 3"],
      ["Label this cell:\n[picture: cell.png]", "Nucleus & membrane"],
    ]);
    // FSRS review history carries over; SM-2 history doesn't map, so that card starts as new and the person is told.
    assert.deepEqual(deck.cards[0].state, { due: crt * 1000 + 400 * day, stability: 14.2, difficulty: 6.3, reps: 5, lapses: 1, last: crt * 1000 + 388 * day });
    assert.equal(deck.cards.filter((c) => c.state).length, 1);
    assert.match(deck.warnings.join(" "), /1 card has Anki review history that doesn't carry over .* starts as new/);
    assert.equal(deck.media.length, 1);
    assert.equal(deck.media[0].name, "cell.png");
    assert.deepEqual([...deck.media[0].data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  });
}

test("bad, newer-only and huge decks say what is wrong", () => {
  assert.throws(() => readApkg(fixture("anki-stub-only.apkg")), /Support older Anki versions/);
  assert.throws(() => readApkg(new TextEncoder().encode("not a zip at all")), /isn't an Anki deck/);
  assert.throws(() => readApkg(new Uint8Array(250_000_001)), /over 250 MB/);
  const broken = fixture("anki-legacy.apkg").slice(0, 900);
  assert.throws(() => readApkg(broken), /isn't an Anki deck|damaged/);
});
