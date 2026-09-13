# Production status · 13 September 2026

The application is deployed at https://mowrai.com, with source in https://github.com/mowafymxis/mowr. Latest verified deployment: dpl_4X1V2C4Wax8TNxQ7BJP4wxi3kyN1, from source b8b5dcf. GitHub CI run 34777301866 passed.

Supabase handles authentication and private file objects/metadata. Cloudflare D1 stores workspace data and skills behind an authenticated Worker. Files require ownership, a reserved quota, matching object size, and applicable authenticator/email verification. Email verification proofs are signed server-side and bound to the authenticated Supabase user and session.

## Verification

Production health reports database, authentication and storage configured. The application build, backend type checking, and 17 isolated tests pass. Live SQL assertions verified email gating, session isolation, forged proof rejection, and access after verification; the transaction rolled back all test records. Security-definer RPCs are intentionally callable by authenticated users: one returns only the caller's access decision, and the other requires a server HMAC proof. No privileged Supabase key is exposed to browsers. A reserved-upload policy incorrectly resolved the unqualified name to the metadata display name; migration 005 qualifies storage.objects.name. A live transaction verified that a reserved upload succeeds and an unreserved upload is denied, then rolled back all fixtures. The repeatable assertion is database/tests/storage-reservations.sql.

The initial JavaScript bundle changed from approximately 214.7 KB gzip before route splitting to 130.1 KB gzip. Heavy visual and document libraries load separately; below-fold 3D is deferred. This is build artifact evidence, not a measured Core Web Vitals improvement. No representative field data exists for this new deployment. CI limits the initial bundle to 145 KB gzip.

## Remaining external setup

- Zoho domain and mailbox deletion requests require Google re-verification in a separate popup. Automation can read these popups but cannot operate them reliably; a regular-tab fallback did not return the verification to the admin operation. User completion of the original verification popup is pending. Mail hosting became disabled for kourseify.com, but the domain and two users still appear. No completed removal or new mailbox is claimed. DNS mail records have not been switched to an unverified mailbox.
- support@mowrai.com needs a working Zoho mailbox and SMTP password before app mail and Supabase custom SMTP can send. Branded templates are in emails/. Supabase security notification switches are enabled. Custom templates cannot be edited in its dashboard until SMTP is configured.
- Google unlink must be tested after a Google-created account sets a password: Supabase upstream issue https://github.com/supabase/auth/issues/2085 describes password setup without a second email identity, which would keep the current unlink control disabled. Do not bypass the provider’s last-identity protection. Google authentication and Drive credentials remain blank in the ignored .env.local. Production auth redirect URLs and manual account linking are configured; TOTP is enabled.
- User requested subscription connections only. No OpenAI key was created. Codex documents subscription device-code login through App Server, requiring a hosted isolated runtime. Cloudflare Containers currently rejects access because the account lacks Workers Paid. A spending decision is pending. No verified Grok consumer-subscription integration was found.
- Vercel's GitHub login connection is verified. The GitHub app still needs repository permission; its installation is prepared for only mowafymxis/mowr, awaiting user confirmation. CLI production deployment works; source is pushed to the requested repository.
- npm audit reports two high findings through pptxgenjs/image-size with no available patched image-size release at inspection. The app's presentation export does not accept arbitrary image files into that package. Review when upstream publishes a fix.

Do not treat configured capability flags as proof that email delivery, Google sign-in, or subscription inference has passed an end-to-end test. These remain pending.
