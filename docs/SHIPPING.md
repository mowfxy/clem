# Shipping readiness — 20 September 2026

The current build is a Windows preview, not a verified public release.

## Connect Codex

In Clem: Settings → Models → Connect account (or Add account) → Continue with ChatGPT. Enable device code login in ChatGPT Security (or workspace permissions), open the provider sign-in link, and enter the displayed one-time code. Clem polls for successful authorization and refreshes the model connection. The official Codex CLI is bundled; no OpenAI API key is needed for this subscription flow. Credentials are kept in the Windows credential store with an account-specific Codex home. Provider usage limits apply.

Official reference: https://learn.chatgpt.com/docs/auth

This flow is implemented, but a real user's authorization and subsequent inference have not been verified in this task. Do not label fixture responses as successful inference.

## Public release blockers

- Exercise a clean-machine install, sign-in, password reset, MFA, Codex authorization and a real streamed answer; confirm cancellation, expired login, usage-limit errors and relaunch persistence.
- Verify live Google Drive consent and DOCX/XLSX/PPTX import with a non-owner account. Confirm consent-screen publishing/allowlists. Legacy email-MFA accounts still require a scoped proof handoff for desktop Drive.
- Verify support/reset email delivery.
- Sign the Windows executable/installer and establish a tested update and rollback process. The unsigned preview has a public installer download; the source is public under the MIT License.
- Configure and test Lemon Squeezy checkout, webhook, renewals and portal before a paid launch. Payments remain deferred at the owner's request; non-exempt accounts still require entitlement.
- Finish offline workspace access. The startup entitlement check still needs a connection.
- Subject ZIP export/import now includes chats, source files, document edits, quizzes, flashcards and attempt history. Workspace-wide JSON still excludes file contents. Verify the Documents migration and keep/delete uninstall choices on a clean Windows machine, plus storage-full recovery.
- Complete folder access hardening (Windows hidden-file attributes and race-resistant reads), and test large local files under memory pressure. There is no Clem storage/upload quota now, but disk capacity, browser storage and document parsers have practical limits.

## Explicit preview limitations

Grok is disabled. PDF edits are annotations, not full page-layout editing. Memory retrieval is primarily lexical and has not passed a broad relevance benchmark. Sync conflicts preserve data but still need a resolution UI. These should be documented or completed before promising those capabilities.

## Current UI verification

Desktop-sized browser fixture checks default workspace routing, complete sidebar visibility, no new-chat overflow, compact settings, modal password action through mocked IPC, keyboard dismissal, profile selection, removal of scope selectors, styled dropdown semantics, Drive dialog and narrow-screen overflow. Unit and desktop tests cover data/security contracts. Live provider and Google account flows remain separate verification tasks.

## September 20 local-first update

- Sidebar fills the window height; the draggable titlebar begins alongside it. Memory and automations have illustrated cards; sessions/privacy use consistent action rows.
- Renderer storage lives under the Windows Documents known folder in `Clem/Local data`. Readable account snapshots and source blobs live under `Clem/Accounts/<account>/`. The first launch copies existing renderer storage before opening Chromium. Original AppData copies are retained as migration fallback; protected authentication remains in AppData.
- Uninstall keeps data by default. Interactive uninstall offers explicit permanent removal of Documents/Clem and protected AppData; cancellation, silent uninstall and updates do not opt in. This is compiled but still requires a clean-machine lifecycle test.
- Subjects support generated quizzes and flashcards, saved attempt scores, ZIP sharing/import with fresh identifiers, and deletion of owned files, chats, sets, workflow checkpoints and source indexes. ZIP processing has a 250 MB archive / 500 MB expanded safety ceiling; this is not a local storage quota. Archives may contain private course context and conversations: share intentionally.
- Memory chat edits the displayed summary and existing confirmed facts, with stale-write detection on facts. Source text is not overwritten by memory changes. Selected model context still needs real-world relevance testing.
- Desktop automations are daily/weekly prompts run by the signed-in local app using the selected Codex model. They consume subscription allowance. The computer must be awake and the app open. A missed slot runs once on return; the next slot is claimed before inference to avoid automatic duplicate spending after a crash. If a crash interrupts a claimed slot, that slot is not retried automatically. Results are local chats; there is no server URL setup or background Windows service.
- New/edited PDF, Office, Markdown, SVG and LaTeX exports carry an invisible versioned SHA-256 marker. Original source downloads remain unchanged. The public checker operates entirely in the browser; it finds markers and checks marked bytes, not authorship. Markers are unsigned, forgeable and removable. Re-exporting can remove them; existing old exports are not retroactively marked.
- Attached templates/examples can guide structure and style when explicitly requested. Office element editing preserves the source archive. General generated-document exports do not guarantee pixel-identical template reproduction.

Automated coverage includes provenance/alteration checks, readable marked PDFs/Office ZIPs, archive validation, account-isolated disk persistence, subject generation and scoring, ZIP transfer, memory editing, a due automation producing one saved chat, compact settings and sidebar layout. Browser model/IPC flows are fixtures, not live subscription evidence.

The existing signed-in Windows profile was migrated successfully: its saved chat remained available and the sidebar began at y=0. The protected Chromium key is copied before Electron initializes; its encrypted-key migration also has an isolated regression check. Code signing and a full install/uninstall lifecycle on a clean machine remain outstanding.
## September 20 preview 2: accounts, usage and downloads

- Models settings supports separate ChatGPT account profiles, protected by the official Codex OS keyring using distinct local homes. Existing default credentials remain in their original location. The active account is explicit; Clem does not rotate accounts automatically when limits are reached.
- Account usage comes from the bundled Codex app-server `account/rateLimits/read` response. Multiple limit buckets, percentage remaining and reset times are shown when supplied. Missing usage is unavailable, never zero. Reads are cached for one minute; a completed generation invalidates the account snapshot. Checking usage does not run a model.
- Context budgeting preserves system instructions, the latest user request and attached evidence. Recent history is bounded with an explicit omission notice. Retrieval uses the actual question rather than the appended file excerpt. No model-based summary call is added. Existing workflow checkpoints skip completed steps and no automatic inference retries are introduced. These are engineering safeguards, not measured claims of lower account usage or guaranteed output quality.
- The memory card reuses the approved connected-shapes drawing. Automation has a matching recurring-task scene. Both use the website's contour-redraw idle and respect reduced motion and offscreen suspension. The checker has a custom local file chooser and drag/drop.
- Windows preview installers are published separately at https://github.com/mowafymxis/clem-releases. `/download/windows` redirects directly to the versioned executable. The application source repository stays private. Preview 2 is unsigned.
- Account RPC parsing, caching, owner isolation, persisted selection, busy-task switching, context preservation, usage rendering and connection dialogs have automated coverage. Actual multiple-account authorization and inference still need live verification. Public release still needs signing, update/rollback lifecycle verification, live connectors, and offline startup work.

Preview 2 verification: 32 core/integration tests and 31 desktop tests passed, as did browser settings, animation/reduced-motion, checker, model/workflow, packaged smoke and encrypted migration checks. The live homepage button initiated an executable download with the expected filename. GitHub's published asset SHA-256 matches the local installer. A complete browser re-download stalled on this machine's connection and was cancelled; it is not recorded as a completed transfer.
