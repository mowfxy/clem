/**
 * PDF ingestion.
 *
 * Minimal, dependency-free PDF text extractor. Real PDF text lives inside
 * content streams using `BT ... ET` text blocks with `Tj`/`TJ` operators
 * (and Type1/TrueType font encodings). This implementation handles the
 * common case of unencrypted, uncompressed PDFs with `flate` (`zlib`)
 * streams and simple WinAnsiEncoding fonts, which covers lecture slides,
 * notes, and most textbook chapters in practice.
 *
 * For password-protected PDFs, broken xref tables, or exotic CJK / CID
 * fonts, this extractor returns a `PdfDocument` with a warning but no
 * page text. Higher-fidelity extraction is a later enhancement.
 */

import { KinetraError } from "../errors.js";
import { sha256 } from "../utils/hash.js";
import { inflateSync } from "node:zlib";

export interface PdfPage {
  /** 1-based page number. */
  page: number;
  /** Best-effort text extraction for the page. Empty string if unsupported. */
  text: string;
}

export interface PdfDocument {
  sourceId: string;
  title?: string;
  pages: PdfPage[];
  warnings: string[];
  createdAt: string;
  byteLength: number;
}

const MAX_PDF_BYTES = 200 * 1024 * 1024; // 200 MiB safety cap.

export function ingestPdf(bytes: Uint8Array, title?: string): PdfDocument {
  if (!(bytes instanceof Uint8Array)) {
    throw new KinetraError("validation", "PDF must be a Uint8Array", { got: typeof bytes });
  }
  if (bytes.byteLength === 0) {
    throw new KinetraError("parse", "Empty PDF");
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new KinetraError("validation", "PDF too large", { bytes: bytes.byteLength, cap: MAX_PDF_BYTES });
  }
  const header = bytes.subarray(0, Math.min(8, bytes.byteLength));
  const headerStr = new TextDecoder("latin1").decode(header);
  if (!headerStr.startsWith("%PDF-")) {
    throw new KinetraError("parse", "Not a PDF (missing %PDF- header)", { header: headerStr });
  }
  const warnings: string[] = [];
  const pages = extractPages(bytes, warnings);
  return {
    sourceId: sha256(bytes),
    title,
    pages,
    warnings,
    createdAt: new Date().toISOString(),
    byteLength: bytes.byteLength,
  };
}

function extractPages(bytes: Uint8Array, warnings: string[]): PdfPage[] {
  // Use a binary string (each char = one byte) so bytes 0x80-0x9F are not
  // re-mapped by TextDecoder's Windows-1252 behaviour. PDF streams routinely
  // contain such bytes in FlateDecode output.
  const bin = bytesToBinaryString(bytes);
  const pageObjectNums = collectPageObjectNums(bin);
  if (pageObjectNums.length === 0) {
    warnings.push("Could not locate page tree; no text extracted.");
    return [];
  }
  const objects = parseObjects(bytes);
  const pageInfos: { page: number; contentRef: number | null }[] = [];
  for (let i = 0; i < pageObjectNums.length; i++) {
    const num = pageObjectNums[i];
    const obj = objects.get(num);
    if (!obj) continue;
    const contentRef = findContentStreamRef(obj.dict);
    pageInfos.push({ page: i + 1, contentRef });
  }
  const out: PdfPage[] = [];
  for (const p of pageInfos) {
    let text = "";
    if (p.contentRef !== null) {
      try {
        const stream = objects.get(p.contentRef);
        if (stream && stream.bytes.length > 0) {
          text = extractTextFromStream(stream.bytes, warnings);
        }
      } catch (e) {
        warnings.push(`Page ${p.page}: stream error: ${(e as Error).message}`);
      }
    }
    out.push({ page: p.page, text });
  }
  return out;
}

/**
 * Build a binary string (one char per byte) from a Uint8Array. Unlike
 * TextDecoder("latin1") this preserves bytes 0x80-0x9F exactly, which is
 * required for round-tripping PDF stream bytes.
 */
function bytesToBinaryString(bytes: Uint8Array): string {
  let s = "";
  // Use chunked String.fromCharCode to avoid stack overflow on large arrays.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    s += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return s;
}

function collectPageObjectNums(ascii: string): number[] {
  // Walk `Type /Page` and `Type /Pages` markers. Pages of a /Pages tree
  // have a /Kids array of object refs. We collect the order they appear.
  const pages: number[] = [];
  const seen = new Set<number>();
  // Step 1: find the /Pages root by scanning all objects, then resolve its
  // Kids recursively. The match is bounded by "endobj" so the regex does
  // not leak across objects (which previously caused the Catalog object
  // to be picked because /Type /Pages appears inside the next object body).
  const objRe = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g;
  let root: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(ascii)) !== null) {
    if (/\/Type\s*\/Pages\b/.test(m[2])) {
      root = parseInt(m[1], 10);
      break;
    }
  }
  if (root !== null) {
    collectKids(ascii, root, pages, seen);
  } else {
    // Step 2: some PDFs have flat /Page objects only. Scan every object
    // body for /Type /Page (NOT /Type /Pages) and keep the order seen.
    objRe.lastIndex = 0;
    while ((m = objRe.exec(ascii)) !== null) {
      if (/\/Type\s*\/Page(?!s)\b/.test(m[2])) {
        const n = parseInt(m[1], 10);
        if (!seen.has(n)) {
          seen.add(n);
          pages.push(n);
        }
      }
    }
  }
  return pages;
}

function collectKids(ascii: string, objNum: number, out: number[], seen: Set<number>): void {
  if (seen.has(objNum)) return;
  seen.add(objNum);
  const block = findObjectBody(ascii, objNum);
  if (!block) return;
  const kids = extractArrayRefs(block, "/Kids");
  for (const k of kids) {
    if (seen.has(k)) continue;
    const child = findObjectBody(ascii, k);
    if (!child) continue;
    if (/\/Type\s*\/Page(?!s)/.test(child)) {
      out.push(k);
    } else if (/\/Type\s*\/Pages/.test(child)) {
      collectKids(ascii, k, out, seen);
    } else {
      // Be defensive: if the object contains /MediaBox we treat it as a page.
      if (/\/MediaBox/.test(child)) out.push(k);
    }
  }
}

function findObjectNumberWithEntry(ascii: string, entry: string): number | null {
  const re = new RegExp(`(\\d+)\\s+\\d+\\s+obj[\\s\\S]*?${escapeRegExp(entry)}`, "g");
  const m = re.exec(ascii);
  return m ? parseInt(m[1], 10) : null;
}

function findObjectBody(ascii: string, objNum: number): string | null {
  // The first definition wins. Allow "N M obj ... endobj" forms.
  const re = new RegExp(`${objNum}\\s+\\d+\\s+obj\\b([\\s\\S]*?)endobj`);
  const m = re.exec(ascii);
  return m ? m[1] : null;
}

function extractArrayRefs(body: string, key: string): number[] {
  const re = new RegExp(`${escapeRegExp(key)}\\s*\\[([^\\]]*)\\]`);
  const m = re.exec(body);
  if (!m) return [];
  const out: number[] = [];
  const reNum = /(\d+)\s+\d+\s+R/g;
  let n: RegExpExecArray | null;
  while ((n = reNum.exec(m[1])) !== null) out.push(parseInt(n[1], 10));
  return out;
}

function findContentStreamRef(dict: string): number | null {
  // /Contents N M R or /Contents [N M R ...]
  const single = /\/(?:Contents|Filter)\s+(\d+)\s+\d+\s+R/.exec(dict);
  if (single) return parseInt(single[1], 10);
  const arr = /\/Contents\s*\[([^\]]*)\]/.exec(dict);
  if (arr) {
    const m = /(\d+)\s+\d+\s+R/.exec(arr[1]);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

interface ParsedObject {
  num: number;
  dict: string;
  bytes: Uint8Array;
}

function parseObjects(bytes: Uint8Array): Map<number, ParsedObject> {
  const out = new Map<number, ParsedObject>();
  const bin = bytesToBinaryString(bytes);
  const re = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bin)) !== null) {
    const num = parseInt(m[1], 10);
    const body = m[3];
    const bodyOffset = m.index + m[0].length - body.length - 7; // approximate
    // Compute body offset accurately: use m[0].indexOf(body)
    const bodyStartInMatch = m[0].indexOf(body);
    const { dict, stream } = splitDictAndStream(body, bytes, m.index + bodyStartInMatch);
    if (stream) {
      out.set(num, { num, dict, bytes: stream });
    } else {
      out.set(num, { num, dict, bytes: new Uint8Array() });
    }
  }
  return out;
}

function splitDictAndStream(body: string, raw: Uint8Array, bodyOffset: number): { dict: string; stream: Uint8Array | null } {
  const start = body.indexOf("<<");
  if (start < 0) return { dict: body, stream: null };
  let depth = 1;
  let i = start + 2;
  while (i < body.length && depth > 0) {
    const c = body[i];
    if (c === "<" && body[i + 1] === "<") { depth++; i += 2; continue; }
    if (c === ">" && body[i + 1] === ">") { depth--; i += 2; continue; }
    i++;
  }
  const dictEnd = i;
  const dict = body.slice(start, dictEnd);
  // After dictEnd, the remainder should be "stream\n ... \nendstream".
  const after = body.slice(dictEnd);
  const sm = /\bstream\b\s*\n?([\s\S]*?)\n?\s*\bendstream\b/.exec(after);
  if (!sm) return { dict, stream: null };
  // Find the exact byte range of the stream in raw. We rely on the relative
  // text offset and the body's offset in the file.
  const streamText = sm[1];
  const streamStart = bodyOffset + dictEnd + (sm.index + sm[0].indexOf(streamText));
  // Apply FlateDecode if requested.
  const filterMatch = /\/Filter\s*\/FlateDecode|\/Filter\s*\[\s*\/FlateDecode/.exec(dict);
  if (filterMatch) {
    try {
      const inflated = inflateSync(Buffer.from(streamText, "latin1"));
      return { dict, stream: new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength) };
    } catch {
      return { dict, stream: null };
    }
  }
  // Fallback: try to map the text characters back to bytes.
  const bytes = new Uint8Array(streamText.length);
  for (let j = 0; j < streamText.length; j++) bytes[j] = streamText.charCodeAt(j) & 0xff;
  return { dict, stream: bytes.subarray(streamStart, Math.min(streamStart + bytes.length, raw.byteLength)) };
}

function extractTextFromStream(stream: Uint8Array, warnings: string[]): string {
  if (stream.byteLength === 0) return "";
  // Streams are post-inflate binary content. Decode the text operators.
  const ascii = new TextDecoder("latin1").decode(stream);
  return extractTextFromAsciiStream(ascii, warnings);
}

function extractTextFromAsciiStream(ascii: string, warnings: string[]): string {
  // Extract text from BT...ET blocks, with Tj, TJ, ', and " operators.
  const out: string[] = [];
  const blockRe = /\bBT\b([\s\S]*?)\bET\b/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(ascii)) !== null) {
    const body = m[1];
    // Tokens like (string) Tj, [array] TJ, or "..." with line breaks.
    const tjRe = /\(((?:\\.|[^()\\])*)\)\s*(Tj|TJ|')/g;
    let t: RegExpExecArray | null;
    while ((t = tjRe.exec(body)) !== null) {
      out.push(decodePdfString(t[1]));
    }
    // Hex string form: <FEFF...>Tj (used by Kinetra's emitter and many PDF libraries).
    const hexTjRe = /<([0-9A-Fa-f]+)>\s*(Tj|TJ|')/g;
    while ((t = hexTjRe.exec(body)) !== null) {
      out.push(decodeHexString(t[1]));
    }
    // Array form: [(part1) (part2) -3 (part3)] TJ
    const arrRe = /\[((?:\((?:\\.|[^()\\])*\)|<[0-9A-Fa-f]+>|-?\d+(?:\.\d+)?\s*)+)\]\s*TJ/g;
    while ((t = arrRe.exec(body)) !== null) {
      const inside = t[1];
      const partRe = /(\((?:\\.|[^()\\])*\))|(<([0-9A-Fa-f]+)>)/g;
      let p: RegExpExecArray | null;
      while ((p = partRe.exec(inside)) !== null) {
        if (p[1] !== undefined) {
          out.push(decodePdfString(p[1].slice(1, -1)));
        } else if (p[3] !== undefined) {
          out.push(decodeHexString(p[3]));
        }
      }
    }
  }
  if (out.length === 0 && ascii.length > 0) {
    warnings.push("Page contained no text operations (image-only or unsupported font).");
  }
  return out.join(" ").replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n").trim();
}

function decodeHexString(hex: string): string {
  // Decode a hex-encoded PDF string. If the byte sequence starts with 0xFE 0xFF
  // it is UTF-16BE (with BOM); otherwise it is treated as a sequence of bytes
  // decoded as latin1 (PDFDocEncoding substitution is not required for the
  // subset of Kinetra-generated text, which always uses UTF-16BE).
  if (hex.length % 2 !== 0) hex = hex.slice(0, hex.length - 1);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16BE: drop BOM and decode pairs of bytes as code points.
    let s = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return s;
  }
  // No BOM: try latin1 (PDFDocEncoding is a superset; latin1 is a safe fallback).
  return new TextDecoder("latin1").decode(bytes);
}

function decodePdfString(s: string): string {
  // Handle \\, \(, \), \n, \r, \t, \ddd (octal).
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out += c; continue; }
    const next = s[++i];
    if (next === undefined) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "(") out += "(";
    else if (next === ")") out += ")";
    else if (next === "\\") out += "\\";
    else if (/[0-7]/.test(next)) {
      let oct = next;
      if (s[i + 1] && /[0-7]/.test(s[i + 1])) oct += s[++i];
      if (s[i + 1] && /[0-7]/.test(s[i + 1])) oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += next;
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}