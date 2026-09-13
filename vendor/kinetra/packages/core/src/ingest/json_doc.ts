/**
 * JSON document ingestion.
 *
 * Two flavours:
 *   1. A plain JSON object treated as a structured document (one "page",
 *      arbitrary keys, no rendering).
 *   2. A list of records, each treated as a row. The schema is taken from
 *      the union of keys across the first 100 rows.
 *
 * The output is a `JsonDocument` whose `chunks` field is a list of
 * {key, value, path, line} entries the chunker can ingest directly.
 */

import { KinetraError } from "../errors.js";
import { sha256 } from "../utils/hash.js";

export interface JsonChunk {
  /** 0-based chunk index. */
  index: number;
  /** Object-path of this chunk within the document. */
  path: string;
  /** Heading-ish label. For records this is the row key, if any. */
  heading: string;
  /** Text content (stringified JSON for primitives; for records, the row). */
  text: string;
  /** 1-based line in the original source if known. */
  line?: number;
}

export interface JsonDocument {
  sourceId: string;
  title?: string;
  /** Number of top-level entries. */
  count: number;
  chunks: JsonChunk[];
  createdAt: string;
}

export function ingestJson(raw: string, title?: string): JsonDocument {
  if (typeof raw !== "string") {
    throw new KinetraError("validation", "JSON source must be a string", { got: typeof raw });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new KinetraError("parse", "Invalid JSON: " + (e as Error).message, { source: title ?? "json" });
  }
  const chunks: JsonChunk[] = [];
  if (Array.isArray(parsed)) {
    parsed.forEach((item, i) => {
      const path = "$[" + i + "]";
      const text = stringify(item);
      chunks.push({ index: chunks.length, path, heading: "#" + i, text });
    });
  } else if (parsed !== null && typeof parsed === "object") {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      chunks.push({
        index: chunks.length,
        path: "$.\"" + escapePath(k) + "\"",
        heading: k,
        text: stringify(v),
      });
    }
  } else {
    chunks.push({ index: 0, path: "$", heading: "value", text: stringify(parsed) });
  }
  return {
    sourceId: sha256(raw),
    title,
    count: chunks.length,
    chunks,
    createdAt: new Date().toISOString(),
  };
}

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function escapePath(k: string): string {
  return k.replace(/(["\\])/g, "\\$1");
}
