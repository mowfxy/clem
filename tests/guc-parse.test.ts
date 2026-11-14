import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formFields, pageState, parseCourseList, parseCoursePage, parseSchedule, parseTranscript, SiteChanged, transcriptChallenge, transcriptYears, urls } from "../core/guc/parse.ts";
import { courseDeadlines, DEADLINE_VERSION, dueText, extractDeadlines } from "../core/guc/deadlines.ts";
import { diffSnapshots } from "../core/guc/diff.ts";
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
  const seen = { courses: ["1:1"], grades: false, schedule: false, deadlines: { v: DEADLINE_VERSION, courses: ["1:1"] } };
  const at = Date.parse("2026-11-13T10:00:00Z");
  const [moved] = diffSnapshots(snap("2026-11-16T21:59:00.000Z"), snap("2026-11-24T13:30:00.000Z"), seen, at);
  assert.equal(moved.title, "CSEN 301 Quiz 2 moved to Tue 24 Nov, 15:30");
  assert.match(moved.detail, /^Was Mon 16 Nov\./);
  assert.equal(diffSnapshots(snap("2026-11-16T21:59:00.000Z"), snap("2026-11-24T13:30:00.000Z"), { ...seen, deadlines: { v: 1, courses: ["1:1"] } }, at).length, 0, "read by an older extractor: baseline");
  assert.equal(diffSnapshots({ ...emptySnapshot(), courses: [course] }, snap("2026-11-01T10:00:00.000Z"), seen, at).length, 0, "already past: not news");
});
