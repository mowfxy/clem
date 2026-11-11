// One GUC sync: the light course list, the schedule and grades, and the pages of linked courses (every active course on
// the first sync, for announcements). Unchanged pages are skipped; changes become rows, a snapshot and events.
import { diffSnapshots, newCourses, type Seen } from "../../core/guc/diff.ts";
import { extractDeadlines } from "../../core/guc/deadlines.ts";
import { formFields, parseCourseList, parseCoursePage, parseSchedule, parseTranscript, transcriptChallenge, transcriptYears, urls } from "../../core/guc/parse.ts";
import { emptySnapshot, type GucEvent, type GucProgress, type GucSnapshot, type GucSyncStats } from "../../core/guc/types.ts";
import type { Db } from "./db.ts";
import { GucError } from "./errors.ts";
import type { GucClient, PageMemo } from "./guc-client.ts";

type Previous = { data: GucSnapshot; pages: Record<string, PageMemo>; seen: Seen };
export type SyncResult = GucSyncStats & { eventList: GucEvent[]; warnings: string[] };

export async function previousSnapshot(db: Db, owner: string): Promise<Previous> {
  const [row] = await db.query<{ data: GucSnapshot; pages: Record<string, PageMemo>; seen: Seen }>("select data, pages, seen from guc_snapshots where owner_id = $1 order by id desc limit 1", [owner]);
  return row ? { data: { ...emptySnapshot(), ...row.data }, pages: row.pages, seen: row.seen } : { data: emptySnapshot(), pages: {}, seen: { courses: [], grades: false, schedule: false } };
}

export async function linkedCourses(db: Db, owner: string) {
  return (await db.query<{ course_key: string }>("select distinct course_key from subject_links where owner_id = $1", [owner])).map((r) => r.course_key);
}

/** `only`: a light sync of one course's page (just linked, or "Check now"), leaving the course list and portal as they are. */
export async function syncGuc(o: { db: Db; owner: string; client: GucClient; initial?: boolean; only?: string; now?: Date; progress?: (p: GucProgress) => void }): Promise<SyncResult> {
  const { db, owner, client } = o, started = Date.now(), now = o.now || new Date(), before = client.requests;
  const prev = await previousSnapshot(db, owner);
  const pages: Record<string, PageMemo> = { ...prev.pages }, warnings: string[] = [];
  const next: GucSnapshot = structuredClone(prev.data);
  const seen: Seen = { courses: [...prev.seen.courses], grades: prev.seen.grades, schedule: prev.seen.schedule };
  let skipped = 0, changed = 0;
  const say = (phase: GucProgress["phase"], done: number, total: number, label: string) => o.progress?.({ phase, done, total, label });

  if (!o.only) {
    say("courses", 0, 1, "Checking your courses…");
    const home = await client.page(urls.home, pages[urls.home]);
    if (home.unchanged) skipped++;
    else { next.courses = parseCourseList(home.body); pages[urls.home] = home.memo; changed++; }

    // The portal pages are optional: "available from…" or a broken layout keeps what was there.
    const portal = async (key: "schedule" | "grades", url: string, read: () => Promise<boolean>) => {
      try { if (await read()) changed++; else skipped++; if (pages[url]?.hash) seen[key] = true; }
      catch (e) { if (e instanceof GucError && (e.kind === "auth" || e.kind === "offline")) throw e; warnings.push(key + ": " + ((e as GucError).kind || (e as Error).name)); }
    };
    say("schedule", 0, 1, "Reading your schedule…");
    await portal("schedule", urls.schedule, async () => {
      const page = await client.page(urls.schedule, pages[urls.schedule]);
      if (page.unchanged) return false;
      next.slots = parseSchedule(page.body); pages[urls.schedule] = page.memo; return true;
    });
    say("grades", 0, 1, "Reading your grades…");
    await portal("grades", urls.transcript, async () => {
      let page = await client.page(urls.transcript, pages[urls.transcript]);
      if (page.unchanged) return false;
      const challenge = transcriptChallenge(page.body, page.url);
      if (challenge) page = await client.page(challenge);
      const years = transcriptYears(page.body);
      // The transcript shows a year only after its dropdown posts back; ask for the newest when it isn't shown.
      if (years && !years.latest.selected) page = await client.page(page.url, {}, { method: "POST", form: { ...formFields(page.body), [years.field]: years.latest.value, __EVENTTARGET: years.field, __EVENTARGUMENT: "" } });
      if (page.memo.hash && page.memo.hash === pages[urls.transcript]?.hash) return false;
      next.grades = parseTranscript(page.body); pages[urls.transcript] = page.memo; return true;
    });
  }

  const linked = new Set(await linkedCourses(db, owner));
  const latestSeason = Math.max(0, ...next.courses.map((c) => c.seasonId));
  const wanted = next.courses.filter((c) => (o.only ? c.key === o.only : linked.has(c.key) || (o.initial && c.active && c.seasonId === latestSeason)));
  let done = 0;
  await Promise.all(wanted.map(async (course) => {
    const url = urls.course(course.id, course.seasonId);
    try {
      const page = await client.page(url, pages[url]);
      if (page.unchanged) skipped++;
      else {
        const read = parseCoursePage(page.body, course.key);
        next.announcements = [...next.announcements.filter((a) => a.courseKey !== course.key), ...read.announcements];
        next.materials = [...next.materials.filter((m) => m.courseKey !== course.key), ...read.materials];
        const deadlines = [
          ...read.announcements.flatMap((a) => extractDeadlines(a.text, course.key, "announcement", now)),
          ...read.weeks.flatMap((w) => extractDeadlines(w.description, course.key, "week", now)),
        ];
        next.deadlines = [...next.deadlines.filter((d) => d.courseKey !== course.key), ...deadlines];
        pages[url] = page.memo; changed++;
      }
      if (!seen.courses.includes(course.key)) seen.courses.push(course.key);
    } catch (e) {
      if (e instanceof GucError && (e.kind === "auth" || e.kind === "offline")) throw e;
      warnings.push(course.code + ": " + ((e as GucError).kind || (e as Error).name));
    }
    say("course", ++done, wanted.length, `Checking your courses… ${done} of ${wanted.length}`);
  }));

  const eventList = [...diffSnapshots(prev.data, next, prev.seen), ...newCourses(prev.data, next, linked)];
  const stats: GucSyncStats = { requests: client.requests - before, skipped, changed, events: eventList.length, ms: Date.now() - started };
  await db.tx(async (t) => {
    if (changed) await save(t, owner, next);
    for (const e of eventList)
      await t.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail) values ($1, $2, $3, $4, $5, $6) on conflict do nothing", [owner, e.key, e.kind, e.courseKey ?? null, e.title, e.detail]);
    await t.query("insert into guc_snapshots (owner_id, pages, data, seen, stats) values ($1, $2, $3, $4, $5)", [owner, pages, next, seen, stats]);
    await t.query("delete from guc_snapshots where owner_id = $1 and id not in (select id from guc_snapshots where owner_id = $1 order by id desc limit 5)", [owner]);
  });
  say("done", 1, 1, "Up to date");
  return { ...stats, eventList, warnings };
}

/** Writes the normalized rows; announcements and materials keep when they were first seen and read. */
async function save(t: Db, owner: string, s: GucSnapshot) {
  await t.query("delete from guc_courses where owner_id = $1", [owner]);
  for (const c of s.courses) await t.query("insert into guc_courses values ($1, $2, $3, $4, $5, $6, $7, $8)", [owner, c.key, c.id, c.seasonId, c.season, c.code, c.name, c.active]);
  await t.query("delete from guc_schedule_slots where owner_id = $1", [owner]);
  for (const x of s.slots) await t.query("insert into guc_schedule_slots values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict do nothing", [owner, x.id, x.day, x.period, x.start, x.end, x.code, x.name, x.type, x.group, x.location]);
  await t.query("delete from guc_grades where owner_id = $1", [owner]);
  for (const g of s.grades) await t.query("insert into guc_grades values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing", [owner, g.id, g.semester, g.code, g.name, g.hours, g.numeric, g.letter]);
  await t.query("delete from guc_deadlines where owner_id = $1", [owner]);
  for (const d of s.deadlines) await t.query("insert into guc_deadlines values ($1, $2, $3, $4, $5, $6) on conflict do nothing", [owner, d.id, d.courseKey, d.title, d.due, d.source]);
  await t.query("delete from guc_announcements where owner_id = $1 and not (announcement_id = any($2::text[]))", [owner, s.announcements.map((a) => a.id)]);
  for (const a of s.announcements)
    await t.query("insert into guc_announcements (owner_id, announcement_id, course_key, scope, week, body) values ($1, $2, $3, $4, $5, $6) on conflict (owner_id, announcement_id) do nothing", [owner, a.id, a.courseKey, a.scope, a.week ?? null, a.text]);
  await t.query("delete from guc_materials where owner_id = $1 and not (material_id = any($2::text[]))", [owner, s.materials.map((m) => m.id)]);
  for (const m of s.materials)
    await t.query("insert into guc_materials (owner_id, material_id, course_key, week, title, kind, url) values ($1, $2, $3, $4, $5, $6, $7) on conflict (owner_id, material_id) do update set week = excluded.week, title = excluded.title, kind = excluded.kind, url = excluded.url", [owner, m.id, m.courseKey, m.week, m.title, m.kind, m.url]);
}
