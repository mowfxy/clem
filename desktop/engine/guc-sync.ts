// One GUC sync: the light course list, the schedule and grades, and the pages of linked courses (every active course on
// the first sync, for announcements). Unchanged pages are skipped; changes become rows, a snapshot and events.
import { diffSnapshots, newCourses, type Seen } from "../../core/guc/diff.ts";
import { extractDeadlines } from "../../core/guc/deadlines.ts";
import { courseworkOptions, formFields, nextTranscriptYear, parseCourseList, parseCoursePage, parseCoursework, parseExamSeats, parseMidterms, parseSchedule, parseTranscript, portalBounce, portalUrls, postbackForm, studyYear, transcriptYears, urls } from "../../core/guc/parse.ts";
import { readMail } from "./guc-mail.ts";
import { emptySnapshot, type GucEvent, type GucProgress, type GucSnapshot, type GucSyncStats } from "../../core/guc/types.ts";
import type { Db } from "./db.ts";
import { GucError } from "./errors.ts";
import type { Fetched, GucClient, PageMemo } from "./guc-client.ts";

type Previous = { data: GucSnapshot; pages: Record<string, PageMemo>; seen: Seen };
export type SyncResult = GucSyncStats & { eventList: GucEvent[]; warnings: string[] };

export async function previousSnapshot(db: Db, owner: string): Promise<Previous> {
  const [row] = await db.query<{ data: GucSnapshot; pages: Record<string, PageMemo>; seen: Seen }>("select data, pages, seen from guc_snapshots where owner_id = $1 order by id desc limit 1", [owner]);
  return row ? { data: { ...emptySnapshot(), ...row.data }, pages: row.pages, seen: { ...row.seen } } : { data: emptySnapshot(), pages: {}, seen: { courses: [], grades: false, schedule: false } };
}

export async function linkedCourses(db: Db, owner: string) {
  return (await db.query<{ course_key: string }>("select distinct course_key from subject_links where owner_id = $1", [owner])).map((r) => r.course_key);
}

/** `only`: a light sync of one course's page (just linked, or "Check now"), leaving the course list and portal as they are. */
/** A portal page, followed through its `sTo(…)` bounce when it answers with one (CheckGrade, the schedule, exams). */
async function portalPage(client: GucClient, url: string, memo?: PageMemo): Promise<Fetched> {
  let page = await client.page(url, memo);
  const bounce = !page.unchanged && portalBounce(page.body, page.url);
  if (bounce) page = await client.page(bounce, memo);
  return page;
}

/** The parts of GUC a sync reads. A pulse reads only the ones whose pace (PACE) has come round, so GUC is checked
 *  every few minutes in small bites instead of all at once every few hours. */
export const PARTS = ["mail", "pages", "catalog", "grades", "exams", "courses", "schedule", "transcript"] as const;
export type Part = (typeof PARTS)[number];
/** Minutes between reads of each part, daytime (Cairo). At night (01:00–07:00) they are four times as far apart.
 *  "pages" is linked courses; "catalog" is every current course (announcements and the file list, never the files). */
export const PACE: Record<Part, number> = { mail: 3, pages: 5, catalog: 20, grades: 15, exams: 30, courses: 60, schedule: 180, transcript: 360 };
/** The parts due at `now`, given when each was last read. */
export function dueParts(lastRead: Record<string, number> | undefined, now: number, cairoHour: number): Part[] {
  const night = cairoHour >= 1 && cairoHour < 7 ? 4 : 1;
  return PARTS.filter((p) => now - (lastRead?.[p] || 0) >= PACE[p] * night * 60_000 - 20_000);
}

/** `mail: false` leaves the Inbox out (tests, and a person who turned it off). `parts`: read only these (a pulse);
 *  every part when left out. */
export async function syncGuc(o: { db: Db; owner: string; client: GucClient; initial?: boolean; only?: string; now?: Date; progress?: (p: GucProgress) => void; mail?: boolean; parts?: Part[] }): Promise<SyncResult> {
  const { db, owner, client } = o, started = Date.now(), now = o.now || new Date(), before = client.requests;
  const prev = await previousSnapshot(db, owner);
  const pages: Record<string, PageMemo> = { ...prev.pages }, warnings: string[] = [];
  const next: GucSnapshot = structuredClone(prev.data);
  const seen: Seen = { ...prev.seen, courses: [...prev.seen.courses] };
  const missed: string[] = [];
  let homeBroken = false;
  const want = (p: Part) => !o.parts || o.parts.includes(p);
  const lastRead: Record<string, number> = { ...(prev.seen.lastRead || {}) };
  const readAt = (p: Part) => { lastRead[p] = Date.now(); };
  let skipped = 0, changed = 0;
  const say = (phase: GucProgress["phase"], done: number, total: number, label: string) => o.progress?.({ phase, done, total, label });

  if (!o.only) {
    say("courses", 0, 1, "Checking your courses…");
    const home = want("courses") || !next.courses.length ? await client.page(urls.home, pages[urls.home]) : undefined;
    if (home) readAt("courses");
    if (!home || home.unchanged) { if (home) skipped++; }
    else {
      // A course list Clem can't read keeps the last one, and the rest of GUC is still read.
      try { next.courses = parseCourseList(home.body); pages[urls.home] = home.memo; changed++; }
      catch (e) { if ((e as Error).name !== "SiteChanged") throw e; homeBroken = true; missed.push("courses"); warnings.push("courses: site changed"); }
    }

    // Every other page is optional: "available from…" or a broken layout keeps what was there. Only a wrong password
    // or no connection stops the sync.
    const part = async (key: string, read: () => Promise<boolean | undefined>, mark?: () => void) => {
      try { const r = await read(); if (r) changed++; else skipped++; if (r !== undefined) mark?.(); }
      catch (e) { if (e instanceof GucError && (e.kind === "auth" || e.kind === "offline")) throw e; missed.push(key); warnings.push(key + ": " + ((e as GucError).kind || (e as Error).name) + ((e as GucError).detail ? " " + (e as GucError).detail : "")); }
    };
    say("schedule", 0, 1, "Reading your schedule…");
    if (want("schedule")) await part("schedule", async () => {
      const page = await portalPage(client, urls.schedule, pages[urls.schedule]);
      if (page.unchanged) return page.unavailable ? undefined : false;
      next.slots = parseSchedule(page.body); pages[urls.schedule] = page.memo; return true;
    }, () => { seen.schedule = true; readAt("schedule"); });
    say("grades", 0, 2, "Reading this term's grades…");
    // CheckGrade: midterms, then each course's coursework, one postback at a time from the latest page's view state.
    if (want("grades")) await part("grades", async () => {
      // Coursework shows only after a postback, so the landing page's hash says nothing about it: always read.
      const page = await portalPage(client, portalUrls.grades);
      if (page.unavailable) return undefined;
      const body = page.body;
      next.midterms = parseMidterms(body);
      const list = courseworkOptions(body), work = [];
      let form = body;
      for (const [i, c] of (list?.options || []).slice(0, 15).entries()) {
        say("grades", i + 1, (list?.options.length || 0) + 1, `Reading coursework… ${i + 1} of ${list!.options.length}`);
        const res = await client.page(page.url, {}, { method: "POST", form: postbackForm(form, list!.field, c.value) });
        if (res.unavailable) break;
        work.push(parseCoursework(res.body, c));
        form = res.body;
      }
      const before = sameJson([prev.data.midterms, prev.data.coursework]);
      next.coursework = work;
      return sameJson([next.midterms, next.coursework]) !== before;
    }, () => { seen.portal = true; readAt("grades"); });
    say("exams", 0, 1, "Reading your exam seats…");
    if (want("exams")) await part("exams", async () => {
      const page = await portalPage(client, portalUrls.exams, pages[portalUrls.exams]);
      if (page.unchanged) return page.unavailable ? undefined : false;
      next.exams = parseExamSeats(page.body); pages[portalUrls.exams] = page.memo; return true;
    }, () => { seen.exams = true; readAt("exams"); });
    say("grades", 1, 2, "Reading your transcript…");
    // The landing page holds no grades (only the bounce and the year dropdown), so it is never compared: one study
    // year is posted back per sync (nextTranscriptYear), and while past years are unread the part stays due, so the
    // next pulse reads the next one.
    let transcriptMore = false;
    if (want("transcript")) await part("transcript", async () => {
      let page = await client.page(urls.transcript);
      const challenge = !page.unavailable && portalBounce(page.body, page.url);
      if (challenge) page = await client.page(challenge);
      if (page.unavailable) return undefined;
      const years = transcriptYears(page.body);
      if (!years) { const before = sameJson(next.grades); next.grades = parseTranscript(page.body); return sameJson(next.grades) !== before; }
      const pick = nextTranscriptYear(years.options, seen.transcript, now);
      if (!pick) return false;
      const { year } = pick;
      if (year.text !== years.options.find((o) => o.selected)?.text) page = await client.page(page.url, {}, { method: "POST", form: { ...formFields(page.body), [years.field]: year.value, __EVENTTARGET: years.field, __EVENTARGUMENT: "" } });
      if (page.unavailable) return undefined;
      const grades = parseTranscript(page.body, year.text);
      const state: NonNullable<Seen["transcript"]> = { at: { ...seen.transcript?.at, [year.text]: Date.now() }, ...(seen.transcript?.end ? { end: seen.transcript.end } : {}) };
      // A past year with no grades is before the student started (GUC still shows it empty semester tables): no older
      // year is read.
      if (!grades.length && Number(/20\d{2}/.exec(year.text)?.[0]) < studyYear(now)) { state.end = year.text; transcriptMore = false; }
      else transcriptMore = pick.more;
      seen.transcript = state;
      const before = sameJson(next.grades);
      // Grades read before years were tracked (no year) are replaced as the years come in.
      next.grades = [...next.grades.filter((g) => g.year && g.year !== year.text), ...grades];
      return sameJson(next.grades) !== before;
    }, () => { seen.grades = true; if (!transcriptMore) readAt("transcript"); });
    if (o.mail !== false && want("mail")) {
      say("mail", 0, 1, "Checking your GUC mail…");
      // Mail is its own server: anything but no connection there (even a refused sign-in) is skipped, not a reason to
      // pause the rest of GUC.
      try {
        const m = await readMail(client, seen.mailIds, prev.data.mail);
        next.mail = m.mail; seen.mailIds = m.seen; readAt("mail");
        if (m.fresh.length || !prev.seen.mailIds) changed++; else skipped++;
      } catch (e) {
        if (e instanceof GucError && e.kind === "offline") throw e;
        missed.push("mail"); warnings.push("mail: " + ((e as GucError).kind || (e as Error).name) + ((e as GucError).detail ? " " + (e as GucError).detail : ""));
      }
    }
  }

  const linked = new Set(await linkedCourses(db, owner));
  const latestSeason = Math.max(0, ...next.courses.map((c) => c.seasonId));
  // A pulse reads the linked courses' pages (conditionally: an unchanged page is one cheap request) when they are due,
  // and every current course's page at the catalog's slower pace, so each course's announcements and file list are
  // there for the hub and the AI whether or not it is linked. Reading a page lists files; it never downloads them.
  const current = (c: (typeof next.courses)[number]) => c.active && c.seasonId === latestSeason;
  const all = !o.only && (o.initial || want("catalog"));
  const wanted = o.only ? next.courses.filter((c) => c.key === o.only)
    : next.courses.filter((c) => (want("pages") && linked.has(c.key)) || (all && current(c)));
  if (!o.only && want("pages")) readAt("pages");
  if (all) readAt("catalog");
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
  const stats: GucSyncStats = { requests: client.requests - before, skipped, changed, events: eventList.length, ms: Date.now() - started, ...(missed.length ? { missed } : {}) };
  await db.tx(async (t) => {
    if (changed) await save(t, owner, next);
    if (eventList.length) await t.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail) select $1::text, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) on conflict do nothing",
      [owner, ...columns(eventList, (e) => e.key, (e) => e.kind, (e) => e.courseKey ?? null, (e) => e.title, (e) => e.detail)]);
    // A pulse that found nothing new only moves the latest snapshot's memos and read times (no new row every few minutes).
    const quiet = !!o.parts && !changed && !eventList.length && (await t.query("update guc_snapshots set pages = $2, seen = $3 where owner_id = $1 and id = (select max(id) from guc_snapshots where owner_id = $1) returning 1", [owner, pages, { ...seen, lastRead }])).length > 0;
    if (!quiet) await t.query("insert into guc_snapshots (owner_id, pages, data, seen, stats) values ($1, $2, $3, $4, $5)", [owner, pages, next, { ...seen, lastRead }, stats]);
    await t.query("delete from guc_snapshots where owner_id = $1 and id not in (select id from guc_snapshots where owner_id = $1 order by id desc limit 5)", [owner]);
  });
  // What else was read is saved; the course list GUC changed is still a failure the person is told about.
  if (homeBroken) throw new GucError("site_changed", "course list");
  say("done", 1, 1, "Up to date");
  return { ...stats, eventList, warnings };
}

/** JSON with object keys sorted: the database (jsonb) keeps keys in its own order. */
const sameJson = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
/** Columns of `rows`, one array per field, for `insert … select … from unnest(…)`: a table in one statement. */
const columns = <T,>(rows: T[], ...fields: ((r: T) => unknown)[]) => fields.map((f) => rows.map(f));
/** The last row of each id (a page that lists a file twice keeps its last entry, as row-by-row upserts did). */
const lastOf = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((r) => [r.id, r])).values()];

/** Writes the normalized rows, one statement per table (not one per row); announcements and materials keep when they
 *  were first seen and read. */
async function save(t: Db, owner: string, s: GucSnapshot) {
  await t.query("delete from guc_courses where owner_id = $1", [owner]);
  await t.query("insert into guc_courses select $1::text, * from unnest($2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::bool[])",
    [owner, ...columns(s.courses, (c) => c.key, (c) => c.id, (c) => c.seasonId, (c) => c.season, (c) => c.code, (c) => c.name, (c) => c.active)]);
  await t.query("delete from guc_schedule_slots where owner_id = $1", [owner]);
  await t.query("insert into guc_schedule_slots select $1::text, * from unnest($2::text[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[]) on conflict do nothing",
    [owner, ...columns(s.slots, (x) => x.id, (x) => x.day, (x) => x.period, (x) => x.start, (x) => x.end, (x) => x.code, (x) => x.name, (x) => x.type, (x) => x.group, (x) => x.location)]);
  await t.query("delete from guc_grades where owner_id = $1", [owner]);
  await t.query("insert into guc_grades select $1::text, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::real[], $8::text[]) on conflict do nothing",
    [owner, ...columns(s.grades, (g) => g.id, (g) => g.semester, (g) => g.code, (g) => g.name, (g) => g.hours, (g) => g.numeric, (g) => g.letter)]);
  await t.query("delete from guc_deadlines where owner_id = $1", [owner]);
  await t.query("insert into guc_deadlines select $1::text, * from unnest($2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[]) on conflict do nothing",
    [owner, ...columns(s.deadlines, (d) => d.id, (d) => d.courseKey, (d) => d.title, (d) => d.due, (d) => d.source)]);
  await t.query("delete from guc_announcements where owner_id = $1 and not (announcement_id = any($2::text[]))", [owner, s.announcements.map((a) => a.id)]);
  await t.query("insert into guc_announcements (owner_id, announcement_id, course_key, scope, week, body) select $1::text, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) on conflict (owner_id, announcement_id) do nothing",
    [owner, ...columns(s.announcements, (a) => a.id, (a) => a.courseKey, (a) => a.scope, (a) => a.week ?? null, (a) => a.text)]);
  await t.query("delete from guc_materials where owner_id = $1 and not (material_id = any($2::text[]))", [owner, s.materials.map((m) => m.id)]);
  await t.query("insert into guc_materials (owner_id, material_id, course_key, week, title, kind, url) select $1::text, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) on conflict (owner_id, material_id) do update set week = excluded.week, title = excluded.title, kind = excluded.kind, url = excluded.url",
    [owner, ...columns(lastOf(s.materials), (m) => m.id, (m) => m.courseKey, (m) => m.week, (m) => m.title, (m) => m.kind, (m) => m.url)]);
}
