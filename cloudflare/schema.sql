-- Cloudflare D1 production foundation. Run only against the provisioned Mowr database.

CREATE TABLE IF NOT EXISTS mowr_users (
 id text PRIMARY KEY, display_name text NOT NULL DEFAULT '', email text UNIQUE, password_hash text, disabled integer NOT NULL DEFAULT 0, created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS mowr_scopes (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES mowr_users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('personal','project','subject')), name text NOT NULL,
 memory text NOT NULL DEFAULT '', created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(id,owner_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_personal_scope ON mowr_scopes(owner_id) WHERE kind='personal';
CREATE TABLE IF NOT EXISTS mowr_skills (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES mowr_users(id) ON DELETE CASCADE,
 name text NOT NULL, definition text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS mowr_workspaces (
 owner_id text PRIMARY KEY REFERENCES mowr_users(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT '{}', revision bigint NOT NULL DEFAULT 1, updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS mowr_credentials (
 owner_id text NOT NULL REFERENCES mowr_users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('openai','anthropic','google','xai','drive','github')),
 ciphertext text NOT NULL, nonce text NOT NULL, key_version integer NOT NULL,
 metadata text NOT NULL DEFAULT '{}', updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY(owner_id,provider)
);
CREATE TABLE IF NOT EXISTS mowr_usage (
 owner_id text PRIMARY KEY REFERENCES mowr_users(id) ON DELETE CASCADE,
 stored_bytes bigint NOT NULL DEFAULT 0 CHECK(stored_bytes>=0),
 reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),
 cap_bytes bigint NOT NULL DEFAULT 1500000000 CHECK(cap_bytes>=0),
 CHECK(stored_bytes+reserved_bytes<=cap_bytes)
);
CREATE TABLE IF NOT EXISTS mowr_files (
 id text PRIMARY KEY, owner_id text NOT NULL, scope_id text NOT NULL,
 object_key text NOT NULL UNIQUE, name text NOT NULL, mime text NOT NULL,
 bytes bigint NOT NULL CHECK(bytes>=0), checksum text, status text NOT NULL CHECK(status IN ('reserved','ready','deleting')),
 expires_at text, created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(scope_id,owner_id) REFERENCES mowr_scopes(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS files_by_scope ON mowr_files(owner_id,scope_id,created_at DESC);
CREATE TABLE IF NOT EXISTS mowr_jobs (
 id text PRIMARY KEY, owner_id text NOT NULL, scope_id text NOT NULL,
 plan text NOT NULL, revision integer NOT NULL, approved_hash text,
 status text NOT NULL CHECK(status IN ('draft','queued','running','complete','failed','cancelled')),
 lease_until text, next_run_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 idempotency_key text NOT NULL, created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(owner_id,idempotency_key), FOREIGN KEY(scope_id,owner_id) REFERENCES mowr_scopes(id,owner_id)
);
CREATE INDEX IF NOT EXISTS job_dispatch ON mowr_jobs(next_run_at) WHERE status IN ('queued','running');

CREATE TABLE IF NOT EXISTS mowr_automations (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES mowr_users(id) ON DELETE CASCADE,
 name text NOT NULL,prompt text NOT NULL,model text NOT NULL,schedule text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,next_run_at text NOT NULL,
 last_result text,last_error text,lease_until text,updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS mowr_rate_limits (
 key text PRIMARY KEY,window_start text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),count integer NOT NULL DEFAULT 0
);


CREATE TRIGGER file_ready_usage AFTER UPDATE OF status ON mowr_files WHEN OLD.status='reserved' AND NEW.status='ready' BEGIN UPDATE mowr_usage SET stored_bytes=stored_bytes+NEW.bytes,reserved_bytes=reserved_bytes-NEW.bytes WHERE owner_id=NEW.owner_id; END;
CREATE TRIGGER file_delete_usage AFTER DELETE ON mowr_files BEGIN UPDATE mowr_usage SET stored_bytes=stored_bytes-CASE WHEN OLD.status='ready' THEN OLD.bytes ELSE 0 END,reserved_bytes=reserved_bytes-CASE WHEN OLD.status='reserved' THEN OLD.bytes ELSE 0 END WHERE owner_id=OLD.owner_id; END;
CREATE TABLE IF NOT EXISTS mowr_security(owner_id TEXT PRIMARY KEY REFERENCES mowr_users(id) ON DELETE CASCADE,email_mfa INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS mowr_email_challenges(owner_id TEXT NOT NULL,session_id TEXT NOT NULL,code_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,sent_at TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(owner_id,session_id));
CREATE TABLE IF NOT EXISTS mowr_support(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,category TEXT NOT NULL,subject TEXT NOT NULL,message TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
