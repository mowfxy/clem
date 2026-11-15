-- Where the person said a file is kept (docs/GUC-VPS-ENGINE.md "Storage limit"; vps.keep): "pc" keeps it on this PC
-- only, "vps" on the VPS. The storage router and the move to the VPS follow it; no row means Clem decides.
create table if not exists file_keep (
  owner_id text not null,
  file_id text not null,
  place text not null check (place in ('pc', 'vps')),
  created_at timestamptz not null default now(),
  primary key (owner_id, file_id)
);
-- Deleted files whose bytes on the VPS couldn't be removed yet (it was out of reach): removed once it is, exactly once.
create table if not exists vps_deletes (
  owner_id text not null,
  path text not null,
  file_id text not null,
  size bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (owner_id, path)
);
