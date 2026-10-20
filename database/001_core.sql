-- PostgreSQL production foundation. Run only against the provisioned Clem database.
BEGIN;
CREATE TABLE IF NOT EXISTS clem_users (
 id text PRIMARY KEY, display_name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clem_scopes (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES clem_users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('personal','project','subject')), name text NOT NULL,
 memory text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,owner_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_personal_scope ON clem_scopes(owner_id) WHERE kind='personal';
CREATE TABLE IF NOT EXISTS clem_skills (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES clem_users(id) ON DELETE CASCADE,
 name text NOT NULL, definition jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clem_workspaces (
 owner_id text PRIMARY KEY REFERENCES clem_users(id) ON DELETE CASCADE,
 state jsonb NOT NULL DEFAULT '{}', revision bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clem_credentials (
 owner_id text NOT NULL REFERENCES clem_users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('openai','anthropic','google','xai','drive')),
 ciphertext text NOT NULL, nonce text NOT NULL, key_version integer NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,provider)
);
CREATE TABLE IF NOT EXISTS clem_usage (
 owner_id text PRIMARY KEY REFERENCES clem_users(id) ON DELETE CASCADE,
 stored_bytes bigint NOT NULL DEFAULT 0 CHECK(stored_bytes>=0),
 reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),
 cap_bytes bigint NOT NULL DEFAULT 1500000000 CHECK(cap_bytes>=0),
 CHECK(stored_bytes+reserved_bytes<=cap_bytes)
);
CREATE TABLE IF NOT EXISTS clem_files (
 id uuid PRIMARY KEY, owner_id text NOT NULL, scope_id uuid NOT NULL,
 object_key text NOT NULL UNIQUE, name text NOT NULL, mime text NOT NULL,
 bytes bigint NOT NULL CHECK(bytes>=0), checksum text, status text NOT NULL CHECK(status IN ('reserved','ready','deleting')),
 expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(scope_id,owner_id) REFERENCES clem_scopes(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS files_by_scope ON clem_files(owner_id,scope_id,created_at DESC);
CREATE TABLE IF NOT EXISTS clem_jobs (
 id uuid PRIMARY KEY, owner_id text NOT NULL, scope_id uuid NOT NULL,
 plan jsonb NOT NULL, revision integer NOT NULL, approved_hash text,
 status text NOT NULL CHECK(status IN ('draft','queued','running','complete','failed','cancelled')),
 lease_until timestamptz, next_run_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,idempotency_key), FOREIGN KEY(scope_id,owner_id) REFERENCES clem_scopes(id,owner_id)
);
CREATE INDEX IF NOT EXISTS job_dispatch ON clem_jobs(next_run_at) WHERE status IN ('queued','running');
-- Applications use parameterized queries with verified subject IDs. RLS is additionally
-- applied on transactions that SET LOCAL clem.user_id from a verified identity.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['clem_users','clem_scopes','clem_skills','clem_workspaces','clem_credentials','clem_usage','clem_files','clem_jobs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='owner_isolation') THEN
   EXECUTE format('CREATE POLICY owner_isolation ON %I USING (%I = current_setting(''clem.user_id'',true)) WITH CHECK (%I = current_setting(''clem.user_id'',true))',t,CASE WHEN t='clem_users' THEN 'id' ELSE 'owner_id' END,CASE WHEN t='clem_users' THEN 'id' ELSE 'owner_id' END);
  END IF;
 END LOOP;
END $$;
COMMIT;
