# Mowr

A Windows desktop workspace for conversations, projects, subjects, local files and document drafts. The React interface ships inside the application; Codex connectivity and document tools run on the user's PC. https://mowrai.com is the marketing and account site. Subscriptions cost **$2/month**, purchased inside the app through Lemon Squeezy browser checkout.

This is a **desktop preview**, not a fully verified production release. See [production status](docs/PRODUCTION-STATUS.md) and [desktop architecture and operations](docs/DESKTOP.md) for tested capabilities, security boundaries and remaining work.

## Run on Windows

Use Node 25 and npm. Run `npm ci`, copy `.env.example` to `.env.local`, set the Supabase public URL/key, then run `npm run desktop:dev`.

`npm run desktop:installer` writes the Windows EXE to `release/`. It bundles the official Codex CLI. Sign in, complete setup, and connect ChatGPT from Settings. Owner exemptions are verified server-side; other accounts cannot purchase until Lemon Squeezy is configured. Unsigned previews show Windows publisher warnings.

For the website, run `npm run server` and `npm run dev` separately. Legacy account/file services remain during migration; the website no longer opens the browser workspace.

## Verify changes

```powershell
npm test
npm run test:desktop
npm run typecheck:server
npm run desktop:build
npm run desktop:smoke
node scripts/check-performance-budget.mjs
```

Smoke tests use a temporary profile. Real account authorization, payments and Telegram delivery require user participation and credentials; fixtures do not verify those services.

## Find the code

- `desktop/`: main process, protected storage, authentication, local Codex, folders, memory and Telegram.
- `src/desktop/`: onboarding and desktop controls. `src/App.tsx` retains the workspace design.
- `cloudflare/account-*`: account/entitlement Worker, Lemon Squeezy and additive D1 schema.
- `core/`, `vendor/kinetra/`: shared workflows and deterministic geometry.
- `server/`, `database/`: legacy web services and migrations retained during migration.
- `tests/desktop/`: policy, isolation, memory, folders, messaging and export regression tests.

Generated bundles, installers, credentials and screenshots are ignored. Historical owner-only helper scripts are preserved locally in `.maintainer/archive-2026-09-19/` with a SHA-256 manifest; never deploy that archive.

Font licenses remain in `public/fonts`, and Kinetra's license in `vendor/kinetra/LICENSE`. Support: support@mowrai.com.
