-- Corrections the person makes in words (docs/GUC-VPS-ENGINE.md → Corrections, core/guc/corrections.ts): an item Clem
-- read or synced wrong is removed, edited, marked done or annotated, and what it taught is kept as a rule. Applied at
-- sync time and read time, so the next sync doesn't bring an item back or undo an edit. Undo sets undone_at.
--   kind:        hide | edit | done | note | rule | link
--   item_id:     the item (a deadline id, or exam-<seat id>)
--   source_ref:  the message or post it was read from (a reader text id)
--   fingerprint: its course and what it is ("45:70|quiz|2"), so a re-read finds it again
--   patch:       edit/note fields, a rule ({ rule, text }), or a link change ({ subjectId, from, to })
--   before:      the item as it was, put back on undo
create table if not exists guc_corrections (
  owner_id text not null,
  correction_id text not null,
  kind text not null check (kind in ('hide', 'edit', 'done', 'note', 'rule', 'link')),
  item_id text,
  source_ref text,
  fingerprint text,
  course_key text,
  patch jsonb not null default '{}'::jsonb,
  before jsonb,
  label text not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  primary key (owner_id, correction_id)
);
create index if not exists guc_corrections_live on guc_corrections (owner_id, created_at) where undone_at is null;
-- Each tracked item remembers the text it was read from and when that was sent, so a correction stays keyed to that
-- message and relative words are counted from the day it was sent.
alter table guc_deadlines add column if not exists source_ref text;
alter table guc_deadlines add column if not exists sent_at timestamptz;
