-- The organizer's log gains one state (docs/MAIN-THREAD.md "Proactivity" → "Steered by text"):
--   revert: an applied change of Clem's own that the person asked to undo in words (clem.undo); the window puts it back
--           when it next pulls the inbox, then it is 'undone'.
alter table organizer_actions drop constraint if exists organizer_actions_status_check;
alter table organizer_actions add constraint organizer_actions_status_check
  check (status in ('apply', 'applied', 'undone', 'confirm', 'dismissed', 'failed', 'said', 'held', 'skipped', 'revert'));
