// Coming up with the owner's real shapes (sanitized): seven courses, schedule cells that name the course instead of its
// code, groups like "3MIET T014", posts with group tables, a course mail from the notification system and exam seats the
// portal keeps listing for weeks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupIn, sameCode, shortGroup } from "../core/guc/codes.ts";
import { applyReader, fitText, mailSubject, readerPrompt, type ReaderInput } from "../core/guc/deadline-ai.ts";
import { courseDeadlines, DEADLINE_VERSION, whenText } from "../core/guc/deadlines.ts";
import { comingUp, dueGroup, examWhen } from "../core/guc/hub.ts";
import { deadlinesText } from "../core/guc/ai-tools.ts";
import { slotCourse } from "../core/guc/match.ts";
import { EWS_URL } from "../core/guc/ews.ts";
import { parseCourseList, parseSchedule, portalUrls, urls } from "../core/guc/parse.ts";
import type { GucSlot } from "../core/guc/types.ts";
import { Engine } from "../desktop/engine/index.ts";
import { GucClient } from "../desktop/engine/guc-client.ts";
import { readMail, readMessage } from "../desktop/engine/guc-mail.ts";
import { syncGuc } from "../desktop/engine/guc-sync.ts";
import { checkGrade, fakeEws, fakeGuc, host, noWait, type FakePage } from "./guc-fake.ts";

// Saturday 14 November 2026, 10:00 in Cairo.
const NOW = Date.parse("2026-11-14T08:00:00Z");
const COURSES: [string, string, number][] = [["MATH301", "Mathematics III", 45], ["ELCT301", "Electrical Circuits I", 46], ["CSEN301", "Data Structures and Algorithms", 351], ["PHYST301", "Physics III", 399], ["PHYSP301", "Physics III", 400], ["DE303", "German III", 47], ["CPS402", "Communication & Presentation Skills", 48]];
const home = `<html><body><form><table id="ContentPlaceHolderright_ContentPlaceHoldercontent_GridViewcourses"><tr><th>&nbsp;</th><th>Name</th><th>Active</th><th>Season</th><th>ID</th><th>SeasonId</th></tr>
${COURSES.map(([c, n, id]) => `<tr><td><input type="button" value="View Course" /></td><td>(|${c}|) ${n} (${id})</td><td>Active</td><td>Winter 2026</td><td>${id}</td><td>70</td></tr>`).join("\n")}</table></form></body></html>`;
const cell = (group: string, room: string, text: string) => `<td><table><tbody><tr><td>${group}</td><td>${room}</td><td>${text}</td></tr></tbody></table></td>`;
const free = "<td>Free</td>";
// As the portal shows it: the course's name in the cell, the group as "3MIET T014".
const schedule = `<html><body><table id="ContentPlaceHolderright_ContentPlaceHoldercontent_scdTbl"><tbody>
<tr><td></td><td>First Period</td><td>Second Period</td><td>Third Period</td><td>Fourth Period</td><td>Fifth Period</td></tr>
<tr><td>Saturday</td>${free.repeat(5)}</tr>
<tr><td>Sunday</td>${free}${cell("3MIET T014", "C5.212", "Mathematics III Tut")}${free.repeat(3)}</tr>
<tr><td>Monday</td>${cell("3MIET L002", "H1", "Mathematics III Lecture")}${free.repeat(2)}${cell("3MIET T014", "C3.201", "Electrical Circuits I Tut")}${free}</tr>
<tr><td>Tuesday</td>${free.repeat(2)}${cell("3MIET T014", "C5.208", "Mathematics III Tut")}${cell("3MIET T014", "C7.02", "Data structures and Algorithms Tut")}${free}</tr>
<tr><td>Wednesday</td>${free.repeat(4)}${cell("3 IET&amp;MET II CPS T040", "C2.110", "Communication &amp; Presentation Skills (A2) Tut")}</tr>
<tr><td>Thursday</td>${cell("3MIET L002", "H1", "Mathematics III Lecture")}${cell("3MIET T014", "C6.104", "Physics III (t) Tut")}${free}${cell("3MIET P014", "C6.204", "Data structures and Algorithms Lab")}${free}</tr>
</tbody></table></body></html>`;
const page = (desc: string) => `<html><body><div id="ContentPlaceHolderright_ContentPlaceHoldercontent_desc">${desc}</div></body></html>`;
const MATH_QUIZ2 = `<p>Quiz 2 will be held on Monday November 16th and Tuesday November 17th. It will cover chapter 16.1,16.2 and 16.3 in Stewart Calc. and corresponding Lectures 10-12 and worksheets 5-6</p>
<table><tr><td>Date</td><td>Time</td><td>Tutorial</td><td>Location</td></tr>
<tr><td rowspan="2">Monday 16.11</td><td rowspan="2">3:45 P.M.</td><td>T21 - T22</td><td>D1.001</td></tr><tr><td>T29 - T30</td><td>D1.003</td></tr>
<tr><td rowspan="2">Tuesday 17.11</td><td>3:45 P.M.</td><td>T41 - T42</td><td>Exam Hall 1</td></tr><tr><td>4:30 P.M.</td><td>T13 - T17</td><td>Exam Hall 4</td></tr></table>`;
const MATH = page(`<p>The Fourth in-class assignment is scheduled to take place during the first tutorial of the week starting Saturday 14th of November, 2026. This will cover Stoke's Theorem and Diveregence Theorem.</p><p>-------------------------</p>${MATH_QUIZ2}<p>_______________________</p><p>Quiz 3 will be on Mon 30/11 and Tue 1/12. Save this to your calendar.</p>`);
const PHYST = page(`<p>Kindly be informed that Quiz 2/ Assignment 2 will be in the last 40 minutes of the tutorial starting the next week (14/11-19/11)</p>`);
const ELCT = page(`<p>[4/11/2026]: Assignment 2 is now posted online. Its submission deadline is Thursday (19/11/2026).</p>`);
const CSEN = page(`<p>Quiz 2 will be on Tuesday 24/11/2026.</p>`);
const quiet = page(`<p>Welcome to the course.</p>`);
const exams = (rows: string[][]) => `<html><body><table><tr><th>Course</th><th>Exam Day</th><th>Date</th><th>Start Time</th><th>End Time</th><th>Hall</th><th>Seat</th><th>Exam Type</th></tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table></body></html>`;
const SEATS = exams([
  ["IET & MET 3rd Semester - MATH 301 Mathematics III - Winter 2026", "Thursday", "29 - October - 2026", "8:30:00 AM", "10:30:00 AM", "H5", "J13", "Normal"],
  ["IET & MET 3rd Semester - ELCT 301 Electrical Circuits I - Winter 2026", "Thursday", "5 - November - 2026", "8:30:00 AM", "10:30:00 AM", "H6", "B2", "Normal"],
  ["IET & MET 3rd Semester - CSEN 301 Data Structures - Winter 2026", "Sunday", "20 - December - 2026", "12:00:00 PM", "2:00:00 PM", "H2", "C7", "Final"],
]);
const CSEN_MAIL = { id: "AAMkQ2", subject: "[EXTERNAL EMAIL] - Notification System: CSEN301 Quiz 2 [Group: Winter 2026  - CSEN 301 - 3MIET2 (Lecture)]", from: "GUC Notification System (DO NOT REPLY)", at: "2026-11-12T09:00:00Z", body: "Dears. Please note that quiz 2 will be conducted for group 2 on Tuesday 24th of November, starting 3:45 pm. Content covered will be SLL (lecture 7 , PA7). No entrance to the quiz location will be allowed after 10 min of the start." };

function realSite(): Record<string, FakePage> {
  return {
    [urls.home]: home, [urls.schedule]: schedule, [urls.transcript]: "<html><body>Transcript</body></html>",
    [urls.course(45, 70)]: MATH, [urls.course(46, 70)]: ELCT, [urls.course(351, 70)]: CSEN, [urls.course(399, 70)]: PHYST, [urls.course(400, 70)]: quiet, [urls.course(47, 70)]: quiet, [urls.course(48, 70)]: quiet,
    [portalUrls.grades]: checkGrade(), [portalUrls.exams]: SEATS,
    [EWS_URL]: fakeEws([{ id: "AAMk1", subject: "Welcome back", from: "Student Affairs", at: "2026-09-01T08:00:00Z", body: "Classes start Saturday." }, CSEN_MAIL]),
  };
}
async function owner(name: string, o: { reader?: boolean } = {}) {
  const pages = realSite(), guc = fakeGuc(pages), h = host();
  const engine = await Engine.open(name, h, { http: guc.http, sleep: noWait, memory: true, jobs: false, clock: () => NOW });
  await engine.connect("student.name", "secret");
  return { engine, pages, guc, h, close: () => engine.close() };
}
const key = (code: string, list: { code: string; key: string }[]) => list.find((c) => sameCode(c.code, code))!.key;

// ---------- Classes belong to their courses ----------
test("short groups and group rows: T14 is in 'T13 - T17' and 'T11,T12,T14', lecture and lab groups too", () => {
  assert.deepEqual(shortGroup("3MIET T014"), { kind: "T", n: 14, label: "T14" });
  assert.deepEqual(shortGroup("3MIET L002"), { kind: "L", n: 2, label: "L2" });
  assert.deepEqual(shortGroup("P014"), { kind: "P", n: 14, label: "P14" });
  assert.deepEqual(shortGroup("3 IET&MET II CPS T040"), { kind: "T", n: 40, label: "T40" });
  assert.equal(shortGroup("Lecture"), undefined);
  const t14 = shortGroup("3MIET T014")!;
  for (const yes of ["Tuesday 17.11 · 4:30 P.M. · T13 - T17 · Exam Hall 4", "October 15, 2026 · 3:30-4:15 · C7.01 · T11,T12,T14,T15,T16", "T14", "T 13–17"]) assert.ok(groupIn(yes, t14), yes);
  for (const no of ["Monday 16.11 · 3:45 P.M. · T29 - T30 · D1.003", "T41 - T42", "P14", "T140"]) assert.ok(!groupIn(no, t14), no);
});

test("every class of the real schedule belongs to its course, PHYST and PHYSP told apart", () => {
  const courses = parseCourseList(home), slots = parseSchedule(schedule);
  assert.equal(slots.length, 9);
  for (const s of slots) assert.ok(slotCourse(s.name, courses), `${s.name} matched`);
  const of = (name: string) => slotCourse(name, courses)?.code;
  assert.equal(of("Mathematics III"), "MATH 301");
  assert.equal(of("Electrical Circuits I"), "ELCT 301");
  assert.equal(of("Data structures and Algorithms"), "CSEN 301");
  assert.equal(of("Physics III (t)"), "PHYST 301");
  assert.equal(of("Physics III (p)"), "PHYSP 301");
  assert.equal(of("Communication & Presentation Skills (A2)"), "CPS 402");
  assert.equal(of("Physics III"), undefined, "two courses of that name and nothing to choose by: left as it is");
  assert.equal(of("Underwater Basket Weaving"), undefined);
});

test("a sync fixes stored classes' codes without saying the schedule changed, and a subject sees its classes", async () => {
  const t = await owner("cu-slots");
  try {
    const courses = await t.engine.courses();
    const stored = await t.engine.db.query<{ slot_id: string; code: string; name: string }>("select slot_id, code, name from guc_schedule_slots where owner_id = 'cu-slots'");
    assert.equal(stored.length, 9);
    for (const s of stored) assert.ok(courses.some((c) => sameCode(s.code, c.code)), `${s.name} → ${s.code}`);
    // As they were stored before: the cell's name as the code.
    const ids = stored.map((s) => s.slot_id).sort();
    await t.engine.db.query("update guc_schedule_slots set code = name where owner_id = 'cu-slots'");
    const [snap] = await t.engine.db.query<{ id: number; data: any }>("select id, data from guc_snapshots where owner_id = 'cu-slots' order by id desc limit 1");
    await t.engine.db.query("update guc_snapshots set data = $2 where id = $1", [snap.id, { ...snap.data, slots: snap.data.slots.map((s: GucSlot) => ({ ...s, code: s.name })) }]);
    const before = (await t.engine.db.query("select 1 from guc_events")).length;
    await t.engine.sync();
    assert.equal((await t.engine.db.query("select 1 from guc_events")).length, before, "no schedule_changed, no news");
    const after = await t.engine.db.query<{ slot_id: string; code: string }>("select slot_id, code from guc_schedule_slots where owner_id = 'cu-slots'");
    assert.deepEqual(after.map((s) => s.slot_id).sort(), ids, "slot ids are the portal's and stay");
    assert.ok(after.every((s) => /^[A-Z]{2,5} \d{3}$/.test(s.code)));
    await t.engine.link("subj-math", key("MATH 301", courses));
    const view = await t.engine.subject("subj-math");
    assert.equal(view.slots.length, 4, "the subject's Classes tab has its tutorials and lectures");
  } finally { await t.close(); }
});

// ---------- The readers ----------
const mathSlots = (): GucSlot[] => parseSchedule(schedule).filter((s) => s.name === "Mathematics III").map((s) => ({ ...s, code: "MATH 301" }));
test("the model is given the student's classes, groups and exam seats; a long table keeps their row", () => {
  const input: ReaderInput = { course: { key: "45:70", code: "MATH 301", name: "Mathematics III" }, slots: mathSlots(), texts: [{ id: "t1", source: "announcement", label: "Course announcement", text: "Quiz 2 …" }], tracked: [], now: NOW,
    exams: [{ id: "e", course: "MATH 301", code: "MATH 301", day: "Thursday", date: "29 - October - 2026", start: "8:30:00 AM", end: "10:30:00 AM", hall: "H5", seat: "J13", type: "Midterm" }] };
  const { system, user } = readerPrompt(input);
  assert.match(user, /- Tutorial: Sunday, 2nd slot 10:00–11:30, group 3MIET T014, C5\.212/);
  assert.match(user, /- Lecture: Monday, 1st slot/);
  assert.match(user, /Their groups: tutorial group T14 \(T14\), lecture group 2 \(L2\)\./);
  assert.match(user, /Exam seats the portal already lists:\n- Midterm on Thu 29 Oct, 08:30, H5, seat J13/);
  assert.match(system, /"T13 - T17" and "T11,T12,T14" both include T14/);
  assert.match(system, /still return the item: the earliest day, "timeKnown": false, and "either"/);
  assert.match(system, /last 40 minutes" of a 90-minute slot starts 50 minutes in/);
  const rows = Array.from({ length: 300 }, (_, i) => `Monday 16.11 · 3:45 P.M. · T${100 + i} · D1.00${i % 9}`);
  const long = ["Quiz 2 will be held on Monday and Tuesday.", "", "Date · Time · Tutorial · Location", ...rows.slice(0, 150), "Tuesday 17.11 · 4:30 P.M. · T13 - T17 · Exam Hall 4", ...rows.slice(150)].join("\n");
  const cut = fitText(long, mathSlots(), 2000);
  assert.ok(cut.length <= 2000 + 40);
  assert.match(cut, /^Quiz 2 will be held[^]*Date · Time · Tutorial · Location[^]*Tuesday 17\.11 · 4:30 P\.M\. · T13 - T17 · Exam Hall 4/, "the header and their row survive the cut");
  assert.equal(mailSubject(CSEN_MAIL.subject), "CSEN301 Quiz 2");
});

test("the model's answer keeps kind, place, covers and the either-days; one quiz from a post and a mail is one item", () => {
  const input: ReaderInput = { course: { key: "351:70", code: "CSEN 301", name: "Data Structures" }, slots: [], texts: [{ id: "m1", source: "mail", label: "Email: CSEN301 Quiz 2", text: CSEN_MAIL.body }], now: NOW,
    tracked: [{ id: "q2", courseKey: "351:70", title: "Quiz 2", due: "2026-11-24T21:59:00.000Z", source: "announcement", kind: "quiz", timeKnown: false }] };
  const out = applyReader({ deadlines: [
    { title: "CSEN 301 Quiz 2", kind: "quiz", due: "2026-11-24 15:45", timeKnown: true, place: "C7.02", covers: "SLL (lecture 7, PA7)", from: "m1", quote: "quiz 2 will be conducted for group 2 on Tuesday 24th of November, starting 3:45 pm" },
    { title: "Quiz 3", kind: "quiz", due: "2026-11-30", timeKnown: false, either: "Monday or Tuesday, by tutorial group" },
  ], cancel: [] }, input)!;
  assert.equal(out.length, 2, "the mail's Quiz 2 is the tracked Quiz 2");
  const q2 = out.find((d) => d.id === "q2")!;
  assert.deepEqual([q2.kind, q2.place, q2.covers, q2.timeKnown, q2.source, whenText(q2.due)], ["quiz", "C7.02", "SLL (lecture 7, PA7)", true, "mail", "Tuesday 24 Nov at 15:45"]);
  const q3 = out.find((d) => d.title === "Quiz 3")!;
  assert.deepEqual([q3.either, q3.timeKnown, whenText(q3.due, false)], ["Monday or Tuesday, by tutorial group", false, "Monday 30 Nov"]);
});

test("the rule reader alone finds the real cases", () => {
  const ref = new Date(NOW), show = (l: ReturnType<typeof courseDeadlines>) => l.map((d) => [d.title, d.kind, whenText(d.due, d.timeKnown !== false), d.place ?? "", d.either ?? ""]);
  const math = courseDeadlines([{ text: "The Fourth in-class assignment is scheduled to take place during the first tutorial of the week starting Saturday 14th of November, 2026. This will cover Stoke's Theorem and Diveregence Theorem.", source: "announcement" },
    { text: "Quiz 2 will be held on Monday November 16th and Tuesday November 17th. It will cover chapter 16.1,16.2 and 16.3 in Stewart Calc. and corresponding Lectures 10-12 and worksheets 5-6\n\nDate · Time · Tutorial · Location\nMonday 16.11 · 3:45 P.M. · T29 - T30 · D1.003\nTuesday 17.11 · 4:30 P.M. · T13 - T17 · Exam Hall 4", source: "announcement" },
    { text: "Quiz 3 will be on Mon 30/11 and Tue 1/12. Save this to your calendar.", source: "announcement" }], "45:70", ref, mathSlots());
  assert.deepEqual(show(math), [
    ["In-class assignment 4", "in-class", "Sunday 15 Nov at 10:00", "C5.212", ""],
    ["Quiz 2", "quiz", "Tuesday 17 Nov at 16:30", "Exam Hall 4", ""],
    ["Quiz 3", "quiz", "Monday 30 Nov", "", "Monday or Tuesday, by tutorial group"],
  ]);
  assert.match(math[1].covers || "", /^chapter 16\.1,16\.2 and 16\.3 in Stewart/);
  const phys = parseSchedule(schedule).filter((s) => s.name === "Physics III (t)").map((s) => ({ ...s, code: "PHYST 301" }));
  assert.deepEqual(show(courseDeadlines([{ text: "Kindly be informed that Quiz 2/ Assignment 2 will be in the last 40 minutes of the tutorial starting the next week (14/11-19/11)", source: "announcement" }], "399:70", ref, phys)),
    [["Quiz 2 / Assignment 2", "quiz", "Thursday 19 Nov at 10:50", "C6.104", ""]], "the last 40 minutes of their Thursday tutorial");
  assert.deepEqual(show(courseDeadlines([{ text: CSEN_MAIL.body, source: "mail" }], "351:70", ref)), [["Quiz 2", "quiz", "Tuesday 24 Nov at 15:45", "", ""]]);
  const both = courseDeadlines([{ text: "Quiz 2 will be on Tuesday 24/11/2026.", source: "announcement" }, { text: CSEN_MAIL.body, source: "mail" }], "351:70", ref);
  assert.deepEqual(show(both), [["Quiz 2", "quiz", "Tuesday 24 Nov at 15:45", "", ""]], "a post and a mail about one quiz: one item, the timed one");
});

// ---------- Coming up ----------
test("one list: exam seats and read items, merged when the same sitting, done until 14 days after", () => {
  assert.deepEqual(examWhen({ date: "29 - October - 2026", start: "8:30:00 AM", end: "10:30:00 AM" }), { start: "2026-10-29T05:30:00.000Z", end: "2026-10-29T07:30:00.000Z", timed: true }, "Cairo was still on summer time");
  assert.deepEqual(examWhen({ date: "2026-12-21", start: "08:30", end: "10:30" }), { start: "2026-12-21T06:30:00.000Z", end: "2026-12-21T08:30:00.000Z", timed: true });
  const seat = (id: string, code: string, date: string, type = "Normal") => ({ id, course: code, code, day: "", date, start: "8:30:00 AM", end: "10:30:00 AM", hall: "H5", seat: "J13", type });
  const list = comingUp([
    { id: "mid", courseKey: "45:70", code: "MATH 301", title: "Midterm", due: "2026-12-20T21:59:00.000Z", source: "announcement", kind: "exam", timeKnown: false, covers: "Chapters 14–16", either: "Sunday or Monday, by tutorial group" },
    { id: "a2", courseKey: "46:70", code: "ELCT 301", title: "Assignment 2", due: "2026-11-19T21:59:00.000Z", source: "announcement", kind: "assignment", timeKnown: false },
    { id: "old", courseKey: "46:70", code: "ELCT 301", title: "Quiz 1", due: "2026-11-05T13:30:00.000Z", source: "announcement", kind: "quiz", timeKnown: true },
  ], [seat("e1", "MATH 301", "21 - December - 2026"), seat("e2", "MATH 301", "29 - October - 2026"), seat("e3", "CSEN 301", "20 - December - 2026", "Final")], [{ key: "45:70", code: "MATH 301" }, { key: "351:70", code: "CSEN 301" }], NOW);
  assert.deepEqual(list.map((d) => [d.id, d.title, d.place ?? "", !!d.done]), [["a2", "Assignment 2", "", false], ["exam-e3", "Final exam", "H5, seat J13", false], ["mid", "Midterm", "H5, seat J13", false], ["old", "Quiz 1", "", true]]);
  const mid = list.find((d) => d.id === "mid")!;
  assert.deepEqual([mid.covers, mid.either, mid.timeKnown, mid.due], ["Chapters 14–16", undefined, true, "2026-12-21T06:30:00.000Z"], "the portal's date and seat, the post's covers");
  assert.equal(list.find((d) => d.id === "old")!.removeAt, "2026-11-19T15:30:00.000Z", "a timed quiz is over two hours after it starts, then kept 14 days");
  assert.ok(!list.some((d) => d.id === "exam-e2"), "an exam seat over for more than 14 days is hidden");
  assert.equal(dueGroup("2026-11-14T20:00:00Z", NOW), "Today");
  assert.equal(dueGroup("2026-11-15T08:00:00Z", NOW), "Tomorrow");
  assert.equal(dueGroup("2026-11-19T08:00:00Z", NOW), "This week");
  assert.equal(dueGroup("2026-11-24T08:00:00Z", NOW), "Next week");
  assert.equal(dueGroup("2026-12-01T08:00:00Z", NOW), "Later");
  const text = deadlinesText(list, { from: NOW, to: NOW + 60 * 864e5 }, NOW);
  assert.match(text, /- MATH 301: \[exam\] Midterm · [^\n]*H5, seat J13 · covers Chapters 14–16/);
  assert.match(text, /- CSEN 301: \[exam\] Final exam · /, "the AI sees exam seats in the same list");
});

test("after a sync the real posts, the course mail and the exam seats are one Coming up list, with nothing told", async () => {
  const t = await owner("cu-real");
  try {
    assert.equal((await t.engine.db.query("select 1 from guc_events where kind like 'deadline%'")).length, 0, "the first read is a baseline");
    const list = await t.engine.deadlines(), show = (code: string) => list.filter((d) => d.code === code && !d.done).map((d) => [d.title, whenText(d.due, d.timeKnown !== false), d.place ?? "", d.either ?? ""]);
    assert.deepEqual(show("MATH 301"), [["In-class assignment 4", "Sunday 15 Nov at 10:00", "C5.212", ""], ["Quiz 2", "Tuesday 17 Nov at 16:30", "Exam Hall 4", ""], ["Quiz 3", "Monday 30 Nov", "", "Monday or Tuesday, by tutorial group"]]);
    assert.deepEqual(show("PHYST 301"), [["Quiz 2 / Assignment 2", "Thursday 19 Nov at 10:50", "C6.104", ""]]);
    assert.deepEqual(show("ELCT 301"), [["Assignment 2", "Thursday 19 Nov", "", ""]]);
    assert.deepEqual(show("CSEN 301"), [["Quiz 2", "Tuesday 24 Nov at 15:45", "", ""], ["Final exam", "Sunday 20 Dec at 12:00", "H2, seat C7", ""]], "the post and the mail are one quiz; the exam seat is in the list");
    assert.deepEqual(list.filter((d) => d.done).map((d) => [d.code, d.title]), [["ELCT 301", "Exam"]], "the 5 Nov seat is done; the 29 Oct one is gone");
    assert.equal((await t.engine.overview()).counts.deadlines, 7, "the badge counts what is ahead");
    const facts = await (t.engine as any).gucFacts();
    assert.ok(facts.deadlines.every((d: { done?: boolean }) => !d.done), "nothing done is handed to the organizer");
    assert.ok(facts.deadlines.some((d: { id: string; kind: string; place: string }) => d.id.startsWith("exam-") && d.kind === "exam" && d.place === "H2, seat C7"));
    assert.ok((await t.engine.now(NOW)).deadlines.some((d) => /Quiz 2 · Exam Hall 4/.test(d.title)));
  } finally { await t.close(); }
});

test("a new reader is a silent baseline; after it a new quiz is news with a clean title; done items are pruned after 14 days", async () => {
  const t = await owner("cu-version");
  try {
    const [snap] = await t.engine.db.query<{ id: number; data: any; seen: any }>("select id, data, seen from guc_snapshots where owner_id = 'cu-version' order by id desc limit 1");
    const old = { id: "old", courseKey: "46:70", title: "Quiz 0", due: "2026-10-20T10:00:00.000Z", source: "announcement", kind: "quiz", timeKnown: true };
    const recent = { id: "recent", courseKey: "46:70", title: "Lab 1", due: "2026-11-10T10:00:00.000Z", source: "announcement", kind: "lab", timeKnown: true };
    await t.engine.db.query("update guc_snapshots set data = $2, seen = $3 where id = $1", [snap.id, { ...snap.data, deadlines: [old, recent] }, { ...snap.seen, deadlines: { ...snap.seen.deadlines, v: DEADLINE_VERSION - 1 } }]);
    await t.engine.db.query("delete from guc_deadlines where owner_id = 'cu-version'");
    await t.engine.sync();
    assert.equal((await t.engine.db.query("select 1 from guc_events where kind like 'deadline%'")).length, 0, "the version bump says nothing");
    assert.ok((await t.engine.deadlines()).some((d) => d.title === "Quiz 3"), "but the items are there");

    t.pages[urls.course(45, 70)] = MATH.replace("</div></body>", "<hr><p>Quiz 4 will be held on Tuesday 24/11/2026 at 3:45 pm.</p></div></body>");
    const [s2] = await t.engine.db.query<{ id: number; data: any }>("select id, data from guc_snapshots where owner_id = 'cu-version' order by id desc limit 1");
    await t.engine.db.query("update guc_snapshots set data = $2 where id = $1", [s2.id, { ...s2.data, deadlines: [...s2.data.deadlines, old, recent] }]);
    await t.engine.sync();
    const told = await t.engine.db.query<{ title: string }>("select title from guc_events where kind = 'deadline_added'");
    assert.deepEqual(told.map((e) => e.title), ["MATH 301 Quiz 4: Tuesday 24 Nov at 15:45"]);
    const ids = (await t.engine.db.query<{ deadline_id: string }>("select deadline_id from guc_deadlines where owner_id = 'cu-version'")).map((r) => r.deadline_id);
    assert.ok(!ids.includes("old") && ids.includes("recent"), "over more than 14 days ago: removed; four days ago: kept, under Done");
    assert.equal((await t.engine.deadlines()).find((d) => d.id === "recent")?.done, true);
  } finally { await t.close(); }
});

// ---------- Syncing ----------
test("a model that doesn't answer holds nothing up: news is saved first, the rules stand in, and it is tried 3 times", async () => {
  const t = await owner("cu-slow");
  try {
    const client = new GucClient({ username: "student.name", password: "secret" }, t.guc.http, noWait);
    let asked = 0;
    const never = () => { asked++; return new Promise<string | null>(() => {}); };
    t.pages[urls.course(45, 70)] = MATH.replace("</div></body>", "<hr><p>Quiz 5 will be held on Tuesday 1/12/2026 at 3:45 pm.</p></div></body>");
    const started = Date.now();
    const r = await syncGuc({ db: t.engine.db, owner: "cu-slow", client, parts: ["pages", "catalog"], reader: never, readerMs: 40, now: new Date(NOW) });
    assert.ok(Date.now() - started < 10_000, "minutes of waiting are not the sync's");
    assert.ok(r.eventList.some((e) => e.kind === "new_announcement"), "the announcement is saved and told");
    assert.ok(r.eventList.some((e) => e.kind === "deadline_added" && /Quiz 5/.test(e.title)), "the rules found the quiz meanwhile");
    assert.ok(r.warnings.some((w) => /deadline reader didn't answer/.test(w)));
    for (let i = 0; i < 3; i++) await syncGuc({ db: t.engine.db, owner: "cu-slow", client, parts: ["pages", "catalog"], reader: never, readerMs: 40, now: new Date(NOW) });
    assert.equal(asked, 3, "three tries on the same texts, then the rules' answer stands until they change");
    assert.equal((await t.engine.db.query("select 1 from guc_events where kind = 'deadline_added'")).length, 1, "told once");
  } finally { await t.close(); }
});

test("a sync that fails halfway saves nothing and tells nothing twice; a page that failed is read again next pulse", async () => {
  const t = await owner("cu-late");
  try {
    t.pages[urls.course(46, 70)] = ELCT.replace("</div></body>", "<hr><p>Lab 2 report is due Thursday 26/11/2026.</p></div></body>");
    const keep = t.pages[urls.course(399, 70)];
    t.pages[urls.course(399, 70)] = () => { throw Object.assign(Error("socket hang up"), { code: "ECONNRESET" }); };
    await assert.rejects(t.engine.sync());
    assert.equal((await t.engine.db.query("select 1 from guc_events where kind = 'new_announcement'")).length, 0, "nothing told from the failed sync");
    t.pages[urls.course(399, 70)] = keep;
    await t.engine.sync();
    await t.engine.sync();
    assert.equal((await t.engine.db.query("select 1 from guc_events where kind = 'new_announcement'")).length, 1, "told once, on the retry");

    // A page GUC won't serve is read again on the next pulse, though pages aren't due.
    t.pages[urls.course(47, 70)] = "";
    t.guc.log.length = 0;
    const client = new GucClient({ username: "student.name", password: "secret" }, t.guc.http, noWait);
    await syncGuc({ db: t.engine.db, owner: "cu-late", client, parts: ["pages", "catalog"], now: new Date(NOW) });
    t.pages[urls.course(47, 70)] = quiet;
    t.guc.log.length = 0;
    await syncGuc({ db: t.engine.db, owner: "cu-late", client, parts: ["mail"], now: new Date(NOW) });
    assert.ok(t.guc.log.some((r) => r.url === urls.course(47, 70)), "the failed page is retried");
    assert.ok(!t.guc.log.some((r) => r.url === urls.course(45, 70)), "the others wait for their pace");
  } finally { await t.close(); }
});

test("mail is listed newest first and stops at a page it has seen; a message opens without listing the Inbox", async () => {
  const inbox = Array.from({ length: 250 }, (_, i) => ({ id: "AAMk" + i, subject: "Note " + i, from: "Office", at: new Date(Date.parse("2026-09-01T08:00:00Z") + i * 3600e3).toISOString(), body: "Body " + i }));
  const guc = fakeGuc({ [EWS_URL]: fakeEws(inbox) }), client = new GucClient({ username: "s", password: "secret" }, guc.http, noWait);
  const finds = () => guc.log.filter((r) => r.url === EWS_URL).length;
  const first = await readMail(client, undefined);
  assert.equal(first.mail[0].subject, "Note 249", "newest first");
  guc.log.length = 0;
  inbox.push({ id: "AAMkNEW", subject: "Lab moved", from: "TA", at: "2026-11-13T08:00:00Z", body: "Lab 3 moved to Thursday." });
  const second = await readMail(client, first.seen, first.mail);
  assert.deepEqual(second.fresh.map((m) => m.subject), ["Lab moved"]);
  assert.equal(finds(), 3, "one page of the Inbox, the next page (all seen) to be sure, and the new body");
  guc.log.length = 0;
  await readMail(client, second.seen, second.mail);
  assert.equal(finds(), 1, "a quiet pulse is one request");
  guc.log.length = 0;
  await readMail(client, second.seen, second.mail, { full: true });
  assert.equal(finds(), 3, "the daily full listing reads every page");
  guc.log.length = 0;
  const opened = await readMessage(client, second.mail[0].id);
  assert.equal(opened.text, "Lab 3 moved to Thursday.");
  assert.equal(finds(), 2, "the first page holds it, then its body");
});
