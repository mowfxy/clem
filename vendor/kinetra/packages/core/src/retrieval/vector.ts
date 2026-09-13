/**
 * Vector retrieval.
 *
 * Pure-TS hashed-bag embedding. Each token is mapped to a fixed-dimension
 * binary-ish vector via a deterministic hash. The "embedding" of a
 * document is the mean of its token vectors. This is a deliberately
 * simple, dependency-free fallback for environments without an embedding
 * provider.
 *
 * It is fast, deterministic, fully local, and good enough to demonstrate
 * semantic-ish retrieval in benchmarks. Real semantic embeddings from
 * external providers can replace `embedText` via the providers
 * abstraction.
 */

import { KinetraError } from "../errors.js";
import { tokenize } from "../utils/text.js";
import type { Chunk } from "../ingest/chunk.js";

export type Embedding = number[];

export const EMBEDDING_DIM = 256;

export function embedText(text: string, dim = EMBEDDING_DIM): Embedding {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new KinetraError("validation", "Embedding dim must be a positive integer", { dim });
  }
  const v = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return v;
  for (const t of tokens) {
    const h = hash32(t);
    // Sign-flipping trick: 50% of hash bits go +1, 50% go -1.
    for (let i = 0; i < dim; i++) {
      const bit = (h >>> (i % 32)) & 1;
      v[i] += bit ? 1 : -1;
    }
  }
  // L2 normalise so cosine similarity reduces to dot product.
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

export function cosine(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export interface VectorHit {
  chunkId: string;
  score: number;
  sourceId: string;
  heading: string;
  index: number;
  startLine: number;
  endLine: number;
  text: string;
}

export interface VectorIndex {
  dim: number;
  chunks: Map<string, Chunk>;
  vecs: Map<string, Embedding>;
}

export function makeVectorIndex(dim = EMBEDDING_DIM): VectorIndex {
  return { dim, chunks: new Map(), vecs: new Map() };
}

export function addToVectorIndex(idx: VectorIndex, chunk: Chunk): void {
  if (idx.chunks.has(chunk.id)) return;
  idx.chunks.set(chunk.id, chunk);
  idx.vecs.set(chunk.id, embedText(chunk.text, idx.dim));
}

export function removeFromVectorIndex(idx: VectorIndex, chunkId: string): void {
  idx.chunks.delete(chunkId);
  idx.vecs.delete(chunkId);
}

export function searchVector(idx: VectorIndex, query: string, limit = 5): VectorHit[] {
  const qv = embedText(query, idx.dim);
  const out: VectorHit[] = [];
  for (const [id, v] of idx.vecs) {
    const s = cosine(qv, v);
    if (s <= 0) continue;
    const chunk = idx.chunks.get(id);
    if (!chunk) continue;
    out.push({
      chunkId: id,
      score: s,
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

function hash32(s: string): number {
  // FNV-1a 32-bit. Cheap, deterministic, no external deps.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}