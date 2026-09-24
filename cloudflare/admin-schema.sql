-- Additive migration for the admin portal, moderation, support cases and in-app announcements.
-- Safe to run repeatedly. Existing tables are not altered.
CREATE TABLE IF NOT EXISTS mowr_support(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,category TEXT NOT NULL,subject TEXT NOT NULL,message TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS mowr_support_owner ON mowr_support(owner_id,created_at);

-- Workflow state kept beside the legacy support table so the website endpoint keeps working unchanged.
CREATE TABLE IF NOT EXISTS mowr_support_state (
 case_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending','resolved','closed')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 assignee_id TEXT, updated_at TEXT NOT NULL, staff_replied_at TEXT, user_seen_at TEXT, user_replied_at TEXT
);
CREATE TABLE IF NOT EXISTS mowr_support_messages (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL, author TEXT NOT NULL CHECK(author IN ('user','staff','note')),
 author_id TEXT NOT NULL, author_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mowr_support_messages_case ON mowr_support_messages(case_id,created_at);

CREATE TABLE IF NOT EXISTS desktop_admins (
 user_id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','support')),
 added_by TEXT NOT NULL, added_at TEXT NOT NULL
);
-- Last-seen data is written by the entitlement check; it lets staff find people by email.
CREATE TABLE IF NOT EXISTS desktop_activity (
 user_id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS desktop_activity_email ON desktop_activity(email);
CREATE TABLE IF NOT EXISTS desktop_moderation (
 user_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('active','suspended')), reason TEXT NOT NULL DEFAULT '',
 until TEXT, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS desktop_comp_grants (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', valid_until TEXT,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS desktop_comp_grants_owner ON desktop_comp_grants(user_id);
CREATE TABLE IF NOT EXISTS desktop_staff_notes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, author_id TEXT NOT NULL, author_email TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS desktop_staff_notes_owner ON desktop_staff_notes(user_id,created_at);
CREATE TABLE IF NOT EXISTS desktop_announcements (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, tone TEXT NOT NULL DEFAULT 'info' CHECK(tone IN ('info','success','warning')),
 link TEXT, starts_at TEXT NOT NULL, ends_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS desktop_audit_log (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_email TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '',
 detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS desktop_audit_log_time ON desktop_audit_log(created_at);
