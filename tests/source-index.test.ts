import test from "node:test";
import assert from "node:assert/strict";
import { fileIndex, sourceExcerpts } from "../core/source-context.ts";

const lecture = (n: number, pages: number) => Array.from({ length: pages }, (_, i) => `\n[Lecture ${n}.pdf, page ${i + 1}]\n` + `Op-amp notes ${"text ".repeat(400)}`).join("");

test("the files go as a list, not their contents, with where each is from and its pages", () => {
  const sources = [{ name: "Lecture 1.pdf", text: lecture(1, 12) }, { name: "Lecture 2.pdf", text: lecture(2, 3) }, { name: "notes.txt", text: "Short notes on filters." }];
  const index = fileIndex(sources, [2], [0]);
  assert.match(index, /listed, not loaded/);
  assert.match(index, /Lecture 1\.pdf — from earlier in this chat · 12 pages/);
  assert.match(index, /Lecture 2\.pdf — in this subject, project or linked folder · 3 pages/);
  // The attached file is first, and short enough to go along whole.
  assert.match(index, /1\. notes\.txt — attached to this request/);
  assert.match(index, /\[Source: notes\.txt; complete file\]\nShort notes on filters\./);
  assert.ok(index.length < 2500, "a long lecture costs one line, not its text");
});

test("files the request is not about share a small allowance; the attached ones still go whole", () => {
  const sources = [{ name: "Attached.pdf", text: lecture(1, 20) }, ...Array.from({ length: 6 }, (_, i) => ({ name: `Other ${i}.pdf`, text: lecture(i + 2, 20) }))];
  const out = sourceExcerpts(sources, "op-amp gain", 280_000, [0], [], 24_000);
  assert.match(out, /Attached\.pdf: complete/);
  const others = out.length - sources[0].text.length;
  assert.ok(others < 30_000, `other files took ${others} characters`);
});
