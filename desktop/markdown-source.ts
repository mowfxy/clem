import { parseRequest } from "./kinetra-turn.ts";

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
 */
export type SourceSection = { heading?: string; text?: string; figure?: Record<string, unknown>; caption?: string };
export type MarkdownSource = { title?: string; summary?: string; sections: SourceSection[]; references?: string[] };

const REFERENCES = /^(references|bibliography|works cited|sources|reference list)$/i;

export function markdownSource(markdown: string): MarkdownSource {
  const lines = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let title: string | undefined;
  const lead: string[] = [];
  const sections: SourceSection[] = [];
  let current: SourceSection | null = null;
  let fence: string | null = null;
  let figure: { at: number; body: string[] } | null = null;
  const text = (line: string) => {
    if (current) current.text = (current.text ?? "") + line + "\n";
    else lead.push(line);
  };
  const close = () => {
    if (current && (current.heading || current.text?.trim() || current.figure)) sections.push({ ...current, ...(current.text !== undefined ? { text: current.text.replace(/\n+$/, "") } : {}) });
    current = null;
  };
  lines.forEach((line, index) => {
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
    if (fenceMark) { fence = fenceMark; text(line); return; }
    const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (h1 && title === undefined && !sections.length && !current) { title = h1[1].trim(); return; }
    const h2 = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h2) { close(); current = { heading: h2[1].trim(), text: "" }; return; }
    text(line);
  });
  if (figure) throw Error(`The figure block at line ${(figure as { at: number }).at} never closes: end it with a line of three backticks.`);
  close();
  // A references section becomes the numbered list the document prints and links [1], [2] to.
  let references: string[] | undefined;
  const refAt = sections.findIndex((s) => s.heading && REFERENCES.test(s.heading.replace(/[*_:]/g, "").trim()) && !s.figure);
  if (refAt >= 0) {
    const items = (sections[refAt].text || "").split("\n").map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)]|\[\d+\])\s+/, "").trim()).filter(Boolean);
    if (items.length) { references = items; sections.splice(refAt, 1); }
  }
  const summary = lead.join("\n").trim();
  return { ...(title ? { title } : {}), ...(summary ? { summary } : {}), sections: sections.filter((s) => s.heading || s.text?.trim() || s.figure), ...(references ? { references } : {}) };
}

/**
 * A pdf or docx request whose content is a Markdown file: the file's parts fill what the request leaves out. Fields
 * the request gives (title, kind, design, summary…) win over the file's, so a look can be set without editing the text.
 */
export function withMarkdownSource(spec: Record<string, any>, markdown: string) {
  // The file is the whole document, so parts sent beside it ("append", "patch", a "plan") would add to it twice.
  const { markdown: _path, sections: _sections, append: _append, patch: _patch, plan: _plan, ...rest } = spec;
  const source = markdownSource(markdown);
  if (!source.sections.length) throw Error("The Markdown file has no content: write the document's sections (## Heading, then text) first.");
  return {
    ...rest,
    title: rest.title || source.title || "Document",
    ...(rest.summary === undefined && source.summary ? { summary: source.summary } : {}),
    ...(rest.references === undefined && source.references ? { references: source.references } : {}),
    sections: source.sections,
  };
}
