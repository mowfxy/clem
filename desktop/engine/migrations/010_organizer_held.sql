-- The organizer's log gains two states (docs/MAIN-THREAD.md "Proactivity"):
--   held:    news worth knowing that the person's level kept back; it rides along with the next card Clem posts.
--   skipped: a reminder Clem chose not to send because it had just told them the same thing (kept so it isn't tried again).
alter table organizer_actions drop constraint if exists organizer_actions_status_check;
alter table organizer_actions add constraint organizer_actions_status_check
  check (status in ('apply', 'applied', 'undone', 'confirm', 'dismissed', 'failed', 'said', 'held', 'skipped'));
