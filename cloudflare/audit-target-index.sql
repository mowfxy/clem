-- One-time migration for D1 databases created before admin-schema.sql indexed audit entries by person. Safe to run again.
-- npx wrangler d1 execute clem-workspaces --remote --file cloudflare/audit-target-index.sql
CREATE INDEX IF NOT EXISTS desktop_audit_log_target ON desktop_audit_log(target,created_at);
