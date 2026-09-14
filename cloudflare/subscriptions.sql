CREATE TABLE IF NOT EXISTS mowr_subscription_sessions (
 owner_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('openai','xai')),
 session_id TEXT NOT NULL,
 sandbox_id TEXT,
 expires_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,provider)
);
CREATE TABLE IF NOT EXISTS mowr_runtime_budget (
 month TEXT PRIMARY KEY,
 reserved_seconds INTEGER NOT NULL DEFAULT 0
);
