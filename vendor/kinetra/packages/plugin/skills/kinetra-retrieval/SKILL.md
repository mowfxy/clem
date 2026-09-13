---
name: kinetra-retrieval
description: Build a local-first hybrid lexical + vector retrieval index over a corpus of lecture notes, PDFs, or transcripts using Kinetra's deterministic TypeScript core, and run a recall/MRR benchmark. Use when the user wants to query a local corpus, RAG over notes, or measure retrieval quality for a study corpus. Do not use for general web search, hosted embedding APIs, or pure lexical-only ranking where hybrid scoring adds nothing.
---

# Kinetra Retrieval

Build a hybrid index (lexical BM25-ish + deterministic hashed-bag vector)
and benchmark it. Everything runs locally; no embedding model download,
no network call.

## When to activate

- User has a corpus of markdown / PDF / JSON documents and wants to
  query it locally.
- User asks "RAG over my notes", "find the lecture that covers X",
  "rank my flashcards by similarity to topic Y".
- User wants a recall / MRR benchmark for a custom query set.

Do not activate for general web search, hosted embedding services, or
streaming pipelines (this is in-process).

## Core entry points

All paths are relative to the repo root.

```ts
import { makeIndex, addChunks, search, removeChunk, indexSize } from "../../../../core/src/retrieval/index.js";
// Index is a HybridIndex - lexical + vector fused.
import { makeLexicalIndex, addToLexicalIndex, searchLexical } from "../../../../core/src/retrieval/lexical.js";
import { makeVectorIndex, addToVectorIndex, searchVector } from "../../../../core/src/retrieval/vector.js";
import { makeHybridIndex, addToHybridIndex, searchHybrid } from "../../../../core/src/retrieval/hybrid.js";
import { runBenchmark, type BenchmarkCase } from "../../../../core/src/retrieval/benchmark.js";
import { ingestText, type TextDocument } from "../../../../core/src/ingest/text.js";
import { ingestMarkdown, type MarkdownDocument } from "../../../../core/src/ingest/markdown.js";
import { ingestPdf, type PdfDocument } from "../../../../core/src/ingest/pdf.js";
import { chunkText, chunkMarkdown, chunkPdf } from "../../../../core/src/ingest/chunk.js";
```

## Workflow

1. **Ingest.** Read the user's file with `node:fs`. Convert to a
   Kinetra document with `ingestText`, `ingestMarkdown`, or
   `ingestPdf` (or parse JSON yourself and call `chunkText` on the resulting plain text).
2. **Chunk.** Call the matching `chunkX(doc, { maxChars, overlapChars, minChars? })`
   from `ingest/chunk.ts`. Each `Chunk` carries `id`, `sourceId`,
   `text`, `heading`, `startLine`, `endLine`, `depth`.
3. **Build.** Call `makeIndex()` to get a `HybridIndex`. Add chunks
   with `addChunks(idx, chunks)`.
4. **Query.** Use `search(idx, { query, limit, weights: { lexical, vector }, sourceIds? })`
   for ranked hits. For finer control, call `searchHybrid(idx, query, limit, weights)` directly (imported separately from `retrieval/hybrid.ts`); the same hit shape is returned. Weights default to balanced lexical+vector fusion.
5. **Benchmark.** When the user has a labeled query set, build
   `BenchmarkCase[]` (`{ query, expectedSourceIds, expectedChunkIds?, limit? }`)
   and call `runBenchmark(idx, cases)`. Report `meanRecall`,
   `meanMrr`, `passRate`, `total`.

## Embedding caveat

- The default vector embedding is a deterministic hashed-bag. It is
  not a learned embedding. It works well for short technical
  vocabulary with overlapping tokens; it will underperform for
  paraphrase-heavy queries.
- If the user wants real embeddings, the `VectorIndex` is pluggable;
  replace the embed function via the lower-level `searchVector` API.

## What to hand back

- The top-k hits with `chunkId`, `sourceId`, score, and a snippet.
- When benchmarked: mean recall, MRR, pass rate, total.
- A short note on the embedding caveat when relevant.

## Common failure modes

- **Empty corpus.** `search` returns `[]` and `runBenchmark` reports `total: 0, meanRecall: 0, meanMrr: 0, passRate: 0`. Add chunks before benchmarking; a zero-corpus run is not an error but is meaningless.
- **Missing `sourceId`.** The benchmark matches against
  `expectedSourceIds`; mismatched ids silently drop recall. Always
  pass the same id used at ingest.
- **Chunks too large.** Prefer 50-150 tokens per chunk; smaller chunks
  give better precision at the cost of context.
- **Removing chunks.** `removeChunk` is required for accurate indexing
  when files change; otherwise stale chunks survive.
- **Weights sum to zero.** Default weights are sensible; only override
  with care and always re-benchmark after a weight change.
