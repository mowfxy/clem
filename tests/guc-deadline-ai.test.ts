import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorDue, applyReader, courseTexts, readerPrompt, type CourseText, type ReaderInput } from "../core/guc/deadline-ai.ts";
import { rulesText, textAllowed } from "../core/guc/corrections.ts";
import { dueText } from "../core/guc/deadlines.ts";
import type { GucCoursePage, GucSlot } from "../core/guc/types.ts";

const now = Date.parse("2026-11-13T10:00:00Z"); // Friday 13 November, Cairo
const course = { key: "1:1", code: "MATH 301", name: "Engineering Mathematics" };
const slot = (day: string, period: number, start: string, end: string, type: string): GucSlot => ({ id: day + period, day, period, start, end, code: "MATH 301", name: "MATH 301", type, group: "T12", location: "C7.203" });
const slots = [slot("Saturday", 2, "10:00", "11:30", "Tutorial"), slot("Tuesday", 4, "13:45", "15:15", "Tutorial"), slot("Monday", 1, "08:15", "09:45", "Lecture"), { ...slot("Sunday", 1, "08:15", "09:45", "Lab"), code: "CSEN 301" }];

test("only recent, unread posts are read: old weeks are history", () => {
  const page: GucCoursePage = {
    courseKey: "1:1", materials: [],
    announcements: [
      { id: "c1", courseKey: "1:1", scope: "course", text: "Quiz 3 will be on Tue 1/12." },
      { id: "w-old", courseKey: "1:1", scope: "week", week: "Week: 2026-9-19", text: "First in-class assignment this week." },
      { id: "w-new", courseKey: "1:1", scope: "week", week: "Week: 2026-11-7", text: "Third in-class assignment next week." },
    ],
    weeks: [
      { title: "Week: 2026-11-7", date: "2026-11-07", announcement: "", description: "Assignment 4 is posted.", materials: [] },
      { title: "Week: 2026-9-19", date: "2026-09-19", announcement: "", description: "Assignment 1 is posted.", materials: [] },
    ],
  };
  const texts = courseTexts(page, now);
  assert.deepEqual(texts.map((t) => t.id).filter((id) => !id.startsWith("w-") && id !== "c1").length, 1, "one week's notes");
  assert.ok(texts.some((t) => t.id === "c1") && texts.some((t) => t.id === "w-new"));
  assert.ok(!texts.some((t) => t.id === "w-old") && !texts.some((t) => /Assignment 1/.test(t.text)), "September is not read");
});

test("the AI is given the calendar of GUC weeks and the student's own classes in this course", () => {
  const { system, user } = readerPrompt({ course, slots, texts: [{ id: "a1", source: "announcement", label: "Course announcement", text: "The third in-class assignment is during the second tutorial of the week starting Saturday 14th of November." }], tracked: [], now });
  assert.match(user, /Today: Friday 2026-11-13/);
  assert.match(user, /Week starting Sat 14 Nov 2026: Sat 14 Nov, Sun 15 Nov, Mon 16 Nov, Tue 17 Nov, Wed 18 Nov, Thu 19 Nov/);
  assert.match(user, /Tutorial: Saturday, 2nd slot 10:00–11:30, group T12, C7\.203/);
  assert.match(user, /Tutorial: Tuesday, 4th slot 13:45–15:15/);
  assert.doesNotMatch(user, /Lab: Sunday/, "another course's lab is not this course's");
  assert.match(user, /\[a1\] Course announcement \(date not known\):/);
  assert.match(system, /second tutorial of the week starting Saturday 7 November/);
});

test("the AI's answer: new ones join, a moved one keeps its id, a cancelled one goes, bad answers are refused", () => {
  const tracked = [
    { id: "q2", courseKey: "1:1", title: "Quiz 2", due: "2026-11-16T21:59:00.000Z", source: "announcement", note: "Quiz 2 on Monday." },
    { id: "a9", courseKey: "1:1", title: "Assignment 9", due: "2026-11-20T21:59:00.000Z", source: "week" },
  ];
  const input: ReaderInput = { course, slots, texts: [{ id: "t1", source: "announcement", label: "Course announcement", text: "…" }], tracked, now };
  const out = applyReader({ deadlines: [
    { title: "In-class assignment 3", due: "2026-11-17 13:45", timeKnown: true, from: "t1", quote: "during the second tutorial of the week starting Saturday 14th" },
    { id: "q2", title: "Quiz 2", due: "2026-11-24 15:30", timeKnown: true, from: "t1", quote: "Quiz 2 is postponed to Tuesday 24/11." },
    { title: "Old quiz", due: "2025-11-18 15:30" },
    { title: "Students will have to submit their solutions to their tutorial TAs before the end of the week", due: "2026-11-19" },
  ], cancel: ["a9"] }, input)!;
  assert.deepEqual(out.map((d) => [d.title, dueText(d.due)]), [["In-class assignment 3", "Tue 17 Nov, 13:45"], ["Quiz 2", "Tue 24 Nov, 15:30"]]);
  assert.equal(out[1].id, "q2", "moved, not added twice");
  assert.equal(out[0].note, "during the second tutorial of the week starting Saturday 14th");
  assert.equal(applyReader({ nope: 1 }, input), null);
  assert.equal(applyReader({ deadlines: [{ title: "Quiz 4", due: "next week" }] }, input), null);
  assert.deepEqual(applyReader({ deadlines: [], cancel: [] }, input), tracked, "nothing new: the list stays");
});

// ---------- Relative dates count from when the message was sent ----------
// The owner's case: a TA mail sent 25 October said "in next week's class you will be having your 2nd group persuasive
// presentation". Read on 15 November, the model counted "next week" from today and Clem showed it for 22 November.
const CPS = { key: "48:70", code: "CPS 402", name: "Communication & Presentation Skills" };
const presMail = (sent: string): CourseText => ({ id: "m1", source: "mail", label: "Email: Group Presentation", sent, sender: "GUC Notification System (DO NOT REPLY) <notify@guc.edu.eg>",
  text: "Good morning dear CPS students: Kindly be reminded that in next week's class you will be having your 2nd group persuasive presentation." });
const presAnswer = (due: string) => ({ deadlines: [{ title: "Group presentation 2", kind: "presentation", due, timeKnown: true, from: "m1", quote: "in next week's class you will be having your 2nd group persuasive presentation" }], cancel: [] });

test("the stale TA mail: sent months ago, 'presentation 2 will be next week' adds nothing to Coming up", () => {
  const at = Date.parse("2026-11-15T08:00:00Z"); // Sunday 15 November
  const old: ReaderInput = { course: CPS, slots: [], texts: [presMail("2026-08-20T09:00:00Z")], tracked: [], now: at };
  assert.deepEqual(applyReader(presAnswer("2026-11-22 11:45"), old), [], "months old: next week from today is not what it meant");
  // The real mail: sent Sunday 25 October, so "next week" was the week of 31 October, long past.
  const real: ReaderInput = { ...old, texts: [presMail("2026-10-25T05:46:47Z")] };
  assert.deepEqual(applyReader(presAnswer("2026-11-22 11:45"), real), [], "the owner's mail: nothing");
  assert.equal(dueText(new Date(anchorDue(Date.parse("2026-11-22T09:45:00Z"), { sent: Date.parse("2026-10-25T05:46:47Z"), quote: "in next week's class", now: at })!).toISOString()), "Sun 1 Nov, 11:45", "counted again from the day it was sent");
  assert.deepEqual(applyReader(presAnswer("2026-11-01 11:45"), real), [], "a model that got it right: already past, so nothing either");
});

test("the same mail sent yesterday yields the presentation next week, keyed to its message", () => {
  const at = Date.parse("2026-11-13T10:00:00Z"); // Friday 13 November
  const input: ReaderInput = { course: CPS, slots: [], texts: [presMail("2026-11-12T07:00:00Z")], tracked: [], now: at };
  const out = applyReader(presAnswer("2026-11-18 15:45"), input)!;
  assert.deepEqual(out.map((d) => [d.title, dueText(d.due), d.ref, d.sent]), [["Group presentation 2", "Wed 18 Nov, 15:45", "m1", "2026-11-12T07:00:00.000Z"]]);
  const { system, user } = readerPrompt(input);
  assert.match(user, /\[m1\] Email: Group Presentation \(sent Thursday 12 Nov 2026\):/, "the prompt says when it was sent");
  assert.match(system, /count from the day it was SENT, never from today/);
  // A date before the mail was written is wrong; "tomorrow" can't be three weeks later.
  assert.deepEqual(applyReader(presAnswer("2026-11-10 15:45"), input), [], "before it was sent");
  assert.equal(dueText(new Date(anchorDue(Date.parse("2026-12-03T10:00:00Z"), { sent: Date.parse("2026-11-12T07:00:00Z"), quote: "the quiz is tomorrow", now: Date.parse("2026-12-02T10:00:00Z") })!).toISOString()), "Fri 13 Nov, 12:00", "tomorrow, read three weeks late: the day after it was sent");
  assert.equal(anchorDue(Date.parse("2026-12-25T10:00:00Z"), { sent: Date.parse("2026-11-12T07:00:00Z"), quote: "the quiz is tomorrow", now: Date.parse("2026-12-02T10:00:00Z") }), null, "a date that fits neither: left out");
  assert.ok(anchorDue(Date.parse("2026-12-03T10:00:00Z"), { sent: Date.parse("2026-11-12T07:00:00Z"), quote: "Quiz 3 is on 3/12", now: at }), "a written date stands");
});

test("stamped parts count from their stamp; a relative date with no known sending day is dropped on a first read", () => {
  const at = Date.parse("2026-11-15T08:00:00Z");
  const box: CourseText = { id: "c1", source: "announcement", label: "Course announcement", text: "[25/10/2026]: The second presentation is next week.\n[14/11/2026]: Quiz 2 is next week." };
  const answer = { deadlines: [
    { title: "Presentation 2", due: "2026-11-22 10:00", from: "c1", quote: "The second presentation is next week." },
    { title: "Quiz 2", due: "2026-11-24 10:00", from: "c1", quote: "Quiz 2 is next week." },
  ] };
  assert.deepEqual(applyReader(answer, { course: CPS, slots: [], texts: [box], tracked: [], now: at })!.map((d) => d.title), ["Quiz 2"], "October's part is past; November's stands");
  const bare: CourseText = { id: "c2", source: "announcement", label: "Course announcement", text: "Quiz 2 is next week." };
  const one = { deadlines: [{ title: "Quiz 2", due: "2026-11-24 10:00", from: "c2", quote: "Quiz 2 is next week." }] };
  assert.deepEqual(applyReader(one, { course: CPS, slots: [], texts: [bare], tracked: [], now: at, firstRead: true }), [], "first read: when it was written isn't known");
  assert.equal(applyReader(one, { course: CPS, slots: [], texts: [bare], tracked: [], now: at })!.length, 1, "seen as new on a later read: it was just posted");
});

test("learned rules reach the reader and keep texts out", () => {
  const rules = [{ id: "r1", kind: "rule" as const, at: 1, label: "", patch: { rule: { type: "max_age", days: 14 } } }, { id: "r2", kind: "rule" as const, at: 2, label: "", courseKey: "48:70", patch: { rule: { type: "ignore", from: "library" }, text: "Ignore mail from the library." } }];
  const at = Date.parse("2026-11-15T08:00:00Z");
  assert.deepEqual(rulesText(rules), ["Mail and posts sent more than 14 days before Clem reads them don't create Coming up items.", "Ignore mail from the library."]);
  assert.equal(textAllowed(presMail("2026-10-25T05:46:47Z"), rules, at), false, "older than 14 days");
  assert.equal(textAllowed(presMail("2026-11-12T07:00:00Z"), rules, at), true);
  assert.equal(textAllowed({ ...presMail("2026-11-12T07:00:00Z"), sender: "GUC Library <library@guc.edu.eg>" }, rules, at), false, "the ignored sender");
  assert.match(readerPrompt({ course: CPS, slots: [], texts: [presMail("2026-11-12T07:00:00Z")], tracked: [], now: at, rules: rulesText(rules) }).user, /Corrections the student gave Clem \(follow them\):\n- Mail and posts sent more than 14 days/);
});
