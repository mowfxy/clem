-- One-time cleanup: support cases filed through mowrai.com were stored under "supabase:<id>", while the account
-- worker and staff portal look people up by the bare Supabase id. Readers tolerate both; this makes the data uniform.
-- npx wrangler d1 execute mowr-workspaces --remote --file cloudflare/support-owner-ids.sql
UPDATE mowr_support SET owner_id=substr(owner_id,10) WHERE owner_id LIKE 'supabase:%';
