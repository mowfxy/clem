/**
 * Tests for retrieval/vector.ts (hashed-bag cosine).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMBEDDING_DIM,
  embedText,
  cosine,
  makeVectorIndex,
  addToVectorIndex,
  removeFromVectorIndex,
  searchVector,
} from "../../src/retrieval/vector.js";
import type { Chunk } from "../../src/ingest/chunk.js";

function chunk(id: string, text: string, sourceId = "src"): Chunk {
  return { id, sourceId, index: 0, heading: "h", startLine: 0, endLine: 0, text, depth: 0 };
}

test("vector: EMBEDDING_DIM is 256", () => {
  assert.equal(EMBEDDING_DIM, 256);
});

test("vector: embedText produces L2-normalized vector", () => {
  const e = embedText("the quick brown fox");
  assert.equal(e.length, EMBEDDING_DIM);
  let sum = 0;
  for (const v of e) sum += v * v;
  // L2 norm should be ~1.0 (allow small float drift).
  assert.ok(Math.abs(Math.sqrt(sum) - 1) < 1e-6, "expected L2 norm ~1, got " + Math.sqrt(sum));
});

test("vector: identical text produces near-1 cosine", () => {
  const a = embedText("Karnaugh map minimization");
  const b = embedText("Karnaugh map minimization");
  assert.ok(Math.abs(cosine(a, b) - 1) < 1e-9, "cosine of identical should be ~1, got " + cosine(a, b));
});

test("vector: dissimilar text has low similarity", () => {
  const a = embedText("digital logic gates flip-flops");
  const b = embedText("chocolate cake recipe ingredients");
  const s = cosine(a, b);
  assert.ok(s < 0.5, "dissimilar text should have low cosine, got " + s);
});

test("vector: searchVector ranks similar text higher", () => {
  const idx = makeVectorIndex();
  addToVectorIndex(idx, chunk("a", "flip-flops store state in digital logic"));
  addToVectorIndex(idx, chunk("b", "chocolate cake recipe with flour and sugar"));
  addToVectorIndex(idx, chunk("c", "SR latch and JK flip-flop behavior"));
  const hits = searchVector(idx, "flip-flop latch state", 5);
  assert.ok(hits.length >= 2, "should return at least 2 hits, got " + hits.length);
  // Hits must be sorted by descending score.
  for (let i = 1; i < hits.length; i++) {
    assert.ok(hits[i - 1].score >= hits[i].score);
  }
  // Top hit should be about flip-flops, not chocolate.
  assert.notEqual(hits[0].chunkId, "b", "chocolate should not be top hit for flip-flop query");
});

test("vector: removeFromVectorIndex removes chunk", () => {
  const idx = makeVectorIndex();
  addToVectorIndex(idx, chunk("a", "Karnaugh map simplification"));
  addToVectorIndex(idx, chunk("b", "unrelated chocolate content"));
  removeFromVectorIndex(idx, "a");
  const hits = searchVector(idx, "Karnaugh map", 5);
  // After removal, the only matching chunk is b (which contains the words
  // since query text shares tokens). Verify a is gone.
  assert.equal(hits.find(h => h.chunkId === "a"), undefined, "removed chunk must not appear");
});

test("vector: empty index returns no hits", () => {
  const idx = makeVectorIndex();
  assert.equal(searchVector(idx, "anything").length, 0);
});

test("vector: limit caps results", () => {
  const idx = makeVectorIndex();
  for (let i = 0; i < 20; i++) addToVectorIndex(idx, chunk("d" + i, "common words " + i));
  const hits = searchVector(idx, "common words", 5);
  assert.equal(hits.length, 5);
});

test("vector: zero-token text yields zero vector (not NaN)", () => {
  const e = embedText("");
  for (const v of e) assert.equal(v, 0);
  assert.equal(cosine(e, e), 0);
});
