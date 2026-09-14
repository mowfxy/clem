# Production status — 14 September 2026

Mowr is served at https://mowrai.com from Vercel. GitHub is connected to mowafymxis/mowr. Cloudflare D1 stores workspace records and encrypted provider credentials; Supabase handles identity and private original files.

## This update

- Native PDF canvas viewer with selectable text, page navigation, zoom, page notes, and annotated PDF export. Notes append to separate pages and never overwrite source content. Non-Latin note export reports a limitation instead of silently replacing characters.
- DOCX, PPTX and XLSX uploads have safe text extraction and previews. This is not a full fidelity Office layout editor. Edited Office text downloads separately as text; the original file stays available.
- Streamed AI revision proposals support reviewing and applying replacements to text, or adding PDF page notes. This does not replace arbitrary text or graphics inside an existing PDF.
- A file has one current edit record with revision checks. Saves update that file only; they do not duplicate other attachments. Deleting a file removes its edit record.
- Codex and Grok Build device sign-in use isolated Vercel Sandbox sessions. Both CLIs produced valid device challenges in live isolated smoke tests. A complete user login and successful subscribed model response have **not** yet been verified.
- Each runtime has one vCPU and a fixed timeout. The application reserves worst-case runtime seconds against a shared 12,000-second monthly ceiling and does not request paid overflow. Provider subscription limits remain separate.
- The clean CLI snapshot is about 1.14 GB and expires on 14 October 2026. Replace SUBSCRIPTION_RUNTIME_SNAPSHOT_ID before expiry. Never snapshot a VM after user authentication.
- Connection states, execution locks and runtime reservations are in Cloudflare D1. Credentials are encrypted per account. Finished or cancelled VMs are deleted; the daily authenticated scheduler also cleans expired sessions.
- All repository email templates and the app-generated transactional email shell use Mowr's dark palette. Only the signup Auth template was verified as saved in Supabase. Other Auth templates still need the Auth Management API or dashboard; the installed Supabase MCP has no Auth configuration method.

## Completed infrastructure

Zoho verified mowrai.com and completed MX, SPF and DKIM checks after kourseify.com was removed. The owner reports mailbox and Supabase SMTP setup completed. Google identity manual linking, secure email changes and TOTP are configured in Supabase. Private file ownership, reservation and MFA storage policies have been tested against Supabase.

## Remaining verification and configuration

- Production app SMTP_PASSWORD is absent. Supabase SMTP and the app contact form are separate configurations. App support emails need this server secret in Vercel.
- Google Drive client ID and secret are absent. Google sign-in also needs its configured OAuth credentials and end-to-end identity linking tests.
- Complete each provider device authorization in Settings, then verify generation, refresh, disconnect, cancellation and account isolation with authenticated accounts. Device-code smoke tests alone do not prove subscription inference.
- Full fidelity Word/PowerPoint/Excel editing and arbitrary PDF element replacement remain unfinished.
- Saved email templates are not proof of actual delivery. A delivered recovery email and a contact-form email still need verification.

## Checks

19 automated tests pass, including PDF note pagination, preservation of original pages, fragmented AI revision streams, incomplete-response rejection, account isolation and existing security checks. Backend typecheck passes. Browser checks verified local uploads, text editing, saved edits after reopening, and PDF rendering. Heavy PDF/Office libraries remain lazy loaded; the main entry bundle is unchanged by the editor. These are build observations, not field performance measurements.
