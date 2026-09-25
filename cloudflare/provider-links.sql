-- Linked ChatGPT/Claude sign-ins and the Telegram bot connection. `sealed` is IV (12 bytes) followed by AES-GCM ciphertext of the
-- deflated credential JSON; `hash` is the SHA-256 of the credential, used only to detect changes.

CREATE TABLE IF NOT EXISTS provider_links (
 user_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('codex','claude','telegram')),
 label TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL DEFAULT '', sealed BLOB NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,id)
) WITHOUT ROWID;
