import { parseRequest } from "./kinetra-turn.ts";
import { checkProblems, type CheckBlock } from "../core/checks.ts";
export { checkProblems, type CheckBlock };

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

/** Where a worked example or solution starts: a > [!EXAMPLE] / [!SOLUTION] / [!ANSWER] block, or a ###–##### heading. */
const EXAMPLE_START = /^\s*>\s*\[!(?:EXAMPLE|SOLUTION|ANSWER)\]|^#{3,5}\s+(?:worked\s+)?(?:example|solution)s?\b/i;
/** A computed result: a chain worked through to a number (V/R = 12/4 = 3) or an approximation (≈ 3.2). */
const RESULT = /=[^=\n]*=\s*\$?\s*-?\d|(?:≈|\\approx)\s*\$?\s*-?\d/;
/**
 * The lines where a worked example or solution states computed results with no ```check after it (before the next
 * example or ## section). Mowr can only recompute what is checked, so these are the numbers nothing verified.
 */
export function uncheckedExamples(markdown: string) {
  const unchecked: number[] = [];
  let region: { at: number; result: boolean; checked: boolean } | null = null, fence: string | null = null;
  const close = () => { if (region?.result && !region.checked) unchecked.push(region.at); region = null; };
  markdown.replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
    const mark = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (fence) { if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null; return; }
    if (mark) { if (region && /^\s*```\s*check\s*$/i.test(line)) region.checked = true; fence = mark; return; }
    if (/^##\s/.test(line)) return close();
    if (EXAMPLE_START.test(line)) { close(); region = { at: index + 1, result: false, checked: false }; }
    if (region && RESULT.test(line)) region.result = true;
  });
  close();
  return unchecked;
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
