/**
 * Tests for retrieval/hybrid.ts (lexical + vector fusion).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeHybridIndex,
  addToHybridIndex,
  removeFromHybridIndex,
  searchHybrid,
} from "../../src/retrieval/hybrid.js";
import type { Chunk } from "../../src/ingest/chunk.js";

function chunk(id: string, text: string, sourceId = "src"): Chunk {
  return { id, sourceId, index: 0, heading: "h", startLine: 0, endLine: 0, text, depth: 0 };
}

test("hybrid: empty index returns no hits", () => {
  const idx = makeHybridIndex();
  assert.equal(searchHybrid(idx, "anything").length, 0);
});

test("hybrid: ranks relevant chunks above irrelevant ones", () => {
  const idx = makeHybridIndex();
  addToHybridIndex(idx, chunk("rel", "Karnaugh map minimization for four variables"));
  addToHybridIndex(idx, chunk("irr", "chocolate cake with sugar and flour ingredients"));
  const hits = searchHybrid(idx, "Karnaugh map minimization", 3);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].chunkId, "rel");
});

test("hybrid: combines lexical and vector signals", () => {
  const idx = makeHybridIndex();
  // "rel" has the exact term; "rel2" has it semantically.
  addToHybridIndex(idx, chunk("rel", "Karnaugh map"));
  addToHybridIndex(idx, chunk("rel2", "Boolean minimization using map grouping"));
  const hits = searchHybrid(idx, "Karnaugh map minimization", 5);
  assert.ok(hits.length >= 1);
});

test("hybrid: weights parameter controls fusion", () => {
  const idx = makeHybridIndex();
  addToHybridIndex(idx, chunk("a", "alpha alpha alpha beta"));
  addToHybridIndex(idx, chunk("b", "alpha alpha gamma gamma"));
  // All-lexical: chunk with more "alpha" mentions wins if lexical dominates.
  const lexOnly = searchHybrid(idx, "alpha", 5, { lexical: 1, vector: 0 });
  assert.equal(lexOnly[0].chunkId, "a", "lexical-only should prefer chunk a with 3 mentions");
});

test("hybrid: removeFromHybridIndex updates both indices", () => {
  const idx = makeHybridIndex();
  addToHybridIndex(idx, chunk("a", "Karnaugh map simplification"));
  addToHybridIndex(idx, chunk("b", "chocolate cake recipe"));
  removeFromHybridIndex(idx, "a");
  const hits = searchHybrid(idx, "Karnaugh map", 5);
  assert.equal(hits.find(h => h.chunkId === "a"), undefined);
});

test("hybrid: each hit exposes lexical and vector sub-scores", () => {
  const idx = makeHybridIndex();
  addToHybridIndex(idx, chunk("a", "Karnaugh map"));
  const hits = searchHybrid(idx, "Karnaugh map", 1);
  assert.equal(hits.length, 1);
  assert.ok("lexical" in hits[0]);
  assert.ok("vector" in hits[0]);
  assert.ok(hits[0].score > 0);
});

test("hybrid: limit caps results", () => {
  const idx = makeHybridIndex();
  for (let i = 0; i < 20; i++) addToHybridIndex(idx, chunk("d" + i, "common words " + i));
  const hits = searchHybrid(idx, "common words", 5);
  assert.equal(hits.length, 5);
});

test("hybrid: near-duplicate lectures on flip-flops", () => {
  const idx = makeHybridIndex();
  addToHybridIndex(idx, chunk("lec4", "Lecture 4: SR flip-flops have set and reset", "lec4"));
  addToHybridIndex(idx, chunk("lec5", "Lecture 5: JK flip-flops toggle on J and K high", "lec5"));
  addToHybridIndex(idx, chunk("lec6", "Lecture 6: D flip-flops capture data on clock edge", "lec6"));
  const sr = searchHybrid(idx, "SR set reset forbidden", 3);
  const jk = searchHybrid(idx, "JK toggle J K", 3);
  assert.equal(sr[0].chunkId, "lec4", "SR query should rank Lecture 4 first");
  assert.equal(jk[0].chunkId, "lec5", "JK query should rank Lecture 5 first");
});
