-- Coming up: what an item is, where it is sat, what it covers, whether its time is known, and the days it may be on
-- when that depends on the group ("Monday or Tuesday, by tutorial group").
alter table guc_deadlines add column if not exists kind text;
alter table guc_deadlines add column if not exists place text;
alter table guc_deadlines add column if not exists covers text;
alter table guc_deadlines add column if not exists time_known boolean;
alter table guc_deadlines add column if not exists either text;
