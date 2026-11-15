-- The worker's own standing state (docs/GUC-VPS-ENGINE.md "VPS"): a server-changing command asked in words and not
-- answered yet ("vps-ask"), the person's standing answer about files waiting past the storage limit ("full-answer")
-- and whether Clem already told them the VPS is full ("full-told"). One row per owner and key.
create table if not exists worker_state (
  owner_id text not null,
  key text not null,
  value jsonb not null,
  at timestamptz not null default now(),
  primary key (owner_id, key)
);
