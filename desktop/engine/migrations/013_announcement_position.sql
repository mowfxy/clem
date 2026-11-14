-- A course's announcements are whole posts now; `position` is a post's place on its course page (0 at the top), so posts
-- first seen together keep the page's order.
alter table guc_announcements add column if not exists position int;
