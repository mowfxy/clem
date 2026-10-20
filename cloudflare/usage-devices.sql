-- One-time migration for D1 databases created before desktop usage was kept per device (run once, before deploying
-- the account worker that writes the `device` column): npx wrangler d1 execute clem-workspaces --remote --file cloudflare/usage-devices.sql
-- Existing rows become device '' and keep counting; new reports land in per-device rows.
CREATE TABLE desktop_usage_devices (
 user_id TEXT NOT NULL, day TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL, model TEXT NOT NULL, reasoning TEXT NOT NULL DEFAULT '',
 turns INTEGER NOT NULL DEFAULT 0, images INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,day,device,provider,model,reasoning)
) WITHOUT ROWID;
INSERT INTO desktop_usage_devices(user_id,day,device,provider,model,reasoning,turns,images) SELECT user_id,day,'',provider,model,reasoning,turns,images FROM desktop_usage;
DROP TABLE desktop_usage;
ALTER TABLE desktop_usage_devices RENAME TO desktop_usage;
CREATE INDEX IF NOT EXISTS desktop_usage_day ON desktop_usage(day);
CREATE TABLE desktop_usage_hours_devices (
 user_id TEXT NOT NULL, day TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', hours TEXT NOT NULL, PRIMARY KEY(user_id,day,device)
) WITHOUT ROWID;
INSERT INTO desktop_usage_hours_devices(user_id,day,device,hours) SELECT user_id,day,'',hours FROM desktop_usage_hours;
DROP TABLE desktop_usage_hours;
ALTER TABLE desktop_usage_hours_devices RENAME TO desktop_usage_hours;
