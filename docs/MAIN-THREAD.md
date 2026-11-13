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
  - **How it is built:** `src/main-thread/morph.ts` runs the swap inside `document.startViewTransition`. The box glides for 440 ms on `cubic-bezier(.32,.72,0,1)` (`--mt-glide`, `MORPH_MS`/`MORPH_EASE` in `core/main-thread/home.ts`): a soft start that still answers the click, and a long settle. While it runs, `html[data-morph=in|out]` names the composer `clem-composer`, home's content `clem-home` and the thread's list `clem-thread` (`main-thread.css`): home recedes (down, scale .97, fade, 200 ms), the thread rises 18 px (360 ms after 80 ms), and back to Home reverses both.
    - **The group is the glass.** While the box is in flight (`data-morph-surface=group`) the composer's own surface is off and `::view-transition-group(clem-composer)` paints the tint, sheen, rim, shadow and live `--glass-filter` blur at every size between the two boxes. The snapshots then hold only the box's contents, at their own size (never stretched), and are handed over old-out (140 ms) then new-in (220 ms after 120 ms), so the two placeholders never sit on top of each other. When the glide's animation finishes, the real composer takes its surface back (`=live`) while the transition is still up (the page crossfade runs 60 ms longer), so nothing changes on the frame the transition lets go.
    - **The morph is the entrance.** Right after the swap, finite CSS entrances of the arriving view (home's widgets, a message's mark) are finished at once instead of replaying under and after the morph, and the window's frost transition takes the glide's length and curve. A caret that was in home's box is put in the thread's box in the same frame, so keys typed during the swap are not lost.
    - The swap is `flushSync`ed inside the transition, so the new frame already has the cached newest page; the draft is read from a ref because the swap runs a frame later. Without the API the new composer is FLIPped with WAAPI (transform only, no fading parent). Reduced motion or a quieter workspace swap at once (`morphMode`). Going Home no longer focuses home's box when a main thread exists, since that focus opens the thread.
  - **The picker** (`src/main-thread/HomePicker.tsx`, `pickSpaces`): a quiet "New chat in" row under the box with the three most recently used spaces (by their newest chat; never-used ones after, subjects first, then by name) and **Find** (Ctrl J from anywhere, which goes Home first), the @-mention fuzzy list with a field; arrows and Enter pick, Escape closes. A pick is `newChat(spaceId)`, local and instant. `scripts/verify/home-transition.mjs` holds the transition's animations to take frames at 0/150/300/440 ms in both themes.
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

**Organizing and pinging, not usage-heavy AI work** (user, 2026-11-12). Rules keep the plan tidy; the organizer model is called at most once per sweep that has something to say (news to judge, or a post to put in its own words), short and batched: a handful of short calls a day. Nothing is read, summarized or generated on its own.

**An assistant, not a notification system** (user, 2026-11-12): "it's just how Clem should feel, not what the user does in settings". There is no switch per kind of news. Clem judges each piece of news against what it knows of the person (their plans, deadlines, exams, what they said lately) and tells them only what matters, in its own words, saying what it means for them. Nothing reaches them just because it happened, and nothing needs a watch to be noticed; a watch is for something specific they want to hear about.

**A voice and a sense of timing** (user, 2026-11-12: "I want it to feel human… reaches out before the user does"):
- **Clem speaks first, the card backs it up.** A post opens with one to three sentences in Clem's own words (the organizer's `message`: what matters most, what it means for the day, what Clem already did about it) and the card under it carries the details and the buttons. The same single call that judges the news writes it, so a sweep is still one short call. It is asked for whenever a post would otherwise be only templates: something certain worth saying (a class moved, a deadline), an answered watch, and the timed briefs. Not at the quiet level, and not for plan tidying after an event. Without a model the card stands alone. The words are plain text (fences and markdown marks are stripped), and they are the push text.
- **It reaches out.** At proactive, the morning plan, evening prep and weekly review go to the desktop and Telegram too (never the midday check); at balanced a brief still isn't worth a buzz.
- **The main thread's AI knows what Clem said.** A card sent back as context reads as its lines ("You told them, in a card…"), so "yes, do that" has something to refer to (`turnText`).
- **Nothing is lost to the level.** News found by a timed sweep is told like any other. News a quieter level keeps back is logged as `held` and rides along with the next card Clem posts (for a week).
- **One thing is said once.** A watch's line stands for its change; a grade is one line (Clem's words, or the grade note); a deadline told as news in the last 12 hours is not repeated by the 48-hour reminder (`skipped`); a person's own reminders don't use up the day's pushes.
- **Asked when a person would ask.** A follow-up comes the evening of the day they named (or after it), never the same morning, never for "remind me to…" (the reminder answers it) or a loose "I should…" with no day, and never the minute they said it (the model no longer writes follow-ups). A grade is met as the mark deserves (`gradeShare`): a cheer for 80% and up, a hand for under half, nothing forced otherwise.
- **It notices a pattern instead of repeating itself.** A task Clem has moved twice in four days and that is still open is not rolled on a third time: Clem asks once what to do with it and leaves it. A morning block for a task already in the plan gives that task its hour (a move, one task) instead of a copy; Clem's own old blocks are not rolled on.
- **It knows what time it is.** Opened after a missed routine, Clem runs the latest one missed (at night the evening prep, not a morning plan for a day that is over; the weekly review on its day), and a late morning plan skips classes already over. The brief says an exam today or tomorrow. A project thread that fails is said in the next sweep, not the next morning. The very first sweep is a baseline: what GUC already held is not news.

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
- **Each sweep** gets the snapshot, GUC's changes and the timetable diff since the last sweep. Nothing changed: no model call, no card. The card's lines and the reminders are templates; the model is asked when something needs judgement (an announcement to rate, a half-matching watch, an unplaceable file, new words from the person) or a post needs Clem's own words above it (see "A voice and a sense of timing"), with the Now card, the diff and what the card will show, for short JSON.

## Reminders and study time (user, 2026-11-12)
The main thread sets reminders and plans study time around the person's GUC classes and plans, by their preferences, and says when a class and a plan item clash. Clem sends reminders itself (the main thread, the desktop and Telegram). There is no calendar connector: Google Calendar was tried in 0.3.25 and removed in 0.3.26 (user), so Clem neither reads nor writes any calendar app, and the AI is told never to offer to.

- **Study preferences** (`ProSettings.study`; only through chat, the AI's `clem.prefs`; Settings has no card for them, user 2026-11-12): days (default Saturday to Thursday), hours (default 16:00 to 22:00) and breathing room kept around anything else (10 min). How long a session is and whether it gets a reminder are the person's to say in chat too ("user manages this"). Settings saved when session length, sessions a day and a reminder before each session were settings still load; `readPro` drops those three.
- **Study sessions** (`clem.study`, `Organizer.planStudy`, `studySlots`): N sessions before a day, each as long as the person said (`minutes`; 50 when they didn't). They go only on allowed days and hours, clear of classes and timed plan items (with the breathing room), and are spread one a day first, then as many more a day as fit. Today needs an hour's notice. Each becomes a timed `plan_task` "Study: …", applied by the window with Undo. No reminder is set for them: the person asks with `clem.remind`. The reply carries an `organizer` card (`when: "study"`) with Undo per session.
- **Reminders** (`organizer_reminders`, migration `009`; `clem.remind` / `clem.reminders` / `clem.unremind`):
  - the time is read in Cairo time from ISO or the person's words (`whenOf`; a bare day is 09:00), with an optional `before` and `repeat` (daily or weekly);
  - each one sends a pg-boss `organizer.remind` job for its minute, and the tick catches any that slip;
  - ringing posts a `reminder` card (`rang: true`) in the main thread and pushes it once (desktop and Telegram);
  - the person's own reminders ring through quiet hours; `study` reminders (only from older versions, which set one per study session) ring like any other reminder;
  - one rung more than 6 hours late (Clem was off) is posted but not pushed, and a repeating one moves on to its next time.

  A reminder card that was just set, or that repeats, has Cancel. Settings lists the upcoming ones.
- **The AI's view** (`clem.calendar`, the name kept for older prompts): the agenda for a range: classes and timed plan items by day, every class-against-plan clash, and the study preferences. The guide is `CALENDAR_GUIDE`, in the main thread's note.
- Checked by `tests/calendar.test.ts` and `scripts/verify/study-reminders.mjs`. The verify script shows the reminders, the study card, the brief, Settings → Proactivity and that Connectors has no calendar, in dark and light.
- Left from 0.3.25, unused: `organizer_sweeps.calendar` (migration `009`), a `google_event` column on `organizer_reminders` on PCs that ran 0.3.25, and `'calendar'` in the `clem_credentials` provider check (D1 and `database/008_calendar.sql`). No account ever stored a Calendar connection.

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

## Size cap (user, 2026-11-12)
The main thread never ends, so its own data is kept **under 650 MB** (`core/main-thread/trim.ts`, pure and tested in `tests/main-thread-trim.test.ts`):
- **What counts:** its messages as saved in the workspace (their JSON bytes), plus the files only its messages use (a file's recorded size and its kept earlier versions). A file is the thread's only when it was sent or made in the main thread (`chatId`), has no subject or project, is not in a library folder, is not from Drive, and its id appears nowhere else in the workspace (another chat, a space's sources, a plan, a room…). Anything else is not counted and is never deleted.
- **When over 650 MB**, the oldest material goes until the thread is at **600 MB**, so it does not trim again on the next save:
  1. its files, oldest last use first, each leaving a small "removed to save space" note (`Message.removed`) where it was;
  2. if that is not enough, old messages a digest already covers. The digest stays, so the summary, recall and context keep working.
- **Never cut:** the last 30 days; messages no digest covers (their files can go, their words stay); digests; messages without a time; and any message whose card still waits on the person: Undo (`organizer`), a confirm (`vps_confirm`), a watch, an upcoming reminder, lecture buttons, setup questions, pairing, a card this build can't read, a plan with steps left, or a limit that will continue by itself. A file one of those messages (or a recent one) uses stays too. Messages have no pin or star today; the thread itself is pinned.
- **When it runs:** `src/main-thread/useSizeCap.ts`, 2 seconds after start and then 15 seconds after the workspace stops changing, with nothing answering. The window applies the plan like deleting a chat's files: the workspace is saved first (notes and all), then the blobs go. It logs what went to the console (`[main-thread] size cap: …`) and adds one quiet line to the thread, e.g. "Cleared 52 MB of old main-thread files to stay under 650 MB." (`Message.trim`: shown small, left out of folds, recall and context).
- 650 / 600 MB and 30 days are constants (`TRIM_LIMIT`, `TRIM_TARGET`, `KEEP_DAYS`), not a setting.

## Libraries
`minisearch` for local recall: no dependencies, maintained, small.

## Where it lives
- `core/main-thread/`: pure and tested.
  - `migrate.ts`: one main thread per workspace; standalone chats get `archived: 'earlier'` once, recorded in `State.migrations`.
  - `route.ts`: the hand-off. An @mention, or one subject or project clearly ahead by name, alias or course code; anything ambiguous stays.
  - `context.ts`: the budgeted layers and the local Now card. `fold.ts`: day, week and month folding. `recall.ts`: MiniSearch. `trim.ts`: the 650 MB size cap.
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
