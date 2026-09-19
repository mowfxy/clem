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
- The repository is private. Public installer distribution must be configured before the marketing download button can link to a public artifact. No inaccessible private-release URL is advertised as a public download.

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

Final verification: 51 automated tests, frontend/server/desktop typechecks, packaged Electron smoke, browser handoff, setup idle/pause/reduced motion, Office round trips, structured export/checkpoint/atomic-save fixtures, desktop revision IPC and local project-source integration passed. Initial site JavaScript remains 71,237 bytes gzip (145,000-byte budget). Production https://mowrai.com is updated; unauthenticated Drive returns 401 and legacy workspace/file uploads return 410. Installer rebuilt at `release/Mowr-Setup-0.2.0-preview.1.exe`.
