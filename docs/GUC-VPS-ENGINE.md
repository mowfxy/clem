# GUC, VPS and Telegram: engine design

These are the working notes for the `feature/guc-connector` branch. Every step follows them. If you change a decision, update this file.

## Product intent
- **Clem's background engine:** GUC sync, scheduled jobs, notifications, the Telegram relay client, AI tools and file storage.
  - It runs in the desktop main process by default.
  - Once a VPS is connected and "Run Clem's background jobs on my VPS" is on, it runs on the user's VPS instead, so it is always on.
  - The desktop then acts as the UI and keeps only a cache.
- **One engine codebase, two hosts:**
  - `desktop/main.ts` runs it in-process.
  - `worker/` runs the same engine headless, in Docker or under systemd.
- **The renderer never talks to GUC or SSH directly.** It goes through the desktop app's request handlers, which call the engine in-process or proxy to the VPS engine over an SSH tunnel.

## Layout
- `core/guc/`: pure, I/O-free TypeScript, unit-tested. It covers:
  - HTML parsers;
  - the normalized types;
  - diff → events;
  - fuzzy subject matching;
  - natural language → save rules and schedule rules;
  - the card schemas.
- `core/connectors.ts`: the small connector list, used for GUC and VPS only. Drive stays hand-wired in `App.tsx`.
- `desktop/engine/`: Node I/O.
  - It must NOT import `electron`. Electron-only things (Vault, notifications) are passed in through an `EngineHost` interface, so `worker/` can supply its own.
  - Contents: the NTLM client, the DB, the job runner, storage backends, tool handlers, the notifier and the Telegram client.
- `src/guc/`: renderer UI: the GUC hub, settings panels and card renderers.
- `worker/`: headless entry plus a Dockerfile and a systemd unit (step 8).

## Data
- **Databases:**
  - Desktop: PGlite (`@electric-sql/pglite`, moved to `dependencies`), stored under `Documents/Clem/Accounts/<owner>/engine/`.
  - VPS: real Postgres in Docker.
  - Both are behind the same `Db` interface: `query(sql, params)` and `tx(fn)`.
- **Migrations:** SQL files in `desktop/engine/migrations/NNN_*.sql`, applied in order and recorded in `engine_migrations`.
- **Scoping:** every table has `owner_id`, and every query filters on it. The AI only ever sees the current owner's rows.
- **Tables:**
  - GUC data: `guc_courses`, `guc_schedule_slots`, `guc_announcements` (with `read_at`), `guc_materials`, `guc_grades`, `guc_deadlines`.
  - `guc_snapshots`: one row per sync, holding the per-page content hash, ETag and Last-Modified.
  - `guc_events`: `new_grade`, `new_announcement`, `new_material`, `deadline_added`, `deadline_changed`, `schedule_changed`.
  - `subject_links`: subject id ↔ GUC course.
  - `subject_settings`: save rules, schedule and Drive settings as JSON.
  - `file_objects`: location `device|vps|drive`, sha256, size, pinned, `last_access`.
  - `notifications_sent`: unique on `(owner_id, event_key, channel)`.
  - `jobs`: if the job runner needs its own table.
  - `telegram_link` and `migration_state`.
- **Credentials:**
  - GUC password and SSH key go in the Vault (desktop) or an encrypted file using AES-256-GCM (worker).
  - They are never written to workspace state, logs or prompts, and never put in error messages.

## GUC
- **Auth:** NTLM through `httpntlm`, with one keep-alive agent per owner.
  - Try the username both as given and with a `GUC\` prefix.
  - Detect the IIS 401 page as a credentials failure.
  - TLS checking stays on. If GUC's certificate chain is broken, pin or add the missing intermediate rather than disabling checks.
- **CMS** (`https://cms.guc.edu.eg/apps/student/`):
  - `HomePageStn.aspx`: the course grid.
  - `ViewAllCourseStn`: list of all courses.
  - `CourseViewStn.aspx?id=&sid=`: one course. Files are in `.card-body` blocks, week headings in `h2` ("Week: YYYY-MM-DD"), and downloads in `a#download`. The course description is `#ContentPlaceHolderright_ContentPlaceHoldercontent_desc` and weekly announcements are in `div.weeksdata`.
  - This layout is ported from AhmedAshrafAZ/cms-downloader (MIT); credit it in THIRD-PARTY-NOTICES.
- **Portal** (`https://apps.guc.edu.eg/student_ext/`):
  - `Scheduling/GroupSchedule.aspx`: the schedule.
  - `Grade/Transcript_001.aspx`: grades. It needs a postback on the year dropdown.
  - "Page will be available from…" means skip this time, not an error.
- **Deadlines:** pulled out of announcements and course content using chrono-node, plus keywords such as "deadline", "due" and "submission".
- **Incremental sync:**
  - Send conditional requests (ETag / If-Modified-Since). Otherwise compare a content hash per page, and skip parsing when it is unchanged.
  - Only fetch courses that are linked to a subject, plus the light course list.
  - Requests are batched, at most 2 at a time per host, with exponential backoff on errors.
- **Errors:** sync failures are typed (`auth`, `site_changed`, `offline`, `unavailable`). The user gets one friendly notice, deduplicated, never repeated.

## Password expiry (user, 2026-11-12)
GUC can force a password change every 30 days. When sign-in fails with an `auth` error:
- **Retry once,** after a short delay to rule out a blip.
- **Mark the connection `password_needed`.** Pause all GUC checks for that owner without wiping any data or settings, so nothing hammers GUC and the account can't get locked out.
- **Tell the user once** through the notifier at urgent level, on every channel they enabled (including Telegram), deduplicated by key `guc-auth:<date of first failure>`: "GUC isn't accepting your password. If the uni asked you to change it, enter the new one here." Show it as a card in the main thread with **Update password**.
- **Update password** opens Settings → Connectors → GUC on an inline "New password" field. It is NOT a disconnect.
- **On save:** verify the new password, store it in the Vault, clear the flag, resume the jobs, and run a catch-up check.
- **Hub and subject pages** show the same banner.
- **Reminders:** at most one gentle reminder per day while the flag is still set, and none during quiet hours.
- **How it is built** (`core/guc/password.ts`, tested in `tests/guc-password.test.ts`):
  - The flag is `guc_account.password_needed` (migration 006): when it first failed. The retry waits `AUTH_RETRY_MS` (8 s) with a fresh client; a check's auth failure flags it without a second retry, since its page read already retried.
  - Pausing unschedules `guc.sync` and every `guc.check` schedule; while flagged, `reschedule` adds none, the job handlers return, and every path to GUC (sync, checks, viewing or reading a CMS file) throws the friendly auth error without a request. Resuming schedules `guc.sync` again and rebuilds each linked subject's checks from its settings as they are now. The catch-up is a sync, then each linked subject's check with trigger `rules`.
  - The notice is `Organizer.gucPassword()`, called when it fails and on every `organizer.tick`: the `guc_password` card (live: once it works, it says so) posted once under `guc-auth:<Cairo day>`, and a push under the same key on every outward channel turned on for any event (urgent, so the level doesn't hold it; quiet hours queue its pushes). Later days push `guc-auth-reminder:<day>` outside quiet hours, with no new card.
  - Update password is the route `#/app/connectors/guc`: Settings → Connectors with the GUC dialog, which shows the "New password" field while flagged (`gucPassword` IPC → `Engine.updatePassword`). Telegram's card button opens the same route in Clem.

## Jobs
- **Runner:** pg-boss, running on PGlite on the desktop and on Postgres on the VPS.
  - **Decision (step 1, proven):** pg-boss 12 runs on PGlite 0.5 through its own `fromPglite` adapter (`backend: "pglite"`, schema `pgboss`). The spike and `tests/guc-jobs.test.ts` show a failed job retried with backoff, and jobs and cron schedules (with `tz`) surviving a close and reopen. So there is no `jobs` table and no croner (check schedules use pg-boss cron too; see Check schedules). The wrapper is `desktop/engine/jobs.ts`.
  - Each owner has their own database, so queue names leave the owner out (`guc.sync`, not `guc.sync:<owner>`). Per-subject checks are `guc.check` schedules keyed by subject and cron line.
  - `guc.sync` runs every three hours (`0 */3 * * *`, Cairo time) while GUC is connected. A wrong password is not retried. Offline and unavailable errors retry 3 times with backoff from 2 minutes.
- **Bundling:** `scripts/build-desktop.mjs` maps `import.meta.url` to the bundle's own file URL, copies `pglite.wasm`, `pglite.data` and `initdb.wasm` beside `main.cjs`, and copies `desktop/engine/migrations` to `desktop-dist/migrations`. `pg-native` stays external.
- **Job names:**
  - `guc.check:<owner>:<subjectId>`: one per subject, from its schedule rules.
  - `guc.sync:<owner>`
  - `organizer.sweep` (keys `morning`, `midday`, `evening`, `weekly`, Cairo time; event sweeps are sent with a singleton key) and `organizer.tick` every 10 minutes (deadline reminders, quiet-hours pushes). See docs/MAIN-THREAD.md "Proactivity".
- **Timezone:** Africa/Cairo by default.

## Chat cards
- Assistant messages carry ` ```clem-card ` fenced blocks with a JSON body, checked against a zod schema in `core/guc/cards.ts`.
- `MessageBody.tsx` renders them the same way it renders ` ```plan `.
- Card types: `course_link`, `save_rules`, `check_schedule`, `drive_folder`, `storage`, `file_saved`, `announcement`, `grade`, `deadline`.
- When a card is edited, the outcome is written back to the engine through IPC, and the card shows live state read from the engine, not a frozen copy.

## UI rules
- Use only existing components and tokens: `SettingsCard`, `SettingRow`, `Switch`, `EmptyState`, `PageHead`, `Icon`, `confirmDialog` and `Toast`, plus the glass tokens and the scale in `src/glass/glass.css`.
- No new UI library. `@tanstack/react-virtual` (headless) handles long lists.
- Data shows instantly from cache, then refreshes in the background. Edits update the screen immediately. Loading states use skeletons, never a blank screen.
- Respect the existing memory rules: text sits small inside its button, the logo never animates, and never fade a parent of glass.

## Libraries
`httpntlm`, `cheerio`, `fuse.js`, `pg-boss`, `@electric-sql/pglite`, `chrono-node`, `croner`, `ssh2`, `ssh2-sftp-client`, `grammy` (Cloudflare relay), `@tanstack/react-virtual`, `officeparser`, `lru-cache`, `zod` (already present).

## GUC hub
- **Reads** (`desktop/engine/guc-read.ts`, owner-scoped): `gucOverview`, `gucCourses`, `gucSchedule(weekStart)`, `gucAnnouncements({courseId?, cursor})` (40 a page, keyset on first-seen time and id), `gucMarkRead(ids)`, `gucMaterials(courseId)` grouped by week, `gucSearch(query)` (ILIKE over file names and announcements, every word must match), `gucGrades({courseId?})`, `gucDeadlines`.
- **Files:** `gucFile(materialId)` and `clem://app/api/local/guc/file/<id>` serve the saved copy (`file_objects`, `guc:<id>`) or fetch the file on demand through the NTLM client into a temp folder (`EngineHost.paths.temp`, else the system temp). Temp copies go when the engine closes or GUC disconnects; what save rules keep is served from its saved copy (see Checks and saved files). The window reads them as `guc_<id>` through `getBlob`, so the existing viewer (PDF, slides, images) shows them read-only.
- **Shared logic** (`core/guc/hub.ts`, tested): result types, the Sat–Thu week in Africa/Cairo, deadline order and relative times, semester order, and the `#/app/guc/<tab>/<id>/<sub>` routes (`schedule`, `announcements/<id>`, `cms/<course>/<file>`, `grades`, `deadlines/<id>`) for notifications to link to.
- **Window cache** (`src/guc/swr.ts`, `src/guc/useGuc.ts`): stale-while-revalidate per owner, in memory and IndexedDB (idb-keyval, already present; no new library). One fetch per key at a time; a finished sync refreshes what is on screen; marking read updates every cached copy at once.
- **UI:** `src/guc/GucHub.tsx` (the sidebar's GUC item, shown while connected; course rows show their subject, Link to a subject and Create subject from this course) and a CMS tab on each subject (`src/guc/SubjectGuc.tsx`). `scripts/verify/guc-hub.mjs` checks it against the real engine reads.

## Subject setup
- **Course codes** have one form everywhere, "CSEN 701" (`core/guc/codes.ts`): the parsers write it, the engine's reads rewrite older rows, and comparisons go through `codeKey`.
- **Matching** (`core/guc/match.ts`): an exact code wins; otherwise name words (prefixes, plurals, small typos, roman numerals, initials) plus fuse.js. `sure` (≥ 0.75 and 0.12 ahead of the next) is what lets Clem ask "This looks like CSEN 701 — link it?"; otherwise it offers the alternatives.
- **Links** (`desktop/engine/subjects.ts`, migration `002`): one course per subject and one subject per course (linking moves it). Linking runs a light sync of that course only (`Engine.syncCourse`, queued behind any full sync). Each linked subject's checks are `guc.check` pg-boss schedules keyed `<subject>/HHMM` (pg-boss keys allow no colon), from its check rules; Check now is the same light sync. Deleting a subject forgets its link and settings.
- **Settings** live in `subject_settings` as JSON (`core/guc/settings.ts`): save rules, check schedule (default: 30 min after each of the course's lectures, else Sat–Thu 20:00, Africa/Cairo), Drive and storage, and the setup state. Patches are zod-checked; the window applies them optimistically (`src/guc/subject.ts`) and the engine's answer replaces the guess.
- **Setup thread** (`core/guc/setup-flow.ts`, `src/guc/setup.ts`): a pure state machine decides the next question (link → save → check → drive → storage; save and check only once linked, storage only with a VPS, so it is skipped until the VPS step). It starts when a subject is created while GUC is connected, when a subject's first course is linked, from "Create subject from this course", or from "Set up in a chat". It lives in a pinned chat titled Setup (`Chat.setup`). Questions are posted locally and instantly; typed replies go through the local parsers first, and only a reply they can't read is sent to the AI (the setup chat's model, else Clem's organizer, else the default) as one JSON side request. State is saved in the engine after every answer, so reopening the chat after a restart posts whatever is still unasked. Editing an earlier card changes the setting without moving the flow.
- **Rules converters**: `convertSaveRules` and `convertCheckSchedule` (below) read typed replies; `parseSaveRules`/`parseCheckSchedule` remain as their local-only wrappers.
- **Cards** read live state through one `gucSubject` read per subject (never a frozen copy): `course_link`, `save_rules`, `check_schedule`, `drive_folder` (shell: toggle, open, change folder via the subject's Drive link; copying arrives with Drive sync), `storage` (device only until a VPS is connected), `setup_done`, `settings_update`, `new_courses`. The subject page's CMS tab and Settings → Connectors → GUC show the same cards.
- **The AI changes settings** the way plans work: a linked subject's chat gets a short note with the current settings and the `settings_update` block format; when an answer ends, `applyUpdates` applies any such block through the same `gucSetSettings`/`gucUnlink`/`gucCheckNow` requests a card uses, and the block draws as "Stopped saving videos". No new tool or IPC path.
- **New semester**: a sync that finds active courses of the newest term that weren't in the last snapshot and no subject has records `new_course` events (never on the first sync). The window posts them once to the main thread as a `new_courses` card (acknowledged in `notifications_sent`, channel `thread`), each with Set up.
- **Checks**: `tests/guc-setup.test.ts`, `tests/guc-links.test.ts`, `scripts/verify/guc-setup.mjs`.

## Save rules
- **Shape** (`core/guc/rules.ts`): the kinds of CMS file (slides, assignments, tutorials and sheets, videos, links, other) plus optional filters every kept file must also pass: file types (`only`/`except`, from the link's extension), week numbers (`from`/`to`, counted from the course's oldest week on CMS by the date in its heading), name globs (`*`, `?`, case-insensitive, against the title and the file name) and `maxMB`. Defaults: slides, assignments, sheets and other files; no filters.
- **Words → rules**: `convertSaveRules(text, current)` reads "all lecture slides", "only PDFs", "everything except videos", "nothing, I'll open on demand", "slides and sheets under 50MB", "only week 3 onwards", "files named Lab*". A new statement of what to keep ("only slides") starts clean; a change ("stop saving videos", "also videos", "under 20MB") keeps what it doesn't mention. Leftover words it doesn't know, contradictions ("only slides except slides"), "files over 50MB" alone and "skip week 3" (a hole a range can't hold) are `{ needsAI: true }`.
- **The AI** answers with JSON that must pass `aiSaveRules` (strict zod: known kinds and types only, weeks 1–60 with from ≤ to, globs without slashes, positive sizes; `null` removes a filter). The same schema checks every settings patch.
- **`matches(rules, material, { week, size })`** is the only gate before a download. A size rule passes until the size is known; the check asks with a HEAD first.
- **Described** for cards: "Everything · PDFs only · week 3 onwards · under 50 MB"; "Nothing (open files on demand)".

## Check schedules
- **Shape** (`core/guc/schedule-rules.ts`): fixed times (day + "HH:MM"), an optional repeat (`every` minutes between two times on some days) and an optional date range (`during`), always on Cairo's clock (Africa/Cairo, daylight saving included).
- **GUC week**: Saturday to Thursday. "Weekdays", "school days" mean Sat–Thu, and descriptions say "Sat–Thu (GUC week)"; "weekend" is Friday.
- **Words → schedule**: `convertCheckSchedule(text, { suggested, slots, code, exam })` reads "every 2 hours on weekdays 8am–10pm", "twice a day", "only on lecture days" (the course's lecture days at 20:00), "hourly during exams" (the 21 days up to the subject's exam date), "after each lecture". It answers `{ ask }` when only the person knows (no exam date, no lectures on the schedule) and `{ needsAI: true }` for the rest ("every day except Friday").
- **Never more often than every 30 minutes**, whatever is asked (shared server, battery, data).
- **Default**: 30 minutes after each of the course's lectures plus one 21:00 check those days; a course with no classes gets Sat–Thu at 20:00.
- **Cron**: `cronLines` groups the week's times by minute and days ("0 8,10,12 * * 0,1,2,3,4,6") with a stable key per line. pg-boss runs them with `tz: Africa/Cairo`; no croner. `nextRuns(n)` lists what is coming and is tested against pg-boss's own cron parser, across the April and October clock changes.
- **Date ranges** can't be cron: the job wakes up and does nothing outside them.

## Checks and saved files
- **Jobs**: each linked subject's lines are `guc.check` schedules keyed `<subject>/<line key>`. A settings change reconciles: lines whose cron changed or went away are removed, new ones added, the rest left alone.
- **A check** (`Engine.check`, one per subject at a time): the course page conditionally (ETag/If-None-Match, else the content hash) → diff → events; then `saveFiles` (`desktop/engine/check.ts`): only materials the rules keep, on a GUC host, not links, and not saved yet or whose link changed; two downloads at a time (the client's per-host limit), stored one at a time. An unchanged page with everything saved costs one request and no downloads. "Check now" runs one; new save rules run one without the page after the taps settle (15 s), but not mid-setup before the save question is answered. Linking only reads the page.
- **Storage** (`desktop/engine/storage.ts`): `FileStore`; `DeviceStore` keeps bytes under `Documents/Clem/Accounts/<owner>/Files/GUC/<sha256>.<ext>`, written once per hash. The same bytes from another CMS entry reuse that file. Each saved file is shown in the workspace as `Files/guc_<material>.blob`, a hard link to the same bytes (a copy only on file systems without hard links), so the viewer, backups and the AI's working folder read it like any file. Replaced bytes nobody uses any more are deleted. A VPS store comes later behind the same interface.
- **Records**: `file_objects` (migration `003`) gains material, subject, link, name, type and the Drive copy's id, hash, folder and root. `guc_checks` keeps one row per check (trigger, page changed, requests, bytes, saved, skipped, deduped, uploaded, ms, error; last 200 per subject) for the performance pass. A file a size rule refused after download is remembered (`notifications_sent`, channel `too_big`) and not fetched again.
- **To the window**: the engine has no workspace state, so saves are `file_saved` events and the window pulls them with news (announcements, grades — now tied to their course — and deadlines) through `gucInbox`, acknowledged with `gucAckInbox` (channel `thread`). The engine host's `changed()` tells the window to pull. The window adds each file once (id `guc_<material>`, the subject's `spaceId`) and posts one message per subject in its Setup chat: a `file_saved` card (Preview, Summarize, Show in Files) and a card per piece of news. Pulling also works after the window was closed during a check.

## Drive copy
- `desktop/engine/drive-mirror.ts` copies a subject's saved files to `Clem/GUC/<code name>/<week>` in My Drive, or into week folders under a folder the person chose (the existing DrivePicker). Folders are found or made once and cached (`drive_folders`).
- A file is sent once per root folder and content (`drive_sha256`); the same bytes already in that week folder reuse that Drive file; an unchanged file is never sent again. A new folder sends the files there; the old copies stay.
- Drive goes through the host (`EngineHost.drive`). On the desktop that is DriveLive with two additions: `folderIn(parent, name)` and an optional type for `uploadFile` (default unchanged). Nothing else in Drive changed.
- Drive not connected (or a token that can't write) records `reconnect` in `subject_drive`, and the card shows Reconnect Drive (Settings → Connectors); files wait and go on the next check or toggle.
- **Card**: the toggle, the folder in use, copied and waiting counts, Open, Change folder, Use Clem/GUC.
- **Checks**: `tests/guc-rules.test.ts`, `tests/guc-schedule.test.ts`, `tests/guc-check.test.ts`, `scripts/verify/guc-rules.mjs`.

## AI tools
- **Actions**: GUC joins the one `kinetra` tool as namespaced actions (`core/guc/ai-tools.ts` `GUC_ACTIONS`, added to `ACTIONS` in `desktop/kinetra-turn.ts`), so every CLI reaches them the same way, natively over MCP or as `{"kinetra":…}` text: `guc.schedule(range, subject?)`, `guc.deadlines(range?, subject?)`, `guc.announcements(subject?, since?, unread?)`, `guc.materials(subject)`, `guc.read(file, from?)`, `guc.grades(subject?)`, `guc.search(query, subject?)`, `guc.settings(subject, saveText/checkText/rules/save/check/drive)` and `guc.help`. The spec's names (`get_schedule`, `read_file`, `update_subject_settings`…) read as aliases. Reads are QUICK (they run in parallel); `guc.settings` is not.
- **Guide and skill**: `GUC_GUIDE` (one line per action, byte-stable) is the `guc` playbook in `core/clem-skills.ts`, chosen only when GUC is connected and the chat is a subject's or the message is about study (schedule, deadlines, slides, grades…). Nothing is added otherwise, so other prompts keep their cache.
- **Where they run**: `desktop/main.ts`'s chat `tools` handles `guc.*` first, in the main thread and in subject chats alike, with `runGucTool` (`desktop/engine/ai-tools.ts`). A subject chat (`scope` `subject:<id>`) makes that subject the default.
- **Owner**: the engine is per owner and `runGucTool` refuses an engine that isn't the signed-in owner's; every read goes through the owner-scoped engine reads. Subject names and exam dates come from the window's state (the engine has only ids).
- **Subjects** resolve (`resolveSubject`) by linked subject id or `@id`, a course key or code ("csen702"), a subject's exact name, then fuzzy names of linked subjects and courses (`core/guc/match.ts`); close calls answer "could be A or B: say which".
- **Output**: compact text, capped (40 deadlines or grades, 80 files, 25 search hits, 15 announcements by default), each line with its `#/app/guc/…` link so the AI cites it; the rest is summarized as "…and N more (hint)". Ranges are Cairo days; the schedule spans at most 14 days.
- **guc.read**: any CMS file by id (or a title, the subject's first), saved or not. Bytes come from the store that holds the file (`file_objects.location` → a `FileStore`, which gained `read`; only `device` today, a VPS or Drive store plugs in by location, and one this host can't reach falls back to CMS), else the viewer's temp copy, else straight from CMS through the NTLM client into memory: nothing is written, nothing is recorded as saved. Text: PDFs with pdfjs-dist's legacy build in Node (its worker on the main thread via `globalThis.pdfjsWorker`, so the bundle needs no worker file), PowerPoint, Word and Excel through `desktop/office-text.ts` (`officeBytesText`, the same reader the working folder uses), text as is (`desktop/engine/file-text.ts`). Parts per page, slide or sheet (Word in ~4k-character parts), returned about 24k characters at a time with `[name, page N]` markers and a "continues at page N" request. The text stays in an `lru-cache` (45 min since last read, 12M characters, 200 files) per engine, so reading on costs no download; disconnecting or closing clears it.
- **guc.settings** builds a `settings_update` card from the request and runs it through `updatePatch` (the converters for the person's words, `aiSaveRules`/`checkSchema` for structured fields), checks the patch with `settingsPatch`, then calls `Engine.setSettings` like a card; what the converters can't read comes back as an error with the structured format. Only for subjects linked to a course; no unlink or check-now from the AI here (the `settings_update` block still has them).
- **Now card**: `Engine.now()` (IPC `gucNow`) gives today's classes, deadlines in the next 7 days and the unread count (`gucNow`), cached under a version bumped by every sync, check, mark-read and disconnect, and by the Cairo hour. The window merges it into the local card (`withGuc` in `core/main-thread/context.ts`) for each main-thread turn.
- **Checks**: `tests/guc-ai-tools.test.ts` (each tool on the fixture GUC, resolution, owner scoping, saved vs unsaved reads with cache hit and TTL, PDF and PPTX extraction from `tests/fixtures/guc/lecture.pdf` and `deck.pptx` made by `scripts/make-guc-text-fixtures.mjs`, settings validation, the Now card, and a tool call over the MCP endpoint as a CLI makes it).

## Telegram
- **Hosting:** one Clem bot, using grammY in a webhook on the existing Cloudflare account worker.
  - The bot token is a Worker secret, never shipped to a user's engine.
  - Pairing codes are 6 digits and expire after 10 minutes.
  - Inbound messages from a paired chat go into an inbox. The user's engine (VPS or desktop) pulls the inbox, answers using the agent and tools, then posts the reply through the relay.
- **Built (2026-11-11, re-approved by the owner):** `cloudflare/telegram.js` (the bot, `/webhooks/telegram`, `/telegram/*`), `cloudflare/telegram-schema.sql` (`npm run db:telegram`), `core/telegram/` (pairing codes, card and answer rendering, the AI guide), `desktop/engine/telegram.ts` (the relay) and migration `005_telegram.sql` (`telegram_seen`, `telegram_buttons`; `telegram_link` caches the last status). The removal code is gone. Details, and the owner's deploy checklist: docs/DESKTOP.md "Telegram".
- **Host-agnostic:** the relay needs only `EngineHost.account` (the account service as the owner) and `EngineHost.converse` (an answer from the main thread's agent); `EngineHost.open` is optional. A VPS host gives it its own session for `account`. Its `converse` must run the main-thread agent headless; until then a VPS engine can deliver Telegram notifications and cards and run taps the engine owns (Stop, Mute, Not now, Check now, Send me the file), while messages wait for the desktop's window.
- **Notifier:** `push` takes channels (`push`, `telegram`); `notifications_sent` dedupes per channel, quiet hours queue per channel (`notify_queue.channel`), the daily cap counts an event once across both.

## Tests
- Location: `tests/guc-*.test.ts` and `tests/vps-*.test.ts`, run with `node --test` like the existing tests.
- Fixtures: sanitized saved HTML pages in `tests/fixtures/guc/`. No real names or IDs.
