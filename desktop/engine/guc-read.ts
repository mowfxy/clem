// The GUC hub's reads (docs/GUC-VPS-ENGINE.md): every query filters on owner_id, and lists that can grow are paged.
import { materialFile, semesterOrder, type HubAnnouncement, type HubCourse, type HubDeadline, type HubGrade, type HubHit, type HubMaterial, type HubMaterials, type HubSchedule, type Page } from "../../core/guc/hub.ts";
import { normCode, withCode } from "../../core/guc/codes.ts";
import type { GucSlot } from "../../core/guc/types.ts";
import type { Db } from "./db.ts";

export const ANNOUNCEMENT_PAGE = 40;
const ms = (t: Date | string | null) => (t ? new Date(t).getTime() : 0);
/** Rows saved before codes were canonical ("CSEN701") read as "CSEN 701" until the next sync rewrites them. */
const canon = (code: string | null) => (code ? normCode(code) || code : "");
const like = (s: string) => "%" + s.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

export async function counts(db: Db, owner: string) {
  const [row] = await db.query<{ courses: number; unread: number; materials: number; deadlines: number; grades: number }>(`select
    (select count(*)::int from guc_courses where owner_id = $1 and active) as courses,
    (select count(*)::int from guc_announcements where owner_id = $1 and read_at is null) as unread,
    (select count(*)::int from guc_materials where owner_id = $1) as materials,
    (select count(*)::int from guc_deadlines where owner_id = $1 and due >= now()) as deadlines,
    (select count(*)::int from guc_grades where owner_id = $1) as grades`, [owner]);
  return row;
}

/** Active courses first, then by season and code; each with its linked subject, unread and file counts. */
export async function courses(db: Db, owner: string): Promise<HubCourse[]> {
  const rows = await db.query<{ course_key: string; code: string; name: string; season: string; season_id: number; active: boolean; subject_id: string | null; unread: number; materials: number }>(`select c.course_key, c.code, c.name, c.season, c.season_id, c.active, l.subject_id,
      (select count(*)::int from guc_announcements a where a.owner_id = $1 and a.course_key = c.course_key and a.read_at is null) as unread,
      (select count(*)::int from guc_materials m where m.owner_id = $1 and m.course_key = c.course_key) as materials
    from guc_courses c left join subject_links l on l.owner_id = c.owner_id and l.course_key = c.course_key
    where c.owner_id = $1 order by c.active desc, c.season_id desc, c.code`, [owner]);
  return rows.map((r) => ({ key: r.course_key, code: canon(r.code), name: r.name, season: r.season, active: r.active, subjectId: r.subject_id || undefined, unread: r.unread, materials: r.materials }));
}

export async function schedule(db: Db, owner: string, weekStart: string): Promise<HubSchedule> {
  const rows = await db.query<{ slot_id: string; day: string; period: number; starts: string; ends: string; code: string; name: string; kind: string; grp: string; location: string }>(
    "select * from guc_schedule_slots where owner_id = $1 order by period, day", [owner]);
  const slots: GucSlot[] = rows.map((r) => ({ id: r.slot_id, day: r.day, period: r.period, start: r.starts, end: r.ends, code: canon(r.code), name: withCode(r.name), type: r.kind, group: r.grp, location: r.location }));
  return { weekStart, slots };
}

/** Newest first, `ANNOUNCEMENT_PAGE` at a time; `cursor` is the last row's "<ms>.<id>". */
export async function announcements(db: Db, owner: string, o: { courseKey?: string; cursor?: string } = {}): Promise<Page<HubAnnouncement>> {
  const params: unknown[] = [owner, ANNOUNCEMENT_PAGE + 1];
  let where = "a.owner_id = $1";
  if (o.courseKey) { params.push(o.courseKey); where += ` and a.course_key = $${params.length}`; }
  const at = o.cursor && /^(\d{1,15})\.([\w-]{1,100})$/.exec(o.cursor);
  if (at) { params.push(new Date(Number(at[1])), at[2]); where += ` and (date_trunc('milliseconds', a.first_seen), a.announcement_id) < ($${params.length - 1}::timestamptz, $${params.length})`; }
  const rows = await db.query<{ announcement_id: string; course_key: string; code: string | null; name: string | null; scope: "course" | "week"; week: string | null; body: string; first_seen: Date; read_at: Date | null }>(`select a.announcement_id, a.course_key, c.code, c.name, a.scope, a.week, a.body, date_trunc('milliseconds', a.first_seen) as first_seen, a.read_at
    from guc_announcements a left join guc_courses c on c.owner_id = a.owner_id and c.course_key = a.course_key
    where ${where} order by date_trunc('milliseconds', a.first_seen) desc, a.announcement_id desc limit $2`, params);
  const items = rows.slice(0, ANNOUNCEMENT_PAGE).map((r): HubAnnouncement => ({ id: r.announcement_id, courseKey: r.course_key, code: canon(r.code), course: r.name || "A course", scope: r.scope, week: r.week || undefined, text: r.body, firstSeen: ms(r.first_seen), read: !!r.read_at }));
  const last = items.at(-1);
  return { items, next: rows.length > ANNOUNCEMENT_PAGE && last ? `${last.firstSeen}.${last.id}` : undefined };
}

export async function markRead(db: Db, owner: string, ids: string[]) {
  const rows = await db.query("update guc_announcements set read_at = now() where owner_id = $1 and announcement_id = any($2::text[]) and read_at is null returning 1", [owner, ids]);
  return { marked: rows.length };
}

const weekDate = (w: string) => /(\d{4}-\d{2}-\d{2})/.exec(w)?.[1];
/** One course's files by week, newest week first, in the CMS's own order inside a week. */
export async function materials(db: Db, owner: string, courseKey: string): Promise<HubMaterials> {
  const rows = await db.query<{ material_id: string; week: string; title: string; kind: string; url: string; first_seen: Date; stored: boolean }>(`select m.material_id, m.week, m.title, m.kind, m.url, m.first_seen,
      exists (select 1 from file_objects f where f.owner_id = m.owner_id and f.file_id = 'guc:' || m.material_id) as stored
    from guc_materials m where m.owner_id = $1 and m.course_key = $2 order by m.material_id`, [owner, courseKey]);
  const weeks = new Map<string, HubMaterial[]>();
  for (const r of rows) {
    const { name, type } = materialFile(r.url, r.title);
    let week = weeks.get(r.week);
    if (!week) weeks.set(r.week, (week = []));
    week.push({ id: r.material_id, courseKey, week: r.week, title: r.title, kind: r.kind, name, type, firstSeen: ms(r.first_seen), stored: r.stored });
  }
  return { courseKey, weeks: [...weeks].map(([week, items]) => ({ week, date: weekDate(week), items })).sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.week.localeCompare(b.week)) };
}

/** File names and announcements across courses; every word must appear. */
export async function search(db: Db, owner: string, query: string, limit = 40): Promise<HubHit[]> {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1 || /\d/.test(t)).slice(0, 6);
  if (!terms.length) return [];
  const params: unknown[] = [owner, ...terms.map(like)];
  const all = (expr: string) => terms.map((_, i) => `${expr} ilike $${i + 2}`).join(" and ");
  params.push(limit);
  const lim = `$${params.length}`;
  const [files, notes] = await Promise.all([
    db.query<{ material_id: string; course_key: string; code: string | null; title: string; kind: string; week: string; url: string }>(`select m.material_id, m.course_key, c.code, m.title, m.kind, m.week, m.url
      from guc_materials m left join guc_courses c on c.owner_id = m.owner_id and c.course_key = m.course_key
      where m.owner_id = $1 and ${all("(m.title || ' ' || m.kind || ' ' || coalesce(c.code, ''))")} order by m.first_seen desc limit ${lim}`, params),
    db.query<{ announcement_id: string; course_key: string; code: string | null; name: string | null; body: string; week: string | null }>(`select a.announcement_id, a.course_key, c.code, c.name, a.body, a.week
      from guc_announcements a left join guc_courses c on c.owner_id = a.owner_id and c.course_key = a.course_key
      where a.owner_id = $1 and ${all("a.body")} order by a.first_seen desc limit ${lim}`, params),
  ]);
  const snippet = (text: string) => { const at = Math.max(0, text.toLowerCase().indexOf(terms[0]) - 50); return (at ? "…" : "") + text.slice(at, at + 160).replace(/\s+/g, " "); };
  return [
    ...files.map((m): HubHit => { const f = materialFile(m.url, m.title); return { type: "material", id: m.material_id, courseKey: m.course_key, code: canon(m.code), title: m.title, snippet: [m.kind, m.week].filter(Boolean).join(" · "), week: m.week, name: f.name, fileType: f.type }; }),
    ...notes.map((a): HubHit => ({ type: "announcement", id: a.announcement_id, courseKey: a.course_key, code: canon(a.code), title: a.name || "Announcement", snippet: snippet(a.body), week: a.week || undefined })),
  ];
}

/** Newest semester first; `fresh` when a grade came out in the last two weeks. `courseKey` keeps one course's code. */
export async function grades(db: Db, owner: string, courseKey?: string): Promise<HubGrade[]> {
  const params: unknown[] = [owner];
  let where = "g.owner_id = $1";
  if (courseKey) { params.push(courseKey); where += ` and replace(g.code, ' ', '') = (select replace(code, ' ', '') from guc_courses where owner_id = $1 and course_key = $2)`; }
  const [rows, events] = await Promise.all([
    db.query<{ grade_id: string; semester: string; code: string; name: string; hours: number | null; numeric_grade: number | null; letter: string }>(`select * from guc_grades g where ${where}`, params),
    db.query<{ event_key: string }>("select event_key from guc_events where owner_id = $1 and kind = 'new_grade' and created_at > now() - interval '14 days'", [owner]),
  ]);
  const fresh = new Set(events.map((e) => e.event_key.split(":")[1]));
  const latest = Math.max(0, ...rows.map((r) => semesterOrder(r.semester)));
  return rows.map((r): HubGrade => ({ id: r.grade_id, semester: r.semester, code: canon(r.code), name: r.name, hours: r.hours, numeric: r.numeric_grade, letter: r.letter, latest: semesterOrder(r.semester) === latest, fresh: fresh.has(r.grade_id) }))
    .sort((a, b) => semesterOrder(b.semester) - semesterOrder(a.semester) || Number(b.fresh) - Number(a.fresh) || a.code.localeCompare(b.code));
}

export async function deadlines(db: Db, owner: string): Promise<HubDeadline[]> {
  const rows = await db.query<{ deadline_id: string; course_key: string; code: string | null; title: string; due: Date; source: string }>(`select d.deadline_id, d.course_key, c.code, d.title, d.due, d.source
    from guc_deadlines d left join guc_courses c on c.owner_id = d.owner_id and c.course_key = d.course_key where d.owner_id = $1 order by d.due`, [owner]);
  return rows.map((r) => ({ id: r.deadline_id, courseKey: r.course_key, code: canon(r.code), title: r.title, due: new Date(r.due).toISOString(), source: r.source }));
}
