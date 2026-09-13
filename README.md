# Mowr

A compact workspace for conversations, personal skills, files, and interactive visuals.

## Production

- Site: https://mowrai.com
- Frontend and API: Vercel
- Identity and private files: Supabase
- Workspace, skills, encrypted connections: Cloudflare D1 through an authenticated Worker
- Email sender: support@mowrai.com (Zoho SMTP credentials required)

## Development

Use Node 25+ for the TypeScript test loader. Run `npm ci`, fill the ignored `.env.local` using `.env.example`, then run `npm run server` and `npm run dev` in separate terminals.

`npm test` runs isolated tests without loading production environment files. `npm run typecheck:server` checks the backend. `npm run build:vercel` bundles the API and builds the frontend.

## Deployment

The Vercel project uses `npm run build:vercel`. `npm run deploy` synchronizes configured server variables and deploys an allowlisted bundle. Never commit `.env.local`, `.work`, or `.deploy`.

Database definitions are in `cloudflare/schema.sql` and `database/supabase-files.sql`. `database/004_file_security.sql` requires its placeholder to be replaced privately with FILE_GATE_SECRET before application. The deployed project already has these migrations.

`emails/` contains branded transactional templates. `scripts/configure-supabase.mjs` configures auth templates and SMTP using a management token and SMTP credentials from `.env.local`. Google sign-in requires separate Google OAuth credentials. Google Drive uses GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.

Codex and Grok subscription connections are under integration review; do not represent a consumer subscription as an API key or promise unsupported authorization.

Fonts include their licenses in public/fonts. The vendored Kinetra engine retains its license in vendor/kinetra/LICENSE.
