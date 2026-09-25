BEGIN;
-- One row per email the server has sent that must never repeat (the welcome email).
CREATE TABLE IF NOT EXISTS mowr_email_log(owner_id text NOT NULL,kind text NOT NULL,sent_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,kind));
-- People who used "Stop update emails".
CREATE TABLE IF NOT EXISTS mowr_email_optout(email text NOT NULL,kind text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(email,kind));
COMMIT;
