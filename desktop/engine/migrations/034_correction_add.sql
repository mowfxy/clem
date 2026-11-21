-- An item the person told Clem about that no post gave it (guc.correct "add"; core/guc/corrections.ts): kept in Coming
-- up through every sync until they remove it or a post brings the same item.
alter table guc_corrections drop constraint if exists guc_corrections_kind_check;
alter table guc_corrections add constraint guc_corrections_kind_check check (kind in ('hide', 'edit', 'done', 'note', 'rule', 'link', 'add'));
