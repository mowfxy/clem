/**
 * Retrieval index facade.
 *
 * Provides a single, friendly interface over the hybrid retrieval system.
 * Application code should import from this module rather than from the
 * individual lexical/vector modules.
 */

import { KinetraError } from "../errors.js";
import type { Chunk } from "../ingest/chunk.js";
import { addToHybridIndex, makeHybridIndex, removeFromHybridIndex, searchHybrid } from "./hybrid.js";
import type { HybridHit, HybridIndex } from "./hybrid.js";

export type RetrievalHit = HybridHit;

export interface RetrievalQuery {
  query: string;
  limit?: number;
  weights?: { lexical?: number; vector?: number };
  /** Restrict to documents in this list of sourceIds. */
  sourceIds?: string[];
}

export function makeIndex(): HybridIndex {
  return makeHybridIndex();
}

export function addChunks(idx: HybridIndex, chunks: Chunk[]): void {
  for (const c of chunks) addToHybridIndex(idx, c);
}

export function removeChunk(idx: HybridIndex, chunkId: string): void {
  removeFromHybridIndex(idx, chunkId);
}

export function search(idx: HybridIndex, q: RetrievalQuery): RetrievalHit[] {
  if (!q || typeof q.query !== "string") {
    throw new KinetraError("validation", "Query text required");
  }
  const limit = q.limit ?? 5;
  const hits = searchHybrid(idx, q.query, limit, q.weights);
  if (!q.sourceIds || q.sourceIds.length === 0) return hits;
  const allowed = new Set(q.sourceIds);
  return hits.filter((h) => allowed.has(h.sourceId)).slice(0, limit);
}

export function indexSize(idx: HybridIndex): number {
  return idx.lexical.chunks.size;
}

export { makeHybridIndex };