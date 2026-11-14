import { test } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { ANNOUNCEMENT_VERSION, portalUrls, urls } from "../core/guc/parse.ts";
import { EWS_URL } from "../core/guc/ews.ts";
import { diffSnapshots } from "../core/guc/diff.ts";
import { emptySnapshot } from "../core/guc/types.ts";
import { Engine } from "../desktop/engine/index.ts";
import { GucError } from "../desktop/engine/errors.ts";
import { GucClient, login, type Http } from "../desktop/engine/guc-client.ts";
import { checkGrade, examSeats, fakeEws, fakeGuc, fixture, host, noWait, site } from "./guc-fake.ts";

test("connecting checks the password, keeps it encrypted, and the first sync is a quiet baseline", async () => {
  const pages = site(), guc = fakeGuc(pages), h = host();
  const engine = await Engine.open("owner-1", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    const progress: string[] = [];
    const status = await engine.connect("student.name", "secret", (p) => progress.push(p.label));
    assert.equal(status.connected, true);
    assert.equal(status.username, "student.name");
    assert.equal(status.courses, 4);
    assert.deepEqual(h.store.get("guc-owner-1"), { username: "student.name", password: "secret", domain: "" });
    assert.ok(progress.includes("Checking your courses… 3 of 3"), progress.join(" | "));
    // First sync: the active courses of the newest season are read for announcements, nothing is news yet.
    const courseRequests = guc.log.filter((r) => r.url.includes("CourseViewStn")).map((r) => r.url);
    assert.equal(courseRequests.length, 3);
    assert.equal((await engine.db.query("select * from guc_events")).length, 0);
    assert.equal((await engine.db.query("select * from guc_grades where owner_id = 'owner-1'")).length, 4);
    assert.equal((await engine.db.query("select * from guc_schedule_slots")).length, 5);
    assert.ok((await engine.db.query("select * from guc_deadlines")).length >= 2);
    assert.match(JSON.stringify(await engine.db.query("select * from guc_snapshots")), /^(?!.*secret)/, "the password is never in the database");
  } finally { await engine.close(); }
});

test("a full sync reads every current course's page (files listed, none downloaded), skips unchanged pages and turns changes into events", async () => {
  const pages = site(), guc = fakeGuc(pages, { etags: true }), h = host();
  const engine = await Engine.open("owner-2", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    await engine.db.query("insert into subject_links (owner_id, subject_id, course_key) values ('owner-2', 'subject-a', '1201:64')");
    guc.log.length = 0;
    let status = await engine.sync();
    // CheckGrade is read every time (coursework only shows after a postback per course); mail is one FindItem.
    assert.deepEqual([...new Set(guc.log.map((r) => r.url))], [urls.home, urls.schedule, portalUrls.grades, portalUrls.exams, urls.transcript, EWS_URL, urls.course(1201, 64), urls.course(1202, 64), urls.course(1203, 64)], "every current course, linked or not");
    assert.ok(!guc.log.some((r) => /\/Uploads\//.test(r.url)), "reading a course page never downloads its files");
    assert.equal(guc.log.filter((r) => r.url === portalUrls.grades && r.method === "POST").length, 2, "one postback per course");
    // The transcript's landing page holds no grades (a year is posted back each time), so it is not asked conditionally.
    assert.ok(guc.log.filter((r) => r.method === "GET" && r.url !== portalUrls.grades && r.url !== urls.transcript).every((r) => r.conditional), "every other page is asked for conditionally");
    assert.equal(status.stats!.requests, 12, "with the transcript's older year posted back once");
    assert.equal(status.stats!.skipped, 9);
    assert.equal(status.stats!.changed, 0);
    assert.equal(status.stats!.missed, undefined, "every part was read");

    pages[urls.course(1201, 64)] = fixture("cms-course")
      .replace("</div>\n    </div>\n  </div>\n  <div class=\"weeksdata\">", `<p>Project milestone 2 deadline is 3 December 2026.</p></div>\n    </div>\n  </div>\n  <div class="weeksdata">`)
      .replace("<strong>Content:</strong>", '<strong>Content:</strong><div class="card mb-4"><div class="card-body"><div><strong>0 - Lecture 4 (Lecture slides)</strong></div><div><div><a id="download" download="L4" href="/Uploads/1201/64/lecture-4.pdf">Download</a><input type="button" id="900401" data-contentid="900401" /></div></div></div></div>')
      .replace("20 November 2026", "22 November 2026");
    pages[urls.transcript] = fixture("transcript").replace("<td>CSEN603</td><td>Software Engineering</td><td></td><td></td>", "<td>CSEN603</td><td>Software Engineering</td><td>1.70</td><td>B+</td>");
    pages[urls.schedule] = fixture("schedule").replace("C6.204", "C6.205");
    pages[urls.course(1202, 64)] += "<!-- changed, but not linked -->";
    pages[portalUrls.grades] = checkGrade({ mid701: "17/20", quiz701: "9 / 10" });
    pages[portalUrls.exams] = examSeats("C7.208");
    pages[EWS_URL] = fakeEws([{ id: "AAMk1", subject: "Welcome back", from: "Student Affairs", at: "2026-09-01T08:00:00Z" }, { id: "AAMk2", subject: "Midterm hall change", from: "Exams Office", at: "2026-11-12T09:00:00Z", body: "Your CSEN 701 midterm moved to H14." }]);
    guc.log.length = 0;
    status = await engine.sync();
    assert.equal(guc.log.filter((r) => r.url.includes("CourseViewStn")).length, 3);
    const kinds = (await engine.db.query<{ kind: string }>("select kind from guc_events order by kind")).map((e) => e.kind);
    // The edited post (its date moved, a milestone paragraph added under it) is one announcement, not one per paragraph.
    assert.deepEqual(kinds, ["deadline_added", "deadline_changed", "exam_posted", "new_announcement", "new_grade", "new_grade", "new_grade", "new_mail", "new_material", "schedule_changed"], kinds.join());
    assert.equal(status.stats!.events, 10);
    const mail = await engine.db.query<{ title: string; detail: string }>("select title, detail from guc_events where kind = 'new_mail'");
    assert.match(mail[0].title, /Exams Office: Midterm hall change/);
    assert.match(mail[0].detail, /moved to H14/, "a 300-character preview of the new message only");
    assert.doesNotMatch(JSON.stringify(await engine.db.query("select data, seen from guc_snapshots")), /AAMk/, "EWS ids are kept only as hashes");

    // The same changes seen again are not news twice.
    guc.log.length = 0;
    status = await engine.sync();
    assert.equal(status.stats!.events, 0);
    assert.equal((await engine.db.query("select * from guc_events")).length, 10);
    assert.equal((await engine.db.query("select * from guc_snapshots")).length, 4, "the latest snapshots are kept, older ones pruned at 5");
  } finally { await engine.close(); }
});

test("a content hash skips pages that come back identical without an ETag", async () => {
  const pages = site(), guc = fakeGuc(pages), h = host();
  const engine = await Engine.open("owner-3", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    // Only the view state changes between loads.
    pages[urls.home] = pages[urls.home].replace("FAKEVIEWSTATE", "OTHERVIEWSTATE");
    const status = await engine.sync();
    assert.equal(status.stats!.changed, 0);
    assert.equal(status.stats!.skipped, 9, "CheckGrade is read every time but its grades are the same; every current course's page is unchanged");
  } finally { await engine.close(); }
});

test("logins are retried as GUC\\username, and failures are typed and told once", async () => {
  const guc = fakeGuc(site(), { domain: "GUC" });
  const client = await login("student.name", "secret", urls.home, guc.http, noWait);
  assert.equal(client.domain, "GUC");
  assert.deepEqual(guc.log.map((r) => r.domain), ["", "GUC"]);
  await assert.rejects(login("student.name", "wrong", urls.home, guc.http, noWait), (e: GucError) => e.kind === "auth" && !/wrong/.test(e.message));

  const offline: Http = async () => { throw Object.assign(Error("getaddrinfo ENOTFOUND cms.guc.edu.eg"), { code: "ENOTFOUND" }); };
  const c = new GucClient({ username: "a", password: "b" }, offline, noWait);
  await assert.rejects(c.page(urls.home), (e: GucError) => e.kind === "offline");
  assert.equal(c.requests, 3, "network errors are retried with backoff");
  const down: Http = async () => ({ status: 503, headers: {}, body: "Service Unavailable" });
  await assert.rejects(new GucClient({ username: "a", password: "b" }, down, noWait).page(urls.home), (e: GucError) => e.kind === "unavailable");
  const loginPage: Http = async () => ({ status: 200, headers: {}, body: '<form><input type="password"></form>' });
  await assert.rejects(new GucClient({ username: "a", password: "b" }, loginPage, noWait).page(urls.home), (e: GucError) => e.kind === "auth");
  const portalClosed: Http = async (r) => r.url.includes("Transcript") ? { status: 302, headers: { location: "/student_ext/Main/MessagePage.aspx?message=Page+will+be+available+from+1+Dec" }, body: "" } : { status: 200, headers: {}, body: "Page will be available from 1 Dec" };
  assert.equal((await new GucClient({ username: "a", password: "b" }, portalClosed, noWait).page(urls.transcript)).unavailable, true);

  const pages = site(), h = host(), flaky = fakeGuc(pages);
  const engine = await Engine.open("owner-4", h, { http: flaky.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    pages[urls.home] = "<html><body>Something new</body></html>";
    await assert.rejects(engine.sync(), (e: GucError) => e.kind === "site_changed");
    await assert.rejects(engine.sync(), (e: GucError) => e.kind === "site_changed");
    assert.equal(h.notices.length, 1, "one notice, not one per failed sync");
    assert.equal((await engine.status()).error?.kind, "site_changed");
    pages[urls.home] = fixture("cms-home");
    assert.equal((await engine.sync()).error, undefined);
    const status = await engine.disconnect();
    assert.equal(status.connected, false);
    assert.equal(h.store.has("guc-owner-4"), false);
    assert.equal((await engine.db.query("select * from guc_courses")).length, 0);
  } finally { await engine.close(); }
});

test("reconnecting after a disconnect is a quiet baseline: no events, and the organizer's next sweep says nothing", async () => {
  const pages = site(), guc = fakeGuc(pages), h = Object.assign(host(), { calls: 0 });
  h.workspace = async () => ({ spaces: [], plans: [], chats: [{ id: "main", kind: "main", messages: [] }], files: [], studySets: [], automations: [] });
  h.complete = async () => { h.calls++; return '{"levels":[],"actions":[]}'; };
  const engine = await Engine.open("owner-re", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    await engine.sync();
    await engine.organizer.sweep("event");
    await engine.disconnect();
    // While disconnected, GUC moves on: a new post, a new file, a new grade and a room change.
    pages[urls.course(1201, 64)] = fixture("cms-course")
      .replace("</div>\n    </div>\n  </div>\n  <div class=\"weeksdata\">", `<p>Project milestone 2 deadline is 3 December 2026.</p></div>\n    </div>\n  </div>\n  <div class="weeksdata">`)
      .replace("<strong>Content:</strong>", '<strong>Content:</strong><div class="card mb-4"><div class="card-body"><div><strong>0 - Lecture 4 (Lecture slides)</strong></div><div><div><a id="download" download="L4" href="/Uploads/1201/64/lecture-4.pdf">Download</a><input type="button" id="900401" data-contentid="900401" /></div></div></div></div>');
    pages[urls.transcript] = fixture("transcript").replace("<td>CSEN603</td><td>Software Engineering</td><td></td><td></td>", "<td>CSEN603</td><td>Software Engineering</td><td>1.70</td><td>B+</td>");
    pages[urls.schedule] = fixture("schedule").replace("C6.204", "C6.205");
    await engine.connect("student.name", "secret");
    await engine.sync();
    assert.equal((await engine.db.query("select * from guc_events")).length, 0, "nothing already on GUC is news after a reconnect");
    assert.deepEqual(await engine.organizer.sweep("event"), { changed: false, called: false, actions: 0, posted: false }, "the first sweep after it says nothing");
    assert.equal((await engine.organizer.inbox()).posts.length, 0, "nothing in the main thread");
    assert.equal(h.notices.length, 0);
    // From there on, news is news again: the next room change is told.
    pages[urls.schedule] = fixture("schedule").replace("C6.204", "C6.206");
    await engine.sync();
    await engine.organizer.sweep("event");
    assert.ok((await engine.organizer.inbox()).posts.some((p) => p.content.includes("C6.206")), "a later change is told");
  } finally { await engine.close(); }
});

test("the diff only reports courses, grades and schedules it has seen before", () => {
  const prev = emptySnapshot(), next = emptySnapshot();
  next.materials.push({ id: "1", courseKey: "1:1", week: "w", title: "t", kind: "File", url: "" });
  next.grades.push({ id: "g", semester: "s", code: "C", name: "n", hours: 6, numeric: 1, letter: "A" });
  assert.equal(diffSnapshots(prev, next, { courses: [], grades: false, schedule: false }).length, 0);
  assert.deepEqual(diffSnapshots(prev, next, { courses: ["1:1"], grades: true, schedule: false }).map((e) => e.key), ["mat:1", "grade:g:A"]);
});

test("with a model, the AI reads each course's posts once, with the schedule, and keeps the deadlines it names", async () => {
  const pages = site(), guc = fakeGuc(pages, { etags: true }), h = host(), asked: string[] = [];
  h.complete = async ({ user }) => { asked.push(user); return JSON.stringify({ deadlines: /Course: CSEN 701/.test(user) ? [{ title: "Quiz 2", due: "2099-01-01 10:00" }, { title: "Assignment 5", due: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) + " 15:30", timeKnown: true, quote: "Assignment 5 is due next week." }] : [], cancel: [] }); };
  const engine = await Engine.open("owner-ai", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    assert.ok(asked.length >= 1 && asked.length <= 3, "one request per course with posts to read");
    assert.ok(asked.every((u) => /GUC weeks \(Saturday to Thursday\)/.test(u) && /The student's classes in this course each week/.test(u)));
    const rows = await engine.db.query<{ title: string; note: string | null }>("select title, note from guc_deadlines where owner_id = 'owner-ai'");
    assert.deepEqual(rows.map((r) => r.title), ["Assignment 5"], "named by the AI; an implausible date is dropped");
    assert.equal(rows[0].note, "Assignment 5 is due next week.");
    const before = asked.length;
    await engine.sync();
    assert.equal(asked.length, before, "nothing new on CMS: the AI isn't asked again");
  } finally { await engine.close(); }
});

// ---------- Whole announcements through the engine ----------
const box = (id: string) => cheerio.load(fixture("cms-announcements"))("#" + id).html() || "";
/** The fixture course page with its announcement box replaced. */
const withBox = (html: string) => fixture("cms-course").replace(/(<div id="ContentPlaceHolderright_ContentPlaceHoldercontent_desc">)[\s\S]*?(\n {6}<\/div>)/, `$1${html}$2`);

test("a post that gains a table row is one Updated announcement; posts keep their page order through the database", async () => {
  const pages = site(), guc = fakeGuc(pages), h = host();
  pages[urls.course(1201, 64)] = withBox(box("math"));
  const engine = await Engine.open("owner-ann", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    const first = await engine.announcements({ courseKey: "1201:64" });
    assert.deepEqual(first.items.map((a) => a.text.slice(0, 12)), ["The Fourth i", "Quiz 2 will ", "Office hours", "Quiz 1 will "], "page order, though all were first seen together");
    assert.match(first.items[1].text, /\nMonday 16\.11 · 3:45 P\.M\. · T29 - T30 · D1\.003\n/);
    await engine.markAllRead();

    pages[urls.course(1201, 64)] = withBox(box("math").replace("</tbody>", "<tr><td>Tuesday 17.11</td><td>4:30 P.M.</td><td>T43 - T44</td><td>Exam Hall 2</td></tr></tbody>"));
    await engine.sync();
    const events = await engine.db.query<{ title: string; detail: string }>("select title, detail from guc_events where kind = 'new_announcement'");
    assert.deepEqual(events.map((e) => e.title), ["Updated announcement in CSEN 701"], "one event, not one per row");
    assert.match(events[0].detail, /^Tuesday 17\.11 · 4:30 P\.M\. · T43 - T44 · Exam Hall 2\nQuiz 2 will be held/);
    const after = await engine.announcements({ courseKey: "1201:64" });
    assert.equal(after.items.length, 4);
    assert.deepEqual(after.items.filter((a) => !a.read).map((a) => a.text.slice(0, 12)), ["Quiz 2 will "], "the changed post is unread again; the rest stay read");
  } finally { await engine.close(); }
});

test("the new announcement reader takes over silently: whole posts, read state and first-seen carried over, no events", async () => {
  const pages = site(), guc = fakeGuc(pages), h = host();
  pages[urls.course(1201, 64)] = withBox(box("math"));
  const engine = await Engine.open("owner-switch", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    // What an older reader left: one row per paragraph or table cell, all read, seen over the past weeks, and the
    // snapshot it wrote (its fragments, no announcement reader version, no deadlines read from whole posts).
    const posts = await engine.db.query<{ course_key: string; scope: string; week: string | null; body: string }>("select course_key, scope, week, body from guc_announcements where owner_id = 'owner-switch'");
    const fragments = posts.flatMap((p) => p.body.split(/\n| · /).map((t) => t.trim()).filter(Boolean).map((text) => ({ ...p, text })));
    const unique = [...new Map(fragments.map((f) => [f.course_key + "|" + f.scope + "|" + f.text, f])).values()];
    await engine.db.query("delete from guc_announcements where owner_id = 'owner-switch'");
    for (const [i, f] of unique.entries()) await engine.db.query("insert into guc_announcements (owner_id, announcement_id, course_key, scope, week, body, first_seen, read_at) values ('owner-switch', $1, $2, $3, $4, $5, $6, $7)",
      ["old" + i, f.course_key, f.scope, f.week, f.text, new Date(Date.parse("2026-10-01T08:00:00Z") + i * 60_000), f.text === "T29 - T30" ? null : new Date("2026-10-20T08:00:00Z")]);
    const [snap] = await engine.db.query<{ id: number; data: any; seen: any }>("select id, data, seen from guc_snapshots where owner_id = 'owner-switch' order by id desc limit 1");
    const { announcements: _v, ...oldSeen } = snap.seen;
    await engine.db.query("update guc_snapshots set data = $2, seen = $3 where id = $1", [snap.id, { ...snap.data, deadlines: [], announcements: unique.map((f, i) => ({ id: "old" + i, courseKey: f.course_key, scope: f.scope, ...(f.week ? { week: f.week } : {}), text: f.text })) }, oldSeen]);
    await engine.db.query("delete from guc_deadlines where owner_id = 'owner-switch'");

    const before = (await engine.db.query("select * from guc_events")).length;
    await engine.sync();
    const kinds = (await engine.db.query<{ kind: string }>("select kind from guc_events")).slice(before).map((e) => e.kind);
    assert.deepEqual(kinds.filter((k) => /announcement|deadline/.test(k)), [], "no announcement and no deadline is news because of the switch");
    const rows = await engine.db.query<{ course_key: string; body: string; read_at: Date | null; first_seen: Date }>("select course_key, body, read_at, first_seen from guc_announcements where owner_id = 'owner-switch' order by course_key, position");
    assert.equal(rows.length, posts.length, "whole posts again, not fragments");
    assert.ok(rows.filter((r) => r.course_key !== "1201:64").every((r) => r.read_at), "a course with nothing unread: every post read");
    const mine = rows.filter((r) => r.course_key === "1201:64");
    assert.deepEqual(mine.map((r) => [r.body.slice(0, 12), !!r.read_at]), [["The Fourth i", true], ["Quiz 2 will ", false], ["Office hours", true], ["Quiz 1 will ", true]], "only the post holding the unread fragment is unread");
    const quiz = unique.findIndex((f) => f.course_key === "1201:64" && f.text.startsWith("Quiz 2 will"));
    assert.equal(new Date(mine[1].first_seen).toISOString(), new Date(Date.parse("2026-10-01T08:00:00Z") + quiz * 60_000).toISOString(), "first seen when its earliest fragment was");
    assert.equal((await engine.overview()).counts.unread, 1);
    assert.ok((await engine.deadlines()).length > 0, "the deadline reader still read the posts");
    const [latest] = await engine.db.query<{ seen: any }>("select seen from guc_snapshots where owner_id = 'owner-switch' order by id desc limit 1");
    assert.equal(latest.seen.announcements.v, ANNOUNCEMENT_VERSION);

    // From now on the reader is the same: a new post is news again.
    pages[urls.course(1201, 64)] = withBox(box("math") + "<hr><p>Lab 4 is cancelled this week.</p>");
    await engine.sync();
    assert.deepEqual((await engine.db.query<{ title: string; detail: string }>("select title, detail from guc_events where kind = 'new_announcement'")).map((e) => [e.title, e.detail]), [["New announcement in CSEN 701", "Lab 4 is cancelled this week."]]);
  } finally { await engine.close(); }
});
