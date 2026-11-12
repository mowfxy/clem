-- GUC password expiry (docs/GUC-VPS-ENGINE.md "Password expiry"): when GUC first stopped accepting the password.
-- Set, the connection is password_needed and its jobs are paused; nothing else changes.
alter table guc_account add column password_needed timestamptz;
