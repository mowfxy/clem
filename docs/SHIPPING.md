# Shipping readiness — 20 September 2026

The current build is a Windows preview, not a verified public release.

## Connect Codex

In Mowr: Settings → Models → Connect a model → Connect subscription. Enable device code login in ChatGPT Security (or workspace permissions), open the provider sign-in link, and enter the displayed one-time code. Mowr polls for successful authorization and refreshes the model connection. The official Codex CLI is bundled; no OpenAI API key is needed for this subscription flow. Credentials are kept in the Windows credential store with an account-specific Codex home. Provider usage limits apply.

Official reference: https://learn.chatgpt.com/docs/auth

This flow is implemented, but a real user's authorization and subsequent inference have not been verified in this task. Do not label fixture responses as successful inference.

## Public release blockers

- Exercise a clean-machine install, sign-in, password reset, MFA, Codex authorization and a real streamed answer; confirm cancellation, expired login, usage-limit errors and relaunch persistence.
- Verify live Google Drive consent and DOCX/XLSX/PPTX import with a non-owner account. Confirm consent-screen publishing/allowlists. Legacy email-MFA accounts still require a scoped proof handoff for desktop Drive.
- Verify Telegram pairing and delivery with a real bot; verify support/reset email delivery.
- Sign the Windows executable/installer, publish it at a public download URL, and establish a tested update and rollback process. The GitHub repository is private; private artifacts are not public downloads.
- Configure and test Lemon Squeezy checkout, webhook, renewals and portal before a paid launch. Payments remain deferred at the owner's request; non-exempt accounts still require entitlement.
- Finish offline workspace access. The startup entitlement check still needs a connection.
- Provide a full local backup/restore path including file contents. Current JSON export contains metadata/text, not all blobs. Confirm uninstall/update behavior and storage-full recovery.
- Complete folder access hardening (Windows hidden-file attributes and race-resistant reads), and test large local files under memory pressure. There is no Mowr storage/upload quota now, but disk capacity, browser storage and document parsers have practical limits.

## Explicit preview limitations

Grok is disabled. PDF edits are annotations, not full page-layout editing. Memory retrieval is primarily lexical and has not passed a broad relevance benchmark. Sync conflicts preserve data but still need a resolution UI. These should be documented or completed before promising those capabilities.

## Current UI verification

Desktop-sized browser fixture checks default workspace routing, complete sidebar visibility, no new-chat overflow, compact settings, modal password action through mocked IPC, keyboard dismissal, profile selection, removal of scope selectors, styled dropdown semantics, Drive dialog and narrow-screen overflow. Unit and desktop tests cover data/security contracts. Live provider and Google account flows remain separate verification tasks.
