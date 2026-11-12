-- GUC connector tables (docs/GUC-VPS-ENGINE.md). Every row belongs to one owner and every query filters on owner_id.
create table guc_account (
  owner_id text primary key,
  username text not null,
  connected_at timestamptz not null default now(),
  last_sync timestamptz,
  last_error jsonb,
  stats jsonb
);
create table guc_courses (
  owner_id text not null,
  course_key text not null,
  course_id integer not null,
  season_id integer not null,
  season text not null,
  code text not null,
  name text not null,
  active boolean not null,
  primary key (owner_id, course_key)
);
create table guc_schedule_slots (
  owner_id text not null,
  slot_id text not null,
  day text not null,
  period integer not null,
  starts text not null,
  ends text not null,
  code text not null,
  name text not null,
  kind text not null,
  grp text not null,
  location text not null,
  primary key (owner_id, slot_id)
);
create table guc_announcements (
  owner_id text not null,
  announcement_id text not null,
  course_key text not null,
  scope text not null check (scope in ('course', 'week')),
  week text,
  body text not null,
  first_seen timestamptz not null default now(),
  read_at timestamptz,
  primary key (owner_id, announcement_id)
);
create table guc_materials (
  owner_id text not null,
  material_id text not null,
  course_key text not null,
  week text not null,
  title text not null,
  kind text not null,
  url text not null,
  first_seen timestamptz not null default now(),
  primary key (owner_id, material_id)
);
create table guc_grades (
  owner_id text not null,
  grade_id text not null,
  semester text not null,
  code text not null,
  name text not null,
  hours integer,
  numeric_grade real,
  letter text not null,
  primary key (owner_id, grade_id)
);
create table guc_deadlines (
  owner_id text not null,
  deadline_id text not null,
  course_key text not null,
  title text not null,
  due timestamptz not null,
  source text not null,
  primary key (owner_id, deadline_id)
);
create table guc_snapshots (
  id bigserial primary key,
  owner_id text not null,
  taken_at timestamptz not null default now(),
  pages jsonb not null,
  data jsonb not null,
  seen jsonb not null,
  stats jsonb not null
);
create index guc_snapshots_owner on guc_snapshots (owner_id, id desc);
create table guc_events (
  owner_id text not null,
  event_key text not null,
  kind text not null check (kind in ('new_grade', 'new_announcement', 'new_material', 'deadline_added', 'deadline_changed', 'schedule_changed')),
  course_key text,
  title text not null,
  detail text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, event_key)
);
create table subject_links (
  owner_id text not null,
  subject_id text not null,
  course_key text not null,
  linked_at timestamptz not null default now(),
  primary key (owner_id, subject_id)
);
create table subject_settings (
  owner_id text not null,
  subject_id text not null,
  settings jsonb not null default '{}',
  primary key (owner_id, subject_id)
);
create table file_objects (
  owner_id text not null,
  file_id text not null,
  location text not null check (location in ('device', 'vps', 'drive')),
  path text not null,
  sha256 text not null,
  size bigint not null,
  pinned boolean not null default false,
  last_access timestamptz,
  primary key (owner_id, file_id)
);
create table notifications_sent (
  owner_id text not null,
  event_key text not null,
  channel text not null,
  sent_at timestamptz not null default now(),
  unique (owner_id, event_key, channel)
);
create table telegram_link (
  owner_id text primary key,
  chat_id text not null,
  linked_at timestamptz not null default now()
);
create table migration_state (
  owner_id text primary key,
  state jsonb not null default '{}'
);
