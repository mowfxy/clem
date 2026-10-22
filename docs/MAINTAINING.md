# Maintaining Clem

Owner and release tasks: building the installer, deploying the website and account service, the admin portal, emails and the product films. Contributors don't need any of this to work on the app.

## Release the Windows installer

**The installer:** `npm run desktop:installer` builds it and copies the finished EXE, its SHA-256 and install notes to the top-level **`Installer/`** folder (build intermediates stay in `release/`). After uploading it to the releases repository, run `npm run installer:release` to update the website's download metadata, and point `/download/windows` in `vercel.json` at the new file. It bundles the official Codex CLI. Sign in, complete setup, and connect ChatGPT from Settings. Owner exemptions are verified server-side; other accounts cannot purchase until Lemon Squeezy is configured. Unsigned previews show Windows publisher warnings.

**Updates:** installed copies of Clem update themselves from the newest release (`desktop/app-update.ts`; on or off in Settings → General → Updates). Every release must carry three files from `release/`: the EXE, `latest.yml` (version and SHA-512, which Clem checks before installing) and the `.exe.blockmap` (smaller downloads). The release must be marked Latest and not a pre-release, because Clem reads `releases/latest/download/latest.yml`. `npm run installer:release` refuses to update the website until `latest.yml` is live. `node scripts/verify/update-flow.mjs` runs a copy of the packaged build against a local feed: it checks that a mismatched download is refused and the real one is verified, and it stops before installing.

The website's download page reads `public/desktop-release.json`. Releases are published at [mowfxy/clem-releases](https://github.com/mowfxy/clem-releases/releases).

## Website and account service

- `npm run deploy` builds and deploys the website to Vercel.
- `npm run deploy:accounts` deploys the account Worker in `cloudflare/`.

## Admin portal

Staff moderate accounts, manage subscriptions and complimentary access, answer support cases and publish in-app announcements at **admin.m4labs.xyz**. See [admin portal](docs/ADMIN.md) for roles, setup (`npm run db:admin`, `npm run deploy:accounts`) and the local demo (`http://localhost:5173/?demo#/admin`).

## Emails

- `npm run emails` builds the templates in `emails/`; `npm run emails:art` renders the animated artwork in `public/email/`.
- `npm run emails:apply` applies the auth templates to Supabase (needs `SUPABASE_ACCESS_TOKEN`).
- `npm run emails:announce` sends the release announcement.

## The product film and ads

`npm run film:demo` captures the story in the browser fixture at 2× (`scripts/film/capture.mjs`), composites it with a virtual camera, drawn cursor and kinetic title cards (`stage.js`, `render.mjs`), scores it with an original synthesised track and UI sounds (`score.mjs`) and writes `ads/clem-film-demo.mp4`. AI replies in the demo are scripted and the video says so. For the real film: `npm run desktop:build`, then `npm run film:live-setup` once to sign in and connect the ChatGPT account with GPT-6 Luna in a separate ad profile, then `npm run film:live` (writes `ads/clem-film.mp4`). `node scripts/film/render.mjs [--live] [--preview]` re-renders without re-capturing.

**Short ads** (30–45 s each): `npm run ads` captures and renders `ads/clem-ad-visuals.mp4`, `clem-ad-pdf.mp4` and `clem-ad-study.mp4`. Each ad's edit and copy live in `scripts/ads/ads.mjs`; `node scripts/ads/capture.mjs <ad>` and `node scripts/ads/render.mjs <ad> [--preview]` run one step. Built-in visuals are the real engine; the PDF and study ads use the fixture's scripted replies and say so on screen.

Rendered videos are written to `ads/`, which stays out of git.

## README screenshots

`node scripts/readme-screenshots.mjs` re-shoots `docs/assets/` from the demo fixture and the website (scripted replies, no model calls).
