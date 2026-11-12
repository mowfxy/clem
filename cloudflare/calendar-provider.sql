-- Allow provider 'calendar' (Google Calendar, read-only) in clem_credentials on D1.
-- SQLite cannot change a CHECK in place, so rebuild the table and copy every row.
-- Run once: npx wrangler d1 execute clem-workspaces --remote --file cloudflare/calendar-provider.sql
PRAGMA defer_foreign_keys = on;
CREATE TABLE clem_credentials_new (
 owner_id text NOT NULL REFERENCES clem_users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('openai','anthropic','google','xai','drive','github','calendar')),
 ciphertext text NOT NULL, nonce text NOT NULL, key_version integer NOT NULL,
 metadata text NOT NULL DEFAULT '{}', updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY(owner_id,provider)
);
INSERT INTO clem_credentials_new (owner_id,provider,ciphertext,nonce,key_version,metadata,updated_at)
 SELECT owner_id,provider,ciphertext,nonce,key_version,metadata,updated_at FROM clem_credentials;
DROP TABLE clem_credentials;
ALTER TABLE clem_credentials_new RENAME TO clem_credentials;
PRAGMA defer_foreign_keys = off;
