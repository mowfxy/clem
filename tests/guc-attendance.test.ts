// Attendance from the portal (ClassAttendance_ViewStudentAttendance_001.aspx): the absence report's warning per course,
// each course's sessions after its dropdown's postback, and an event when a warning goes up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceOptions, parseAbsenceReport, parseCourseAttendance, portalUrls, reportOnly, warningLevel } from "../core/guc/parse.ts";
import { importance } from "../core/proactivity/attention.ts";
import { attendanceText } from "../core/guc/ai-tools.ts";
import { Engine } from "../desktop/engine/index.ts";
import { attendance, fakeGuc, host, noWait, site } from "./guc-fake.ts";

const page = (o: Parameters<typeof attendance>[0] = {}, form?: Record<string, string>) => (attendance(o) as (r: { method: "GET" | "POST"; url: string; form?: Record<string, string> }) => string)({ method: form ? "POST" : "GET", url: portalUrls.attendance, form });
const FIELD = "ctl00$ctl00$ContentPlaceHolderright$ContentPlaceHoldercontent$DDL_Courses";

test("GUC's warning words read as a level", () => {
  for (const [text, level] of [["", 0], ["No Warning", 0], ["-", 0], ["Level 1", 1], ["First Warning", 1], ["Warning", 1], ["Level 2", 2], ["2nd warning", 2], ["Level 3", 3], ["Third Warning", 3], ["FA", 3], ["Dropped", 3]] as const)
    assert.equal(warningLevel(text), level, text);
});

test("the attendance page: its absence report, its course dropdown and one course's sessions", () => {
  const landing = page({ level701: "Level 2" });
  assert.deepEqual(parseAbsenceReport(landing), [{ code: "CSEN 701", name: "Embedded Systems", level: "Level 2", warning: 2 }]);
  const list = attendanceOptions(landing)!;
  assert.equal(list.field, FIELD);
  assert.deepEqual(list.options.map((o) => o.value), ["31701", "31702"], "the 'Choose a Course' option is left out");

  const after = page({ level701: "Level 2", absent701: 2 }, { __EVENTTARGET: FIELD, [FIELD]: "31701" });
  const a = parseCourseAttendance(after, list.options[0], parseAbsenceReport(after));
  assert.equal(a.code, "CSEN 701");
  assert.equal(a.course, "CSEN 701 - Embedded Systems");
  assert.equal(a.warning, 2);
  assert.equal(a.level, "Level 2");
  assert.equal(a.total, 6);
  assert.equal(a.absent, 2);
  assert.deepEqual(a.sessions.slice(0, 3).map((s) => s.status), ["absent", "absent", "attended"]);
  assert.equal(a.sessions[0].session, "CSEN701 - Lecture - Week 1");

  const none = parseCourseAttendance(page({}, { __EVENTTARGET: FIELD, [FIELD]: "31702" }), list.options[1]);
  assert.equal(none.warning, 0);
  assert.equal(none.absent, 0);
  assert.equal(none.total, 1);
  // A course in the report but not the dropdown still shows its warning.
  assert.equal(reportOnly([{ code: "MATH 301", name: "Calculus", level: "Level 1", warning: 1 }], [a, none])[0].code, "MATH 301");
  assert.equal(reportOnly(parseAbsenceReport(after), [a, none]).length, 0);
});

test("a warning is urgent only when it is the last one, and the AI reads attendance", () => {
  assert.equal(importance({ key: "k", kind: "attendance_warning", title: "Attendance warning: CSEN 701", detail: "Level 1" }).level, "notify");
  assert.equal(importance({ key: "k", kind: "attendance_warning", title: "Last attendance warning: CSEN 701", detail: "Level 3" }).level, "urgent");
  const text = attendanceText([{ id: "a", course: "CSEN 701 - Embedded Systems", code: "CSEN 701", level: "Level 2", warning: 2, absent: 2, total: 6, sessions: [{ status: "absent", session: "Week 1" }, { status: "attended", session: "Week 2" }] }]);
  assert.match(text, /CSEN 701 - Embedded Systems: Level 2 · absent 2 of 6 sessions/);
  assert.match(text, /absent: Week 1$/m);
});

test("sync reads attendance once per course, keeps it in the snapshot, and says so only when a warning goes up", async () => {
  const pages = site(), guc = fakeGuc(pages), h = host({ reader: true });
  const engine = await Engine.open("owner-att", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    let term = await engine.term();
    assert.equal(term.attendanceRead, true);
    assert.deepEqual(term.attendance.map((a) => [a.code, a.absent, a.total, a.warning]), [["CSEN 701", 1, 6, 0], ["CSEN 702", 0, 1, 0]]);
    assert.equal(guc.log.filter((r) => r.url.startsWith(portalUrls.attendance) && r.method === "POST").length, 2, "one postback per course");

    pages[portalUrls.attendance] = attendance({ level701: "Level 1", absent701: 2 });
    await engine.sync();
    let events = await engine.db.query<{ kind: string; title: string; detail: string; course_key: string | null }>("select kind, title, detail, course_key from guc_events where kind = 'attendance_warning'");
    assert.equal(events.length, 1);
    assert.equal(events[0].title, "Attendance warning: CSEN 701");
    assert.equal(events[0].detail, "Level 1 · absent 2 of 6 sessions");
    assert.equal(events[0].course_key, "1201:64", "it reaches the course's subject");

    // The same warning again is not news; a warning going down never is.
    await engine.sync();
    pages[portalUrls.attendance] = attendance({ absent701: 2 });
    await engine.sync();
    assert.equal((await engine.db.query("select 1 from guc_events where kind = 'attendance_warning'")).length, 1);

    pages[portalUrls.attendance] = attendance({ level701: "Level 3", absent701: 4 });
    await engine.sync();
    events = await engine.db.query("select kind, title, detail, course_key from guc_events where kind = 'attendance_warning' order by created_at, title");
    assert.ok(events.some((e) => e.title === "Last attendance warning: CSEN 701"), events.map((e) => e.title).join());
    term = await engine.term();
    assert.equal(term.attendance[0].warning, 3);
  } finally { await engine.close(); }
});

test("an attendance page Clem can't read keeps the last attendance and the rest of GUC is still read", async () => {
  const pages = site(), guc = fakeGuc(pages), h = host({ reader: true });
  const engine = await Engine.open("owner-att2", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    pages[portalUrls.attendance] = "<html><body>Something else entirely</body></html>";
    const status = await engine.sync();
    assert.deepEqual(status.stats!.missed, ["attendance"]);
    assert.equal((await engine.term()).attendance.length, 2, "the last attendance stays");
  } finally { await engine.close(); }
});
