// Subjects and their GUC courses (docs/GUC-VPS-ENGINE.md → Subject setup): links, settings and the live view the cards
// read, and the new courses a sync found. Every query filters on owner_id.
import { normCode, sameCode } from "../../core/guc/codes.ts";
import { defaultCheckSchedule, nextCheck } from "../../core/guc/schedule-rules.ts";
import { mergeSettings, type InboxItem, type NewCourse, type SettingsPatch, type SubjectLink, type SubjectSettings, type SubjectView } from "../../core/guc/settings.ts";
import type { GucSlot } from "../../core/guc/types.ts";
import type { Db } from "./db.ts";
import { GucError } from "./errors.ts";
import { courses as readCourses } from "./guc-read.ts";
import { driveState } from "./drive-mirror.ts";

const ms = (t: Date | string | null) => (t ? new Date(t).getTime() : 0);

export async function links(db: Db, owner: string): Promise<SubjectLink[]> {
  const rows = await db.query<{ subject_id: string; course_key: string; code: string | null; name: string | null; season: string | null; linked_at: Date }>(`select l.subject_id, l.course_key, c.code, c.name, c.season, l.linked_at
    from subject_links l left join guc_courses c on c.owner_id = l.owner_id and c.course_key = l.course_key where l.owner_id = $1 order by l.linked_at`, [owner]);
  return rows.map((r) => ({ subjectId: r.subject_id, courseKey: r.course_key, code: normCode(r.code || "") || r.code || "", name: r.name || "A course", season: r.season || "", linkedAt: ms(r.linked_at) }));
}

/** Links `subjectId` to `courseKey`. A course belongs to one subject: linking it here unlinks it from any other. */
export async function link(db: Db, owner: string, subjectId: string, courseKey: string) {
  const [course] = await db.query("select 1 from guc_courses where owner_id = $1 and course_key = $2", [owner, courseKey]);
  if (!course) throw new GucError("unavailable", "no such course", "That course isn't in your CMS list any more. Sync and try again.");
  return db.tx(async (t) => {
    const [was] = await t.query<{ subject_id: string }>("delete from subject_links where owner_id = $1 and course_key = $2 and subject_id <> $3 returning subject_id", [owner, courseKey, subjectId]);
    await t.query("insert into subject_links (owner_id, subject_id, course_key) values ($1, $2, $3) on conflict (owner_id, subject_id) do update set course_key = excluded.course_key, linked_at = now()", [owner, subjectId, courseKey]);
    return { movedFrom: was?.subject_id as string | undefined };
  });
}
export async function unlink(db: Db, owner: string, subjectId: string) {
  return (await db.query("delete from subject_links where owner_id = $1 and subject_id = $2 returning course_key", [owner, subjectId])).length > 0;
}

export async function settings(db: Db, owner: string, subjectId: string): Promise<SubjectSettings> {
  const [row] = await db.query<{ settings: Partial<SubjectSettings> }>("select settings from subject_settings where owner_id = $1 and subject_id = $2", [owner, subjectId]);
  return mergeSettings(row?.settings, {});
}
export async function saveSettings(db: Db, owner: string, subjectId: string, patch: SettingsPatch) {
  return db.tx(async (t) => {
    const next = mergeSettings((await settings(t, owner, subjectId)), patch);
    await t.query("insert into subject_settings (owner_id, subject_id, settings) values ($1, $2, $3) on conflict (owner_id, subject_id) do update set settings = excluded.settings", [owner, subjectId, next]);
    return next;
  });
}
/** A deleted subject: its link and settings go; the course's files stay until GUC is disconnected. */
export async function forget(db: Db, owner: string, subjectId: string) {
  await db.tx(async (t) => {
    await t.query("delete from subject_links where owner_id = $1 and subject_id = $2", [owner, subjectId]);
    await t.query("delete from subject_settings where owner_id = $1 and subject_id = $2", [owner, subjectId]);
  });
}

/** Everything a subject's cards and its page show, fresh: course, settings (with the suggested check when none was
 *  chosen), next check, the course's classes and the files kept. */
export async function view(db: Db, owner: string, subjectId: string, o: { now?: number; vps?: boolean } = {}): Promise<SubjectView> {
  const [all, s, [l]] = await Promise.all([readCourses(db, owner), settings(db, owner, subjectId), db.query<{ course_key: string; linked_at: Date }>("select course_key, linked_at from subject_links where owner_id = $1 and subject_id = $2", [owner, subjectId])]);
  const course = l && all.find((c) => c.key === l.course_key);
  const rows = course ? await db.query<{ slot_id: string; day: string; period: number; starts: string; ends: string; code: string; name: string; kind: string; grp: string; location: string }>("select * from guc_schedule_slots where owner_id = $1 order by period", [owner]) : [];
  const slots: GucSlot[] = rows.map((r) => ({ id: r.slot_id, day: r.day, period: r.period, start: r.starts, end: r.ends, code: normCode(r.code) || r.code, name: r.name, type: r.kind, group: r.grp, location: r.location })).filter((x) => course && sameCode(x.code, course.code));
  const suggested = defaultCheckSchedule(slots, course?.code || "");
  const check = s.check || suggested;
  const [[kept], drive, [last]] = await Promise.all([
    course ? db.query<{ files: number; bytes: string | null }>(`select count(*)::int as files, sum(f.size) as bytes from file_objects f
      join guc_materials m on m.owner_id = f.owner_id and f.file_id = 'guc:' || m.material_id where f.owner_id = $1 and m.course_key = $2`, [owner, course.key]) : Promise.resolve([] as { files: number; bytes: string | null }[]),
    driveState(db, owner, subjectId, s.drive.enabled, s.drive.folderId || undefined),
    db.query<{ at: Date; saved: number; error: string | null }>("select at, saved, error from guc_checks where owner_id = $1 and subject_id = $2 order by id desc limit 1", [owner, subjectId]),
  ]);
  return {
    subjectId, course: course ? { ...course, linkedAt: ms(l.linked_at) } : undefined, settings: { ...s, check }, suggested,
    nextCheck: course ? nextCheck(check, o.now ?? Date.now()) : undefined, slots,
    storage: { files: kept?.files || 0, bytes: Number(kept?.bytes || 0) }, vps: !!o.vps,
    drive: { ...drive, path: s.drive.folderId && s.drive.folderName ? s.drive.folderName : `Clem/GUC/${course ? `${course.code} ${course.name}`.trim() : "…"}` },
    ...(last ? { lastCheck: { at: ms(last.at), saved: last.saved, ...(last.error ? { error: last.error } : {}) } } : {}),
  };
}

/** New-term courses a sync found that no subject has taken since and the main thread hasn't been told about. */
export async function newCourses(db: Db, owner: string): Promise<NewCourse[]> {
  const rows = await db.query<{ course_key: string; code: string; name: string; season: string }>(`select c.course_key, c.code, c.name, c.season from guc_events e
    join guc_courses c on c.owner_id = e.owner_id and c.course_key = e.course_key
    where e.owner_id = $1 and e.kind = 'new_course'
      and not exists (select 1 from subject_links l where l.owner_id = e.owner_id and l.course_key = e.course_key)
      and not exists (select 1 from notifications_sent n where n.owner_id = e.owner_id and n.event_key = e.event_key and n.channel = 'thread')
    order by c.code`, [owner]);
  return rows.map((r) => ({ key: r.course_key, code: normCode(r.code) || r.code, name: r.name, season: r.season }));
}
export async function ackNewCourses(db: Db, owner: string, keys: string[]) {
  for (const key of keys) await db.query("insert into notifications_sent (owner_id, event_key, channel) values ($1, $2, 'thread') on conflict do nothing", [owner, "course:" + key]);
}

const INBOX = ["file_saved", "new_announcement", "new_grade", "deadline_added", "deadline_changed"];
/** Saved files and news of linked courses since they were linked that the window hasn't shown (channel 'thread'). */
export async function inbox(db: Db, owner: string): Promise<InboxItem[]> {
  const rows = await db.query<{ event_key: string; kind: InboxItem["kind"]; course_key: string; title: string; detail: string; created_at: Date; subject_id: string }>(`select e.event_key, e.kind, e.course_key, e.title, e.detail, e.created_at, l.subject_id from guc_events e
    join subject_links l on l.owner_id = e.owner_id and l.course_key = e.course_key
    where e.owner_id = $1 and e.kind = any($2::text[]) and e.created_at >= l.linked_at
      and not exists (select 1 from notifications_sent n where n.owner_id = e.owner_id and n.event_key = e.event_key and n.channel = 'thread')
    order by e.created_at, e.event_key limit 300`, [owner, INBOX]);
  return rows.map((r) => {
    const base = { key: r.event_key, subjectId: r.subject_id, kind: r.kind, courseKey: r.course_key, title: r.title, detail: r.detail, at: ms(r.created_at) };
    if (r.kind !== "file_saved") return base;
    try { const d = JSON.parse(r.detail); return { ...base, detail: "", file: { id: String(d.id), name: r.title, size: Number(d.size) || 0, type: String(d.type || "application/octet-stream"), week: d.week || undefined } }; }
    catch { return base; }
  });
}
export async function ackInbox(db: Db, owner: string, keys: string[]) {
  for (const key of keys) await db.query("insert into notifications_sent (owner_id, event_key, channel) values ($1, $2, 'thread') on conflict do nothing", [owner, key]);
}
