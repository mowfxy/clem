/**
 * Lexical retrieval using BM25.
 *
 * A textbook-style BM25 implementation with:
 *   - configurable k1 and b
 *   - per-document term frequencies
 *   - per-term document frequencies
 *   - safe handling of empty queries
 *
 * The index is in-memory and rebuilt from chunks. It supports incremental
 * add/remove.
 */

import { KinetraError } from "../errors.js";
import { tokenize } from "../utils/text.js";
import type { Chunk } from "../ingest/chunk.js";

export interface LexicalHit {
  chunkId: string;
  score: number;
  sourceId: string;
  heading: string;
  index: number;
  startLine: number;
  endLine: number;
  text: string;
}

export interface LexicalIndex {
  /** id -> chunk. */
  chunks: Map<string, Chunk>;
  /** id -> term frequencies. */
  tf: Map<string, Map<string, number>>;
  /** id -> total terms. */
  docLen: Map<string, number>;
  /** term -> document count. */
  df: Map<string, number>;
  /** Average document length. */
  avgDocLen: number;
  k1: number;
  b: number;
}

export function makeLexicalIndex(opts: { k1?: number; b?: number } = {}): LexicalIndex {
  return {
    chunks: new Map(),
    tf: new Map(),
    docLen: new Map(),
    df: new Map(),
    avgDocLen: 0,
    k1: opts.k1 ?? 1.5,
    b: opts.b ?? 0.75,
  };
}

export function addToLexicalIndex(idx: LexicalIndex, chunk: Chunk): void {
  if (!chunk || typeof chunk.id !== "string" || typeof chunk.text !== "string") {
    throw new KinetraError("validation", "Chunk must have id and text");
  }
  if (idx.chunks.has(chunk.id)) return;
  const terms = tokenize(chunk.text);
  const tf = new Map<string, number>();
  for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
  idx.chunks.set(chunk.id, chunk);
  idx.tf.set(chunk.id, tf);
  idx.docLen.set(chunk.id, terms.length);
  for (const t of tf.keys()) idx.df.set(t, (idx.df.get(t) ?? 0) + 1);
  recomputeAverage(idx);
}

export function removeFromLexicalIndex(idx: LexicalIndex, chunkId: string): void {
  if (!idx.chunks.has(chunkId)) return;
  const tf = idx.tf.get(chunkId);
  if (tf) {
    for (const t of tf.keys()) {
      const c = idx.df.get(t) ?? 0;
      if (c <= 1) idx.df.delete(t);
      else idx.df.set(t, c - 1);
    }
  }
  idx.chunks.delete(chunkId);
  idx.tf.delete(chunkId);
  idx.docLen.delete(chunkId);
  recomputeAverage(idx);
}

export function searchLexical(idx: LexicalIndex, query: string, limit = 5): LexicalHit[] {
  const qTerms = tokenize(query);
  if (qTerms.length === 0) return [];
  const N = Math.max(1, idx.chunks.size);
  const scores = new Map<string, number>();
  for (const q of qTerms) {
    const df = idx.df.get(q) ?? 0;
    if (df === 0) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (const [id, tf] of idx.tf) {
      const f = tf.get(q);
      if (!f) continue;
      const dl = idx.docLen.get(id) ?? 0;
      const denom = f + idx.k1 * (1 - idx.b + idx.b * (dl / Math.max(1, idx.avgDocLen)));
      const s = idf * ((f * (idx.k1 + 1)) / Math.max(1e-9, denom));
      scores.set(id, (scores.get(id) ?? 0) + s);
    }
  }
  const out: LexicalHit[] = [];
  for (const [id, score] of scores) {
    if (score <= 0) continue;
    const chunk = idx.chunks.get(id);
    if (!chunk) continue;
    out.push({
      chunkId: id,
      score,
      sourceId: chunk.sourceId,
      heading: chunk.heading,
      index: chunk.index,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function recomputeAverage(idx: LexicalIndex): void {
  if (idx.docLen.size === 0) { idx.avgDocLen = 0; return; }
  let total = 0;
  for (const v of idx.docLen.values()) total += v;
  idx.avgDocLen = total / idx.docLen.size;
}