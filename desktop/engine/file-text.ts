/// <reference path="./pdfjs-worker.d.ts" />
// A CMS file's text for the AI's guc.read (docs/GUC-VPS-ENGINE.md → AI tools): PDFs through pdfjs-dist, Word,
// PowerPoint and Excel through desktop/office-text.ts, text as it is; one part per page, slide or sheet. Read from
// bytes in memory, so a file nobody saved never touches the disk. Extracted text is kept a while in a small LRU.
import { LRUCache } from "lru-cache";
import type { FileText } from "../../core/guc/ai-tools.ts";
import { officeBytesText } from "../office-text.ts";

/** Kept this long after it was last read, and at most this many characters in all (each char ~2 bytes). */
export const TEXT_TTL_MS = 45 * 60_000;
export const TEXT_MAX_CHARS = 12_000_000;
/** A file larger than this is not read for text (open it in the viewer). */
export const READ_MAX_BYTES = 150_000_000;
const PDF_PAGES = 2000, PART = 4000;

export type TextCacheOptions = { ttl?: number; maxChars?: number; perf?: { now(): number } };
export const textCache = (o: TextCacheOptions = {}) => new LRUCache<string, FileText>({
  max: 200, ttl: o.ttl ?? TEXT_TTL_MS, ttlResolution: 0, maxSize: o.maxChars ?? TEXT_MAX_CHARS, updateAgeOnGet: true,
  sizeCalculation: (t) => Math.max(1, t.parts.reduce((n, p) => n + p.length, 0)), ...(o.perf ? { perf: o.perf } : {}),
});

/** Text without pages, cut at paragraph ends into parts of about PART characters. */
function chunks(text: string) {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n(?=\s*\n)|\n/)) {
    if (cur && cur.length + para.length > PART) { out.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + para;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

let pdfjs: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | undefined;
/** pdfjs in Node: the legacy build, its worker run in this thread (globalThis.pdfjsWorker), so the bundle needs no worker file. */
const loadPdfjs = () => pdfjs ||= (async () => {
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ||= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return import("pdfjs-dist/legacy/build/pdf.mjs");
})();

async function pdfParts(bytes: Uint8Array) {
  const lib = await loadPdfjs();
  // pdfjs takes ownership of the buffer it is given: a copy keeps the caller's bytes usable.
  const task = lib.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  try {
    const pdf = await task.promise, parts: string[] = [];
    for (let p = 1; p <= Math.min(pdf.numPages, PDF_PAGES); p++) {
      const page = await pdf.getPage(p), content = await page.getTextContent();
      let line = "";
      for (const item of content.items as { str?: string; hasEOL?: boolean }[]) line += (item.str || "") + (item.hasEOL ? "\n" : item.str ? " " : "");
      parts.push(line.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim());
      page.cleanup();
    }
    if (pdf.numPages > PDF_PAGES) parts.push(`(The text stops at page ${PDF_PAGES} of ${pdf.numPages}; open the file to see the rest.)`);
    return parts;
  } finally { await task.destroy(); }
}

/** The file's text by page (PDF), slide (PowerPoint), sheet (Excel) or part (Word, text). Throws for types without text. */
export async function extractText(bytes: Uint8Array, name: string, type = ""): Promise<FileText> {
  if (bytes.length > READ_MAX_BYTES) throw Error(`${name} is too large to read as text (${Math.round(bytes.length / 1e6)} MB). Open it in the viewer.`);
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1].toLowerCase() || "";
  if (ext === "pdf" || type === "application/pdf" || new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return { name, unit: "page", parts: await pdfParts(bytes) };
  if (ext === "pptx" || ext === "xlsx") {
    const text = officeBytesText(bytes, name), marker = ext === "pptx" ? "slide" : "sheet";
    // officeText writes "[name, slide N]" / "[name, sheet "X"]" before each one: those become the parts.
    const parts = text.split(new RegExp(`^\\[${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, ${marker} [^\\]]*\\]\\n?`, "m")).map((p) => p.trim());
    return { name, unit: marker, parts: parts[0] ? parts : parts.slice(1) };
  }
  if (ext === "docx") return { name, unit: "part", parts: chunks(officeBytesText(bytes, name)) };
  if (/^text\//.test(type) || /^(txt|md|csv|tsv|json|html?|xml|py|java|c|cpp|h|js|ts|m|sql|vhd|v|asm|tex)$/.test(ext)) return { name, unit: "part", parts: chunks(new TextDecoder().decode(bytes)) };
  throw Error(`${name} has no text to read (${ext ? "." + ext : type || "unknown type"}). Open it in the viewer.`);
}
