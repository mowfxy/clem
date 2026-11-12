# Main thread: app structure

Decided by the user on 2026-11-11. It works alongside docs/GUC-VPS-ENGINE.md.

## What changes
- **Opening the app** lands on the **home screen**: today's new-chat screen, with its widgets, kept as home. Its message box is the way into the main thread:
  - focusing or tapping the box opens the main thread;
  - text already typed carries over;
  - there is no blank flash, and the thread shows its cached newest page instantly.
- **Home to thread (user, 2026-11-12):**
  - The home page stays as it is. Pressing its message box **expands it into the main thread with a smooth shared-element animation**: the box grows into the thread's composer while the thread rises in. There is no hard route swap, and you can go back to home the same way.
  - Animate the glass element itself, never fade a parent of glass. Respect reduced motion.
  - Home also has a **fast subject/project picker** (recent first, type-to-filter, keyboard-first) that opens a new chat in the chosen subject or project in one tap.
  - **How it is built:** `src/main-thread/morph.ts` runs the swap inside `document.startViewTransition` (320 ms, `--ease-out`). While it runs, `html[data-morph=in|out]` names the composer `clem-composer`, home's content `clem-home` and the thread's list `clem-thread` (`main-thread.css`): home recedes (down, scale .97, fade), the thread rises 18 px, and back to Home reverses both. Named snapshots lose their own backdrop blur, so the composer's `::view-transition-group` carries `--glass-filter` itself: the glass is live every frame. Without the API the new composer is FLIPped with WAAPI (transform only, no fading parent). Reduced motion or a quieter workspace swap at once (`morphMode`, `core/main-thread/home.ts`). The swap is `flushSync`ed inside the transition, so the new frame already has the cached newest page; the draft is read from a ref because the swap runs a frame later. Going Home no longer focuses home's box when a main thread exists, since that focus opens the thread.
  - **The picker** (`src/main-thread/HomePicker.tsx`, `pickSpaces`): a quiet "New chat in" row under the box with the three most recently used spaces (by their newest chat; never-used ones after, subjects first, then by name) and **Find** (Ctrl J from anywhere, which goes Home first), the @-mention fuzzy list with a field; arrows and Enter pick, Escape closes. A pick is `newChat(spaceId)`, local and instant. `scripts/verify/home-transition.mjs` holds the transition's animations to take frames at 0/120/240/320 ms in both themes.
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

**Organizing and pinging, not usage-heavy AI work** (user, 2026-11-12). Rules keep the plan tidy; the organizer model is called once per sweep that has news, short and batched. Nothing is read, summarized or generated on its own.

**An assistant, not a notification system** (user, 2026-11-12): "it's just how Clem should feel, not what the user does in settings". There is no switch per kind of news. Clem judges each piece of news against what it knows of the person (their plans, deadlines, exams, what they said lately) and tells them only what matters, in its own words, saying what it means for them. Nothing reaches them just because it happened, and nothing needs a watch to be noticed; a watch is for something specific they want to hear about.

**What it does on its own:**
- **Plans the day:** the morning brief (and the first open each day after its time) writes today's time blocks into the plan: due and overdue work, due flashcards, the nearest exam, in free hours around classes.
- **Turns new information into work:**
  - A new deadline adds a "Start:" task two days before and marks the deadline on the timeline.
  - A new lecture is not a card of its own: it is a digest line unless Clem judges that something the person is working on needs it. Summaries and flashcards are made only when they ask.
  - A cancelled class frees its slot for the next open task; a moved class or room change is said, and checked for clashes.
- **Keeps plans honest:** overdue tasks move to the next day with room, an exam date pulls revision sessions back from it, and a quiet project gets a nudge with its next step.
- **Closes loops:** follow-ups on what the person said they'd do, grade pings (a cheer, or a review of shaky cards from `weakConcepts`), and watches.
- **Manages the workspace:** it files loose uploads whose name names one subject, saves durable facts to memory (model, only from new main-thread words), and offers a routine for a request repeated on 3 days.

**Watches** ("tell me when the Circuits midterm room is posted", "ping me if lab 3 moves", "watch for grades in Math"): asked in any chat, kept by the organizer as the person's words plus a matcher (subject, kinds of change, keywords, an end date, 60 days by default), shown as a card with Stop. Every change is matched by rules; a partial keyword match goes to the model in the sweep's one call. A watch fires once unless the person asked for every time.

**Attention (no spam):** every change gets a level by rules first, and the organizer model then judges the news itself:
- **urgent** (pushed at once): a cancelled or moved class or a room change today or tomorrow, a deadline within 48 hours, an announcement that cancels or moves something today;
- **notify** (in the sweep's card, and one push for the batch): other class changes, deadlines, grades, announcements with action words (cancel, postpone, moved, deadline, submit, quiz, exam, mandatory, attendance, compensation, room…);
- **digest** (one "Also new" line): routine new material and routine announcements;
- **silent**: trivial notes, and anything muted.

Timetable and deadline changes keep the rules' level (they are certain). Every announcement, grade and new file that isn't muted or empty goes to the model in one short call per sweep, with the Now card (plans, deadlines, exams) and what the person said: it returns a level, a reason and, for urgent and notify, what to say in Clem's voice (`say`), which is the card line and the push text. Without a model the rules' levels and wording stand. "Don't tell me about this kind of thing" (Mute on a card line) mutes that kind in that subject. Pushes have a daily cap by level (quiet 2, balanced 5, proactive 12); what is over it waits in the card.

**Guardrails:**
- **Reversible actions** happen on their own and appear as a card with **Undo**: plan tasks, time blocks, moves, revision plans, filing, memory.
- **One confirm tap first:** anything destructive, outward-facing or costly; today that is making a routine.
- **Set in chat, not in Settings** (user, 2026-11-12): how much Clem speaks (quiet / balanced / proactive; **default proactive**), quiet hours, its routines (morning plan, midday check, evening prep, weekly review: when, or off) and study time. The first time the engine starts, Clem asks about all of them in one plain message in the main thread, with what it does now (`Organizer.offerSetup`, once per owner, key `setup:first`). The answer, and any later "move my morning plan to 8" or "only tell me what can't wait", is saved by the AI's `clem.prefs`, which takes any part of the settings and answers with `settingsText`. Settings → Proactivity keeps only the organizer model, upcoming reminders, what Clem did today, and watches and mutes.
- **Level and quiet hours** shape *when* Clem speaks. Where is not a setting: everything is in the main thread, and what is worth telling goes to the desktop and, once paired, Telegram. Quiet means fewer messages, not less organizing. Older saves with a switch and channels per kind of news still load; `readPro` drops them.
- **No repeats:** every action, line and push has a stable key and is never repeated on any channel. Everything is logged as "What Clem did today".

**How it runs:**
- **Jobs:** the engine's pg-boss runs the sweeps without the window: timed (morning, midday, evening, weekly; Cairo time, changed by telling Clem) and event sweeps a minute after a sync, a check or a workspace change, at most every 10 minutes. A 10-minute tick sends deadline reminders (48 h and 3 h before) and pushes held by quiet hours.
- **Each sweep** gets the snapshot, GUC's changes and the timetable diff since the last sweep. Nothing changed: no model call, no card. The brief, reminders and lines are templates; the model is asked only when something changed **and** needs judgement (an announcement to rate, a half-matching watch, an unplaceable file, new words from the person), with the Now card plus the diff, for short JSON.

## Calendar, reminders and study time (user, 2026-11-12)
The main thread can read the person's Google Calendar, set reminders, and plan study time around everything else, by their preferences, and it says when things clash.

- **Google Calendar is read-only** (`calendar.readonly`). Settings → Connectors → Google Calendar (a row beside Google Drive; desktop only) → Connect opens `clem.m4labs.xyz/#/drive-connect?account=…&for=calendar` in the browser: the same sign-in hop, Google client and registered redirect (`/api/drive/callback`) as Drive, with `for: "calendar"` in the signed state. The refresh token is its own `clem_credentials` row (`provider = 'calendar'`, `database/008_calendar.sql`); `/api/calendar/token` mints short-lived access tokens and `DELETE /api/calendar/connection` revokes it. The desktop reads Google directly (`desktop/calendar-live.ts`): every calendar the person shows, events expanded (`singleEvents`), kept in memory for 5 minutes. Cancelled events, ones they declined, and working-location and out-of-office markers are dropped. All-day and "free" events are listed but never count as busy. **Google Cloud project:** turn on the Google Calendar API and add `calendar.readonly` to the consent screen.
- **What the organizer does with it** (`core/proactivity/calendar.ts`, pure):
  - Timed events are busy time (`busyOf`): morning blocks go around them.
  - Events that look like schoolwork (quiz, exam, midterm, assignment, due, submission, lab report…) become deadlines (`gcal-…`), matched to a subject by course code or name. They get the usual 48 h and 3 h reminders and, with a subject, a "Start:" task.
  - Clashes are said once each (`calendarClashes`): a calendar event against a class, a plan item, or another calendar event. Classes against plan items stay with `rules.clashNotes`.
  - The briefs list today's and tomorrow's events. The 10-minute tick notices when the calendar changes and runs an event sweep, which says what is new or moved (`calendarDiff`; the last calendar seen is in `organizer_sweeps.calendar`). A VPS worker has no calendar: it works from GUC and the plans.
- **Study preferences** (`ProSettings.study`; only through chat, the AI's `clem.prefs`; Settings has no card for them, user 2026-11-12): days (default Saturday to Thursday), hours (default 16:00 to 22:00) and breathing room kept around anything else (10 min). How long a session is and whether it gets a reminder are the person's to say in chat too ("user manages this"). Settings saved when session length, sessions a day and a reminder before each session were settings still load; `readPro` drops those three.
- **Study sessions** (`clem.study`, `Organizer.planStudy`, `studySlots`): N sessions before a day, each as long as the person said (`minutes`; 50 when they didn't). They go only on allowed days and hours, clear of classes, calendar events and timed plan items (with the breathing room), and are spread one a day first, then as many more a day as fit. Today needs an hour's notice. Each becomes a timed `plan_task` "Study: …", applied by the window with Undo. No reminder is set for them: the person asks with `clem.remind`. The reply carries an `organizer` card (`when: "study"`) with Undo per session.
- **Reminders** (`organizer_reminders`, migration `009`; `clem.remind` / `clem.reminders` / `clem.unremind`):
  - the time is read in Cairo time from ISO or the person's words (`whenOf`; a bare day is 09:00), with an optional `before` and `repeat` (daily or weekly);
  - each one sends a pg-boss `organizer.remind` job for its minute, and the tick catches any that slip;
  - ringing posts a `reminder` card (`rang: true`) in the main thread and pushes it once (desktop and Telegram);
  - the person's own reminders ring through quiet hours; `study` reminders (only from older versions, which set one per study session) ring like any other reminder;
  - one rung more than 6 hours late (Clem was off) is posted but not pushed, and a repeating one moves on to its next time.

  A reminder card that was just set, or that repeats, has Cancel. Settings lists the upcoming ones.
- **The AI's view** (`clem.calendar`): the agenda for a range: classes, calendar events (all-day too) and timed plan items by day, every clash including class-against-plan, and the study preferences. The guide is `CALENDAR_GUIDE`, in the main thread's note.
- Checked by `tests/calendar.test.ts` and `scripts/verify/calendar.mjs`. The verify script shows the reminders, the study card, the clash in the brief and Settings in dark and light.

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
- **Proactivity** (`core/proactivity/`, pure and tested in `tests/proactivity.test.ts`): `settings.ts` (level, quiet hours, jobs; `delivery` decides what is said where by level and urgency), `snapshot.ts` (the compact workspace snapshot and its diff), `actions.ts` (the actions, their keys, appliers and Undo), `rules.ts`, `attention.ts` (levels, mutes, the push cap, timetable changes), `watches.ts`, `sweep.ts` (one sweep decided; the byte-stable `ORGANIZER_GUIDE`; the card).
- **The engine runs it** (`desktop/engine/organizer.ts`, migration `004`): `organizer_settings`, `organizer_actions` (every action, line and reminder by key, with its status and Undo record), `organizer_sweeps` (last day per job; `_state`: the last snapshot, the last timetable and the events cursor), `organizer_runs`, `organizer_posts` (cards waiting for the window), `notify_queue` (quiet hours), `organizer_watches`, `organizer_mutes`. The engine now opens for every signed-in owner, GUC or not.
- **Where workspace data comes from:** the workspace lives in the window and in `state.json`. The engine reads that saved file through `EngineHost.workspace()` and keeps only a compact snapshot (spaces, plans, due and weak cards, loose files, project rooms, recent words, routines, the organizer model). It never writes the workspace: decisions are `organizer_actions` rows with status `apply`, and the window applies them with the pure appliers when it pulls `proInbox` (on every engine "changed", and on start), then acknowledges with each Undo record (`proAck`). Posts become main-thread messages whose id is the post id. With the window closed to the tray the renderer still runs, so actions apply at once; a VPS host will be handed the snapshot by the desktop, and applies wait for the window. The window pokes a sweep (`proPoke`) when plans, loose files, study sets or exam dates change.
- **The model path:** `EngineHost.complete` is the desktop's `answerWith` with the organizer's instructions as the system prompt and no tools (one turn, short JSON), on `State.organizer` or the default model. Left out (tests, a host without models), sweeps run on rules alone.
- **Notifications:** pushes are Electron notifications through the host, once per key on each channel (`notifications_sent`, channels `app`, `push`, `telegram`); a click sends `clem:open` with a `#/app/…` route or a chat and message, and the window opens it and scrolls the main thread to the card. Telegram is a channel too while paired (the cards with their buttons; docs/DESKTOP.md "Telegram"), and pairing happens in the main thread (the `telegram_pair` card).
- **AI tool:** `clem.watch` / `clem.unwatch` on the kinetra tool (`WATCH_GUIDE`, in the main thread's note and the GUC playbook); the reply carries the `watch` card.
- **Cards:** `organizer` (a sweep's lines, keyed for Undo, Do it / Not now and Mute, live from `proStatus`), `lecture` (Summarize, Make flashcards; no longer posted by the organizer, still rendered for older posts), `watch` (Stop), and `reminder` for deadlines. `scripts/verify/proactivity.mjs` checks them, the digest line, Settings → Proactivity and "What Clem did today" in dark and light.
