CREATE TABLE IF NOT EXISTS desktop_sync (
 user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('skills','memory','notes')),
 revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,kind)
);
