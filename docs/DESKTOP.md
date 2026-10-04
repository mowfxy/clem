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

The NSIS installer is written to `release/Mowr-Setup-0.2.0-preview.2.exe`. `desktop-package/` is a generated staging tree with no server dependency requirement. The installer bundles the pinned official Codex Windows binaries. `desktop:dev` rebuilds before opening. Test the packaged binary with `MOWR_SMOKE_PACKAGED=1` when running `desktop:smoke`.

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

Facts about the person themselves live in a global `user:me` scope and apply in every chat, project and subject; space facts stay in their space. After a reply, if the message says something about the user (a cheap pattern gate), a lowest-effort background pass on the warm Codex connection extracts at most four durable facts or preferences. They are stored unconfirmed ("Learned") until the person keeps or forgets them in Memory; "remember that…" is saved as confirmed. A newer learned item with the same key replaces the older one. Retrieval always includes profile facts and confirmed preferences, then ranks the rest by stemmed overlap, confirmation and recency, and the model sees compact lines with dates rather than JSON records.

The tests are correctness fixtures, not a state-of-the-art accuracy benchmark. A larger labeled relevance/fidelity corpus, resumable multi-step job execution, filesystem mutation review/undo and full offline operation remain open work.

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
# Connection recovery and textbook diagrams

ChatGPT device sign-in keeps its pending challenge for up to 15 minutes. Settings can resume or retry the same account slot. Completion invalidates account/model caches; a usage-service timeout does not erase a confirmed account. Post-challenge failures appear in the recovery card. Browser authorization alone does not establish that credentials were saved locally; verify that Models shows a connected account and synchronized models.

`scripts/build-kinetra.mjs` packages all six full vendored Kinetra skill guides and the callable module API references. Every desktop Codex model receives a short tool catalog; guides are loaded on demand. A bounded structured tool loop executes deterministic calculations in a worker with a five-second timeout and memory budget. PDF requests can embed actual computed SVG figures through Chromium print-to-PDF, with local file attachments and provenance metadata. Kinetra's upstream placeholder `addFigure` implementation is not used. The Visuals page has no sample gallery. Its interactive projectile explorer continues to use Three.js and Kinetra trajectory calculations.

Full Kinetra instructions, including verified figure recipes (`desktop/kinetra-recipes.ts`, each rendered in tests), are sent only when a request looks like it needs calculations, figures or documents; other messages get a one-line pointer and the model can ask for `help`. API references are TypeScript declarations only. PDF sections accept Markdown and `$…$`/`$$…$$` math (MathML), every figure is rendered and checked before layout with all failures reported together, and each figure is labelled with the Kinetra function that computed it. `mowr.plot` and `mowr.logicDiagram` adapt plain expressions; see `vendor/kinetra/MOWR_PATCHES.md` for parser and plot repairs. Only the registered JSON-compatible pure APIs are executable: upstream CLI, arbitrary JavaScript functions, database classes and external tools described by guides are not exposed. Tool exchanges are limited to twelve calls and a bounded context. Live provider sign-in and model-generated document quality still require an authenticated end-to-end check.

### Response streaming and chat preferences

Chat turns share one warm `codex app-server` connection per account (`desktop/app-server.ts`), started ahead of the first message and closed after ten idle minutes; each message gets its own ephemeral, read-only thread, and Kinetra tool results continue that thread instead of resending the whole context. Cancelling sends `turn/interrupt` (the connection is recycled if the provider does not stop within 1.5 s). The signed-in user is re-verified at most once a minute per access token (security actions always verify), an active entitlement is reused for five minutes, and folder retrieval, memory and entitlement load in parallel. Prompts are plain tagged sections (`desktop/prompt.ts`) rather than JSON. Chat turns use the app-server's incremental agent-message events. Mowr supplies conversational instructions, disables shell execution and web search, and rejects tool approval requests; Kinetra remains the explicitly bounded document/calculation interface. Potential Kinetra JSON envelopes are held internally while ordinary prose streams immediately. The renderer receives one final completion, without duplicated full-text replies. Higher selected reasoning levels can still delay the provider's first token.

Each local chat stores its selected model and reasoning level. Switching chats restores that selection; refreshing the account catalog does not silently replace it. Older chats without selection metadata adopt the current choice when next used. Subject archives preserve these optional fields.

### Email delivery boundaries

Desktop Contact us uses validated IPC and a main-process HTTPS request to the existing website support endpoint, with the current Supabase session and no credential access in the renderer. Redirects are rejected. Existing server email-MFA checks remain enforced; users requiring that browser verification receive a browser/direct-email fallback. Drafts remain after failure and uncertain timeouts are never retried automatically. SMTP acceptance is submission, not confirmed inbox delivery; the legacy support `delivered` database column records SMTP submission only.

Signup, recovery and email-change messages come from Supabase Auth. Website support and email-code messages are sent by the server. Both paths use the same SMTP provider and sender: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env.local`, synchronize those values to the deployed server with `scripts/sync-env.mjs`, and run `node scripts/configure-supabase.mjs` with `SUPABASE_ACCESS_TOKEN` set to apply the same provider to Supabase Auth. The configuration script fails if SMTP is incomplete and reads back the saved nonsecret settings. Supabase's default email service is not suitable for production delivery. A local missing secret does not establish whether production is configured; verify the deployed server environment and Supabase Auth settings before relying on email delivery.

The automation, support-acknowledgement and deletion HTML files are template assets, not proof of active notification flows. Do not advertise automatic emails for these without implementing the corresponding verified event and delivery flow. Live inbox delivery and bounce handling have not been verified by the mocked support tests.

## Files the AI makes, and what it sees (4 October 2026)

File actions (`desktop/file-maker.ts`, guides in `desktop/file-guides.ts`): `pdf`, `docx` (same specification as pdf; native Word equations from LaTeX via `desktop/docx-math.ts`), `pptx` (`desktop/pptx-deck.ts`: a design derived per deck from its archetype, subject and brand, twenty-six layouts, icons, generated art, native charts, tables and diagrams, speaker notes, and a rendered self-review; see below), `xlsx` (`desktop/xlsx-workbook.ts`: live formulas with `{row}`/`{first}`/`{last}` placeholders, formats, totals, native charts), `file` (any text format; programs Windows would run are refused) and `image` (Kinetra figure or SVG as PNG/SVG). Figures and fallback equations are drawn by an offscreen Chromium page (`desktop/rasterize.ts`). Every action takes `revise`; pdf, docx, pptx and xlsx take `append`.

Delivery: files made or changed during an answer are held in the main process and sent to the window once, just before the answer completes, as a card on the reply; nothing opens until the person clicks it. Within one answer, any number of model revisions of a file count as one version (one Undo step); a file the answer created has no version at all. Stopping an answer deletes the files it made and restores files it changed. A failed answer still delivers the files finished before the failure.

Vision (`src/desktop/page-images.ts`): each message sends up to 16 pictures: attached images (re-encoded to at most 1600 px), PDF pages the message names, whole short or scanned PDFs, the pages of longer PDFs that draw something (embedded images or many path operations), and pictures inside Word/PowerPoint/Excel files; files from earlier in the chat get what is left. The prompt lists what each picture is. The model can ask for more pages with `{"action":"look","file","pages"}`; the window draws them and they go with the model's next message.

Checks: `tests/desktop/files.test.ts`; `node scripts/verify/office-files.mjs <dir>` writes one sample of every file type (open them in Office to inspect); `node scripts/verify/page-images.mjs <file.pdf> [file.docx]` prints which pictures a message would carry.

**Decks designed for their talk** (`desktop/pptx-deck.ts`, `deck-design.ts`, `deck-art.ts`, `deck-review.ts`; skill in `file-guides.ts`). A deck carries a `brief` (audience, purpose, message, tone, minutes), an `archetype` (lecture, defence, research, pitch, report, status, workshop, training, kids, keynote, story, sales, portfolio; inferred from the title and brief when left out) and an optional `brand`. The archetype sets the storyline the skill asks for and the visual language (cover, decoration, generated art, icon style, type scale, density, palette harmony); the palette is derived from the brand colours, else from a hue for the subject, else from hues that suit the archetype, with a seed from the title, so the same deck always looks the same and two decks on different subjects do not. Fonts come from the brand, else a pair chosen for the archetype (installed Windows/Office fonts only, never Mowr's own). Text is forced readable: body 7:1, muted text and the main accent 4.5:1, other accents 3:1. The ten presets remain as starting points. Twenty-six layouts, including statement, big-number, before-after, matrix (2×2, with plotted points for competitor maps), roadmap (with "now"), team, icons (a set of 75 outline icons), image (a Kinetra figure, the model's own SVG illustration, generated art or a large icon, half- or full-bleed) and native editable diagrams (cycle, hub, pyramid, funnel, venn, layers). Generated art (orbits, waves, blocks, contours, confetti, grid, rays, leaves, stripes) is seeded per deck and slot and drawn with the icons in one batched page capture (`rasterize.ts` `many`).

Every deck is reviewed before delivery: each element is recorded as it is drawn, the slides are laid out again in a hidden Chromium page with the same fonts, text that overflows its box is measured and shrunk (two correction passes at most), and what remains is reported in the result's `review` with the story checks (topic-label titles, text runs, repeated layouts, missing opening, ending, sections or notes, pacing against `brief.minutes`), contrast, text off the slide, overlapping text and crowded slides. In the chat, contact sheets of the slides go back to the model as pictures with the result so it can look at the deck and revise it before answering (Telegram replies skip the pictures). Inline `$…$` on slides follows Pandoc's rule, so "$1.2M" and "$5 and $10" stay money (`deck-text.ts`). Single-series charts use one colour and horizontal bar charts read top to bottom.

Hardening (4 October 2026): Stop waits for file work still running before it restores files (`desktop/inflight.ts`), so a draft finishing late cannot overwrite the restored file or be left behind. A Claude or Grok CLI that rejects `--session-id`/`--resume` is remembered and the tool loop falls back to resending everything from the first step on; without a session only the newest twelve looked-at pictures are resent. SVG drawings may not reach outside themselves (`desktop/svg-safety.ts`: remote, local-path and `file:` links, `url()`, `@import`, entities, embedded documents), and the drawing page has a no-network Content-Security-Policy. Workbook formulas are calculated top to bottom (long running balances no longer overflow the stack) and a function the viewer does not know leaves no cached `#NAME?`. Telegram replies merge appended references and finish a planned document or deck before replying; `"revise": null` makes a new file. A whole chat sent for condensing is capped at 60 million characters, newest first. The window's "look" reads the current file list rather than the one from when the message was sent. Two committed regexes held a literal backspace where `\b` was meant (the site's `?start` download link, and a Kinetra intent pattern); they are fixed. A PDF's picture survey stops after eight seconds (the model can still look at any page) and stops at once when the answer is stopped.

Checks: `tests/desktop/hardening.test.ts` (no Electron), `tests/desktop/deck-render.test.ts` (draws three context decks in Electron). `node scripts/verify/office-files.mjs <dir>` also writes the context decks of `scripts/verify/deck-samples.ts` (lecture, pitch, board report, kids' lesson, thesis defence, workshop, brand-led sales deck, keynote) with the contact sheets the model sees; `MOWR_ONLY=context-` limits it to them.

## Previews, export, long chats, tool sessions, HEIC and Telegram files (4 October 2026)

**Office previews** (`src/office-preview/`, drawn by `FilePanel`): Word, PowerPoint and Excel files are drawn from their own bytes, with no Office installed and nothing uploaded. Slides (`pptx.tsx`) resolve placeholders through layout and master, shape styles, table styles, groups, pictures and native charts (`chart.tsx`); Word pages (`docx.tsx`) resolve styles, numbering, footnotes, headers and footers with page numbers, columns, pictures and OMML equations (as MathML, `omml.ts`), and are paginated by measuring each block; sheets (`xlsx.tsx`) show number formats, fonts, fills, borders, merges, frozen rows and charts, with every formula calculated by `core/xlsx-formulas.ts` (arithmetic, ranges, cross-sheet references and about sixty common functions; a function it does not know keeps the result the file saved). Number formats come from `core/numfmt.ts`. Mowr's own workbooks also carry each formula's calculated value. Because previews read the file, an edit made in the panel shows at once and Undo works as before; a file that cannot be drawn falls back to the text view. Pagination is approximate (Word's own line breaking differs by a few lines); slide and sheet conditional formatting, gradients beyond the first stop, WMF/EMF pictures and shape effects are not drawn. Check: `node scripts/verify/office-preview.mjs <file> <out dir>` writes each slide, page or sheet as a PNG; `tests/desktop/office-preview.test.ts` runs it in Electron.

**Export** (Export → Word / PowerPoint under an answer): the `documentExport` action builds the answer with the same builders as the AI's own files (`wordDocument(markdownDocument(…))`, `powerpointDeck(markdownDeck(…))`). `desktop/markdown-deck.ts` chooses layouts from the content (tables, stats, cards, process, equation, figure slides from ` ```visual ` blocks), puts prose that does not fit in the speaker notes and picks one of the ten designs from the subject. The browser build keeps the old builders in `src/document-export.ts`. Check: `node scripts/verify/export-answer.mjs <out dir> [answer.md]`.

**Long chats never stop** (`desktop/chat-condense.ts`): a chat that fits is sent word for word. Once it would have to be shortened, the older turns become one brief written by the person's own AI with the `/compact` instruction; the newest turns stay verbatim. The brief is cached per chat in the vault (`chat-briefs-<user>`), covers a fingerprinted prefix of the chat and is extended only when the turns since it exceed a quarter of the room, so most messages cost no extra request. If the AI cannot write it, the free outline shortening of `core/chat-context.ts` is used. The reply carries a note ("Older messages … were condensed"). The window now sends the whole chat (up to 2000 messages) instead of pre-shortening it.

**Claude and Grok tool steps keep their session** (`desktop/claude.ts`, `grok.ts`, `kinetra-turn.ts`): the first step starts a CLI session (`--session-id`), later steps resume it (`--resume`) and send only the new tool results; if the CLI no longer has the session, the loop falls back to resending everything. Session files are removed when the answer ends. On a 12-part document task the characters sent drop from about 280,000 to 24,000 (11.5×; `tests/desktop/kinetra.test.ts` prints the numbers). The flags are those documented by Anthropic and xAI; they could not be run against the real CLIs here (neither is installed on the build PC).

**HEIC photos** (`src/desktop/heic.ts`, `heic-worker.ts`): converted to JPEG when attached (and when an older stored one is read for the AI), in a worker running libheif (LGPL-3.0, unmodified, as its own `.wasm`; see `THIRD-PARTY-NOTICES.md`). The worker has its own Content-Security-Policy (`desktop/csp.ts`). A failure names the photo and says to export it as JPEG. Check: `node scripts/verify/heic.mjs <photo.heic>`.

**Telegram files** (`desktop/reply-files.ts`): a reply carries up to 10 files (20 MB each, 60 MB together). `revise` with the id from the result corrects a file made in the same reply; `append` continues one; pictures from the `image` action that Telegram accepts (PNG/JPEG, within its size and shape limits) are sent as photos, everything else as documents, in the order made. A file that fails to send is named, and the others still go.
