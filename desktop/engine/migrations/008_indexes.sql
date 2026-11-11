-- Indexes for the hot reads (docs/PERFORMANCE-GUC-VPS.md): a course's files and news (the hub's CMS tab, a check, a
-- subject's view and the course list's counts), and the organizer's and inbox's "events since".
create index guc_materials_course on guc_materials (owner_id, course_key);
create index guc_announcements_course on guc_announcements (owner_id, course_key);
create index guc_events_recent on guc_events (owner_id, created_at);
