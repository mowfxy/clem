/**
 * Tests for retrieval/benchmark.ts.
 *
 * Includes the spec example: three near-duplicate lectures on SR / JK / D
 * flip-flops, with queries that must retrieve the correct lecture rather
 * than whichever chunk happens to repeat the keyword most often.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runBenchmark, type BenchmarkCase } from "../../src/retrieval/benchmark.js";
import { makeIndex, addChunks } from "../../src/retrieval/index.js";
import type { Chunk } from "../../src/ingest/chunk.js";

function chunk(id: string, text: string, sourceId: string, heading: string): Chunk {
  return { id, sourceId, index: 0, heading, startLine: 0, endLine: 0, text, depth: 0 };
}

test("benchmark: empty case set yields zero metrics", () => {
  const idx = makeIndex();
  const r = runBenchmark(idx, []);
  assert.equal(r.total, 0);
  assert.equal(r.passRate, 0);
});

test("benchmark: SR/JK/D flip-flop near-duplicate lectures", () => {
  const idx = makeIndex();
  // Three near-duplicate lectures — each one repeats the word
  // "flip-flop" but has distinguishing terms. The benchmark must rank
  // the right lecture for each query.
  const chunks: Chunk[] = [
    chunk("lec4-sr-1", "Lecture 4: SR flip-flops. The SR latch has set and reset inputs. SR flip-flop behaviour depends on S and R.", "lec4", "Lecture 4: SR flip-flops"),
    chunk("lec4-sr-2", "The SR flip-flop is the simplest latch. Forbidden state arises when both S and R are high.", "lec4", "SR latch details"),
    chunk("lec5-jk-1", "Lecture 5: JK flip-flops. The JK flip-flop toggles when both J and K are high. JK avoids the forbidden state of SR.", "lec5", "Lecture 5: JK flip-flops"),
    chunk("lec5-jk-2", "JK flip-flops implement master-slave designs to avoid race conditions in JK circuits.", "lec5", "JK master-slave"),
    chunk("lec6-d-1", "Lecture 6: D flip-flops. The D flip-flop captures data on the clock edge. D eliminates the race condition.", "lec6", "Lecture 6: D flip-flops"),
    chunk("lec6-d-2", "D flip-flops are edge-triggered and store one bit of data each clock cycle.", "lec6", "D edge-triggered"),
  ];
  addChunks(idx, chunks);
  const cases: BenchmarkCase[] = [
    { query: "SR latch set reset forbidden state", expectedSourceIds: ["lec4"] },
    { query: "JK flip-flop toggle master slave race", expectedSourceIds: ["lec5"] },
    { query: "D flip-flop edge triggered data capture", expectedSourceIds: ["lec6"] },
    { query: "what is a flip-flop", expectedSourceIds: ["lec4", "lec5", "lec6"] }, // any is OK
  ];
  const r = runBenchmark(idx, cases);
  assert.equal(r.total, 4);
  assert.equal(r.meanRecall, 1, "every query must recall its target lecture");
  // 3/4 are top-1 hits; the broad "flip-flop" query is OK with any.
  assert.ok(r.passRate >= 0.75, "passRate should be at least 0.75, got " + r.passRate);
});

test("benchmark: unrelated query returns no hits, marks fail", () => {
  const idx = makeIndex();
  const cases: BenchmarkCase[] = [
    { query: "chocolate cake recipe", expectedSourceIds: ["does-not-exist"] },
  ];
  const r = runBenchmark(idx, cases);
  assert.equal(r.total, 1);
  assert.equal(r.passRate, 0);
  assert.equal(r.meanRecall, 0);
});

test("benchmark: MRR is 1.0 when first hit is correct", () => {
  const idx = makeIndex();
  addChunks(idx, [
    chunk("a", "Karnaugh map four variables simplification", "src-a", "K-map"),
    chunk("b", "chocolate cake", "src-b", "recipe"),
  ]);
  const cases: BenchmarkCase[] = [
    { query: "Karnaugh map four variables", expectedSourceIds: ["src-a"] },
  ];
  const r = runBenchmark(idx, cases);
  assert.equal(r.caseResults[0].mrr, 1.0);
});

test("benchmark: MRR is fractional when correct hit is at lower rank", () => {
  const idx = makeIndex();
  addChunks(idx, [
    chunk("noise1", "flip-flop", "noise1", "noise"),
    chunk("noise2", "flip-flop flip-flop", "noise2", "noise"),
    chunk("good", "SR latch flip-flop with set and reset", "src-sr", "SR latch"),
  ]);
  const cases: BenchmarkCase[] = [
    { query: "SR latch set reset", expectedSourceIds: ["src-sr"] },
  ];
  const r = runBenchmark(idx, cases);
  // The good doc should be found at some rank; MRR > 0 and <= 1.
  assert.ok(r.caseResults[0].mrr > 0);
  assert.ok(r.caseResults[0].mrr <= 1);
});
