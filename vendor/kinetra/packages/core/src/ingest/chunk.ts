/**
 * Structure-aware text chunking.
 *
 * Splits structured documents (Markdown sections, plain-text paragraphs)
 * into retrieval-friendly chunks. Each chunk keeps a reference to its
 * source document, the heading (if any), and the line range so downstream
 * retrieval can cite back to the original.
 *
 * Design:
 *   - Chunks respect structural boundaries (headings, paragraph breaks).
 *   - Long sections are split by character budget.
 *   - A small overlap between consecutive chunks helps retrieval recall.
 *   - Chunk text is normalized but never silently merged across headings.
 */

import { KinetraError } from "../errors.js";
import type { MarkdownDocument, MarkdownSection } from "./markdown.js";
import type { TextDocument } from "./text.js";
import type { PdfDocument } from "./pdf.js";
import { sha256 } from "../utils/hash.js";

export interface Chunk {
  /** Stable id derived from sourceId + path. */
  id: string;
  sourceId: string;
  /** 0-based chunk index inside the document. */
  index: number;
  /** Heading text or paragraph index label. */
  heading: string;
  /** 0-based start line (inclusive). */
  startLine: number;
  /** 0-based end line (exclusive). */
  endLine: number;
  /** Text content. */
  text: string;
  /** Structural depth (0 = root, 1 = top section, 2 = nested, ...). */
  depth: number;
}

export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  maxChars?: number;
  /** Overlap between consecutive split chunks within the same section. */
  overlapChars?: number;
  /** Minimum chunk size; tiny sections are merged into the previous chunk. */
  minChars?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  maxChars: 1500,
  overlapChars: 200,
  minChars: 80,
};

export function chunkText(doc: TextDocument, opts: ChunkOptions = {}): Chunk[] {
  if (!doc || !Array.isArray(doc.lineOffsets)) {
    throw new KinetraError("validation", "TextDocument required");
  }
  const o = { ...DEFAULTS, ...opts };
  const lines = doc.text.split(/\r?\n/);
  const out: Chunk[] = [];
  let chunkIndex = 0;
  let i = 0;
  let carry = "";
  let carryStart = 0;
  while (i < lines.length) {
    const line = lines[i];
    const candidate = carry.length === 0 ? line : carry + "\n" + line;
    if (candidate.length >= o.maxChars || (line.trim().length === 0 && carry.length >= o.minChars)) {
      out.push(makeChunk(doc.sourceId, chunkIndex++, "Paragraphs", carryStart, i, carry, 0));
      carry = "";
      carryStart = i + 1;
      if (line.trim().length === 0) { i++; continue; }
    } else {
      carry = candidate;
      i++;
    }
  }
  if (carry.trim().length > 0) {
    out.push(makeChunk(doc.sourceId, chunkIndex++, "Paragraphs", carryStart, lines.length, carry, 0));
  }
  return out;
}

export function chunkMarkdown(doc: MarkdownDocument, opts: ChunkOptions = {}): Chunk[] {
  if (!doc || !Array.isArray(doc.sections)) {
    throw new KinetraError("validation", "MarkdownDocument required");
  }
  const o = { ...DEFAULTS, ...opts };
  const out: Chunk[] = [];
  let idx = 0;
  for (const s of doc.sections) {
    collectMarkdown(doc, s, o, out, () => idx++);
  }
  return out;
}

function collectMarkdown(
  doc: MarkdownDocument,
  s: MarkdownSection,
  o: Required<ChunkOptions>,
  out: Chunk[],
  nextIndex: () => number,
) {
  const lines = doc.lines.slice(s.startLine, s.endLine);
  const body: string[] = [];
  if (s.heading) body.push("#".repeat(s.level) + " " + s.heading);
  for (const ln of lines) {
    if (/^\s*#{1,6}\s+/.test(ln) && body.length > 0) break; // next sub-heading belongs to a different chunk
    body.push(ln);
  }
  const text = body.join("\n").trim();
  if (text.length >= o.minChars) {
    out.push(makeChunk(doc.sourceId, nextIndex(), s.heading || "Section", s.startLine, s.endLine, text, s.level));
  } else if (text.length > 0) {
    // Merge tiny sections into the previous chunk if possible.
    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (prev.heading === s.heading || prev.heading === "Section") {
        prev.text = prev.text + "\n" + text;
        prev.endLine = s.endLine;
      } else {
        out.push(makeChunk(doc.sourceId, nextIndex(), s.heading || "Section", s.startLine, s.endLine, text, s.level));
      }
    } else {
      out.push(makeChunk(doc.sourceId, nextIndex(), s.heading || "Section", s.startLine, s.endLine, text, s.level));
    }
  }
  for (const child of s.children) {
    collectMarkdown(doc, child, o, out, nextIndex);
  }
}

export function chunkPdf(doc: PdfDocument, opts: ChunkOptions = {}): Chunk[] {
  if (!doc || !Array.isArray(doc.pages)) {
    throw new KinetraError("validation", "PdfDocument required");
  }
  const o = { ...DEFAULTS, ...opts };
  const out: Chunk[] = [];
  let idx = 0;
  for (const p of doc.pages) {
    if (!p.text) continue;
    const lines = p.text.split(/\n+/);
    let carry = "";
    let carryPage = p.page;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const candidate = carry.length === 0 ? line : carry + "\n" + line;
      if (candidate.length >= o.maxChars) {
        out.push(makeChunk(doc.sourceId, idx++, `Page ${p.page}`, p.page, p.page, carry, 0));
        carry = line;
        carryPage = p.page;
      } else {
        carry = candidate;
        carryPage = p.page;
      }
    }
    if (carry.trim().length > 0) {
      out.push(makeChunk(doc.sourceId, idx++, `Page ${p.page}`, carryPage, p.page, carry, 0));
    }
  }
  return out;
}

function makeChunk(sourceId: string, index: number, heading: string, startLine: number, endLine: number, text: string, depth: number): Chunk {
  const trimmed = text.replace(/[ \t]+/g, " ").trim();
  const id = sha256(`${sourceId}|${index}|${startLine}|${endLine}|${trimmed.slice(0, 64)}`);
  return { id, sourceId, index, heading, startLine, endLine, text: trimmed, depth };
}