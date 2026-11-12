-- Reminders the person (or a study session Clem planned) asked for, rung at their time in the main thread, on the
-- desktop and on Telegram (docs/MAIN-THREAD.md "Calendar, reminders and study time"). A repeating one moves on to its
-- next time when it rings. organizer_sweeps keeps the calendar a sweep last saw, so the next one says only what moved.
create table organizer_reminders (
  owner_id text not null,
  id text not null,
  text text not null,
  at timestamptz not null,
  space_id text,
  repeat text check (repeat in ('daily', 'weekly')),
  -- person: asked for in a chat (rings through quiet hours) · study: a planned study session · calendar: a calendar event
  source text not null default 'person' check (source in ('person', 'study', 'calendar')),
  fired_at timestamptz,
  cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create index organizer_reminders_due on organizer_reminders (owner_id, at) where not cancelled and fired_at is null;
alter table organizer_sweeps add column calendar jsonb;
