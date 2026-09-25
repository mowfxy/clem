-- One row per email the server has sent that must never repeat (the welcome email).
CREATE TABLE IF NOT EXISTS mowr_email_log(owner_id TEXT NOT NULL,kind TEXT NOT NULL,sent_at TEXT NOT NULL,PRIMARY KEY(owner_id,kind));
-- People who used "Stop update emails".
CREATE TABLE IF NOT EXISTS mowr_email_optout(email TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(email,kind));
