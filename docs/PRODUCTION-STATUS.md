# Production status — 19 September 2026

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

- Final checks: 37 automated tests passed, frontend/server/desktop typechecks passed, and DOCX/PPTX/XLSX browser round-trip checks passed. Packaged desktop smoke passed again after dependency cleanup.
- Marketing deployed to https://mowrai.com. The application archive contains 52 entries and no production node_modules tree; bundled main-process dependencies keep the archive approximately 7.5 MB.
- Baseline: 19 existing tests, frontend build and server typecheck passed before migration.
- Desktop policy tests cover identity/username races, owner verification, payment states, MAC validation, memory scope isolation/deletion, folders, IPC schemas and Telegram pairing.
- Actual packaged EXE launched under a temporary profile. Smoke verified local UI, no renderer Node access or auth storage, sign-in/signup navigation, reduced motion, local Kinetra calculations and rejected unsupported IPC.
- Windows Authenticode check reports **NotSigned**. The installer is an unsigned preview. No certificate or paid resource was purchased.
- Account Worker `/entitlement` rejects unauthenticated requests with HTTP 401.
- Initial JavaScript: approximately 71 KB gzip versus approximately 100 KB before migration; build evidence only, not field Core Web Vitals.
- Production environment inventory still lacks app SMTP password and Google Drive OAuth credentials. No secret values were printed or copied into the desktop renderer.

## Not yet verified / unfinished

- Full real-account desktop sign-in, delivered reset email, Google callback allowlist, Google linking and subscription inference require live end-to-end verification. Authenticated account testing has not been simulated as success.
- Lemon Squeezy real/test checkout, webhook delivery, customer portal/renewals and direct app return need configuration and verification. Owner asked to provide the key later.
- Telegram delivery requires the user's bot token and provider authorization. Outgoing generated images and richer document formatting are not finished.
- Grok Build official subscription protocol was investigated; desktop integration remains disabled pending secure credential behavior and inference verification.
- No paid embedding model or local semantic model installed. Automatic memory extraction, large relevance/fidelity benchmark, durable multi-step resume, folder file-operation review/undo, broad diagram types and full professional Office/PDF editing remain incomplete.
- Folder indexing applies ignore rules, skips symlinks/dotfiles/secret-like names and bounds work. Windows hidden attributes and stronger race-resistant file access remain hardening work.
- Current desktop requires an online entitlement check to open the workspace; offline read-only access remains unfinished.
- The repository is private. Public installer distribution must be configured before the marketing download button can link to a public artifact. No inaccessible private-release URL is advertised as a public download.

See [DESKTOP.md](DESKTOP.md) for setup, module responsibilities, provider sources and migration boundaries. Legacy web runtime remains for existing accounts and must be retired after account/data migration, not deleted prematurely.
