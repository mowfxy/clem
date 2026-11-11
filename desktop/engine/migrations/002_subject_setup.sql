-- Subject setup (docs/GUC-VPS-ENGINE.md → Subject setup): a course links to one subject at most, and a sync records
-- courses of a new term that no subject is linked to as 'new_course' events, for the main thread's "set them up?" card.
alter table guc_events drop constraint guc_events_kind_check;
alter table guc_events add constraint guc_events_kind_check check (kind in ('new_grade', 'new_announcement', 'new_material', 'deadline_added', 'deadline_changed', 'schedule_changed', 'new_course'));
create unique index subject_links_course on subject_links (owner_id, course_key);
