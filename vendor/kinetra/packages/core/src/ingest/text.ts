/**
 * Plain-text document ingestion.
 *
 * A "text" document is a UTF-8 string (the file contents). We keep the
 * source text verbatim and only attach the metadata needed by the
 * retrieval layer (source id, optional title, line offsets).
 */

import { KinetraError } from "../errors.js";
import { sha256 } from "../utils/hash.js";
import { normalizeWhitespace, splitLines } from "../utils/text.js";
import type { SourceRef } from "../types.js";

export interface TextDocument {
  /** Content hash of the raw source. Stable across renames. */
  sourceId: string;
  /** Optional display title (usually the filename). */
  title?: string;
  /** Raw text. */
  text: string;
  /** 0-based line offsets into `text` for fast line lookups. */
  lineOffsets: number[];
  /** Creation timestamp (ISO 8601). */
  createdAt: string;
}

export function ingestText(raw: string, title?: string): TextDocument {
  if (typeof raw !== "string") {
    throw new KinetraError("validation", "Text document must be a string", { got: typeof raw });
  }
  if (raw.length === 0) {
    throw new KinetraError("validation", "Text document is empty");
  }
  const lineOffsets: number[] = [];
  let pos = 0;
  for (const ch of raw) {
    if (ch === "\n") lineOffsets.push(pos);
    pos += ch.length;
  }
  return {
    sourceId: sha256(raw),
    title,
    text: raw,
    lineOffsets,
    createdAt: new Date().toISOString(),
  };
}

export function lineAt(doc: TextDocument, line: number): string {
  if (line < 0 || line >= doc.lineOffsets.length + 1) {
    throw new KinetraError("validation", "Line out of range", { line, total: doc.lineOffsets.length + 1 });
  }
  const start = line === 0 ? 0 : doc.lineOffsets[line - 1] + 1;
  const end = line < doc.lineOffsets.length ? doc.lineOffsets[line] : doc.text.length;
  // Drop trailing \r (Windows line endings).
  let s = doc.text.slice(start, end);
  if (s.endsWith("\r")) s = s.slice(0, -1);
  return s;
}

export function sliceForSource(doc: TextDocument, ref: SourceRef): string {
  if (ref.page !== undefined || ref.section !== undefined) {
    // Text documents are single-page; page/section are 0.
    if (ref.page !== undefined && ref.page !== 0) {
      throw new KinetraError("validation", "Text document has no page " + ref.page, { page: ref.page });
    }
    if (ref.section !== undefined && ref.section !== 0) {
      throw new KinetraError("validation", "Text document has no section " + ref.section, { section: ref.section });
    }
  }
  return ref.sectionTitle ? "" : doc.text;
}

export function lines(doc: TextDocument): string[] {
  return splitLines(doc.text);
}

export function normalizedText(doc: TextDocument): string {
  return normalizeWhitespace(doc.text);
}
