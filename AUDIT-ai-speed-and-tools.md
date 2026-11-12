# Audit: AI reply speed, and how the AI uses Clem and Kinetra

Date: 2026-10-28. Base: `main` at `e2fc7b4` (0.3.10, after PR #13 `perf/faster-replies`).
Scope: analysis only. **No code was changed.** Items that belong to the parallel session (memory-saving guidance, telling models about Kinetra, chat-open lag, memory popup, dropdowns) are marked **[overlap]** and are reported here, not edited.

## Evidence used

- The real answer ledger on this PC, `%APPDATA%\clem-desktop\logs\answers.jsonl` (22 answers, 17–21 Oct; counts and timings only), and `main.log`. There are no entries after 21 Oct, so this PC has no data from after PR #13. PR #13's before/after numbers came from somewhere else.
- Prompt sizes measured by importing `desktop/prompt.ts`, `desktop/kinetra-runtime.ts`, `core/clem-skills.ts` and `core/answer-format.ts` (script in the session scratchpad). Tokens are estimated at about 3.8 characters per token.
- CLI start time: `claude --version` 116 ms, `grok --version` 103 ms, `codex --version` 656 ms. Starting a process is not where the time goes.
- I traced the code from `src/App.tsx` `send()` → `src/desktop/bridge.ts` `desktopChat` → `desktop/main.ts` `handleRequest` "chat" → `answerWith`/`answerTimed` → provider `run` → `LiveScreen` → `clem:chat` events → bridge paint every 40 ms.

### What the ledger shows

| Provider / model | Kind of answer | Input tokens | Cache read | First text | Total |
|---|---|---|---|---|---|
| Gemini 3.8 Flash (6 runs) | short chat reply, new session | 19.3k | **0** | 7.9–14.2 s | 9.1–15.3 s |
| Grok 4.6 | short reply, new session | 18.0–18.8k | 128–1024 | 4.5–8.2 s | **same as first text** |
| Grok 4.6 | 13k-token reply | 43k | 45k | 354.3 s | **354.3 s** |
| ChatGPT gpt-6-luna | short reply | 12.4k | 11.3k | 3.1 s | 3.4 s |
| Gemini, continued session | short reply | 14.9k | 153k | 19.8 s | 24.8 s |
| Main-process prep (`[clem timing] prep`) | — | — | — | 325 ms (files 39 ms) | — |

What this means:

1. **The main process is not the bottleneck.** It spends about 0.3 s before the AI is asked. The time goes to the model reading a fixed prompt of about 18–19k tokens, which is almost never cached on a new session for Gemini or Grok, plus whatever the window does before IPC (not measured; see S5).
2. **Grok replies do not stream.** In every Grok run, first text equals total, including a 13k-token answer that took 354 s. The person sees nothing until the end.

---

## Part 1: Reply speed, ranked by impact

### S1. Grok answers never stream: the whole reply appears at the end (FIXED, not committed)
- **Evidence:** the ledger has `firstTextMs ≈ totalMs` for every Grok run (8214/8218, 4499/4502, 354283/354289, 459413/461893). Claude and Gemini runs show a gap; Grok runs don't.
- **What was ruled out:** Grok 1.0.70 streams correctly. I pointed a throwaway `GROK_HOME` (in the session scratchpad, not `~/.grok`, and without Clem's sign-in) at a local fake model that sends one word every 100 ms. The CLI emitted one `stream_event`/`text_delta` line per word, in exactly the shape `liveText` reads. Clem's real `GrokProvider.run` received the first partial at 0.86 s out of a 7.4 s answer.
- **Root cause:** `desktop/grok.ts` falls back when Grok refuses a flag, and it decided which flag by searching the whole error text. Grok's clap error repeats the whole command in its usage line (`Usage: grok … --include-partial-messages … --no-plan --tools <TOOLS> …`). So **any** one refused flag set `noPartial`, which turns off streaming for every later answer until Clem restarts. The same error also set `noToolList`, which gives Grok its full default tool list (a larger prompt), and the final fallback set `noSessions`. A Grok build that lacked any one of Clem's newer flags therefore lost streaming for good.
- **Fix (applied):**
  - New `grokRefusal(err)` in `desktop/grok.ts` returns only the line that names the refused flag.
  - The native, partial-messages, tool-list and sessions fallbacks now each test that line for their own flag.
  - Tests: `tests/desktop/grok-flags.test.ts`, using the real clap error text.
  - Result: `npm run test:desktop` passes 416/416, and both `tsc` configs are clean.
- **Still to confirm:** one real Grok answer in a dev build. The ledger should then show `firstTextMs` well below `totalMs`.
- **Remaining small delay:** `LiveScreen` still holds the first 240 characters (S7). That is about 0.5–1 s at real Grok speeds; with the fake model it was 0.86 s to the first partial and 5.2 s to the first text on screen.

### S2. About 4.5–5k tokens of always-sent window instructions, even for "hi"
- **Where:** `src/App.tsx:1417-1419`. The first system message is `capabilityIndex` (577 tok) + `figureLanguage` (773) + `answerInstructions` (2,827). `answerInstructions` (`core/answer-format.ts:31`) contains **`visualLanguage` at 7,119 chars ≈ 1.9k tokens**, which is the spec for interactive `visual` blocks.
- **Impact:** about a quarter of the 19k first-turn floor (the rest is the CLI's own system prompt and tools). It is sent on every new chat's first message and on every non-kept session. It is not cached on Gemini (cache read 0) and barely on Grok. PR #13 and the `workBrief` change (`kinetra-runtime.ts:107-113`) already removed about 6k tokens of Kinetra guide from the system prompt. This block is the next biggest.
- **Fix:**
  - Move `visualLanguage` (and `videoLanguage`, 142 tok) out of the constant first system message. Add them in the per-message system message only when the request has a visual or video intent (`/visual`, "interactive", "simulate", a YouTube link). Keep a one-line pointer in `capabilityIndex`, which already mentions ```visual.
  - For `smallTalk(prompt)` turns (already detected at `App.tsx:1248`), send only `capabilityIndex` + `formatLanguage` + `mathLanguage`.
  - Expected saving: about 2–3k input tokens per fresh turn. On Gemini Flash that is roughly 1–2 s of first-text time (by analogy with the measured saving from the `workBrief` change).
  - **[overlap]**: the parallel session is editing what models are told. Coordinate before editing `App.tsx` and `answer-format.ts`.

### S3. Per-message instructions sit before the conversation, which breaks prefix caching
- **Where:** `desktop/prompt.ts:68-71` puts **all** of the window's system messages in `<clem-instructions>` ahead of `<clem-conversation>`. The third system message (`App.tsx:1423-1430`) changes from message to message: `workflowText(prompt,…)` picks playbooks by the prompt, and `titleInstruction`, `planNote` and memory/standing lines are added.
- **Impact:** when a prompt is sent fresh (a new session, a lost session, ChatGPT after a thread restart, or any condensed chat), everything after the changed system text is a cache miss. On long chats that is the whole conversation. Kept sessions hide this, because they resend only changed blocks (`instructionsSent`, `main.ts:1821`), but every fresh resend pays it.
- **Fix:** in `composePrompt`, send only the first (constant) system message in `<clem-instructions>`. Move the other system messages into the per-message `<clem-context>` after the conversation, as the comment at `prompt.ts:64-66` already intends for files and memory. This is a small change with tests in `tests/desktop/prompt*.test.ts`.

### S4. A long chat can wait on a summarisation call it doesn't need
- **Where:** `desktop/main.ts:1730-1734` runs `condenseConversation(...)` (which may call `quickAsk` and wait for a second model call) **before** `keep`/`chatSessions.take` is checked (`main.ts:2226`, then `chatSessions.take` in `answerTimed`, `main.ts:467`).
- **Impact:** when a chat passes its context budget and the brief needs extending, the reply waits for a whole side job ("Condensing the earlier part of this chat…"). That is often 5–20 s. It happens even when the message is about to continue the chat's kept CLI session, which already holds the history and never reads the brief.
- **Fix:** before condensing, check whether `chatSessions` holds a live session whose `history` matches `conversationPrint(said.slice(0,-1))`. If it does, skip condensing and run it after the answer (fire-and-forget, so the brief is ready if the session is later lost). Expose a non-consuming `chatSessions.peek(key, …)` for this.

### S5. Window-side preparation is not measured, and can wait up to 2.5 s or more
- **Where:** `src/App.tsx:1246-1395`. Before IPC, the window runs `chatPdfs` (awaited alone first, `:1254`), then `conversationPictures` and `chatSources` together, then all Drive work: the linked-folder listing races a **2.5 s** timeout (`:1310`), and non-cowork mode runs a full-text Drive search with no timeout. Video captions are read *after* Drive finishes (`:1362-1374`), and `pdfView` for Drive PDFs runs after that.
- **Impact:** in a subject or project with a linked Drive folder whose listing is not cached, a message can wait up to 2.5 s before the main process even starts. None of this shows in `[clem timing]`, whose "prep" starts at IPC receipt (`main.ts:1684`).
- **Fix:**
  - Add `queuedMs` (the time from `send()` to `invoke`) to the chat request (`desktop/contracts.ts` schema) and print it in the `prep` line, so the real send-to-first-token time is measured.
  - Start the caption reads in parallel with `driveWork` when the YouTube links are already in the prompt. Captions depend on Drive results only for Drive videos.
  - Lower the Drive listing race to about 800 ms once a cached listing exists.
  - **[overlap]**: `App.tsx` is being edited for chat-open lag. Coordinate first.

### S6. A side model call after most messages (memory extraction)
- **Where:** `desktop/main.ts:2266` → `learnFromTurn` (`main.ts:752-794`) → `quickAsk`. The gate is `mentionsSelf` (`desktop/memory.ts:241-243`), and it is very broad.
- **Measured:** 7 of 16 typical task prompts I tried trigger extraction, including "I want you to summarise this lecture", "I'd like a table comparing BJT and MOSFET" and "I'm working on the thermodynamics homework, question 2 please".
- **Impact:** it doesn't delay the reply itself, because it runs after `done`. But each run spawns another CLI process (Claude Haiku, Grok or Gemini) on the person's plan. It uses usage and CPU, and `memoryWrites` puts later memory saves behind it. It is also the main source of junk memories (see T1).
- **Fix:** narrow `mentionsSelf` to self-descriptions and standing preferences. Drop `i want you`, `i'd like`, `i have to`, `i need this for`, `i'm working`/`doing`/`writing` and `my project`. Keep the explicit-remember and style-correction paths. **[overlap]** with the memory-guidance work.

### S7. Short replies wait for the whole reply before showing
- **Where:** `desktop/live-reply.ts:28` `NOTE_HOLD = 240`. Text is held until 240 characters so that a pre-tool note ("I'll search for that.") never flashes.
- **Impact:** a reply under about 240 characters appears only at the end (Gemini: first text 0.7–1.4 s before the end). It's small but visible on quick questions.
- **Fix:** on a step where no tool can follow (`!native` and no tools, or a `plain` request), set the hold to 0. Otherwise also release the text once it holds a sentence end followed by more text and `mayBeTool` is false.

### S8. Smaller items
- **Auth check on the hot path.** `main.ts:1236` awaits `auth.user(true, …)`, which reuses a check for 60 s (`desktop/auth.ts:77`) and otherwise does a network round trip (up to a 12 s timeout). Typing warms it through `prepare` (`App.tsx:329-332`, at most once a minute), but a message sent more than 60 s after the last keystroke-warm pays the round trip. Fix: for `chat`, accept a token verified less than 10 minutes ago, and revalidate it in the background.
- **Memory resent on kept sessions.** `retrieveMemory` re-ranks by each query, so the memory set and its fingerprint (`memorySent`, `main.ts:1817`) change often, and up to about 1.6k tokens of memory go again on a kept session. Fix: fingerprint the stable top set (preferences and profile) separately from the query-matched lines.
- **`loadMemory` reads one after another.** `main.ts:1394-1398` reads setup, then memory. This is negligible.
- **Gemini new-session cache read is 0.** This is a provider limit. The only levers are fewer input tokens (S2, S3) and keeping sessions, which is done. `prepareFor(ahead)` already opens the next Antigravity session with a matching system prompt (`main.ts:656`).
- **Grok failures after 10+ minutes.** Two Grok runs failed at 634 s and 674 s. Because `GROK_REQUEST_LIMIT` is 60 minutes (`grok.ts:202`), a stalled in-flight request can keep the person waiting a long time. Consider an earlier visible status ("Grok is still working… Stop?") after about 2 minutes of silence.

### What PR #13 already covered (not repeated above)
- A Kinetra MCP schema with `module`/`fn`/`args`, and precise errors for wrong calls. This removed 2–3 extra round trips on Gemini and ChatGPT.
- Orphaned Antigravity agents are swept, and quitting ends them synchronously.
- Earlier work: kept CLI sessions per chat, `workBrief` instead of the full guide in the system prompt, a warm Kinetra worker pool, parallel prep in `main.ts:1701`, `smallTalk` skipping file work, and a 40 ms paint batch in the bridge.

---

## Part 2: How the AI uses Clem and Kinetra

### T1. Memory extraction is told to save "goals and deadlines", so one-off plans become memory
- **[overlap]**: report only.
- **Where:** `desktop/memory.ts:311`. `extractionInstructions` lists "goals and deadlines" as lasting user facts. `correctsStyle` (`memory.ts:245-247`) treats "my exam/deadline/project … is/on/due" as a self-mention. The broad `mentionsSelf` (S6) sends most task messages to extraction.
- **Effect:** "Make me a study plan for my exams next week", "I have to submit the lab report tomorrow" and "My project is due on the 3rd" all reach extraction (verified with `mentionsSelf`). They are stored as unconfirmed memories, which `retrieveMemory` then injects into every later prompt. Plans already have their own home (```plan blocks, `planContext`), so storing them as memory duplicates them, and they go stale.
- **Fix:**
  - Change the extraction rule to "long-lived facts only. Never store a plan, schedule, task list, to-do, or anything with a date within the next ~30 days unless the user explicitly asked to remember it. Exam dates belong in the subject (its exam date), not memory."
  - Add an `expiresAt` to any dated item that does get stored (the field already exists, `memory.ts:14`, and is pruned at `:85`).
  - Add negative examples to `tests/desktop/memory-learning.test.ts`.

### T2. The CLI system prompt names Kinetra but not Clem's features. They arrive in the user message instead
- **Where:**
  - `desktop/prompt.ts:23` (`cliIdentity`) plus `kinetraCliBrief` (`kinetra-runtime.ts:107-115`) make up the whole CLI system prompt, 2.8k chars.
  - Clem's features (memory, subjects and projects, commands, plans, routines) are only in `capabilityIndex`, inside the window's system message, which is sent as `<clem-instructions>` in the user turn.
- **Effect:** these are fine for following instructions. But a kept session receives them only once, and after a `/compact` or a session compaction (`ClaudeProvider.compact`, "A summary keeps the work, not every guide"), they return only because `kept.sent` is reset. That reset is correct. No change is needed beyond making sure the parallel session's Kinetra changes reach `cliSystemPrompt` *and* `capabilityIndex`. **[overlap]**
- **Gap to fix:** `capabilityIndex` (`core/clem-skills.ts:385-401`) does not say *when* to use Kinetra versus the CLI's own file tools. `cliIdentity` does ("Make documents, figures, calculations and Office files through Kinetra"), but Codex's system prompt is `cliSystemPrompt("", {shell:true})` (`main.ts:445`) and only adds a shell line. That model can and does try to make PDFs and DOCX files with Python through its shell. Fix: one line in `SHELL` (`prompt.ts:26`): "Never write scripts to make PDF/Word/PowerPoint/Excel files or figures; use Kinetra."

### T3. The Kinetra intent regex misses common phrasings, which costs a `help` round trip
- **Where:** `desktop/kinetra-runtime.ts:59-81` (`kinetraIntent`), with `needsKinetra` at `:84`.
- **Measured misses:** "turn my notes into flash cards" (the regex only has `flashcards?`), "show me the electron transport chain as a picture", "plan my week" / "plan my revision" (no `study plan`). Each miss means the model must call `{"action":"help"}` first. That is one extra full model step that pulls in about 5.4k tokens (`kinetraCli`) mid-answer, or it skips Kinetra and writes an ASCII or plain-text substitute.
- **Fix:** add `flash ?cards?`, `\bas an? (?:picture|image|figure|diagram)\b`, `\bshow me\b[^.?!\n]{0,40}\b(?:picture|image|visual|figure)\b`, and `\bplan (?:my|the) (?:week|revision|study|studying)\b`. Add these phrases to `tests/desktop/kinetra.test.ts` intent cases. **[overlap]** if the parallel session is changing this regex; otherwise it's a safe change.

### T4. The Kinetra tool description doesn't say when to choose it
- **Where:** `desktop/kinetra-mcp.ts:36-38`.
- **Effect:** the description is clear about *what* the tool does. It doesn't say it must be used *instead of* the CLI's own Write/shell for documents and figures, or that `help` returns the guide. Models that pick tools from descriptions (Gemini, Codex) see only this text plus `NATIVE_NOTE`.
- **Fix:** add one sentence: "Use it for every PDF, Word, PowerPoint or Excel file, every figure or chart, and any calculation that needs verified numbers; never write these with your own file or shell tools. Call {"action":"help"} once for the full guide if it is not already in the conversation." **[overlap]**: this is Kinetra guidance.

### T5. The `memory` block guidance is sound; the junk comes from the automatic path
- `coreRules` (`prompt.ts:4-5`) and the memory playbook (`core/clem-skills.ts:158`) only save when the person explicitly asks, and the playbook is detailed. I found nothing that tells the AI itself to save plans. The junk comes from the **automatic** extraction pass (T1, S6), not from the model's ```memory blocks.
- One gap: the playbook says "Clem saves memories itself after your reply … picks up durable facts". That encourages the model to tell the person something "will be remembered" when it may not be. That is a minor honesty issue. **[overlap]**

---

## Suggested order
1. **S1:** done (uncommitted): Grok streaming no longer switches off after one refused flag.
2. **T1 + S6:** narrow extraction and stop storing plans. This is one change that fixes both the junk and the extra side call. **[overlap]**: hand to the memory session.
3. **S2 + S3:** trim the always-sent instructions and move per-message instructions after the conversation. This saves about 2–3k fresh-turn tokens and gives better caching.
4. **S4:** skip blocking condensation when a kept session will continue.
5. **S5:** measure window-side prep (`queuedMs`), then parallelise captions and shorten the Drive race.
6. **T2–T4:** small prompt and regex additions for Kinetra choice. **[overlap]**
7. **S7, S8:** polish.

S1 is fixed in the working tree but not committed: this checkout is on `main`, shared with other sessions. The other items are reported only, because every candidate small fix touches either a file the parallel session is editing (`App.tsx`, `memory.ts`, prompt and Kinetra guidance) or the chat hot path in `main.ts`, where a change should be reviewed rather than slipped in.
