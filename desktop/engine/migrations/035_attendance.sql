-- GUC: an attendance warning going up becomes an event too (core/guc/diff.ts).
alter table guc_events drop constraint guc_events_kind_check;
alter table guc_events add constraint guc_events_kind_check check (kind in ('new_grade', 'new_announcement', 'new_material', 'deadline_added', 'deadline_changed', 'schedule_changed', 'new_course', 'file_saved', 'exam_posted', 'new_mail', 'attendance_warning'));
