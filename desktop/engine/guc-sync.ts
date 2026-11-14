// One GUC sync: the light course list, the schedule and grades, and the pages of linked courses (every active course on
// the first sync, for announcements). Unchanged pages are skipped; changes become rows, a snapshot and events.
import { announcementEdits, bareText, diffSnapshots, newCourses, type AnnouncementEdit, type Seen } from "../../core/guc/diff.ts";
import { courseDeadlines, DEADLINE_VERSION, fileUpdate } from "../../core/guc/deadlines.ts";
import { applyReader, courseTexts, fileText, isSeatingFile, mailTexts, readerPrompt, type CourseText } from "../../core/guc/deadline-ai.ts";
import { DONE_DAYS, endsAt, materialFile, weekLabel } from "../../core/guc/hub.ts";
import { extractText } from "./file-text.ts";
import { mailAbout } from "../../core/guc/mail-about.ts";
import { slotCourse } from "../../core/guc/match.ts";
import { stableId } from "../../core/guc/parse.ts";
import { parseModelJson } from "../../core/model-json.ts";
import { sameCode } from "../../core/guc/codes.ts";
import { ANNOUNCEMENT_VERSION, courseworkOptions, formFields, nextTranscriptYear, parseCourseList, parseCoursePage, parseCoursework, parseExamSeats, parseMidterms, parseSchedule, parseTranscript, portalBounce, portalUrls, postbackForm, studyYear, transcriptYears, urls } from "../../core/guc/parse.ts";
import { readMail } from "./guc-mail.ts";
import { withOpened } from "./guc-read.ts";
import { emptySnapshot, type GucCourse, type GucDeadline, type GucEvent, type GucProgress, type GucSnapshot, type GucSyncStats } from "../../core/guc/types.ts";
import type { Db } from "./db.ts";
import { GucError } from "./errors.ts";
import { fetchFile, fileSize, type Fetched, type GucClient, type PageMemo } from "./guc-client.ts";

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

/** How long one deadline reader call may take, how many run at once, and how many times the same texts are tried
 *  before the rule reader's answer is kept until they change. */
export const READER_MS = 60_000, READERS_AT_ONCE = 2, READER_TRIES = 3;
/** Seating plans and schedules uploaded as files: at most this many read a sync, this big, tried this many times. */
export const FILES_PER_SYNC = 3, FILE_MAX_BYTES = 8 * 1024 * 1024, FILE_TRIES = 3;
/** How long one course page may hold up the sync; a slower one is read again next pulse. */
export const PAGE_MS = 45_000;
const within = <T,>(p: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => { const t = setTimeout(() => reject(new Error("timeout")), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });
/** `fn` over `items`, at most `n` at a time. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x); }));
}

/** `mail: false` leaves the Inbox out (tests, and a person who turned it off). `parts`: read only these (a pulse);
 *  every part when left out. */
export async function syncGuc(o: { db: Db; owner: string; client: GucClient; initial?: boolean; only?: string; now?: Date; progress?: (p: GucProgress) => void; mail?: boolean; parts?: Part[]; /** The main thread's model, to read deadlines (core/guc/deadline-ai.ts); left out, the rule reader does. */ reader?: (ask: { system: string; user: string }) => Promise<string | null>; /** How long one model call may take (READER_MS). */ readerMs?: number }): Promise<SyncResult> {
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
        const full = !lastRead.mailFull || now.getTime() - lastRead.mailFull > 864e5;
        const m = await readMail(client, seen.mailIds, prev.data.mail, { full });
        // A new mail about one of the student's courses keeps 2,000 characters of its body for that course's deadline
        // reader; the Mail tab still shows the preview.
        const theirs = new Set(m.fresh.filter((x) => mailAbout(x, { courses: next.courses, username: client.username }).about === "course").map((x) => x.id));
        next.mail = m.mail.map((x) => (theirs.has(x.id) && m.bodies.get(x.id) ? { ...x, text: m.bodies.get(x.id) } : x)); seen.mailIds = m.seen; readAt("mail");
        if (full) lastRead.mailFull = Date.now();
        if (m.fresh.length || !prev.seen.mailIds) changed++; else skipped++;
      } catch (e) {
        if (e instanceof GucError && e.kind === "offline") throw e;
        missed.push("mail"); warnings.push("mail: " + ((e as GucError).kind || (e as Error).name) + ((e as GucError).detail ? " " + (e as GucError).detail : ""));
      }
    }
  }

  // Classes belong to their courses: the portal's schedule cell names the course, so each slot's code is resolved from
  // the course list on every sync (stored slots are fixed without the schedule page changing). The schedule's hash
  // reads the portal's own words, so this is never "your schedule changed"; slot ids are the portal's too and stay.
  const resolved = next.slots.map((x) => { const c = slotCourse(x.name || x.code, next.courses); return c && c.code !== x.code ? { ...x, code: c.code } : x; });
  if (sameJson(resolved) !== sameJson(next.slots)) { next.slots = resolved; changed++; }

  // Deadlines read by an older extractor are replaced: their course pages are read again (not skipped as unchanged),
  // and what the new one finds is a baseline, not news (core/guc/diff.ts).
  const same = prev.seen.deadlines?.v === DEADLINE_VERSION;
  const fresh = new Set(same ? prev.seen.deadlines!.courses : []);
  const textsRead: Record<string, string[]> = same ? { ...prev.seen.deadlines!.read } : {};
  const fails: Record<string, { texts: string; n: number }> = same ? { ...prev.seen.deadlines!.fails } : {};
  const deadlines: GucDeadline[] = same ? [...prev.data.deadlines] : [];
  // The same for the announcement reader: a course whose page an older reader read is read again once (page memo
  // ignored), its posts are a baseline (diff.ts) and their read state carries over from the old rows (save).
  const annRead = new Set(prev.seen.announcements?.v === ANNOUNCEMENT_VERSION ? prev.seen.announcements.courses : []);
  const switched = new Set<string>();
  const linked = new Set(await linkedCourses(db, owner));
  const latestSeason = Math.max(0, ...next.courses.map((c) => c.seasonId));
  // A pulse reads the linked courses' pages (conditionally: an unchanged page is one cheap request) when they are due,
  // and every current course's page at the catalog's slower pace, so each course's announcements and file list are
  // there for the hub and the AI whether or not it is linked. Reading a page lists files; it never downloads them. A page
  // that failed last time is read again on this pulse, whatever its pace.
  const current = (c: (typeof next.courses)[number]) => c.active && c.seasonId === latestSeason;
  const all = !o.only && (o.initial || want("catalog"));
  const retry = new Set(prev.seen.retry || []), failed = new Set<string>();
  const wanted = o.only ? next.courses.filter((c) => c.key === o.only)
    : next.courses.filter((c) => (want("pages") && linked.has(c.key)) || (all && current(c)) || retry.has(c.key));
  if (!o.only && want("pages")) readAt("pages");
  if (all) readAt("catalog");
  const read = new Map<string, { course: GucCourse; texts: CourseText[]; url: string; memo: PageMemo }>();
  let done = 0;
  // Two at a time per host (the client's limit), and one slow page holds nothing up for long: past PAGE_MS it is left
  // for the next pulse. No connection, or a wrong password, still stops the sync before anything is saved.
  await Promise.all(wanted.map(async (course) => {
    const url = urls.course(course.id, course.seasonId);
    try {
      const page = await within(client.page(url, fresh.has(course.key) && annRead.has(course.key) ? pages[url] : undefined), PAGE_MS);
      if (page.unchanged) skipped++;
      else {
        const parsed = parseCoursePage(page.body, course.key);
        if (!annRead.has(course.key)) switched.add(course.key);
        next.announcements = [...next.announcements.filter((a) => a.courseKey !== course.key), ...parsed.announcements];
        next.materials = [...next.materials.filter((m) => m.courseKey !== course.key), ...parsed.materials];
        read.set(course.key, { course, texts: courseTexts(parsed, now.getTime()), url, memo: page.memo });
        changed++;
      }
      if (!seen.courses.includes(course.key)) seen.courses.push(course.key);
    } catch (e) {
      if (e instanceof GucError && (e.kind === "auth" || e.kind === "offline")) throw e;
      failed.add(course.key);
      warnings.push(course.code + ": " + ((e as GucError).kind || (e as Error).message || (e as Error).name));
    }
    say("course", ++done, wanted.length, `Checking your courses… ${done} of ${wanted.length}`);
  }));
  seen.retry = [...failed];

  // News first: everything read so far is saved and its events written now; deadlines (which may wait on a model) are
  // read after, in the second step below, and land as their own update of the same snapshot.
  seen.announcements = { v: ANNOUNCEMENT_VERSION, courses: [...annRead] };
  next.deadlines = prev.data.deadlines;
  const eventList = [...diffSnapshots(prev.data, next, prev.seen, now.getTime(), { username: client.username }), ...newCourses(prev.data, next, linked)];
  const stats: GucSyncStats = { requests: client.requests - before, skipped, changed, events: eventList.length, ms: Date.now() - started, ...(missed.length ? { missed } : {}) };
  await db.tx(async (t) => {
    // A message opened in the hub while this sync ran is read too (markMailOpened wrote it to the latest snapshot).
    const [cur] = await t.query<{ seen: Seen }>("select seen from guc_snapshots where owner_id = $1 order by id desc limit 1", [owner]);
    if (cur?.seen?.mailRead?.length) seen.mailRead = [...new Set([...(seen.mailRead || []), ...cur.seen.mailRead])].slice(-500);
    if (next.mail) next.mail = withOpened(next.mail, seen.mailRead);
    if (changed) await save(t, owner, next, { switched, edits: announcementEdits(prev.data.announcements, next.announcements) });
    await events(t, owner, eventList);
    // A pulse that found nothing new only moves the latest snapshot's memos and read times (no new row every few minutes).
    const quiet = !!o.parts && !changed && !eventList.length && (await t.query("update guc_snapshots set pages = $2, seen = $3 where owner_id = $1 and id = (select max(id) from guc_snapshots where owner_id = $1) returning 1", [owner, pages, { ...seen, lastRead }])).length > 0;
    if (!quiet) await t.query("insert into guc_snapshots (owner_id, pages, data, seen, stats) values ($1, $2, $3, $4, $5)", [owner, pages, next, { ...seen, lastRead }, stats]);
    await t.query("delete from guc_snapshots where owner_id = $1 and id not in (select id from guc_snapshots where owner_id = $1 order by id desc limit 5)", [owner]);
  });
  say("saved", 1, 2, "Reading deadlines…");

  // ---------- Second step: deadlines ----------
  // Each course whose page was read, and each course with a new mail about it, has its unread texts read: by the model
  // (READERS_AT_ONCE at a time, READER_MS each) when there is one, else by the rules. A model that doesn't answer leaves
  // the rules' answer and the texts unread, so they are tried again next pulse, READER_TRIES times; then the rules'
  // answer stands until the texts change. A course a new announcement reader just read again reads every text once (the
  // diff makes what it finds a baseline).
  const at = now.getTime(), who = { courses: next.courses, username: client.username, now: at };
  const jobs = new Map<string, { course: GucCourse; texts: CourseText[]; page?: { url: string; memo: PageMemo } }>();
  for (const [key, r] of read) jobs.set(key, { course: r.course, texts: [...r.texts, ...mailTexts(next.mail || [], r.course, who)], page: { url: r.url, memo: r.memo } });
  for (const course of next.courses.filter(current)) if (!jobs.has(course.key) && fresh.has(course.key)) {
    const mail = mailTexts(next.mail || [], course, who), had = new Set(textsRead[course.key] || []);
    if (mail.some((t) => !had.has(t.id))) jobs.set(course.key, { course, texts: mail });
  }
  // Seating plans and schedules uploaded as files: the one kind of CMS file Clem reads on its own (cost). Only a file new
  // since the course's last read (never on a course's first read or a reader's re-read), whose title or name says it is
  // one (isSeatingFile), on a GUC host, at most FILE_MAX_BYTES (asked with HEAD first; an unknown size is checked once
  // fetched), FILES_PER_SYNC a sync. Its text (trimmed to the student's rows, fileText) is one more text for that
  // course's reader. The bytes are never stored and the file isn't marked saved. Each is read once (`seen.files.read`); a
  // failure is skipped quietly and tried again on the next syncs, FILE_TRIES times in all.
  const files = { read: [...(prev.seen.files?.read || [])], tries: { ...(prev.seen.files?.tries || {}) } };
  const known = new Set(prev.data.materials.map((m) => m.id)), readFiles = new Set(files.read);
  const candidates = next.materials.filter((m) => !readFiles.has(m.id) && /^https:\/\/([\w-]+\.)*guc\.edu\.eg\//.test(m.url) && !/^(link|video)$/i.test(m.kind)
    && (files.tries[m.id] !== undefined || (same && !known.has(m.id) && read.has(m.courseKey) && !switched.has(m.courseKey) && prev.seen.courses.includes(m.courseKey)))
    && isSeatingFile(m.title, materialFile(m.url, m.title).name)).slice(0, FILES_PER_SYNC);
  for (const m of candidates) {
    const course = next.courses.find((c) => c.key === m.courseKey);
    if (!course) continue;
    try {
      const size = await fileSize(client, m.url);
      if (!size || size <= FILE_MAX_BYTES) {
        const f = await fetchFile(client, m.url);
        if (f.bytes.length <= FILE_MAX_BYTES) {
          const t = await extractText(f.bytes, materialFile(m.url, m.title).name, f.type);
          const text = fileText(t.parts.join("\n"), { slots: next.slots.filter((x) => sameCode(x.code, course.code)), username: client.username });
          const ct: CourseText = { id: stableId("file|" + m.id), source: "file", label: `File: ${m.title} (${weekLabel(m.week)})`, text };
          const job = jobs.get(course.key);
          if (job) job.texts.push(ct); else jobs.set(course.key, { course, texts: [ct] });
        }
      }
      files.read.push(m.id); delete files.tries[m.id];
    } catch (e) {
      const n = (files.tries[m.id] || 0) + 1;
      if (n >= FILE_TRIES) { files.read.push(m.id); delete files.tries[m.id]; } else files.tries[m.id] = n;
      warnings.push(`${course.code}: couldn't read "${m.title}" (${(e as Error).message || "error"})`);
    }
  }
  seen.files = { read: files.read.slice(-500), tries: files.tries };
  await pool([...jobs.values()], READERS_AT_ONCE, async ({ course, texts, page }) => {
    const had = new Set(switched.has(course.key) ? [] : textsRead[course.key] || []);
    const unread = texts.filter((t) => !had.has(t.id));
    const tracked = deadlines.filter((d) => d.courseKey === course.key && Date.parse(d.due) >= at - 30 * 864e5);
    let list = tracked, ok = true;
    if (unread.length) {
      const sig = stableId(unread.map((t) => t.id).sort().join("|")), tries = fails[course.key]?.texts === sig ? fails[course.key].n : 0;
      let ai: GucDeadline[] | null = null;
      if (o.reader && tries < READER_TRIES) {
        const input = { course, slots: next.slots, texts: unread, tracked, now: at, exams: (next.exams || []).filter((e) => sameCode(e.code, course.code)) };
        try { const raw = await within(o.reader(readerPrompt(input)), o.readerMs ?? READER_MS); ai = raw == null ? null : applyReader(parseModelJson(raw), input); } catch { ai = null; }
        if (!ai) { ok = tries + 1 >= READER_TRIES; fails[course.key] = { texts: sig, n: tries + 1 }; warnings.push(course.code + ": deadline reader didn't answer"); }
        else delete fails[course.key];
      }
      if (ai) list = ai;
      else {
        const mine = next.slots.filter((x) => sameCode(x.code, course.code));
        const rules = new Map(courseDeadlines(unread.filter((t) => t.source !== "file").map((t) => ({ text: t.text, source: t.source })), course.key, now, mine).map((d) => [d.id, d]));
        list = [...tracked.filter((d) => !rules.has(d.id)), ...rules.values()];
        // A file sets the room (and time) of the item its title names, for the student's group's row; unsure: nothing.
        for (const f of unread.filter((t) => t.source === "file")) { const u = fileUpdate({ title: f.label.replace(/^File: /, "").replace(/ \([^)]*\)$/, ""), text: f.text }, list, mine); if (u) list = list.map((d) => (d.id === u.id ? u : d)); }
      }
    }
    deadlines.splice(0, deadlines.length, ...deadlines.filter((d) => d.courseKey !== course.key), ...list);
    // A course the switch read counts as read by this reader only once its deadlines were read too, so a model that
    // didn't answer leaves the next read a baseline as well.
    if (ok) {
      textsRead[course.key] = page ? texts.map((t) => t.id) : [...new Set([...(textsRead[course.key] || []), ...texts.map((t) => t.id)])];
      fresh.add(course.key);
      if (page) { pages[page.url] = page.memo; annRead.add(course.key); }
    }
  });
  // Done 14 days ago: gone (the hub shows the rest under Done).
  next.deadlines = deadlines.filter((d) => endsAt(d) > at - DONE_DAYS * 864e5).sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
  seen.deadlines = { v: DEADLINE_VERSION, courses: [...fresh], read: textsRead, ...(Object.keys(fails).length ? { fails } : {}) };
  seen.announcements = { v: ANNOUNCEMENT_VERSION, courses: [...annRead] };
  const before2 = { ...emptySnapshot(), courses: next.courses, deadlines: prev.data.deadlines }, after2 = { ...emptySnapshot(), courses: next.courses, deadlines: next.deadlines };
  const deadlineEvents = diffSnapshots(before2, after2, { courses: prev.seen.courses, grades: false, schedule: false, deadlines: prev.seen.deadlines, announcements: prev.seen.announcements }, at);
  if (jobs.size || sameJson(next.deadlines) !== sameJson(prev.data.deadlines) || sameJson(seen.deadlines) !== sameJson(prev.seen.deadlines)) await db.tx(async (t) => {
    await saveDeadlines(t, owner, next.deadlines);
    await events(t, owner, deadlineEvents);
    await t.query("update guc_snapshots set pages = $2, seen = $3, data = jsonb_set(data, '{deadlines}', $4::jsonb) where owner_id = $1 and id = (select max(id) from guc_snapshots where owner_id = $1)", [owner, pages, { ...seen, lastRead }, JSON.stringify(next.deadlines)]);
  });
  eventList.push(...deadlineEvents);
  stats.events = eventList.length; stats.ms = Date.now() - started;
  // What else was read is saved; the course list GUC changed is still a failure the person is told about.
  if (homeBroken) throw new GucError("site_changed", "course list");
  say("done", 1, 1, "Up to date");
  return { ...stats, eventList, warnings };
}

/** Events, once each (a key already there is skipped). */
async function events(t: Db, owner: string, list: GucEvent[]) {
  if (list.length) await t.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail) select $1::text, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) on conflict do nothing",
    [owner, ...columns(list, (e) => e.key, (e) => e.kind, (e) => e.courseKey ?? null, (e) => e.title, (e) => e.detail)]);
}
/** The tracked items (Coming up's rows besides exam seats), replaced as a whole. */
async function saveDeadlines(t: Db, owner: string, list: GucDeadline[]) {
  await t.query("delete from guc_deadlines where owner_id = $1", [owner]);
  await t.query(`insert into guc_deadlines (owner_id, deadline_id, course_key, title, due, source, note, kind, place, covers, time_known, either)
    select $1::text, * from unnest($2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::bool[], $12::text[]) on conflict do nothing`,
    [owner, ...columns(lastOf(list), (d) => d.id, (d) => d.courseKey, (d) => d.title, (d) => d.due, (d) => d.source, (d) => d.note ?? null, (d) => d.kind ?? null, (d) => d.place ?? null, (d) => d.covers ?? null, (d) => d.timeKnown ?? null, (d) => d.either ?? null)]);
}

/** JSON with object keys sorted: the database (jsonb) keeps keys in its own order. */
const sameJson = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
/** Columns of `rows`, one array per field, for `insert … select … from unnest(…)`: a table in one statement. */
const columns = <T,>(rows: T[], ...fields: ((r: T) => unknown)[]) => fields.map((f) => rows.map(f));
/** The last row of each id (a page that lists a file twice keeps its last entry, as row-by-row upserts did). */
const lastOf = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((r) => [r.id, r])).values()];

/** Writes the normalized rows, one statement per table (not one per row); announcements and materials keep when they
 *  were first seen and read. */
async function save(t: Db, owner: string, s: GucSnapshot, o: { switched: Set<string>; edits: Map<string, AnnouncementEdit> }) {
  await t.query("delete from guc_courses where owner_id = $1", [owner]);
  await t.query("insert into guc_courses select $1::text, * from unnest($2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::bool[])",
    [owner, ...columns(s.courses, (c) => c.key, (c) => c.id, (c) => c.seasonId, (c) => c.season, (c) => c.code, (c) => c.name, (c) => c.active)]);
  await t.query("delete from guc_schedule_slots where owner_id = $1", [owner]);
  await t.query("insert into guc_schedule_slots select $1::text, * from unnest($2::text[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[]) on conflict do nothing",
    [owner, ...columns(s.slots, (x) => x.id, (x) => x.day, (x) => x.period, (x) => x.start, (x) => x.end, (x) => x.code, (x) => x.name, (x) => x.type, (x) => x.group, (x) => x.location)]);
  await t.query("delete from guc_grades where owner_id = $1", [owner]);
  await t.query("insert into guc_grades select $1::text, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::real[], $8::text[]) on conflict do nothing",
    [owner, ...columns(s.grades, (g) => g.id, (g) => g.semester, (g) => g.code, (g) => g.name, (g) => g.hours, (g) => g.numeric, (g) => g.letter)]);
  // Announcements keep when they were first seen and read. A post new to the table takes them from what it replaces:
  // an edit that changed nothing material (spacing, punctuation) keeps the old post's; a course read again by a new
  // reader (`switched`) gets them from the old rows it is made of (inherited, below). Anything else is new: now, unread.
  const old = await t.query<{ announcement_id: string; course_key: string; scope: string; week: string | null; body: string; first_seen: Date; read_at: Date | null }>("select announcement_id, course_key, scope, week, body, first_seen, read_at from guc_announcements where owner_id = $1", [owner]);
  const byId = new Map(old.map((r) => [r.announcement_id, r])), iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  const keep = new Map<string, { first: string | null; read: string | null }>();
  for (const a of s.announcements) {
    if (byId.has(a.id)) continue;
    const edit = o.edits.get(a.id), was = edit && byId.get(edit.from.id);
    if (o.switched.has(a.courseKey)) keep.set(a.id, inherited(a, old));
    else if (was && !edit!.material) keep.set(a.id, { first: iso(was.first_seen), read: iso(was.read_at) });
  }
  await t.query("delete from guc_announcements where owner_id = $1 and not (announcement_id = any($2::text[]))", [owner, s.announcements.map((a) => a.id)]);
  const posts = lastOf(s.announcements);
  await t.query(`insert into guc_announcements (owner_id, announcement_id, course_key, scope, week, body, position, first_seen, read_at)
    select $1::text, x.id, x.course, x.scope, x.week, x.body, x.position, coalesce(x.first, now()), x.read from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::timestamptz[], $9::timestamptz[]) as x(id, course, scope, week, body, position, first, read)
    on conflict (owner_id, announcement_id) do update set position = excluded.position`,
    [owner, ...columns(posts, (a) => a.id, (a) => a.courseKey, (a) => a.scope, (a) => a.week ?? null, (a) => a.text, (a) => a.order ?? null, (a) => keep.get(a.id)?.first ?? null, (a) => keep.get(a.id)?.read ?? null)]);
  await t.query("delete from guc_materials where owner_id = $1 and not (material_id = any($2::text[]))", [owner, s.materials.map((m) => m.id)]);
  await t.query("insert into guc_materials (owner_id, material_id, course_key, week, title, kind, url) select $1::text, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) on conflict (owner_id, material_id) do update set week = excluded.week, title = excluded.title, kind = excluded.kind, url = excluded.url",
    [owner, ...columns(lastOf(s.materials), (m) => m.id, (m) => m.courseKey, (m) => m.week, (m) => m.title, (m) => m.kind, (m) => m.url)]);
}

/** A whole post read by a new announcement reader, from the old rows (fragments) of its course it is made of: it is
 *  first seen when the earliest of them was (else now), and read when the course had nothing unread, else read unless
 *  it holds an unread fragment. So a switch that only changes how posts are cut says nothing and changes no counts. */
function inherited(a: { courseKey: string; scope: string; week?: string; text: string }, old: { course_key: string; scope: string; week: string | null; body: string; first_seen: Date; read_at: Date | null }[]) {
  const mine = old.filter((r) => r.course_key === a.courseKey);
  // A course read for the first time has nothing to carry over: its posts are new and unread, as before.
  if (!mine.length) return { first: null, read: null };
  // Links gained their address in brackets; the old fragments had only their text.
  const flat = bareText(a.text.replace(/\s\((?:https?:|mailto:)[^)\s]*\)/gi, ""));
  const inside = mine.filter((r) => r.scope === a.scope && (r.week || "") === (a.week || "") && bareText(r.body) && flat.includes(bareText(r.body)));
  const first = inside.map((r) => new Date(r.first_seen).getTime()).sort((x, y) => x - y)[0];
  const read = !mine.some((r) => !r.read_at) || !inside.some((r) => !r.read_at) ? new Date().toISOString() : null;
  return { first: first !== undefined ? new Date(first).toISOString() : null, read };
}
