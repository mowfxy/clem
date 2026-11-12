# Handoff: PDF maths, chat selection, AI file edits

Uncommitted work from another session (2026-10-27). It shares files with your work; only the lines listed were touched.

## PDF maths now uses KaTeX HTML (not Chromium MathML)
- `desktop/pdf-markdown.ts`: rehype-katex `output: "html"`; `drawnArrows` removed here (still used by `rasterize.ts`). Every formula is wrapped in `<x-math>…</x-math>` (`fencedMath`); display maths stays KaTeX's `span.katex-display`.
- `desktop/katex-print.ts` (new): KaTeX CSS with woff2 fonts inlined as data URIs.
- `desktop/pdf-document.ts`: print CSP adds `font-src data:`, `katexPrintCss()` goes before the page CSS, `linkText` skips `<x-math>`, the old `math{}` rules were replaced, the proof `□` mark was removed, and paragraphs or list items containing maths are left-aligned.
- `scripts/build-desktop.mjs`: copies `katex.min.css` and the woff2 fonts to `desktop-dist/katex/`.
- Fixes: bars over v², roots, aligned `=` columns, the stray square, justified gaps.

## Chat: selection over formulas
- `src/chat/math-selection.ts` (new; imported in `MessageBody.tsx` after `copy-tex`): marks selected `.katex` with `data-selected` and pads it to the line box.
- `src/chat/chat.css`: rules after `.message-text .md .katex-display`.

## AI file edits
- `core/diff.ts` `applyEdit`: if the exact match fails, it retries a loose match (spacing, indentation, curly quotes), applied only when that finds exactly one place. New error text: "not in the file as it is now".
- `desktop/folder-edits.ts`: `changeProblem()` (a dry run against the live file); `locate()` accepts full paths inside a linked folder (`withinFolder`).
- `desktop/answer-review.ts`: `editReview()` sends broken ```edit blocks back to the model.
- `desktop/main.ts`: `review` gate is now async and runs `editReview` first when folders are linked (plus 2 imports).
- `desktop/kinetra-turn.ts`: the `review` type allows a Promise; `await review?.(…)`.
- `desktop/ai-workspace.ts`: the linked-folders line now tells CLIs to propose ```edit blocks with paths relative to the linked folder.
- `core/clem-skills.ts` "revise" playbook: format-generic (pdf/docx/pptx/xlsx via the action `open` returns, `madeFrom` drafts, patch first, retry on error); uploaded PDFs → editpdf.

## Tests
- New: `tests/edit-match.test.ts`, `tests/desktop/edit-review.test.ts`.
- Updated: `math-draw`, `harness`, `folder-edits`, `standout`.
- Still failing, both caused by prompt growth, not by this work:
  - `ai-workspace.test.ts` "one-line tool note" (`cliSystemPrompt` must stay under 3000 characters).
  - `answer-quality.test.ts` "Claude and Grok always see every tool" (`grokRules` size).
