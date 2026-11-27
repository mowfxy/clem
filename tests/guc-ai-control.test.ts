// The AI decides Coming up: rules and word lists only fill in where the model said nothing, never undo what it said.
// Each case here is one found in the owner's own database copy (2026-11-27), written with made-up text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorDue, applyReader, readerPrompt, sameName, type ReaderInput } from "../core/guc/deadline-ai.ts";
import { applyCorrections, fingerprint, type Correction } from "../core/guc/corrections.ts";
import { dueText, nameOnly } from "../core/guc/deadlines.ts";
import type { GucDeadline, GucSlot } from "../core/guc/types.ts";

const now = Date.parse("2026-11-21T10:00:00Z"); // Saturday 21 November, Cairo
const course = { key: "351:70", code: "CSEN 301", name: "Data structures and Algorithms" };
const slot = (day: string, period: number, start: string, end: string, type: string, group: string, location: string): GucSlot => ({ id: day + period, day, period, start, end, code: "CSEN 301", name: "Data structures and Algorithms", type, group, location });
const slots = [slot("Sunday", 1, "08:15", "09:45", "Lecture", "3MIET L002", "H15"), slot("Tuesday", 4, "13:45", "15:15", "Tutorial", "3MIET T014", "C4.101"), slot("Thursday", 4, "13:45", "15:15", "Lab", "3MIET P014", "D3.301")];
const mail = { id: "m1", source: "mail" as const, label: "Email: Quiz 2", sent: "2026-11-20T09:00:00.000Z", text: "Quiz 2 for your group is in the coming tutorial." };

test("the model's own 'relative: false' stands: the word list doesn't move or drop its date", () => {
  const input: ReaderInput = { course, slots, texts: [mail], tracked: [], now };
  // "the coming tutorial" looks relative to the word list, but the model read the date from the post and said so.
  const out = applyReader({ deadlines: [{ title: "Quiz 2", kind: "quiz", due: "2026-12-15 13:45", timeKnown: true, from: "m1", quote: "Quiz 2 for your group is in the coming tutorial.", relative: false }] }, input)!;
  assert.deepEqual(out.map((d) => dueText(d.due)), ["Tue 15 Dec, 13:45"], "kept as the model gave it");
  // Without the model saying, the words still decide: three weeks past "the coming tutorial" is counted again.
  const unsaid = applyReader({ deadlines: [{ title: "Quiz 2", kind: "quiz", due: "2026-12-15 13:45", timeKnown: true, from: "m1", quote: "Quiz 2 for your group is in the coming tutorial." }] }, input)!;
  assert.notEqual(unsaid[0]?.due, out[0].due);
  assert.equal(anchorDue(Date.parse("2026-11-10T10:00:00Z"), { sent: Date.parse("2026-11-20T09:00:00Z"), quote: "Quiz 2 is on 10/11", relative: false, now }), Date.parse("2026-11-10T10:00:00Z"), "a written date the model read stands");
});

test("names, never sentences, and never the course code: what the model gives is named, not dropped", () => {
  const input: ReaderInput = { course, slots, texts: [mail], tracked: [], now };
  const out = applyReader({ deadlines: [
    { title: "CSEN 301 Quiz 2", kind: "quiz", due: "2026-11-24 15:45", timeKnown: true, from: "m1", relative: false },
    { title: "The final lab test will be conducted during the week starting 28th of November in your labs", kind: "lab", due: "2026-12-03 13:45", timeKnown: true, from: "m1", relative: false },
  ] }, input)!;
  assert.deepEqual(out.map((d) => d.title), ["Quiz 2", "Lab"], "code taken off; a sentence named by what it is");
  assert.equal(nameOnly("ELCT 301 Quiz 2"), "Quiz 2");
  assert.equal(nameOnly("CSEN301 - Lab Test 3"), "Lab Test 3");
  assert.equal(nameOnly("Midterm"), "Midterm");
  assert.equal(nameOnly("CSEN 301"), "CSEN 301", "a code alone stays");
});

test("a room the model didn't repeat stays when the time is the same", () => {
  const tracked: GucDeadline[] = [{ id: "q2", courseKey: course.key, title: "Quiz 2", due: new Date(Date.parse("2026-11-24T13:45:00Z")).toISOString(), source: "announcement", kind: "quiz", timeKnown: true, place: "Exam Hall 2" }];
  const input: ReaderInput = { course, slots, texts: [mail], tracked, now };
  const same = applyReader({ deadlines: [{ id: "q2", title: "Quiz 2", kind: "quiz", due: "2026-11-24 15:45", timeKnown: true, from: "m1", relative: false }] }, input)!;
  assert.equal(same[0].place, "Exam Hall 2");
  const moved = applyReader({ deadlines: [{ id: "q2", title: "Quiz 2", kind: "quiz", due: "2026-11-25 15:45", timeKnown: true, from: "m1", relative: false }] }, input)!;
  assert.equal(moved[0].place, undefined, "a new time may be a new room");
});

test("two items the model kept apart stay apart; the same item named two ways is one", () => {
  const tracked: GucDeadline[] = [{ id: "lt3", courseKey: course.key, title: "Lab Test 3", due: "2026-12-03T11:45:00.000Z", source: "mail", kind: "lab", timeKnown: true }];
  const input: ReaderInput = { course, slots, texts: [mail], tracked, now };
  const out = applyReader({ deadlines: [{ title: "Lab 3 report", kind: "lab", due: "2026-12-05 23:59", from: "m1", relative: false }] }, input)!;
  assert.deepEqual(out.map((d) => d.title).sort(), ["Lab 3 report", "Lab Test 3"]);
  const q: GucDeadline[] = [{ id: "q3", courseKey: course.key, title: "Quiz 3 / Assignment 3", due: "2026-12-03T08:50:00.000Z", source: "announcement", kind: "quiz", timeKnown: true }];
  const one = applyReader({ deadlines: [{ title: "Quiz 3", kind: "quiz", due: "2026-12-03 10:50", timeKnown: true, from: "m1", relative: false }] }, { ...input, tracked: q })!;
  assert.deepEqual(one.map((d) => d.id), ["q3"], "the same quiz");
  assert.ok(sameName("CSEN301 quiz #2", "Quiz 2") && sameName("Second quiz", "Quiz 2") && !sameName("Lab Test 3", "Lab 3 report"));
});

test("the reader is told the student's major, so a group number of another major isn't theirs", () => {
  const { system, user } = readerPrompt({ course, slots, texts: [mail], tracked: [], now });
  assert.match(user, /Their groups: .*tutorial group T14 \(T14\).*; the portal writes them 3MIET L002, 3MIET T014, 3MIET P014\./);
  assert.match(system, /"BI: T13, T14" and "IET\/MET: T13, T14" are different students/);
});

test("an item the person added that a post later brought is shown once, with their edits", () => {
  const read: GucDeadline = { id: "r3", courseKey: "399:70", title: "Quiz 3", due: "2026-12-03T08:50:00.000Z", source: "announcement", kind: "quiz", timeKnown: true, place: "C5.312", ref: "a1" };
  const yours: GucDeadline = { ...read, id: "you-28ab42af", source: "you", ref: undefined, note: "Chapters 18 and 34" };
  const add: Correction = { id: "fix1", kind: "add", at: 1, label: "", itemId: yours.id, fingerprint: fingerprint(yours), courseKey: "399:70", patch: { item: yours } };
  const note: Correction = { id: "fix2", kind: "note", at: 2, label: "", itemId: yours.id, fingerprint: fingerprint(yours), courseKey: "399:70", patch: { note: "bring a calculator" } };
  for (const o of [{ now, course: "399:70" }, { now, hub: true }]) {
    const out = applyCorrections([read, yours], [add, note], o);
    assert.deepEqual(out.map((d) => d.id), ["r3"], "once");
    assert.match(out[0].note || "", /^Your note: bring a calculator/, "their note follows it");
  }
  assert.deepEqual(applyCorrections([yours], [add], { now }).map((d) => d.id), ["you-28ab42af"], "nothing read it: theirs stays");
});

test("a correction that named the item with its course code shows the name alone", () => {
  const item: GucDeadline = { id: "e2", courseKey: "20:70", title: "Quiz 2", due: "2026-11-26T14:30:00.000Z", source: "announcement", kind: "quiz", timeKnown: true };
  const edit: Correction = { id: "fix3", kind: "edit", at: 1, label: "", itemId: "e2", fingerprint: fingerprint(item), courseKey: "20:70", patch: { title: "ELCT 301 Quiz 2", place: "Hall H17" } };
  const [out] = applyCorrections([item], [edit], { now, hub: true });
  assert.equal(out.title, "Quiz 2");
  assert.equal(out.place, "Hall H17");
});
