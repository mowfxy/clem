-- GUC: exam seats and GUC mail become events too (core/guc/diff.ts).
alter table guc_events drop constraint guc_events_kind_check;
alter table guc_events add constraint guc_events_kind_check check (kind in ('new_grade', 'new_announcement', 'new_material', 'deadline_added', 'deadline_changed', 'schedule_changed', 'new_course', 'file_saved', 'exam_posted', 'new_mail'));

-- Routines (core/proactivity/routines.ts): what the person asked Clem to do on its own, written by the AI from their
-- words. Each has a trigger (a schedule, a time, a kind of change, a webhook, a web page to watch) and instructions
-- the model follows when it fires. They run in this engine only: the person's computer or their VPS, never Clem's servers.
--   secret: the webhook's key (only webhook routines); state: what a page watch last saw.
create table organizer_routines (
  owner_id text not null,
  id text not null,
  routine jsonb not null,
  secret text,
  state jsonb,
  runs integer not null default 0,
  last_run timestamptz,
  last_result text,
  stopped boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_id, id)
);
