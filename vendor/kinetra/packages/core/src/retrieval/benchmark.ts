/**
 * Retrieval benchmark.
 *
 * Given a labeled set of (query, expected sourceIds, expected chunkIds?)
 * entries, this module measures recall@k and MRR for the index. Use it
 * to keep retrieval quality honest as the system grows.
 *
 * The benchmark is intentionally lightweight: a single-pass evaluation
 * that reports both per-query and aggregate metrics.
 */

import type { HybridIndex } from "./hybrid.js";
import { search } from "./index.js";

export interface BenchmarkCase {
  query: string;
  /** Any of these sourceIds is considered a "hit". */
  expectedSourceIds: string[];
  /** Optional: specific chunk ids that count as exact matches (boost MRR). */
  expectedChunkIds?: string[];
  /** Optional: how many hits to retrieve. */
  limit?: number;
}

export interface BenchmarkResult {
  caseResults: { query: string; recall: number; mrr: number; hits: string[]; ok: boolean }[];
  meanRecall: number;
  meanMrr: number;
  passRate: number;
  total: number;
}

export function runBenchmark(idx: HybridIndex, cases: BenchmarkCase[]): BenchmarkResult {
  const cr: BenchmarkResult["caseResults"] = [];
  let sumRecall = 0;
  let sumMrr = 0;
  let pass = 0;
  for (const c of cases) {
    const hits = search(idx, { query: c.query, limit: c.limit ?? 5 });
    const expected = new Set(c.expectedSourceIds);
    const exact = new Set(c.expectedChunkIds ?? []);
    const hitSources = hits.map((h) => h.sourceId);
    const top1 = hitSources[0];
    const okExact = top1 ? exact.has(hits[0].chunkId) : false;
    const okSource = top1 ? expected.has(top1) : false;
    const recallHit = hitSources.some((s) => expected.has(s)) ? 1 : 0;
    let mrr = 0;
    for (let i = 0; i < hitSources.length; i++) {
      if (expected.has(hitSources[i])) { mrr = 1 / (i + 1); break; }
    }
    if (okExact || okSource) pass++;
    sumRecall += recallHit;
    sumMrr += mrr;
    cr.push({ query: c.query, recall: recallHit, mrr, hits: hits.map((h) => h.chunkId), ok: okExact || okSource });
  }
  const total = cases.length;
  return {
    caseResults: cr,
    meanRecall: total === 0 ? 0 : sumRecall / total,
    meanMrr: total === 0 ? 0 : sumMrr / total,
    passRate: total === 0 ? 0 : pass / total,
    total,
  };
}