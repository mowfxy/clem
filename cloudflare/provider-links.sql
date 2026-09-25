CREATE TABLE IF NOT EXISTS provider_links (
 user_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('codex','claude')),
 label TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL DEFAULT '', iv TEXT NOT NULL, payload TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,id)
);
