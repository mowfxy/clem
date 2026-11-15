-- The workspace on the VPS worker (docs/GUC-VPS-ENGINE.md "Workspace on the VPS"): its durable copy of the person's
-- workspace (as the desktop last sent it, with the worker's own changes on top) and every change the worker made, in
-- order, until the desktop has saved it. Unused on the desktop's own engine.
create table if not exists workspace_copy (
  owner_id text primary key,
  -- A new id for each fresh copy: a desktop whose cursor names another id takes every operation again.
  copy_id text not null,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists workspace_ops (
  owner_id text not null,
  seq bigserial,
  op jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, seq)
);
