BEGIN;
ALTER TABLE clem_users ADD COLUMN IF NOT EXISTS email text UNIQUE;
ALTER TABLE clem_users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE clem_users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS clem_automations (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES clem_users(id) ON DELETE CASCADE,
 name text NOT NULL,prompt text NOT NULL,model text NOT NULL,schedule text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,next_run_at timestamptz NOT NULL,
 last_result text,last_error text,lease_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clem_rate_limits (
 key text PRIMARY KEY,window_start timestamptz NOT NULL DEFAULT now(),count integer NOT NULL DEFAULT 0
);
COMMIT;
