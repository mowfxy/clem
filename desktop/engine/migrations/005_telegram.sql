-- Telegram (desktop/engine/telegram.ts): the relay's side. The pairing itself lives with the account (the Worker's
-- telegram_links); telegram_link (001) keeps the last status seen, so the notifier knows without asking each time.
alter table telegram_link add column name text not null default '';
alter table telegram_link add column checked_at timestamptz not null default now();
-- What came from Telegram and was handled (messages and taps), so a redelivered item is never answered twice.
create table telegram_seen (
  owner_id text not null,
  id text not null,
  seen_at timestamptz not null default now(),
  primary key (owner_id, id)
);
-- A tap button's action, under the short token Telegram carries ("b:<token>").
create table telegram_buttons (
  owner_id text not null,
  token text not null,
  tap jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, token)
);
