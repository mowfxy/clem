-- Clem's organizer (docs/MAIN-THREAD.md "Proactivity"): its settings, every action it took or offered (deduplicated by
-- a stable key; "What Clem did today" and Undo read them), what each sweep last saw, the main-thread posts waiting for
-- the window, notifications held back by quiet hours or the daily cap, and the person's watches.
-- notifications_sent (001) keeps what was sent, per channel.
create table organizer_settings (
  owner_id text primary key,
  settings jsonb not null,
  updated_at timestamptz not null default now()
);
create table organizer_actions (
  owner_id text not null,
  key text not null,
  sweep text not null,
  action jsonb not null,
  text text not null,
  -- apply: waiting for the window · applied · undone · confirm: waiting for one tap · dismissed · failed · said: a note or reminder
  status text not null check (status in ('apply', 'applied', 'undone', 'confirm', 'dismissed', 'failed', 'said')),
  undo jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);
create index organizer_actions_recent on organizer_actions (owner_id, created_at);
-- One row per sweep kind (the Cairo day it last ran) plus '_state': the last snapshot, the last timetable and the
-- GUC events cursor.
create table organizer_sweeps (
  owner_id text not null,
  kind text not null,
  last_day text,
  last_at timestamptz,
  snapshot jsonb,
  slots jsonb,
  events_after timestamptz,
  primary key (owner_id, kind)
);
create table organizer_runs (
  id bigserial primary key,
  owner_id text not null,
  kind text not null,
  at timestamptz not null default now(),
  changed boolean not null,
  model boolean not null,
  actions integer not null,
  ms integer not null
);
create table organizer_posts (
  owner_id text not null,
  id text not null,
  content text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  primary key (owner_id, id)
);
-- Pushes waiting: held by quiet hours (due_at), or over the day's cap (digest: said in the next card instead).
create table notify_queue (
  owner_id text not null,
  event_key text not null,
  channel text not null,
  payload jsonb not null,
  due_at timestamptz not null,
  primary key (owner_id, event_key, channel)
);
-- "Tell me when…": what to look for, said in the person's words, and how often it has fired.
create table organizer_watches (
  owner_id text not null,
  id text not null,
  watch jsonb not null,
  fired integer not null default 0,
  last_fired timestamptz,
  stopped boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_id, id)
);
-- Kinds of things the person said not to be told about ("Don't tell me about this kind of thing").
create table organizer_mutes (
  owner_id text not null,
  mute_key text not null,
  mute jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, mute_key)
);
