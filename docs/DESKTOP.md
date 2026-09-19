# Desktop architecture and operations

Mowr 0.2 is a Windows desktop preview. Electron loads the bundled React/Vite interface from `mowr://app`, not a remote workspace. Node tools run in the main process. The sandboxed renderer has no Node access and uses a validated, allowlisted IPC contract. Native Windows window controls, editing shortcuts, resizing, downloads, drag/drop, and folder dialogs retain the existing workspace design.

## Module boundaries

| Path | Responsibility |
| --- | --- |
| `desktop/main.ts` | Composition root, application lifecycle, validated dispatch |
| `desktop/contracts.ts` | Renderer/main request schemas and bridge contract |
| `desktop/auth.ts`, `vault.ts` | Supabase client in main; DPAPI-protected session storage; no plaintext fallback |
| `desktop/codex.ts` | Bundled official Codex CLI, account-specific homes, ChatGPT-only authentication, cancellation and timeout |
| `desktop/folders.ts` | Native grants, incremental bounded text index, ignored paths and scoped retrieval |
| `desktop/memory.ts` | Provenance, confirmation, corrections, supersession, explicit sharing, deletion and retrieval |
| `desktop/messaging/` | Telegram private-chat pairing, polling, validated attachments, delivery |
| `src/desktop/` | Guided setup, account security, local connection and memory controls |
| `cloudflare/account-worker.js` | Verified identity, unique username, saved setup, entitlement and Lemon Squeezy |
| `cloudflare/account-schema.sql` | Additive D1 schema; independent of legacy workspace tables |
| `server/` | Legacy web services retained for existing accounts; not the desktop execution runtime |

Electron was selected to reuse the React design and Node document/CLI tooling. The renderer is packaged locally. `@vercel/sandbox` remains only in the legacy web implementation; desktop code never imports it. No paid infrastructure was provisioned.

## Build and test

Use Node 25 and npm. On Windows:

```powershell
npm ci
npm run desktop:build
npm run desktop:dev
npm run desktop:smoke
npm run desktop:installer
```

The NSIS installer is written to `release/Mowr-Setup-0.2.0-preview.1.exe`. `desktop-package/` is a generated staging tree with no server dependency requirement. The installer bundles the pinned official Codex Windows binaries. `desktop:dev` rebuilds before opening. Test the packaged binary with `MOWR_SMOKE_PACKAGED=1` when running `desktop:smoke`.

Checks: `npm test`, `npm run test:desktop`, `npm run typecheck:server`, `npx tsc -p desktop/tsconfig.json`, `npm run build`, and `node scripts/check-performance-budget.mjs`.

Publisher metadata is **Mowr Ai**. Unsigned previews produce Windows unknown-publisher/SmartScreen warnings. Supply `CSC_LINK` and `CSC_KEY_PASSWORD` using a secure build environment to sign, and set `MOWR_REQUIRE_SIGNING=true` to make missing signing fail the build. Never commit certificates. Verify the result with `Get-AuthenticodeSignature`; build log text about invoking signtool is not proof of a signature.

## Accounts and purchase

Flow: download → install → sign in/create account → username → display name → memory preference → plan → secure browser checkout → workspace. Setup is saved server-side; partial checkout never sets a local paid flag. Reopening fetches entitlement again. Offline generation fails closed. The current preview requires connectivity to enter the workspace; offline viewing is not yet implemented.

Supabase verifies passwords and email. Main-process auth storage uses Windows DPAPI; Codex is configured for keyring credentials and forced ChatGPT login, with no API-key environment inherited. Separate Mowr users receive separate Codex homes. Google authentication uses the standalone website sign-in page with Supabase PKCE. Configure the Supabase redirect allowlist for `https://mowrai.com/`. The authenticated page submits tokens to the one-time desktop loopback receiver; the Google OAuth client itself uses the Supabase hosted callback. Authenticator challenges, enrollment/removal, password/email changes, other-session revocation and password-verified Google unlinking have UI and main-process handlers. Google linking for an already signed-in user remains to be finished. Existing access-token revocation follows Supabase expiry; strict immediate access-token revocation is not claimed.

The owner exemption is assigned only after the Worker independently retrieves a verified Supabase user whose current email is allowlisted and has no pending email change. The grant is persisted against immutable user ID and remains a payment exemption, not an administrator role. A different user adopting an unverified email cannot acquire it.

### Lemon Squeezy configuration

The deployed account endpoint is `https://mowr-accounts.mohamed-khaled011008.workers.dev`. Configure Worker secrets `LEMON_API_KEY` and `LEMON_WEBHOOK_SECRET`; set `LEMON_STORE_ID`, `LEMON_VARIANT_ID`, and `LEMON_TEST_MODE`. Start in test mode. The store must use USD, and the chosen variant must be a recurring one-month subscription priced at 200 cents. The server verifies these conditions before creating checkout.

Webhook URL: `/webhooks/lemon`. Subscribe to subscription events. Signatures are checked over the raw body, then current subscription state is retrieved directly from Lemon Squeezy. Server-created checkout IDs bind purchases to authenticated user IDs. Updates are timestamp guarded; cancelled subscriptions retain access only through their paid end date. Payment failures, expiry, unknown purchases and wrong product/environment never grant access. Checkout returns to the website's desktop-return page; users return to the app and it rechecks the server. Deep-link activation and renewal/customer-portal actions remain incomplete.

API keys, checkout and real paid inference have not been tested with customer accounts. The Lemon Squeezy key is intentionally deferred by the owner. Payment processing fees remain third-party costs; no purchase was made.

## Local context and memory

Folders belong to explicit `chat:`, `project:` or `subject:` scopes. Native selection is the only path grant. The index skips symlinks, dotfiles, known generated directories and secret-like filenames, and applies inherited `.gitignore` / `.mowrignore` rules. It bounds depth, entries, individual files and total text. It detects deleted files by rebuilding the bounded manifest while reusing unchanged content. Windows hidden attributes beyond dotfiles and TOCTOU-resistant file handles still need hardening before broad filesystem access is enabled. No model-controlled write/move/delete tool is exposed.

Memory stores source identifiers, locators, timestamps, confirmation, category, uncertainty, supersession and derived relationships. Retrieval is scope-filtered and budgeted, with exact matching and optional supplied-vector similarity. There is no installed local embedding model yet; runtime retrieval is lexical. Only explicit user entries are promoted to confirmed memory; imported documents cannot silently become trusted facts. Deletion cascades through derived records, and does not revive superseded claims. Data is encrypted in the main-process vault. Workspace files/chats still use the existing local IndexedDB store. Synchronization is not enabled.

The tests are correctness fixtures, not a state-of-the-art accuracy benchmark. Automatic incremental memory extraction, a larger labeled relevance/fidelity corpus, resumable multi-step job execution, filesystem mutation review/undo and full offline operation remain open work.

## Telegram

WhatsApp was removed at the owner's request. Create a bot using official BotFather, enter its token in the desktop Telegram panel, then send the expiring `/start` code to that bot in a private chat. The token is DPAPI-protected. Pairing binds both sender and chat IDs to the selected scope. Disconnect deletes the saved token. One bot connection per Mowr account/device is supported in this preview.

The desktop polls the official Bot API; no public local server, tunnel or cloud execution is needed. Telegram retains unconsumed updates for no longer than 24 hours. While the PC is asleep, offline or Mowr is closed, the agent does not process messages. Messages beyond Telegram retention can be lost. Duplicate update IDs are persisted before execution; uncertain completions are not automatically replayed. Explicit retry is required after interruption.

Text, JPEG/PNG, PDF, DOCX and text attachments are accepted with a 20 MB application ceiling, magic-byte checks and bounded extraction. Images go to Codex's supported image input; PDF/DOCX extraction uses local renderer tools. `/pdf` generates a paginated selectable-text PDF reply. The basic PDF exporter rejects unsupported Unicode and overlong words rather than silently corrupting them. Outgoing generated images and rich illustrated PDF composition remain unfinished. Real bot delivery awaits credentials and an authenticated provider account.

## Sources checked

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-basic)
- [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Lemon Squeezy checkout](https://docs.lemonsqueezy.com/api/checkouts/create-checkout)
- [Lemon Squeezy webhooks](https://docs.lemonsqueezy.com/guides/developer-guide/webhooks)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Grok Build enterprise authentication](https://docs.x.ai/build/enterprise)

Grok Build's official CLI supports subscription authentication, but its credential behavior and complete subscribed inference have not been verified in this desktop runtime. It remains disabled; no paid API substitute is used.

## Browser sign-in and window chrome

Desktop sign-in uses the website for email, Google and MFA. A five-minute, single-use loopback receiver accepts a bounded form POST only from https://mowrai.com at a random callback path. The main process verifies the user, persists the session in the Windows-protected vault, and focuses the app. Credentials never enter the desktop renderer. Interrupted attempts can be restarted with Open browser again. The website preserves the callback in tab-scoped session storage across OAuth redirects.

The window uses Electron hidden-title-bar overlay with native minimize, maximize/restore and close controls over the app background. The application menu is removed; the header remains draggable.

## Storage contract (20 September 2026)

| Data | Authoritative storage | Cloud behavior |
| --- | --- | --- |
| Chats, projects, subjects, attachments, Office/PDF edits, workflow checkpoints | Account-separated local IndexedDB | Never uploaded as workspace records |
| Extracted source text | Local cache keyed by account/file/edit revision | Only selected excerpts sent to the model for an explicit request |
| Skills, confirmed memories, explicitly entered memory notes | Local copies with Cloudflare D1 sync | Strict schemas, bounded payloads, revision compare-and-swap and three-way merge |
| Authentication, setup, entitlement, encrypted Drive grant | Supabase identity / Cloudflare essential records | Necessary account and connector services |

The three sync collections are `skills`, `memory` and `notes`. Notes contain only an opaque scope identifier and user-entered memory text; no project names, chats, source documents or file lists. Unmatched scope notes stay in the local sync cache so a second device cannot accidentally erase them. Conflicting edits are reported and kept locally, not silently overwritten. Offline changes stay local and retry on the next sync or restart; no guarantee of immediate cross-device refresh is made.

`core/sync.ts` owns payload validation and merge behavior. `desktop/essential-sync.ts` owns authenticated, serialized sync. `src/essential-state.ts` builds the minimal renderer payload. `src/source-context.ts` caches local text and `core/source-context.ts` selects bounded, labelled excerpts. The desktop cannot invoke whole-workspace upload. Legacy server upload routes return 410 unless an operator explicitly enables migration-only `MOWR_LEGACY_WORKSPACE=true`.

Project and subject details allow adding local files, importing a Drive copy, opening documents and toggling which files participate as memory sources. These use the same local file store and scoped retrieval. Memory sources are documents, not automatically confirmed facts.

Cloudflare migration: apply `cloudflare/sync-schema.sql` to the existing D1 database, then deploy `cloudflare/account.wrangler.jsonc`. The public Supabase URL/key are explicit bindings in config so a CLI deployment cannot omit them; credentials remain secrets. Existing legacy tables are retained for migration safety. Read-only production counts on 20 September found zero legacy workspace, file and scope records.

Decorative app illustrations run a restrained idle cycle without hover, stop offscreen/when hidden, and respect system reduced motion and the existing quiet-workspace setting. There are no illustration playback buttons.
