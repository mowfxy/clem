-- Clem's storage limit on the VPS (docs/GUC-VPS-ENGINE.md "Storage limit"): at most 75% of the VPS disk full because
-- of Clem.
-- A move to the VPS that stopped at the limit: how many files stayed on the PC (they are fine there).
alter table migration_runs add column if not exists limit_left integer;
-- What the worker couldn't keep on the VPS past the limit (with the laptop off), waiting for the PC, in plain words.
create table if not exists vps_waiting (
  owner_id text not null,
  item text not null,
  name text not null,
  bytes bigint not null default 0,
  said text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, item)
);
