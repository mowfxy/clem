# Admin portal — admin.mowrai.com

Staff use the portal to moderate accounts, manage subscriptions and complimentary access, answer support cases, publish in-app announcements and review an audit log.

## How it fits together

- **Frontend:** `src/admin/`, lazy-loaded from the website bundle. `src/main.tsx` renders it when the hostname is `admin.mowrai.com`, or at `#/admin` on any other host (local development).
- **API:** `/admin/*` routes on the account Worker (`cloudflare/admin.js`), using the existing `mowr-workspaces` D1 database. The Worker verifies the Supabase session exactly as it does for the desktop app, then checks the staff role.
- **People-facing routes:** `cloudflare/support.js` serves `/support/cases`, `/support/cases/:id/reply|seen` and `/announcements` to the desktop app (IPC actions `supportCases`, `supportReply`, `supportSeen`, `announcements`).
- **Schema:** `cloudflare/admin-schema.sql` is additive and idempotent. Support-case workflow state lives in `mowr_support_state` beside the legacy `mowr_support` table, so the website's `/api/support` submission path is unchanged.

Entitlement keeps working if the Worker is deployed before the migration: missing moderation, grant and activity tables are treated as empty (tested).

## Roles

| Role | Can |
| --- | --- |
| owner | Everything, including adding and removing staff. Owners are the verified emails in `cloudflare/account-policy.js`. |
| admin | People, complimentary access, suspensions, Lemon Squeezy cancel/sync, announcements, audit log. |
| support | Read people and subscriptions; answer, note and triage support cases; add staff notes. |

Every mutation writes to `desktop_audit_log`. Owner accounts cannot be suspended, and staff cannot suspend themselves.

## Moderation and access

- **Suspend** closes the workspace at the next entitlement check (app start, focus, or the next chat request) and blocks checkout. The person sees the reason and the end date; their local files are never touched.
- **Complimentary access** grants the plan for a fixed period or with no expiry, independent of Lemon Squeezy. Use it for preview testers while payments are being configured.
- **Cancel / sync subscription** calls Lemon Squeezy and needs `LEMON_API_KEY` on the Worker.

## Support cases

People open cases from the app (Settings → Help & support) or the website. Staff replies appear in the person's app as a notice above the account button and in the support inbox; internal notes are never sent to the person. A reply from the person reopens a pending or resolved case. Replies are delivered in the app, not by email — use “Email instead” on a case when an email is needed.

## Setup (one time)

1. Apply the schema: `npm run db:admin` (runs `wrangler d1 execute mowr-workspaces --remote --file cloudflare/admin-schema.sql`).
2. Deploy the Worker: `npm run deploy:accounts`.
3. Optional Worker settings:
   - `ADMIN_REQUIRE_MFA="true"` (variable) requires authenticator verification for staff. Recommended once every staff member has an authenticator.
   - `SUPABASE_SERVICE_ROLE_KEY` (secret, `wrangler secret put`) adds sign-in details (providers, MFA, last sign-in) to person pages. Without it, emails come from the app's own activity records.
4. Add `admin.mowrai.com` as a domain of the Vercel project that serves mowrai.com, then deploy the website. No separate build is needed.

The Worker allows browser requests from `https://admin.mowrai.com` and local Vite (`localhost:5173`) only (`cloudflare/lib/http.js`).

## Local preview

`npm run dev`, then open `http://localhost:5173/?demo#/admin`. `?demo` uses fixture data (`src/admin/demo.ts`) and only works in development builds. Without `?demo`, the portal signs in against production Supabase and talks to the production Worker (set `VITE_ACCOUNT_SERVICE` to point elsewhere).

## Tests

`tests/desktop/admin-worker.test.ts` covers roles, CORS, grants, suspension, case replies and visibility of internal notes, announcements and the audit log against an in-memory SQLite database.
