-- GUC deadlines are named for what is due ("Quiz 2"); the sentence they were read from is kept as their note.
alter table guc_deadlines add column if not exists note text;
