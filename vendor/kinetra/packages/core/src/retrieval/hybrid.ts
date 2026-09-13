/**
 * Hybrid retrieval.
 *
 * Combines lexical (BM25) and vector (hashed-bag) retrieval using a
 * weighted sum of normalised scores. The two indices are kept in lock-
 * step; the hybrid interface hides this so callers see a single API.
 *
 * Normalisation uses min-max scaling per query, so absolute scores are
 * not directly comparable across queries but ranking is.
 */

import type { Chunk } from "../ingest/chunk.js";
import { addToLexicalIndex, makeLexicalIndex, removeFromLexicalIndex, searchLexical } from "./lexical.js";
import type { LexicalHit, LexicalIndex } from "./lexical.js";
import { addToVectorIndex, makeVectorIndex, removeFromVectorIndex, searchVector } from "./vector.js";
import type { VectorHit, VectorIndex } from "./vector.js";

export interface HybridHit {
  chunkId: string;
  score: number;
  sourceId: string;
  heading: string;
  index: number;
  startLine: number;
  endLine: number;
  text: string;
  lexical: number;
  vector: number;
}

export interface HybridIndex {
  lexical: LexicalIndex;
  vector: VectorIndex;
}

export function makeHybridIndex(): HybridIndex {
  return { lexical: makeLexicalIndex(), vector: makeVectorIndex() };
}

export function addToHybridIndex(idx: HybridIndex, chunk: Chunk): void {
  addToLexicalIndex(idx.lexical, chunk);
  addToVectorIndex(idx.vector, chunk);
}

export function removeFromHybridIndex(idx: HybridIndex, chunkId: string): void {
  removeFromLexicalIndex(idx.lexical, chunkId);
  removeFromVectorIndex(idx.vector, chunkId);
}

export function searchHybrid(idx: HybridIndex, query: string, limit = 5, weights: { lexical?: number; vector?: number } = {}): HybridHit[] {
  const wL = weights.lexical ?? 0.6;
  const wV = weights.vector ?? 0.4;
  const lexHits = searchLexical(idx.lexical, query, Math.max(limit, 20));
  const vecHits = searchVector(idx.vector, query, Math.max(limit, 20));
  const lexN = normalise(lexHits.map((h) => h.score));
  const vecN = normalise(vecHits.map((h) => h.score));
  const acc = new Map<string, { score: number; lex: number; vec: number; meta: LexicalHit | VectorHit }>();
  lexHits.forEach((h, i) => {
    acc.set(h.chunkId, { score: wL * lexN[i] + 0, lex: lexN[i], vec: 0, meta: h });
  });
  vecHits.forEach((h, i) => {
    const cur = acc.get(h.chunkId);
    if (cur) {
      cur.score += wV * vecN[i];
      cur.vec = vecN[i];
    } else {
      acc.set(h.chunkId, { score: wV * vecN[i], lex: 0, vec: vecN[i], meta: h });
    }
  });
  const out: HybridHit[] = [];
  for (const [id, v] of acc) {
    const m = v.meta as LexicalHit | VectorHit;
    out.push({
      chunkId: id,
      score: v.score,
      sourceId: m.sourceId,
      heading: m.heading,
      index: m.index,
      startLine: m.startLine,
      endLine: m.endLine,
      text: m.text,
      lexical: v.lex,
      vector: v.vec,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function normalise(arr: number[]): number[] {
  if (arr.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const x of arr) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  if (max === min) return arr.map(() => 1);
  return arr.map((x) => (x - min) / (max - min));
}