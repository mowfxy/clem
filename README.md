# Mowr

A Windows desktop workspace for conversations, projects, subjects, local files and document drafts. The React interface ships inside the application; Codex connectivity and document tools run on the user's PC. https://mowrai.com is the marketing and account site. Mowr is **free**; a PayPal button on the website’s Support page and in Settings (set `PAYPAL_URL` in `src/support-link.tsx`) keeps it that way. Until it is set, the link shows but does nothing.

This is a **desktop preview**, not a fully verified production release. See [production status](docs/PRODUCTION-STATUS.md) and [desktop architecture and operations](docs/DESKTOP.md) for tested capabilities, security boundaries and remaining work.

## Run on Windows

Use Node 25 and npm. Run `npm ci`, copy `.env.example` to `.env.local`, set the Supabase public URL/key, then run `npm run desktop:dev`.

**The installer:** `npm run desktop:installer` builds it and copies the finished EXE, its SHA-256 and install notes to the top-level **`Installer/`** folder (build intermediates stay in `release/`). After uploading it to the releases repository, run `npm run installer:release` to update the website's download metadata, and point `/download/windows` in `vercel.json` at the new file. It bundles the official Codex CLI. Sign in, complete setup, and connect ChatGPT from Settings. Owner exemptions are verified server-side; other accounts cannot purchase until Lemon Squeezy is configured. Unsigned previews show Windows publisher warnings.

In Settings → Models, the usage display polls every second while the workspace is visible; each connected account's Codex app-server is queried at most once every 10 seconds so polling does not spawn a process per second. The optional account switch uses another connected ChatGPT account before each request when the active account has less than 10% left in its short window or less than 5% left weekly, provided the destination supports the selected model and reasoning level. A running request is not moved mid-response; Long Task checks again at each step and preserves completed outputs.

Claude subscription handoff uses a separately installed official Claude Code native CLI. Settings can open the official installation guide or launch its sign-in flow in a terminal. When signed in with a Claude subscription, Claude model aliases appear in the picker and Long Task can offer a compact account, model and thinking choice when no ChatGPT account has capacity. Anthropic does not expose a documented machine-readable subscription usage percentage through this integration, so Claude limits and reset notifications are not shown as measured values. Live Claude sign-in and inference require verification on a machine with an authorized subscription.

For the website, run `npm run server` and `npm run dev` separately. Legacy account/file services remain during migration; the website no longer opens the browser workspace.

Chats and files stay in Documents/Mowr. Subjects can hold AI quizzes and flashcards and move between users as ZIP archives. Read [local data and subject transfers](docs/LOCAL-DATA.md) before uninstalling or sharing an archive. The [export checker](https://check.mowrai.com) checks invisible markers locally in the browser.

## Admin portal

Staff moderate accounts, manage subscriptions and complimentary access, answer support cases and publish in-app announcements at **admin.mowrai.com**. See [admin portal](docs/ADMIN.md) for roles, setup (`npm run db:admin`, `npm run deploy:accounts`) and the local demo (`http://localhost:5173/?demo#/admin`).

## In the app

- **Notices** above the account button stack newest-first, pause on hover and fan out to show all of them: account switches, usage resets, Claude handoffs, staff announcements and support replies.
- **Help & support** (Settings) lists your requests with replies from the team; reply in place.
- **Visuals for anything**: type `/visual` and any topic, or ask in plain words. Eight built-in physics models answer instantly; anything else is described by the connected model in a small JSON language (`core/visual-spec.ts`) — plots with sliders and animation, step-through diagrams, and charts — which Mowr validates, compiles with a safe expression evaluator (`core/expr.ts`, no `eval`) and draws with the same pen. PNG/SVG/PDF export.
- **Checked numbers**: answers with calculations end with a `check` block; Mowr recomputes each stated formula and flags any value that differs. It confirms arithmetic, not the choice of formula.
- **Second opinion** and **Check sources** under each answer: another connected model (another provider first) reviews the answer; the source check lists which claims your attached files support. Citations written as `[[file, p. N]]` become chips that open the file at that page.
- **Subjects and projects are pages** (`src/space/SpacePage.tsx`): a subject has Overview (today's review, exam countdown, mastery, streak, one-click flashcards, quiz, worksheet or summary sheet), Chats, Flashcards, Quizzes, Files and About. Every card is scheduled with FSRS spaced repetition (`core/srs.ts`) and paced to the exam date.
- **Folders inside Mowr**: make folders (and folders inside them) in a space's Files, upload or drop files straight into one, drag files between them or use Move to. A worksheet Mowr makes from a subject lands in its Worksheets folder. Subject ZIPs keep the folders.
- **Real PDF editing** (`src/pdf/`): tell Mowr what to change and the PDF itself changes. PDFs Mowr made are re-typeset from their kept source (`spec-<id>`); any other PDF has the changed lines re-set in place with matching font style, size and colours (`core/pdf-edit.ts`). Changed lines are highlighted with Before/After, nothing is saved until Keep changes, and earlier versions stay for Undo.
- **Screen capture**: **Ctrl Shift Space** from any app (or + → Capture screen) freezes the screen, lets you drag a region and attaches it to the chat for a ChatGPT model.
- **File changes**: with a linked folder, models propose edits as diffs. Nothing is written until you apply; every change can be undone from the chat or Settings → Linked folders, and undo refuses to overwrite newer work.
- **Folders on this PC**: the Files page lists linked folders; **Browse** reads any text or code file inside Mowr, and “Tell Mowr what to change” sends the request to the folder’s chat, project or subject, where it comes back as a diff to apply.
- **Folder watching** (`desktop/folder-watch.ts`): a file changed outside Mowr in a linked folder raises a notice that prepares a flashcard update (subjects) or a summary of the changes. Mowr’s own applied edits are absorbed silently. Settings → Linked folders turns it off.
- **Search everything**: **Ctrl Shift F** (or Ctrl K → Search everything) searches chats, uploaded file contents, linked folders, flashcards and spaces on this PC with one ranking (`core/search.ts`).
- **Sharing**: **Share** on a subject (or Share folder) picks sensible contents, saves a `.mowrpack` to Downloads\Mowr and lets you drag it straight into WhatsApp, Discord, Teams or an email. Packs carry flashcards, quizzes and chosen folders — never chats, memory or review history (`core/study-pack.ts`). Dropping a pack on the window, double-clicking it or importing it from Subjects opens a one-click preview.
- **Offline reading**: when Mowr cannot reach the account service, “Open my files offline” opens the local workspace read-only; sending returns when the connection does.
- **Ctrl K** opens the command palette (chats, projects, subjects, settings); **Ctrl N** starts a new chat; **Ctrl ,** opens Settings.

## Verify changes

```powershell
npm test
npm run test:desktop
npm run typecheck:server
npm run desktop:build
npm run desktop:smoke
node scripts/check-performance-budget.mjs
npm run verify:all          # every browser check in scripts/verify/ (add --live to include the installer download)
```

Smoke tests use a temporary profile. Real account authorization, payments and Telegram delivery require user participation and credentials; fixtures do not verify those services.

## The product film

`npm run film:demo` captures the story in the browser fixture at 2× (`scripts/film/capture.mjs`), composites it with a virtual camera, drawn cursor and kinetic title cards (`stage.js`, `render.mjs`), scores it with an original synthesised track and UI sounds (`score.mjs`) and writes `ads/mowr-film-demo.mp4`. AI replies in the demo are scripted and the video says so. For the real film: `npm run desktop:build`, then `npm run film:live-setup` once to sign in and connect the ChatGPT account with GPT-6 Luna in a separate ad profile, then `npm run film:live` (writes `ads/mowr-film.mp4`). `node scripts/film/render.mjs [--live] [--preview]` re-renders without re-capturing.

## Find the code

- `desktop/`: main process, protected storage, authentication, local Codex and Claude, folders, memory and Telegram. `provider-link.ts` backs connections up to the account and restores them after a reinstall.
- `src/App.tsx`: the workspace shell. Features live in their own folders: `src/notices/` (notice stack, handoff, account signals), `src/support/` (in-app support inbox), `src/command/` (command palette), `src/desktop/` (onboarding and desktop controls).
- `src/files/`: the file panel beside chats and the popup viewer (`FilePanel.tsx`), change-request routing (`intent.ts`), saved-file search and renaming. `src/chat/Links.tsx` draws link chips and in-place YouTube players.
- `src/space/`: subject and project pages; `drive-sync.ts` keeps a space in step with a Google Drive folder.
- `src/visuals/`: the visuals engine. `scenes.ts` holds the models; `pen.ts` draws each one to canvas (live) or SVG (exports, thumbnails).
- `src/site/`: the marketing website (landing, features, pricing, download, legal). Sign-in, inbox and email-link pages are in `src/Login.tsx`.
- `emails/`: generated by `npm run emails`; animated artwork in `public/email/` comes from `npm run emails:art`. Apply auth templates with `npm run emails:apply` (templates only; needs SUPABASE_ACCESS_TOKEN). `src/admin/`: the admin portal.
- `cloudflare/account-worker.js`: account/entitlement Worker entry. Route modules: `admin.js`, `support.js`, `provider-vault.js` (ChatGPT, Claude and Telegram connections kept with the account, encrypted); shared helpers in `cloudflare/lib/` (`pack.js` compresses stored payloads). Schemas: `account-schema.sql`, `sync-schema.sql`, `admin-schema.sql`, `provider-links.sql`.
- `core/`, `vendor/kinetra/`: shared workflows and bundled Kinetra guides, calculations and document illustrations.
- `server/`, `database/`: legacy web services and migrations retained during migration.
- `tests/`, `tests/desktop/`: unit and integration tests; `scripts/verify/*.mjs`: browser-driven checks.

Generated bundles, installers, credentials and screenshots are ignored. Historical owner-only helper scripts are preserved locally in `.maintainer/archive-2026-09-19/` with a SHA-256 manifest; never deploy that archive.

Font licenses remain in `public/fonts`, and Kinetra's license in `vendor/kinetra/LICENSE`. Support: support@mowrai.com.
