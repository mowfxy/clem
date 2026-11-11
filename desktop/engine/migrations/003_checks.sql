-- Checks, saved files and the Drive copy (docs/GUC-VPS-ENGINE.md → Checks and saved files, Drive copy).
-- A saved CMS file: which material and subject it came from, the link it was fetched from (a new link is a changed
-- file), and its Drive copy (the folder and the bytes it holds, so an unchanged file is never sent twice).
alter table file_objects add column material_id text;
alter table file_objects add column subject_id text;
alter table file_objects add column url text;
alter table file_objects add column name text;
alter table file_objects add column mime text;
alter table file_objects add column saved_at timestamptz not null default now();
alter table file_objects add column drive_id text;
alter table file_objects add column drive_sha256 text;
alter table file_objects add column drive_folder text;
alter table file_objects add column drive_root text;
create index file_objects_sha on file_objects (owner_id, sha256);
create index file_objects_subject on file_objects (owner_id, subject_id);
alter table guc_events drop constraint guc_events_kind_check;
alter table guc_events add constraint guc_events_kind_check check (kind in ('new_grade', 'new_announcement', 'new_material', 'deadline_added', 'deadline_changed', 'schedule_changed', 'new_course', 'file_saved'));
-- One row per check, for the performance pass: requests, bytes, what was skipped and how long it took.
create table guc_checks (
  id bigserial primary key,
  owner_id text not null,
  subject_id text not null,
  at timestamptz not null default now(),
  trigger text not null,
  page_changed boolean not null,
  requests integer not null,
  bytes bigint not null,
  saved integer not null,
  skipped integer not null,
  deduped integer not null,
  uploaded integer not null,
  ms integer not null,
  error text
);
create index guc_checks_subject on guc_checks (owner_id, subject_id, id desc);
-- Drive folders Clem made or found ("Clem/GUC/CSEN 701 …/Week 2026-09-26"), so they are looked up once.
create table drive_folders (
  owner_id text not null,
  path text not null,
  folder_id text not null,
  primary key (owner_id, path)
);
-- The Drive copy's state per subject: the folder in use and why the last copy stopped.
create table subject_drive (
  owner_id text not null,
  subject_id text not null,
  folder_id text,
  error text,
  message text,
  at timestamptz not null default now(),
  primary key (owner_id, subject_id)
);
