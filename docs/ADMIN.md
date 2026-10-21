# M4 Labs admin — admin.m4labs.xyz

Staff use the portal to run M4 Labs: every lab account, staff email, the team and an audit log, plus a section for each lab product. Clem is the first product; its group has stats, support cases and in-app announcements. The lab's products are free, so there are no billing screens.

An **M4 Labs account** is a Supabase account; it signs in to every lab product. **Accounts** lists all of them (from the Supabase directory) with the products each has used, so someone who signed up but never opened Clem still shows, marked “Account only”. Products are registered in `src/admin/products.ts`; product pages live at `#/<product>/<section>` (`#/clem/stats`), lab pages at `#/<section>` (`#/accounts`).

The portal uses the lab's terminal look from m4labs.xyz: Fragment Mono, the M4 logo and favicon (`public/m4labs/`; `vercel.json` redirects the favicon paths there on the admin host), near-black surfaces with hairlines, `./section` navigation and a page head that shows the command that opened the page (`m4labs:~$ admin accounts`, `m4labs:~$ admin clem stats`). It is dark only. The style layer is at the end of `src/admin/admin.css`.

## How it fits together

- **Frontend:** `src/admin/`, lazy-loaded from the website bundle. `src/main.tsx` renders it when the hostname is `admin.m4labs.xyz`, or at `#/admin` on any other host (local development).
- **API:** `/admin/*` routes on the account Worker (`cloudflare/admin.js`), using the existing `clem-workspaces` D1 database. The Worker verifies the Supabase session exactly as it does for the desktop app, then checks the staff role.
- **People-facing routes:** `cloudflare/support.js` serves `/support/cases`, `/support/cases/:id/reply|seen` and `/announcements` to the desktop app (IPC actions `supportCases`, `supportReply`, `supportSeen`, `announcements`).
- **Schema:** `cloudflare/admin-schema.sql` is additive and idempotent. Support-case workflow state lives in `clem_support_state` beside the legacy `clem_support` table, so the website's `/api/support` submission path is unchanged.

Entitlement keeps working if the Worker is deployed before the migration: missing moderation, grant and activity tables are treated as empty (tested).

## Roles

| Role | Can |
| --- | --- |
| owner | Everything, including adding and removing staff. Owners are the verified emails in `cloudflare/account-policy.js`. |
| admin | Accounts, suspensions, email, every product's announcements, audit log. |
| support | Read accounts; answer, note and triage support cases; add staff notes. |

Every mutation writes to `desktop_audit_log`. Owner accounts cannot be suspended, and staff cannot suspend themselves.

## Moderation and access

- **Suspend** closes the workspace at the next entitlement check (app start, focus, or the next chat request). The person sees the reason and the end date; their local files are never touched.
- **People filters**: everyone, active this week, new this week, still setting up (fewer than four welcome steps) and suspended.
- Legacy subscription and complimentary-grant records and their Worker routes remain for history, but the portal no longer shows them.

## Support cases

People open cases from the app (Settings → Help & support) or the website. Staff replies appear in the person's app as a notice above the account button and in the support inbox; internal notes are never sent to the person. A reply from the person reopens a pending or resolved case. Replies are delivered in the app, not by email — use “Email instead” on a case when an email is needed.

## Setup (one time)

1. Apply the schema: `npm run db:admin` (runs `wrangler d1 execute clem-workspaces --remote --file cloudflare/admin-schema.sql`).
2. Deploy the Worker: `npm run deploy:accounts`.
3. Optional Worker settings:
   - `ADMIN_REQUIRE_MFA="true"` (variable, on) requires authenticator verification for staff. The Worker answers `code: "MFA_REQUIRED"` and the portal walks the person through adding a TOTP authenticator to their M4 Labs account on the spot.
   - `SUPABASE_SERVICE_ROLE_KEY` (secret, set) is what lets **Accounts** list every M4 Labs account and adds sign-in details to account pages. Without it the list falls back to the people Clem has seen.
4. Add `admin.m4labs.xyz` as a domain of the Vercel project that serves clem.m4labs.xyz, then deploy the website. No separate build is needed.

The Worker allows browser requests from `https://admin.m4labs.xyz` and local Vite (`localhost:5173`) only (`cloudflare/lib/http.js`).

## Local preview

`npm run dev`, then open `http://localhost:5173/?demo#/admin`. `?demo` uses fixture data (`src/admin/demo.ts`) and only works in development builds. Without `?demo`, the portal signs in against production Supabase and talks to the production Worker (set `VITE_ACCOUNT_SERVICE` to point elsewhere).

## Tests

`tests/desktop/admin-worker.test.ts` covers roles, CORS, grants, suspension, case replies and visibility of internal notes, announcements and the audit log against an in-memory SQLite database.

## Stats

`#/stats` shows which AI providers and models people use, messages per day, busiest hours and weekdays, and a few fun facts. The desktop app counts messages per local day (`desktop/usage-tally.ts`) and sends the running totals to `POST /usage` (`cloudflare/usage.js`) at most every 30 minutes and on start. Only provider, model, thinking level, message and image counts and a 24-hour histogram are sent, never content. Totals are stored in `desktop_usage` and `desktop_usage_hours`; a resend keeps the larger count, so retries never double count. Linked accounts and sync adoption come from `provider_links` and `desktop_sync`.

