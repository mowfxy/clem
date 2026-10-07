import { parseRequest } from "./kinetra-turn.ts";
import { parseChecks, showNumber } from "../core/checks.ts";

/**
 * A document's source as a Markdown file the AI writes in its working folder (Drafts/…), read into the same
 * specification a pdf or docx action takes. Writing the text once to a file, and changing it later with small edits,
 * costs far less than sending the whole document inside a tool call again and again (and LaTeX needs no JSON escaping):
 *
 *   # Title                       → "title" (when the call gives none)
 *   text before the first ##      → "summary"
 *   ## Heading                    → a section
 *   ```figure                     → that section's figure: the figure object as JSON ({"module","fn","args"} or
 *   {…}                             {"asset":"crop-…"}, with "width", "align", "source"), and "caption"; the text after
 *   ```                             it continues in a section without a heading
 *   ## References                 → "references", one per list item
 *   ```check                      → a worked example's numbers ({"checks":[{"label","expr","vars","claimed"}]}, as in chat
 *   {…}                             answers, core/checks.ts): recomputed before the file is made, never printed
 *   ```
 */
export type SourceSection = { heading?: string; text?: string; figure?: Record<string, unknown>; caption?: string };
/** A ```check block: the line it starts on and the lines of its body. */
export type CheckBlock = { at: number; lines: string[] };
export type MarkdownSource = { title?: string; summary?: string; sections: SourceSection[]; references?: string[]; checks?: CheckBlock[] };

const REFERENCES = /^(references|bibliography|works cited|sources|reference list)$/i;

export function markdownSource(markdown: string): MarkdownSource {
  const lines = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let title: string | undefined;
  const lead: string[] = [];
  const sections: SourceSection[] = [];
  let current: SourceSection | null = null;
  let fence: string | null = null;
  let figure: { at: number; body: string[] } | null = null;
  let check: CheckBlock | null = null;
  const checks: CheckBlock[] = [];
  const text = (line: string) => {
    if (current) current.text = (current.text ?? "") + line + "\n";
    else lead.push(line);
  };
  const close = () => {
    if (current && (current.heading || current.text?.trim() || current.figure)) sections.push({ ...current, ...(current.text !== undefined ? { text: current.text.replace(/\n+$/, "") } : {}) });
    current = null;
  };
  lines.forEach((line, index) => {
    if (check) {
      if (/^\s*```\s*$/.test(line)) { checks.push(check); check = null; } else check.lines.push(line);
      return;
    }
    if (figure) {
      if (/^\s*```\s*$/.test(line)) {
        let value: any;
        try { value = parseRequest(figure.body.join("\n")); } catch (error) {
          throw Error(`The figure block at line ${figure.at} is not valid JSON (${(error as Error).message}). Fix it in the file and send the request again.`);
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`The figure block at line ${figure.at} must hold one JSON object: {"module":…,"fn":…,"args":[…]} or {"asset":"crop-…"}.`);
        const { caption, ...rest } = value;
        const owner: SourceSection = current ?? {};
        owner.figure = rest;
        if (typeof caption === "string" && caption.trim()) owner.caption = caption.trim();
        current = owner;
        close();
        // The text after a figure continues the same part of the document, in a section without a heading.
        current = { text: "" };
        figure = null;
      } else figure.body.push(line);
      return;
    }
    const fenceMark = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (fence) { if (fenceMark && fenceMark[0] === fence[0] && fenceMark.length >= fence.length) fence = null; text(line); return; }
    if (/^\s*```\s*figure\s*$/i.test(line)) { figure = { at: index + 1, body: [] }; return; }
    if (/^\s*```\s*check\s*$/i.test(line)) { check = { at: index + 1, lines: [] }; return; }
    if (fenceMark) { fence = fenceMark; text(line); return; }
    const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (h1 && title === undefined && !sections.length && !current) { title = h1[1].trim(); return; }
    const h2 = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h2) { close(); current = { heading: h2[1].trim(), text: "" }; return; }
    text(line);
  });
  if (figure) throw Error(`The figure block at line ${(figure as { at: number }).at} never closes: end it with a line of three backticks.`);
  if (check) throw Error(`The check block at line ${(check as CheckBlock).at} never closes: end it with a line of three backticks.`);
  close();
  // A references section becomes the numbered list the document prints and links [1], [2] to.
  let references: string[] | undefined;
  const refAt = sections.findIndex((s) => s.heading && REFERENCES.test(s.heading.replace(/[*_:]/g, "").trim()) && !s.figure);
  if (refAt >= 0) {
    const items = (sections[refAt].text || "").split("\n").map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)]|\[\d+\])\s+/, "").trim()).filter(Boolean);
    if (items.length) { references = items; sections.splice(refAt, 1); }
  }
  const summary = lead.join("\n").trim();
  return { ...(title ? { title } : {}), ...(summary ? { summary } : {}), sections: sections.filter((s) => s.heading || s.text?.trim() || s.figure), ...(references ? { references } : {}), ...(checks.length ? { checks } : {}) };
}

/**
 * Every ```check in the file recomputed with the code chat answers use (core/checks.ts): one line per stated value that
 * differs from what its formula gives, or that cannot be computed, naming the line it is on.
 */
export function checkProblems(blocks: CheckBlock[] = []) {
  const problems: string[] = [];
  for (const block of blocks) {
    let results;
    try { results = parseChecks(block.lines.join("\n")); } catch (error) {
      problems.push(`Line ${block.at}: ${(error as Error).message.replace(/\.$/, "")} (a check block holds {"checks":[{"label":…,"expr":…,"vars":{…},"claimed":…}]}, at most 12 per block).`);
      continue;
    }
    for (const result of results) {
      // The check's own line, found by its label; the block's first line when the label is not on a line of its own.
      const offset = block.lines.findIndex((l) => l.includes(JSON.stringify(result.label)));
      const line = offset >= 0 ? block.at + 1 + offset : block.at;
      const unit = result.unit ? " " + result.unit : "";
      if (result.status === "differs") problems.push(`Line ${line}: "${result.label}" states ${showNumber(result.claimed)}${unit}, but ${result.expr} gives ${showNumber(result.computed)}${unit}.`);
      else if (result.status === "error") problems.push(`Line ${line}: "${result.label}" cannot be computed (${result.error}).`);
    }
  }
  return problems;
}

/**
 * A pdf or docx request whose content is a Markdown file: the file's parts fill what the request leaves out. Fields
 * the request gives (title, kind, design, summary…) win over the file's, so a look can be set without editing the text.
 */
export function withMarkdownSource(spec: Record<string, any>, markdown: string) {
  // The file is the whole document, so parts sent beside it ("append", "patch") would add to it twice. A "plan" stays:
  // the headings the finished file must have, checked against it (desktop/pdf-document.ts unwritten).
  const { markdown: _path, sections: _sections, append: _append, patch: _patch, ...rest } = spec;
  const source = markdownSource(markdown);
  if (!source.sections.length) throw Error("The Markdown file has no content: write the document's sections (## Heading, then text) first.");
  // A worked example's numbers are recomputed before anything is made, so a file never goes out with a wrong value.
  const wrong = checkProblems(source.checks);
  if (wrong.length) throw Error(`No file was made: ${wrong.length === 1 ? "a checked value differs" : `${wrong.length} checked values differ`} from what Mowr computes. ${wrong.join(" ")} Work each one out again (with a Kinetra call where a module computes it), correct the example's text and its check with an edit, then send the request again.`);
  return {
    ...rest,
    title: rest.title || source.title || "Document",
    ...(rest.summary === undefined && source.summary ? { summary: source.summary } : {}),
    ...(rest.references === undefined && source.references ? { references: source.references } : {}),
    sections: source.sections,
  };
}
