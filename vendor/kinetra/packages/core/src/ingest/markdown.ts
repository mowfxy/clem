/**
 * Markdown ingestion.
 *
 * Parses headings, code blocks, lists, and tables into a structured tree
 * of `MarkdownSection`s. Source positions (line numbers) are preserved so
 * that downstream chunkers can cite back into the document.
 */

import { KinetraError } from "../errors.js";
import { sha256 } from "../utils/hash.js";

export interface MarkdownDocument {
  sourceId: string;
  title?: string;
  /** Lines as they appear in the source. */
  lines: string[];
  /** Sections detected in the document (rooted at depth 0). */
  sections: MarkdownSection[];
  createdAt: string;
}

export interface MarkdownSection {
  /** 0-based start line, inclusive. */
  startLine: number;
  /** 0-based end line, exclusive. */
  endLine: number;
  /** Heading level: 0 = untitled (root), 1..6 = h1..h6. */
  level: number;
  /** Heading text (or empty for the root). */
  heading: string;
  /** Sub-sections. */
  children: MarkdownSection[];
}

export function ingestMarkdown(raw: string, title?: string): MarkdownDocument {
  if (typeof raw !== "string") {
    throw new KinetraError("validation", "Markdown source must be a string", { got: typeof raw });
  }
  if (raw.length === 0) {
    throw new KinetraError("validation", "Markdown source is empty");
  }
  const lines = raw.split(/\r?\n/);
  const headings = scanHeadings(lines);
  const sections = buildTree(headings, lines.length);
  return {
    sourceId: sha256(raw),
    title,
    lines,
    sections,
    createdAt: new Date().toISOString(),
  };
}

function scanHeadings(lines: string[]): { line: number; level: number; heading: string }[] {
  const out: { line: number; level: number; heading: string }[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) {
      out.push({ line: i, level: m[1].length, heading: m[2] });
    }
  }
  return out;
}

function buildTree(
  headings: { line: number; level: number; heading: string }[],
  totalLines: number,
): MarkdownSection[] {
  if (headings.length === 0) {
    return [{ startLine: 0, endLine: totalLines, level: 0, heading: "", children: [] }];
  }
  // Build a synthetic root spanning the whole document.
  const root: MarkdownSection = {
    startLine: 0,
    endLine: totalLines,
    level: 0,
    heading: "",
    children: [],
  };
  const stack: MarkdownSection[] = [root];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const end = i + 1 < headings.length ? headings[i + 1].line : totalLines;
    const node: MarkdownSection = {
      startLine: h.line,
      endLine: end,
      level: h.level,
      heading: h.heading,
      children: [],
    };
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root.children;
}

export function flattenSections(doc: MarkdownDocument): MarkdownSection[] {
  const out: MarkdownSection[] = [];
  const visit = (s: MarkdownSection) => {
    out.push(s);
    for (const c of s.children) visit(c);
  };
  for (const s of doc.sections) visit(s);
  return out;
}

export function sectionText(doc: MarkdownDocument, section: MarkdownSection): string {
  return doc.lines.slice(section.startLine, section.endLine).join("\n");
}

export function findSectionByHeading(doc: MarkdownDocument, heading: string): MarkdownSection | undefined {
  const norm = heading.trim().toLowerCase();
  for (const s of flattenSections(doc)) {
    if (s.heading.toLowerCase() === norm) return s;
  }
  return undefined;
}
