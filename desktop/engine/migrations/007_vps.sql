-- The VPS step (docs/GUC-VPS-ENGINE.md "VPS"): workspace files in file_objects ('ws:<id>'), whether this device holds a
-- copy, the migration's per-file state, and the single-runner lease (used in the worker's database).
alter table file_objects add column cached boolean not null default false;
drop table if exists migration_state;
create table migration_state (
  owner_id text not null,
  item text not null,
  direction text not null check (direction in ('up', 'down')),
  status text not null check (status in ('pending', 'copying', 'done', 'failed')),
  size bigint not null default 0,
  sha256 text,
  attempts integer not null default 0,
  error text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, item)
);
create table migration_runs (
  owner_id text primary key,
  direction text not null,
  status text not null,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create table engine_lease (
  owner_id text primary key,
  lease jsonb not null
);
