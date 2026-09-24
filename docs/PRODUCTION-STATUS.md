# Production status — 20 September 2026

## Implemented

- Electron Windows desktop with bundled React assets, sandboxed renderer, typed/validated IPC, native controls and folder dialog. The official Codex Windows CLI is bundled; no Vercel Sandbox or paid API fallback is used by desktop.
- Supabase authentication in the main process with Windows-protected persistence, PKCE browser sign-in, authenticator challenges and account-security handlers.
- Saved one-question onboarding: unique username, display name, optional memory, $2/month plan, Lemon Squeezy checkout preparation. Server-side verified owner exemptions bind to immutable user IDs.
- Cloudflare account Worker deployed using the existing D1 database. Additive schema applied without changing legacy workspace tables. Payments remain disabled pending the owner's Lemon Squeezy key/store/variant/webhook secret.
- Local Codex chat adapter, timeout/cancellation, bounded context, per-account provider homes, scoped folder retrieval and explicit local memory controls. Memory includes provenance, corrections, supersession, deletion and optional-vector retrieval; no automatic embeddings or accuracy marketing claim.
- Telegram-only pairing and polling, bounded media validation, local PDF/DOCX/text extraction, Codex image input and basic paginated PDF replies. WhatsApp removed at the owner's request.
- Marketing source directs users to desktop download/setup, with $2/month pricing. Browser workspace route now shows the desktop/account page.
- Existing Office paragraph/cell patch work preserved, with original-format export. PDF editing remains notes/annotation pages, not arbitrary element replacement.

## Verified

- Final checks: 51 automated tests passed, frontend/server/desktop typechecks passed, and DOCX/PPTX/XLSX browser round-trip checks passed. Packaged desktop smoke passed again after dependency cleanup.
- Marketing deployed to https://mowrai.com. The application archive contains 52 entries and no production node_modules tree; bundled main-process dependencies keep the archive approximately 7.5 MB.
- Baseline: 19 existing tests, frontend build and server typecheck passed before migration.
- Desktop policy tests cover identity/username races, owner verification, payment states, MAC validation, memory scope isolation/deletion, folders, IPC schemas and Telegram pairing.
- Actual packaged EXE launched under a temporary profile. Smoke verified local UI, no renderer Node access or auth storage, sign-in/signup navigation, reduced motion, local Kinetra calculations and rejected unsupported IPC.
- Windows Authenticode check reports **NotSigned**. The installer is an unsigned preview. No certificate or paid resource was purchased.
- Account Worker `/entitlement` rejects unauthenticated requests with HTTP 401.
- Initial JavaScript: approximately 71 KB gzip versus approximately 100 KB before migration; build evidence only, not field Core Web Vitals.
- Google Drive client ID, client secret and APP_URL are configured in Vercel Production from the local environment. The secret remains server-side. Desktop Drive browser consent, authenticated listing, Office-format imports, refresh and disconnect are implemented. Real-account Google authorization/import still requires verification. SMTP delivery still requires live verification.

## Not yet verified / unfinished

- Full real-account desktop sign-in, delivered reset email, Google callback allowlist, Google linking and subscription inference require live end-to-end verification. Authenticated account testing has not been simulated as success.
- Lemon Squeezy real/test checkout, webhook delivery, customer portal/renewals and direct app return need configuration and verification. Owner asked to provide the key later.
- Telegram delivery requires the user's bot token and provider authorization. Outgoing generated images and richer document formatting are not finished.
- Grok Build official subscription protocol was investigated; desktop integration remains disabled pending secure credential behavior and inference verification.
- No paid embedding model or local semantic model installed. Memory suggestions are generated on request and require explicit confirmation. A large relevance/fidelity benchmark, folder file-operation review/undo, broad diagram types and full visual Office/PDF layout editing remain incomplete.
- Folder indexing applies ignore rules, skips symlinks/dotfiles/secret-like names and bounds work. Windows hidden attributes and stronger race-resistant file access remain hardening work.
- Current desktop requires an online entitlement check to open the workspace; offline read-only access remains unfinished.
- The source repository is private. Public unsigned preview installers are distributed through the separate mowafymxis/mowr-releases repository; /download/windows is the direct installer route.

See [DESKTOP.md](DESKTOP.md) for setup, module responsibilities, provider sources and migration boundaries. Legacy web runtime remains for existing accounts and must be retired after account/data migration, not deleted prematurely.

## Latest workflow, memory, documents and Drive changes

- Browser handoff reproduced in Chromium with `Origin: null` on HTTPS-to-loopback form navigation. Opaque origins require the random callback nonce in the POST body; foreign/missing origins stay rejected. The unrelated DevTools probe returns 404. The web and desktop builds must both be updated.
- Workflow checkpoints are awaited before starting dependent steps, isolated by account and plan, and invalidated when task definitions or supplied source context change. Resume is explicit; startup never spends provider tokens automatically. The checkpoint is stored in the existing local IndexedDB workspace, not the server.
- Memory controls support search, corrections, fact/preference selection, explicit space sharing, history, export and forgetting a space. Suggested memories are reviewed before saving; confirmed preferences apply without repeating their exact keywords. Retrieval remains lexical unless supplied vectors exist.
- Document revision now calls the desktop Codex bridge with the active scope. Office edits support undo/redo. Atomic local edit saves reject conflicting revisions. DOCX exports preserve headings, emphasis, lists, code and tables; slides paginate by wrapped lines. Source Office archives preserve untouched media and formula cells.
- Drive uses the existing server-held encrypted refresh token. Desktop access tokens stay in the main process; no Google secret is shipped to the renderer. Browser consent requires the same Mowr identity as desktop. Google Docs, Sheets and Slides import as DOCX, XLSX and PPTX. Imported files are local copies; edits do not overwrite Drive originals.
- Drive retains the legacy account email-MFA policy: accounts with that additional browser-cookie challenge enabled are denied desktop Drive access until a scoped proof handoff is implemented. Supabase authenticator MFA is checked normally. This is an explicit remaining compatibility limitation, not an authentication bypass.
- Automated verification covers mocked Google consent/token exchange, wrong state, invalid bearer, disconnect and exports, plus actual browser loopback navigation, local checkpoint persistence, atomic document saves and desktop revision IPC. Real account sign-in/Google consent/provider inference are not claimed as verified by these fixtures.

## Local-first storage and idle motion update

- Entire workspace cloud writes and file uploads removed from the desktop UI. Server legacy write endpoints are disabled by default. Existing cloud tables were not destructively removed; workspace/file/scope counts are all zero in the production D1 audit.
- Cloudflare essentials sync deployed on the existing database, with strict allowlists, bounded data, account isolation, atomic revision checks and non-destructive conflict detection. Skills and memory sync; chats, file bodies, project/subject records, edits and workflow checkpoints remain local.
- Project/subject memory accepts local file uploads and Drive copies. Source toggles control retrieval. Local text caches invalidate on edit revision; bounded excerpts preserve source labels and disclose incomplete coverage.
- Site-style illustration animation added to setup and project/subject/workflow empty states. Motion runs at idle, pauses outside the viewport/background, and honors reduced motion and quiet mode.
- Browser fixture verified actual project upload, IndexedDB file persistence, source inclusion in scoped desktop chat, and exclusion from cloud sync payloads. No paid model call was simulated as real inference.

Final verification: 51 automated tests, frontend/server/desktop typechecks, packaged Electron smoke, browser handoff, setup idle/reduced motion, Office round trips, structured export/checkpoint/atomic-save fixtures, desktop revision IPC and local project-source integration passed. Initial site JavaScript remains 71,237 bytes gzip (145,000-byte budget). Production https://mowrai.com is updated; unauthenticated Drive returns 401 and legacy workspace/file uploads return 410. Installer rebuilt at `release/Mowr-Setup-0.2.0-preview.1.exe`.

## September 24 preview 3: admin portal, support inbox and website

- **Admin portal (admin.mowrai.com):** overview metrics, people search with CSV export, person pages (plan, subscriptions, complimentary grants, suspension, staff notes, history), subscriptions, a two-pane support inbox with replies, internal notes, status/priority/assignee and saved replies, announcements, team roles and an append-only audit log. See [ADMIN.md](ADMIN.md). Covered by `tests/desktop/admin-worker.test.ts`. Not yet deployed: the schema, Worker and `admin.mowrai.com` domain need the owner's Cloudflare and Vercel credentials.
- **Desktop:** suspended and offline states now have their own screens instead of falling back to the subscribe step; chat errors explain suspensions. Staff replies and announcements arrive as notices above the account button and in Settings → Help & support, where people can reply. Ctrl K command palette, Ctrl N and Ctrl , shortcuts. Entry motion across views, messages and dialogs respects reduced motion and the quieter-workspace setting.
- **Fixes:** live usage polling no longer starts a Codex app-server process per account every second (reads are capped at one per 10 seconds per account, and polling pauses while the window is hidden); PPTX exports showed a replacement character instead of bullets and numbers; several UI strings contained a replacement character; conversation search results lacked React keys and an empty state.
- **Website:** new landing page with an animated product depiction, feature showcase, pricing and FAQ; a download page with automatic start, install steps, SmartScreen guidance, checksum and troubleshooting; a pricing page with a comparison. Initial JavaScript remains about 72 KB gzip.
- **Installer:** `npm run desktop:installer` now copies the finished EXE, SHA-256 and notes to `Installer/`. Packaging uses the installed Electron runtime (`node_modules/electron/dist`) because antivirus scanning blocked electron-builder's extraction rename on this machine. `Mowr-Setup-0.2.0-preview.3.exe` passed the packaged smoke test; it is unsigned and not yet uploaded.

## September 24 preview 5: visuals for anything, checked answers, spaced review

- **Model-drawn visuals:** any connected model can answer with a `visual` block (plot, diagram or chart). Specs are schema-validated, every expression is compiled by a closed arithmetic parser (no `eval`, unknown names rejected) and drawn by the existing canvas/SVG pen with sliders, readouts, animation, step-through and PNG/SVG/PDF export. `/visual` uses a built-in model when one matches and asks the model otherwise. Drawn visuals join Visuals → Recent.
- **Checked numbers:** `check` blocks are recomputed locally; differences open automatically with the recomputed value. Verified arithmetic only — formula choice is still the model's responsibility, and the UI says so.
- **Second opinion and source check:** per-answer tools stream a review from another connected model, or return claim-by-claim support against the conversation's attached sources. Citations `[[file, p. N]]` open the stored file at the page.
- **Study:** FSRS-4.5 scheduling per card (stored in `StudySet.cards`, carried in subject ZIPs), due/new counts, Again/Hard/Good/Easy with interval previews and keyboard shortcuts, optional exam-date pacing, quiz answers counted as reviews, and repeatedly missed questions passed to subject chats.
- **Screen capture:** global Ctrl+Shift+Space and an in-app button open a sandboxed overlay (static page, two-call preload); the cropped PNG becomes an attachment and is sent to Codex as a temporary local image file deleted after the turn. Claude models refuse image turns with a clear message.
- **File changes:** `edit` blocks show a diff against the current file (read through a scoped IPC call). Apply writes atomically inside a linked folder for the same scope only — no absolute paths, `..`, dotfiles, secret-like names or unsupported types — and records before/after in the protected vault. Undo checks the file hash and refuses if the file changed since. Covered by `tests/desktop/folder-edits.test.ts`.
- **Offline reading:** the offline screen offers read-only access to the local workspace and rechecks the connection every 30 seconds.
- **Chat quality:** KaTeX math, hairline tables, code blocks with language and copy, quiet hover tools, and a Long Task card that matches the website (progress bar, ringed step checks, details on demand).
- **Website:** “See it move” now shows what someone typed and mixes built-in and drawn visuals; feature copy updated; the last section on inner pages no longer touches the footer.
- **Verification:** 41 unit tests (8 new) and 56 desktop tests (3 new) pass; typechecks pass; `verify-standout.mjs` drives streamed visuals, checks, citations, file apply/undo, second opinion, source check, capture attachment and offline reading in a browser fixture; existing UI verifications pass. Live model output quality for visual/check blocks has not been measured across providers; malformed blocks fall back to a readable error.
- **Not done:** code signing (requires purchasing a certificate), Claude image input, and PDF text-layer highlighting of the cited quote (citations open the page).
