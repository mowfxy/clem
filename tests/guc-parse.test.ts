import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { announcementPosts, ANNOUNCEMENT_VERSION, formFields, pageState, parseCourseList, parseCoursePage, stableId, parseSchedule, parseTranscript, SiteChanged, transcriptChallenge, transcriptYears, urls } from "../core/guc/parse.ts";
import { courseDeadlines, DEADLINE_VERSION, dueText, extractDeadlines } from "../core/guc/deadlines.ts";
import { announcementEdits, diffSnapshots } from "../core/guc/diff.ts";
import { markText } from "../core/guc/hub.ts";
import { fixture } from "./guc-fake.ts";
import { emptySnapshot } from "../core/guc/types.ts";

const page = (name: string) => readFileSync(new URL(`./fixtures/guc/${name}.html`, import.meta.url), "utf8");

test("the CMS course list reads every season's courses with their ids", () => {
  const courses = parseCourseList(page("cms-home"));
  assert.equal(courses.length, 5);
  assert.deepEqual(courses[0], { key: "1201:64", id: 1201, seasonId: 64, season: "Winter 2026", code: "CSEN 701", name: "Embedded Systems Architecture", active: true });
  assert.equal(courses.find((c) => c.code === "HUMA 101")?.active, false);
  assert.equal(courses.find((c) => c.code === "HUMA 101")?.name, "Critical Thinking & Scientific Methods");
  assert.equal(courses.at(-1)?.key, "1105:63");
  assert.throws(() => parseCourseList("<html><body><p>Hello</p></body></html>"), SiteChanged);
});

test("a course page gives weeks, files and course and weekly announcements", () => {
  const course = parseCoursePage(page("cms-course"), "1201:64");
  assert.equal(course.weeks.length, 2);
  assert.equal(course.weeks[0].date, "2026-11-07");
  assert.equal(course.weeks[0].description, "Memory-mapped I/O and interrupts.");
  assert.deepEqual(course.materials.map((m) => [m.id, m.title, m.kind]), [["900301", "Lecture 3", "Lecture slides"], ["900302", "Tutorial 3", "Assignment"], ["900101", "Lecture 1", "Lecture slides"]]);
  assert.equal(course.materials[0].url, "https://cms.guc.edu.eg/Uploads/1201/64/lecture-3.pdf");
  const course1 = course.announcements.filter((a) => a.scope === "course");
  assert.equal(course1.length, 2);
  assert.match(course1[1].text, /Assignment 1 is due/);
  const weekly = course.announcements.filter((a) => a.scope === "week");
  assert.equal(weekly.length, 1, "an empty weekly announcement is not one");
  assert.match(weekly[0].text, /Quiz 1/);
  assert.equal(parseCoursePage(page("cms-course"), "1201:64").announcements[0].id, course.announcements[0].id, "ids are stable");
});

test("the group schedule reads periods, groups, rooms and types", () => {
  const slots = parseSchedule(page("schedule"));
  assert.equal(slots.length, 5);
  assert.deepEqual({ ...slots[0], id: undefined }, { id: undefined, day: "Sunday", period: 1, start: "08:15", end: "09:45", code: "CSEN 701", name: "CSEN 701 Embedded Systems Architecture", type: "Tutorial", group: "T07", location: "C7.301" });
  assert.equal(slots[1].type, "Lecture");
  assert.equal(slots[2].type, "Lab");
  assert.equal(slots[2].period, 4);
  assert.deepEqual(slots.slice(3).map((s) => [s.day, s.code, s.type]), [["Monday", "DMET 901", "Lecture"], ["Monday", "DMET 901", "Tutorial"]]);
});

test("the transcript reads each semester's grades, years and form, and the v= challenge", () => {
  const grades = parseTranscript(page("transcript"));
  assert.equal(grades.length, 4);
  assert.deepEqual(grades[0], { id: grades[0].id, semester: "Winter 2025", code: "CSEN 601", name: "Computer System Architecture", hours: 6, numeric: 1.3, letter: "A" });
  assert.equal(grades[2].numeric, null);
  assert.equal(grades[2].letter, "");
  assert.equal(grades[3].letter, "A+");
  const years = transcriptYears(page("transcript"))!;
  assert.equal(years.field, "ctl00$ctl00$ContentPlaceHolderright$ContentPlaceHoldercontent$stdYrLst");
  assert.equal(years.latest.value, "2025");
  assert.equal(formFields(page("transcript")).__VIEWSTATE, "FAKEVIEWSTATE");
  assert.equal(transcriptChallenge(page("transcript-challenge"), urls.transcript), urls.transcript + "?v=ab12cd34ef");
  assert.equal(transcriptChallenge(page("transcript"), urls.transcript), undefined);
});

test("login and 'available from' pages are told apart from real pages", () => {
  assert.equal(pageState(page("unavailable")), "unavailable");
  assert.equal(pageState("<html>x</html>", "https://apps.guc.edu.eg/student_ext/Main/MessagePage.aspx?message=x"), "unavailable");
  assert.equal(pageState('<form><input type="password" name="p"></form>'), "login");
  assert.equal(pageState(page("cms-home")), "ok");
});

test("deadlines come from sentences with a deadline word and a date, with ids that survive a moved date", () => {
  const ref = new Date("2026-11-11T10:00:00Z");
  const a = extractDeadlines("Welcome to the course. Assignment 1 is due on 20 November 2026 at 11:59 pm. Lectures start Sunday.", "1201:64", "ann", ref);
  assert.equal(a.length, 1);
  assert.equal(a[0].title, "Assignment 1");
  assert.match(a[0].note || "", /^Assignment 1 is due on 20 November 2026/);
  assert.equal(a[0].due, "2026-11-20T21:59:00.000Z", "23:59 in Cairo");
  const moved = extractDeadlines("Welcome to the course. Assignment 1 is due on 24 November 2026 at 11:59 pm.", "1201:64", "ann", ref);
  assert.equal(moved[0].id, a[0].id);
  assert.notEqual(moved[0].due, a[0].due);
  assert.equal(extractDeadlines("The lecture is on 20 November.", "1201:64", "ann", ref).length, 0);
});

test("deadlines are named, dated in Cairo, never pushed into next year, and last year's text is dropped", () => {
  const ref = new Date("2026-11-13T10:00:00Z");
  const one = (text: string) => extractDeadlines(text, "1:1", "announcement", ref).map((d) => [d.title, dueText(d.due)]);
  assert.deepEqual(one("Quiz 2 will be held on Tuesday November 17th, 3:30-5:15."), [["Quiz 2", "Tue 17 Nov, 15:30"]], "a class time is the afternoon");
  assert.deepEqual(one("Quiz 2 will be held and Tuesday November 18th, 3:30-5:15."), [["Quiz 2", "Tue 17 Nov, 15:30"]], "a weekday that isn't the date's: the earlier day, never dropped");
  assert.match(extractDeadlines("Quiz 2 will be held and Tuesday November 18th, 3:30-5:15.", "1:1", "announcement", ref)[0].note || "", /The post says Tuesday, but 18 Nov is a Wednesday/);
  assert.deepEqual(one("Assignment 2 is now available. Its submission deadline is (19/11/2026)."), [["Assignment 2", "Thu 19 Nov"]], "\"now\" is not a date");
  assert.deepEqual(one("The quiz is today at 5."), [], "when the post was written isn't known");
  assert.deepEqual(one("Quiz 1, 10/5 4:45"), [], "next May is not this term");
  assert.deepEqual(one("Students will have to submit their solutions to their tutorial TAs. The deadline is 20/11/2026."), [["Submit your solutions", "Fri 20 Nov"]], "a title is never the sentence");
  assert.deepEqual(one("The midterm covers up to lecture 6. Please submit the form by 15/11."), [["Submit the form", "Sun 15 Nov"]], "not named after another sentence's subject");
  for (const d of extractDeadlines("Kindly note that the deadline for the regrading requests of everything that was returned is 20/11/2026 and nothing later is accepted.", "1:1", "announcement", ref)) assert.ok(d.title.split(" ").length <= 5, d.title);
  const slot = (day: string, period: number, start: string, type: string) => ({ id: day + period, day, period, start, end: "", code: "MATH 301", name: "", type, group: "", location: "" });
  const mine = [slot("Sunday", 2, "10:00", "Tutorial"), slot("Wednesday", 4, "13:45", "Tutorial"), slot("Monday", 1, "08:15", "Lecture")];
  const inClass = "The fourth in-class assignment is scheduled to take place during the second tutorial of starting Saturday 21st of November, 2026.";
  assert.deepEqual(extractDeadlines(inClass, "1:1", "announcement", ref, mine).map((d) => [d.title, dueText(d.due)]), [["In-class assignment 4", "Wed 25 Nov, 13:45"]], "their own second tutorial that week");
  assert.deepEqual(one(inClass), [["In-class assignment 4", "Sat 21 Nov"]], "classes unknown: the week it starts");
  assert.deepEqual(one("Quiz 1 will be held and Tuesday Sept 29th, 3:30-5:15."), [], "past, not next September");
  assert.deepEqual(one("Assignment 3 is posted. Its submission deadline is (19/11/2026)."), [["Assignment 3", "Thu 19 Nov"]], "day-first, named from the sentence before");
  assert.deepEqual(one("The Third in-class assignment is on Saturday 21st of November, 2026."), [["In-class assignment 3", "Sat 21 Nov"]]);
  assert.deepEqual(one("Quiz 3 will be and Tue 1/12."), [["Quiz 3", "Tue 1 Dec"]]);
  assert.deepEqual(one("Quiz 1 on 20 Nov and Quiz 2 on 27 Nov."), [["Quiz 1", "Fri 20 Nov"], ["Quiz 2", "Fri 27 Nov"]]);
  assert.deepEqual(one("The midterm was postponed from 22 November to 29 November."), [["Midterm", "Sun 29 Nov"]]);
  const merged = courseDeadlines([{ text: "Quiz 2 is on 17 Nov.", source: "week" }, { text: "Quiz 2 is postponed to 24 Nov at 3:30.", source: "announcement" }], "1:1", ref);
  assert.deepEqual(merged.map((d) => [d.title, dueText(d.due)]), [["Quiz 2", "Tue 24 Nov, 15:30"]], "one Quiz 2; the move wins");
});

test("deadline events say what is due and when; a moved one says from when to when; a new extractor is a baseline", () => {
  const course = { key: "1:1", id: 1, seasonId: 1, season: "Winter 2026", code: "CSEN 301", name: "Data Structures", active: true };
  const dl = (due: string) => ({ id: "q2", courseKey: "1:1", title: "Quiz 2", due, source: "announcement", note: "Quiz 2 is on Tuesday." });
  const snap = (due: string) => ({ ...emptySnapshot(), courses: [course], deadlines: [dl(due)] });
  const seen = { courses: ["1:1"], grades: false, schedule: false, deadlines: { v: DEADLINE_VERSION, courses: ["1:1"] }, announcements: { v: ANNOUNCEMENT_VERSION, courses: ["1:1"] } };
  const at = Date.parse("2026-11-13T10:00:00Z");
  const [moved] = diffSnapshots(snap("2026-11-16T21:59:00.000Z"), snap("2026-11-24T13:30:00.000Z"), seen, at);
  assert.equal(moved.title, "CSEN 301 Quiz 2 moved to Tuesday 24 Nov at 15:30");
  assert.match(moved.detail, /^Was Mon 16 Nov\./);
  assert.equal(diffSnapshots(snap("2026-11-16T21:59:00.000Z"), snap("2026-11-24T13:30:00.000Z"), { ...seen, deadlines: { v: 1, courses: ["1:1"] } }, at).length, 0, "read by an older extractor: baseline");
  assert.equal(diffSnapshots({ ...emptySnapshot(), courses: [course] }, snap("2026-11-01T10:00:00.000Z"), seen, at).length, 0, "already past: not news");
});

// ---------- Announcements: whole posts, as written ----------
const boxes = cheerio.load(page("cms-announcements"));
const posts = (id: string) => announcementPosts(boxes("#" + id));

test("a box split by dash lines is its posts, and a rowspan table reads as complete rows inside its post", () => {
  const math = posts("math");
  assert.equal(math.length, 3, "dash and underscore lines end a post and are dropped");
  assert.match(math[0], /^The Fourth in-class assignment .* Divergence Theorem\.$/);
  assert.equal(math[1], [
    "Quiz 2 will be held on Monday November 16th and Tuesday November 17th. It will cover chapter 16.1, 16.2 and 16.3.",
    "",
    "Date · Time · Tutorial · Location",
    "Monday 16.11 · 3:45 P.M. · T21 - T22 · D1.001",
    "Monday 16.11 · 3:45 P.M. · T23 - T28 · D1.002",
    "Monday 16.11 · 3:45 P.M. · T29 - T30 · D1.003",
    "Monday 16.11 · 4:30 P.M. · T31 - T32 · D1.001",
    "Monday 16.11 · 4:30 P.M. · T33 - T34 · D1.002",
    "Tuesday 17.11 · 3:45 P.M. · T41 - T42 · Exam Hall 1",
  ].join("\n"), "the header first; a cell's own lines joined with a space");
  assert.equal(math[2], "Office hours this week are on Wednesday.");
});

test("dated entries start posts and keep their tables; a colspan cell is said once", () => {
  const elct = posts("elct");
  assert.equal(elct.length, 3);
  assert.match(elct[0], /^\[4\/11\/2026\]: Assignment 2 is now posted online\./, "the stamp stays in its post");
  assert.match(elct[0], /\nWeek · Date · Lecture Content · Tutorials · Assessments\n6 · 31\/10 - 05\/11 · Nodal Analysis · T6\n7 · 07\/11 - 12\/11 · Mesh Analysis · T7 · Quiz 2$/, "an empty cell is left out of its row");
  assert.match(elct[1], /^\[7\/11\/2026\]: Kindly note/);
  assert.match(elct[2], /^\(22\/9\/2026\) Depending on your tutorial group/);
  assert.match(elct[2], /\nOctober 15, 2026 · 3:30-4:15 · C7\.01 · T6,T7,T8,T9\nOctober 16, 2026 3:30-4:15 · C7\.02 · T10,T11$/);
});

test("a letter is one post; <br> lines, lists and links read as written; an empty box has none", () => {
  const [letter, ...rest] = posts("physics");
  assert.equal(rest.length, 0);
  assert.match(letter, /^Dear Students,\n\nPlease note .*\n\nLate arrivals .*\n\nBest regards,\n\nPhysics Lab Team$/);
  const csen = posts("csen");
  assert.deepEqual(csen, [
    "Quiz 1, Mon 5/10, 3:45 to 4:30\nBring your university ID.\n\n- Location H8: BI groups\n- Location H9: MET groups",
    "Lecture recordings are on the course drive (https://drive.google.com/drive/folders/abc), and the slides on https://cms.guc.edu.eg/.",
  ], "an <hr> ends a post; a link keeps its address unless its text is the address");
  assert.deepEqual(posts("empty"), []);
  assert.deepEqual(announcementPosts(cheerio.load("<div id='x'>No boundary here.<p>Second paragraph.</p><table><tr><td>H8</td><td>BI: T26</td></tr><tr><td>H9</td><td>MET: T1</td></tr></table></div>")("#x")).length, 1, "a box with no boundary is one post");
  assert.doesNotThrow(() => announcementPosts(cheerio.load("<div id='x'><table><tr><td><table><tr><td>a</td><td>b</td></tr></table></td><td>c</td></tr></table></div>")("#x")), "nested tables");
});

test("a course page's posts keep their page order; a week's announcement keeps its table", () => {
  const html = fixture("cms-course").replace(/(<div id="ContentPlaceHolderright_ContentPlaceHoldercontent_desc">)[\s\S]*?(\n {6}<\/div>)/, `$1${boxes("#math").html()}$2`)
    .replace('<p class="m-2 p2">Quiz 1 will be held on Sunday 15 November 2026 during the tutorial.</p>', '<p class="m-2 p2">Quiz 1 rooms:</p><table><tr><td>T1</td><td>H8</td></tr><tr><td>T2</td><td>H9</td></tr></table>');
  const read = parseCoursePage(html, "1201:64");
  assert.deepEqual(read.announcements.map((a) => [a.scope, a.order, a.text.slice(0, 14)]), [["course", 0, "The Fourth in-"], ["course", 1, "Quiz 2 will be"], ["course", 2, "Office hours t"], ["week", 3, "Quiz 1 rooms:\n"]]);
  assert.match(read.announcements[3].text, /\nT1 · H8\nT2 · H9$/);
  assert.equal(read.weeks[0].description, "Memory-mapped I/O and interrupts.");
  assert.equal(parseCoursePage(html, "1201:64").announcements[1].id, read.announcements[1].id, "ids are stable");
});

test("an edited post is one Updated announcement with what changed first; spacing alone is no news; a new reader is a baseline", () => {
  const course = { key: "1:1", id: 1, seasonId: 1, season: "Winter 2026", code: "MATH 301", name: "Calculus", active: true };
  const post = (text: string) => ({ id: stableId("1:1|c|" + text), courseKey: "1:1", scope: "course" as const, text, order: 0 });
  const quiz = "Quiz 2 will be held on Monday.\n\nDate · Time · Tutorial · Location\nMonday 16.11 · 3:45 P.M. · T21 - T22 · D1.001\nMonday 16.11 · 3:45 P.M. · T23 - T28 · D1.002";
  const snap = (...texts: string[]) => ({ ...emptySnapshot(), courses: [course], announcements: texts.map(post) });
  const seen = { courses: ["1:1"], grades: false, schedule: false, announcements: { v: ANNOUNCEMENT_VERSION, courses: ["1:1"] } };
  const grown = quiz + "\nTuesday 17.11 · 3:45 P.M. · T41 - T42 · Exam Hall 1";
  const events = diffSnapshots(snap(quiz, "Office hours on Wednesday."), snap(grown, "Office hours on Wednesday."), seen);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Updated announcement in MATH 301");
  assert.equal(events[0].key, "ann:" + post(grown).id);
  assert.match(events[0].detail, /^Tuesday 17\.11 · 3:45 P\.M\. · T41 - T42 · Exam Hall 1\nQuiz 2 will be held on Monday\.\nDate · Time/, "the new row first, then the rest");
  assert.equal(diffSnapshots(snap(quiz), snap(quiz.replace("Monday.", "Monday .")), seen).length, 0, "punctuation and spacing only: not news");
  const fresh = diffSnapshots(snap(quiz), snap(quiz, "A brand new post about Lab 4."), seen);
  assert.deepEqual(fresh.map((e) => [e.title, e.detail]), [["New announcement in MATH 301", "A brand new post about Lab 4."]]);
  const long = "x".repeat(2000);
  assert.equal(diffSnapshots(snap(), snap(long), seen)[0].detail.length, 1500, "a whole post, up to 1500 characters");
  assert.equal(diffSnapshots(snap("T21 - T22", "D1.001"), snap(quiz), { ...seen, announcements: { v: ANNOUNCEMENT_VERSION - 1, courses: ["1:1"] } }).length, 0, "read by an older announcement reader: baseline");
  assert.equal(diffSnapshots(snap(), snap(quiz), { ...seen, announcements: undefined }).length, 0);
  const edits = announcementEdits(snap(quiz).announcements, snap(grown).announcements);
  assert.equal(edits.get(post(grown).id)?.material, true);
});

test("grades and marks show at most one decimal", () => {
  assert.equal(markText("92.5926"), "92.6");
  assert.equal(markText("97.5"), "97.5");
  assert.equal(markText("60"), "60");
  assert.equal(markText("9 / 10"), "9 / 10");
  assert.equal(markText("8.75 / 10"), "8.8 / 10");
  assert.equal(markText("/ 10"), "/ 10");
  assert.equal(markText(1.7), "1.7");
  assert.equal(markText("A+"), "A+");
  assert.equal(markText(null), "");
});
