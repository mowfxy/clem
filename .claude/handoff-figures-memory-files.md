# Handoff: memory, Kinetra figures in chat, Drive search, chat files popup

Not committed yet. Another session was editing PDF files at the same time (`pdf-document.ts`, `pdf-markdown.ts`, `katex-print.ts`, `build-desktop.mjs`, `core/diff.ts`, `answer-review.ts` editReview), so commit only the changes listed here.

## Memory actually saves
- The AI saves by ending its answer with a ```memory block `{"remember":[{"text","about":"user"|"space","kind"?}]}`.
- `desktop/memory.ts`: `memoryBlocks()` parser; `explicitRemember`/`rememberedWords`/`mentionsSelf` now catch "save … to (project) memory", "remember this", "memorize", "don't forget"; the extraction prompt keeps topic facts when the person explicitly asks.
- `desktop/main.ts`: `emit` accumulates the answer text; after the run, `rememberAsked()` stores the blocks as confirmed, or sends `{type:"memory",off:true}` when memory is off. `learnFromTurn` runs only when there is no block.
- Rules: `desktop/prompt.ts` coreRules (short, because of the length budgets), `core/clem-skills.ts` memory playbook + capability index. UI: "Memory is off" warning in `src/App.tsx`; `MemoryNote` renders the block.

## Kinetra figures inline in chat (Kinetra first)
- New fence: ```kinetra `{"title","caption","module","fn","args"}` (any recipe's figure).
- `src/chat/KinetraFigure.tsx` (+ wired in `MessageBody.tsx`) asks the desktop app for `{action:"kinetraFigure"}` (`contracts.ts`, `main.ts` → `kinetraCall` + `unsafeSvg`) and shows the result on white paper with Image/SVG/PDF downloads. The light-theme exception is in `src/theme/light.css`.
- `answer-review.ts` `figureProblems()` sends a malformed block back to the model.
- Prompts: `core/answer-format.ts` `figureLanguage` (desktop only, added in App's system prompt); `visualLanguage` narrowed to interactive use; `visualChoice`, figures/visuals playbooks, `/figure` command (`core/commands.ts`), `kinetra-runtime.ts` "Chat figures" line, `kinetra-turn.ts` forModel note.
- No image files or readmes unless asked: `file-guides.ts` image action, `ai-workspace.ts` Outputs note, and `collectOutputs` in `main.ts` drops small readme files.

## Drive search
- `drive-live.ts`: full-text search across up to 600 subfolders (was 60); listing goes 8 levels deep and up to 5000 files (was 5 levels, 1500 files); `folder(..., limit)` (contract + `drive.ts` `driveFolder` limit).
- `src/files/finder.ts`: the AI's `find` searches every linked Drive folder (`driveFolders` from App).
- `src/space/SpacePage.tsx`: the Files "Find" box also searches linked Drive folders (name, path, contents), and shows even with only Drive files.

## Chat files popup
- `src/chat/ChatFiles.tsx` + `chat-files.css`: a top-bar button with a count, and a card that grows out of it listing "Made by Clem" (pen-nib icon) and "Sent by you", with open and download. Mounted in the `src/App.tsx` workspace top bar.

## Checks
- `npm test`, `npm run test:desktop`, and both `tsc` configs pass. New tests are in `tests/desktop/memory-learning.test.ts`.
- Preview: `node --experimental-strip-types --import ./vendor/kinetra/scripts/_register.mjs scripts/verify/chat-files-popup.mjs` (browser fixture with real Kinetra; never restart the installed Clem).
- Length budgets to respect: capabilityIndex < 2200, `cliSystemPrompt(kinetraCliBrief)` < 3000, Grok rules ≤ 24000.
