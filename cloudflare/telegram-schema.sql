-- Telegram (docs/DESKTOP.md "Telegram"): one Clem bot on the account Worker (cloudflare/telegram.js).
-- `npm run db:telegram` applies it; every statement is safe to run again.
-- A paired chat: one per account, one account per chat. last_seen: when the person's engine last pulled the inbox.
CREATE TABLE IF NOT EXISTS telegram_links (
 user_id TEXT PRIMARY KEY, chat_id INTEGER NOT NULL UNIQUE, from_id INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL DEFAULT 0, offline_noted INTEGER NOT NULL DEFAULT 0
);
-- Pairing codes: 6 digits, kept only as an HMAC (hash), single use, 10 minutes.
CREATE TABLE IF NOT EXISTS telegram_pairings (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS telegram_pairings_user ON telegram_pairings(user_id, created_at);
-- What a paired chat sent (messages and button taps), sealed like provider_links (AES-GCM bound to owner and id),
-- until the person's engine acknowledges it. lease_until: handed out and not yet acknowledged.
CREATE TABLE IF NOT EXISTS telegram_inbox (
 user_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('message','tap')), sealed BLOB NOT NULL,
 created_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, id)
) WITHOUT ROWID;
-- A VPS worker's relay token (docs/GUC-VPS-ENGINE.md "What goes to the VPS"): works only for /telegram/*, kept as a
-- SHA-256 hash, one per account (a new one replaces the old), revocable from the app.
CREATE TABLE IF NOT EXISTS engine_tokens (
 user_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER
);
