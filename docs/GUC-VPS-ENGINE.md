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

## Jobs
- **Runner:** pg-boss, running on PGlite on the desktop and on Postgres on the VPS.
  - This must be proven in step 1. If pg-boss can't run on PGlite, fall back to croner plus a persistent `jobs` table with retries and backoff, and record that decision here.
- **Job names:**
  - `guc.check:<owner>:<subjectId>`: one per subject, from its schedule rules.
  - `guc.sync:<owner>`
  - `brief.morning`, `reminders.deadline`, `brief.evening`, `summary.weekly`
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

## Telegram
- **Hosting:** one Clem bot, using grammY in a webhook on the existing Cloudflare account worker.
  - The bot token is a Worker secret, never shipped to a user's engine.
  - Pairing codes are 6 digits and expire after 10 minutes.
  - Inbound messages from a paired chat go into an inbox. The user's engine (VPS or desktop) pulls the inbox, answers using the agent and tools, then posts the reply through the relay.
- **Removal code:** the old Telegram removal code must be taken out. The user re-approved Telegram on 2026-11-11.

## Tests
- Location: `tests/guc-*.test.ts` and `tests/vps-*.test.ts`, run with `node --test` like the existing tests.
- Fixtures: sanitized saved HTML pages in `tests/fixtures/guc/`. No real names or IDs.
