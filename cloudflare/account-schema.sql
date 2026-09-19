-- Additive migration: does not modify legacy workspace or Office records.
CREATE TABLE IF NOT EXISTS desktop_profiles (
 user_id TEXT PRIMARY KEY, username TEXT UNIQUE, display_name TEXT NOT NULL DEFAULT '',
 setup_step INTEGER NOT NULL DEFAULT 0 CHECK(setup_step BETWEEN 0 AND 4), memory INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS desktop_owner_grants (user_id TEXT PRIMARY KEY, granted_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS desktop_subscriptions (
 subscription_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL,
 valid_until TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS desktop_subscriptions_owner ON desktop_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS desktop_checkouts (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL,url TEXT,expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS desktop_checkouts_owner ON desktop_checkouts(user_id,expires_at);
CREATE TABLE IF NOT EXISTS desktop_rate_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
