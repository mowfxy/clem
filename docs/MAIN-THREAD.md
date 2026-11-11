# Main thread: app structure

Decided by the user on 2026-11-11. It works alongside docs/GUC-VPS-ENGINE.md.

## What changes
- **Opening the app** lands on the **home screen**: today's new-chat screen, with its widgets, kept as home. Its message box is the way into the main thread:
  - focusing or tapping the box opens the main thread;
  - text already typed carries over;
  - there is no blank flash, and the thread shows its cached newest page instantly.
- **The main thread** is one never-ending conversation with Clem's organizer. All proactivity happens here: morning brief, deadline reminders, evening prep, weekly summary, organizing the day, and digests of subject and project events.
- **The sidebar** lists **subjects and projects only**, each expandable to its chats. There are no chats outside a subject or project. "New chat" lives on a subject or project.
- **Talking to Clem:** the user can talk freely in the main thread. When a message clearly belongs to one subject or project, Clem **hands off automatically**:
  - it opens that subject's chat, or creates one;
  - it carries over the question plus a short context note;
  - it continues the answer there;
  - it leaves a link card in the main thread ("Continued in Circuits →").
- **Existing standalone chats** move untouched to a read-only **Earlier chats** list (Settings → Data). Each one has a "Move to subject/project" action. Nothing is deleted.
- **The organizer model** is picked in **Settings → Proactivity** ("Clem's organizer"), using the existing `ModelSelector`. It runs the main thread and all proactive jobs, and it organizes subjects, projects, deadlines and plans through tools.

- **@ mentions:** typing `@` in any composer offers subjects and projects (fuzzy search, keyboard-first) alongside whatever `@` already offers. A mention:
  - shows as a chip;
  - scopes that turn's context and tools to the mentioned subject or project;
  - in the main thread, it is the explicit form of the hand-off.

## Proactivity: maximum, and across everything (user, 2026-11-12)
The organizer **acts first and asks only when it truly has to**. Proactivity covers ALL of Clem, not only CMS: subjects, projects, plans, deadlines, exams, flashcards and quizzes (spaced repetition), files, memory, automations and GUC.

**What it does on its own:**
- **Plans the day:** when the morning brief fires (and on first open each day) it builds today's plan. It reads the timetable, deadlines, exam dates, open plan tasks, due flashcards and free slots, then **writes the time blocks into the plan** instead of only suggesting them.
- **Turns new information into work:** examples:
  - A new deadline adds a plan task with a sensible start date.
  - A new lecture gets a 3-line summary, and its flashcards are generated and queued in the subject.
  - A moved lab is checked against the calendar; if it clashes, Clem says so.
- **Keeps plans honest:** overdue tasks are rescheduled into the next free slot, an exam date pulls a revision plan back from it, and a slipping project gets a nudge with the next concrete step.
- **Closes loops:** it follows up on things the user said they'd do, on unread announcements that matter, and on grades (it celebrates, or offers a review of weak concepts using `weakConcepts`).
- **Manages the workspace:** it files loose uploads into the right subject, saves durable facts to memory, and suggests or creates automations when the user repeats a request.
- **Covers projects too:** daily or weekly status of each project's coordinator threads, blockers, and the next step.

**Guardrails:**
- **Reversible actions** happen on their own and appear as a card with **Undo**: adding or rescheduling plan tasks, generating flashcards, filing files, saving memory.
- **One confirm tap first:** anything destructive, outward-facing (sending messages, Telegram to others) or costly.
- **Proactivity level** (quiet / balanced / proactive; **default proactive**), quiet hours, per-event toggles and channels shape *when and where* Clem speaks. Quiet means fewer messages, not less organizing: plan upkeep still happens silently.
- **No repeats:** every proactive action is deduplicated by a stable key, so it never repeats on any channel. Everything is logged so the user can see "what Clem did today".

**How it runs:**
- **Jobs:** the engine scheduler runs the organizer's sweeps; it never relies on the UI being open, and on a VPS it runs always-on. The sweeps are:
  - event-driven: right after a sync or check, on a plan change, on new files;
  - timed: morning brief, midday check, evening prep, weekly review, deadline reminders (default 48h and 3h before).
- **Each sweep** gets a compact Now card plus a diff since its last sweep (not history), decides on actions through tools, applies them, and posts one concise card. If nothing changed, no model call is made.

## Data
- The main thread is a `Chat` with `kind: 'main'`. There is exactly one per owner. It is pinned and can't be deleted.
- Standalone chats get `archived: 'earlier'` in a one-time, idempotent migration. They are not deleted.
- Proactive posts are assistant messages carrying ` ```clem-card ` blocks: `brief`, `reminder`, `digest` and `handoff`, plus the GUC card types.
- Subject events go to the subject's thread. The main thread gets one compact digest line per batch, not a copy.

## Context and memory (efficiency first)
Every turn the context is assembled within a fixed budget (default about 12k tokens; settings can change it). Nothing is ever "load the whole thread". The layers, in order:
1. **Stable prefix:** the system prompt plus the selected skills. It is kept byte-stable so prompt caching hits.
2. **Profile memory:** the existing memory system, with durable facts saved through ` ```memory ` blocks.
3. **Now card:** a compact, structured snapshot built from the engine's database, not from chat history:
   - today's schedule;
   - deadlines in the next 7 days;
   - unread counts;
   - open plan tasks;
   - the next exam;
   - quiet hours.

   It is rebuilt cheaply and cached until the data changes.
4. **Rolling summary:** older messages fold into day digests, then week digests, then month digests. The existing `compact` and `condensed` message fields are reused. Folding runs in the background on the organizer model, never during a reply.
5. **Recent turns:** kept word for word, newest first, until the budget is used.
6. **Recall:** a small local full-text index (MiniSearch) over:
   - main-thread history;
   - digests;
   - subject chat summaries;
   - GUC items.

   The top few hits for the current message are added as quoted snippets.
7. **Tools for detail:** schedule, deadlines, grades, materials, plans and subjects are fetched through tools on demand, never pasted wholesale.

The thread UI is virtualized. It loads the newest page first, and older pages load in as you scroll up.

## Libraries
`minisearch` for local recall: no dependencies, maintained, small.

## Where it lives
- `core/main-thread/`: pure and tested.
  - `migrate.ts`: one main thread per workspace; standalone chats get `archived: 'earlier'` once, recorded in `State.migrations`.
  - `route.ts`: the hand-off. An @mention, or one subject or project clearly ahead by name, alias or course code; anything ambiguous stays.
  - `context.ts`: the budgeted layers and the local Now card. `fold.ts`: day, week and month folding. `recall.ts`: MiniSearch.
- A digest is an assistant message with `compact: true` and a `digest` range. The messages it covers stay in the thread and in recall. Folding runs from `src/main-thread/useFolding.ts` after 20 seconds with nothing answering.
- Cards: `core/guc/cards.ts` (zod) and `src/main-thread/ClemCard.tsx`. A hand-off opens the subject's latest chat (or a new one) and answers there; the main thread keeps the question and the card.
- UI: `src/main-thread/` (the virtualized thread, the sidebar's subjects and projects, Earlier chats) and `src/settings/ProactivitySettings.tsx`. The organizer is `State.organizer`; the main thread's model picker sets it too.
