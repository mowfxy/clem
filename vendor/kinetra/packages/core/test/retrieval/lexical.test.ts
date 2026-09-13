/**
 * Tests for retrieval/lexical.ts (BM25).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeLexicalIndex,
  addToLexicalIndex,
  removeFromLexicalIndex,
  searchLexical,
} from "../../src/retrieval/lexical.js";
import type { Chunk } from "../../src/ingest/chunk.js";

function chunk(id: string, text: string, sourceId = "src", heading = "h", index = 0): Chunk {
  return { id, sourceId, index, heading, startLine: 0, endLine: 0, text, depth: 0 };
}

test("lexical: empty index returns no hits", () => {
  const idx = makeLexicalIndex();
  assert.equal(searchLexical(idx, "anything").length, 0);
});

test("lexical: finds exact term match", () => {
  const idx = makeLexicalIndex();
  addToLexicalIndex(idx, chunk("a", "the SR flip-flop stores one bit of state"));
  addToLexicalIndex(idx, chunk("b", "the JK flip-flop has set and reset inputs"));
  addToLexicalIndex(idx, chunk("c", "the D flip-flop captures data on clock edge"));
  const hits = searchLexical(idx, "flip-flop", 5);
  assert.equal(hits.length, 3);
  // All have the term.
  for (const h of hits) {
    assert.ok(h.score > 0, "score should be > 0");
  }
});

test("lexical: BM25 prefers rare terms (IDF effect)", () => {
  const idx = makeLexicalIndex();
  addToLexicalIndex(idx, chunk("common", "the circuit contains wires and logic gates"));
  addToLexicalIndex(idx, chunk("rare", "the Karnaugh map simplification technique reduces literals"));
  // "karnaugh" appears in only one doc, should rank higher per-match than "the".
  const hits = searchLexical(idx, "karnaugh", 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].chunkId, "rare");
});

test("lexical: returns hits sorted by descending score", () => {
  const idx = makeLexicalIndex();
  addToLexicalIndex(idx, chunk("a", "combinational logic gates"));
  addToLexicalIndex(idx, chunk("b", "combinational logic gates and combinational analysis"));
  addToLexicalIndex(idx, chunk("c", "sequential logic circuits"));
  const hits = searchLexical(idx, "combinational", 5);
  assert.equal(hits.length, 2);
  assert.ok(hits[0].score >= hits[1].score, "hits must be sorted desc");
  assert.equal(hits[0].chunkId, "b", "doc with more matches ranks first");
});

test("lexical: remove deletes chunk and updates df", () => {
  const idx = makeLexicalIndex();
  addToLexicalIndex(idx, chunk("a", "Karnaugh map three variables"));
  addToLexicalIndex(idx, chunk("b", "Karnaugh map four variables"));
  assert.equal(searchLexical(idx, "Karnaugh", 5).length, 2);
  removeFromLexicalIndex(idx, "a");
  const hits = searchLexical(idx, "Karnaugh", 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].chunkId, "b");
});

test("lexical: limit parameter caps results", () => {
  const idx = makeLexicalIndex();
  for (let i = 0; i < 10; i++) addToLexicalIndex(idx, chunk("d" + i, "logic gates document " + i));
  const hits = searchLexical(idx, "logic", 3);
  assert.equal(hits.length, 3);
});

test("lexical: empty query returns no hits", () => {
  const idx = makeLexicalIndex();
  addToLexicalIndex(idx, chunk("a", "some text here"));
  assert.equal(searchLexical(idx, "").length, 0);
  assert.equal(searchLexical(idx, "   ").length, 0);
});

test("lexical: distinguishes near-duplicate lectures by heading context", () => {
  // The spec example: "SR" vs "JK" vs "D" flip-flops.
  // Each lecture repeats "flip-flop" but the unique term must dominate.
  const idx = makeLexicalIndex();
  addToLexicalIndex(idx, chunk("lec4-sr", "Lecture 4: SR flip-flops. The SR latch has set and reset inputs. SR flip-flop behaviour depends on S and R.", "lec4", "Lecture 4: SR flip-flops", 0));
  addToLexicalIndex(idx, chunk("lec5-jk", "Lecture 5: JK flip-flops. The JK flip-flop toggles when both J and K are high. JK avoids the forbidden state of SR.", "lec5", "Lecture 5: JK flip-flops", 0));
  addToLexicalIndex(idx, chunk("lec6-d", "Lecture 6: D flip-flops. The D flip-flop captures data on the clock edge. D eliminates the race condition.", "lec6", "Lecture 6: D flip-flops", 0));
  const sr = searchLexical(idx, "SR latch set reset forbidden state", 3);
  const jk = searchLexical(idx, "JK flip-flop toggle J K high", 3);
  const dd = searchLexical(idx, "D flip-flop data edge capture", 3);
  assert.equal(sr[0].chunkId, "lec4-sr", "SR query should rank Lecture 4 first");
  assert.equal(jk[0].chunkId, "lec5-jk", "JK query should rank Lecture 5 first");
  assert.equal(dd[0].chunkId, "lec6-d", "D query should rank Lecture 6 first");
});
