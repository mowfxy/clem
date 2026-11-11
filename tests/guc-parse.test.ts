import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formFields, pageState, parseCourseList, parseCoursePage, parseSchedule, parseTranscript, SiteChanged, transcriptChallenge, transcriptYears, urls } from "../core/guc/parse.ts";
import { extractDeadlines } from "../core/guc/deadlines.ts";

const page = (name: string) => readFileSync(new URL(`./fixtures/guc/${name}.html`, import.meta.url), "utf8");

test("the CMS course list reads every season's courses with their ids", () => {
  const courses = parseCourseList(page("cms-home"));
  assert.equal(courses.length, 5);
  assert.deepEqual(courses[0], { key: "1201:64", id: 1201, seasonId: 64, season: "Winter 2026", code: "CSEN701", name: "Embedded Systems Architecture", active: true });
  assert.equal(courses.find((c) => c.code === "HUMA101")?.active, false);
  assert.equal(courses.find((c) => c.code === "HUMA101")?.name, "Critical Thinking & Scientific Methods");
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
  assert.deepEqual({ ...slots[0], id: undefined }, { id: undefined, day: "Sunday", period: 1, start: "08:15", end: "09:45", code: "CSEN701", name: "CSEN701 Embedded Systems Architecture", type: "", group: "T07", location: "C7.301" });
  assert.equal(slots[1].type, "Lecture");
  assert.equal(slots[2].type, "Lab");
  assert.equal(slots[2].period, 4);
  assert.deepEqual(slots.slice(3).map((s) => [s.day, s.code, s.type]), [["Monday", "DMET 901", "Lecture"], ["Monday", "DMET 901", "Tutorial"]]);
});

test("the transcript reads each semester's grades, years and form, and the v= challenge", () => {
  const grades = parseTranscript(page("transcript"));
  assert.equal(grades.length, 4);
  assert.deepEqual(grades[0], { id: grades[0].id, semester: "Winter 2025", code: "CSEN601", name: "Computer System Architecture", hours: 6, numeric: 1.3, letter: "A" });
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
  assert.match(a[0].title, /^Assignment 1 is due/);
  assert.equal(new Date(a[0].due).getDate(), 20);
  const moved = extractDeadlines("Welcome to the course. Assignment 1 is due on 24 November 2026 at 11:59 pm.", "1201:64", "ann", ref);
  assert.equal(moved[0].id, a[0].id);
  assert.notEqual(moved[0].due, a[0].due);
  assert.equal(extractDeadlines("The lecture is on 20 November.", "1201:64", "ann", ref).length, 0);
});
