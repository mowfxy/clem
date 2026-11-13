import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReader, courseTexts, readerPrompt, type ReaderInput } from "../core/guc/deadline-ai.ts";
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
  assert.match(user, /\[a1\] Course announcement:/);
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
