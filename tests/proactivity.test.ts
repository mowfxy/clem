import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionKey, applyAction, undoAction, type Workspace } from "../core/proactivity/actions.ts";
import { importance, slotChanges, type Change } from "../core/proactivity/attention.ts";
import { deadlineReminders, extractCommitments, findClashes, followUps, freedSlots, gradeNotes, type Facts } from "../core/proactivity/rules.ts";
import { cairoAt, delivery, DEFAULT_PRO, inQuiet, mergePro, quietEnd, readPro } from "../core/proactivity/settings.ts";
import { snapshotOf } from "../core/proactivity/snapshot.ts";
import { briefText, MAX_MESSAGES, ORGANIZER_GUIDE, planSweep, readReply, shortGroup, sweepMessages, type RatedChange } from "../core/proactivity/sweep.ts";
import { alsoLine, deadlineText, plainText, reminderText } from "../core/proactivity/say.ts";
import { CALENDAR_GUIDE } from "../core/proactivity/calendar.ts";
import { ROUTINE_GUIDE } from "../core/proactivity/routines.ts";
import { clemAction, isClemAction } from "../core/proactivity/tools.ts";
import { turnText } from "../core/main-thread/context.ts";
import { live, matchWatch, parseWatch, WATCH_GUIDE } from "../core/proactivity/watches.ts";
import { readCard, cardsIn } from "../core/guc/cards.ts";
import { Engine } from "../desktop/engine/index.ts";
import { host as fakeHost, migrations } from "./guc-fake.ts";

const T = (day: string, hm: string) => cairoAt(day, hm);
// Sunday 15 November 2026, Cairo (UTC+2).
const SUN = "2026-11-15";
const space = (id: string, name: string, kind: "subject" | "project" = "subject", extra = {}) => ({ id, name, kind, description: "", memory: "", sources: [], ...extra });
const slot = (day: string, start: string, end: string, code = "ELCT 201", type = "Lecture", location = "C1.01") => ({ id: day + start, day, period: 1, start, end, code, name: code, type, group: "T1", location });

test("settings: proactive by default, merged patches, Cairo quiet hours that cross midnight", () => {
  assert.equal(readPro(undefined).level, "proactive");
  assert.deepEqual(readPro({ level: "loud" }), DEFAULT_PRO, "a broken value is the default");
  const s = mergePro(DEFAULT_PRO, { quiet: { from: "23:00", to: "07:30" } });
  // Saved when each kind of news had its own switch and channels: still read, those dropped.
  const old = readPro({ level: "balanced", events: { grade: { on: false, channels: ["app"] } } });
  assert.equal(old.level, "balanced");
  assert.equal("events" in old, false);
  assert.equal(inQuiet(s, T(SUN, "01:00")), true);
  assert.equal(inQuiet(s, T(SUN, "23:30")), true);
  assert.equal(inQuiet(s, T(SUN, "12:00")), false);
  assert.equal(quietEnd(s, T(SUN, "01:00")), T(SUN, "07:30"));
  assert.equal(quietEnd(s, T(SUN, "23:30")), T("2026-11-16", "07:30"));
});

test("levels: quiet speaks only for urgent things, balanced for news and briefs, proactive for all", () => {
  const at = (level: "quiet" | "balanced" | "proactive") => ({ ...DEFAULT_PRO, level });
  assert.deepEqual(delivery(at("quiet"), { news: true }), { post: false, channels: [] });
  assert.deepEqual(delivery(at("quiet"), { news: true, urgent: true }), { post: true, channels: ["app", "push", "telegram"] }, "urgent reaches them wherever they are");
  assert.deepEqual(delivery(at("balanced"), { news: true }), { post: true, channels: ["app", "push", "telegram"] });
  assert.equal(delivery(at("balanced"), { job: "midday" }).post, false);
  assert.deepEqual(delivery(at("balanced"), { job: "morning" }), { post: true, channels: ["app"] }, "a brief is not worth a buzz");
  assert.equal(delivery(at("balanced"), {}).post, false, "plan tidying alone stays quiet");
  assert.equal(delivery(at("proactive"), { job: "midday" }).post, true);
});

test("deadline reminders: 48 hours, then 3 hours before, on Cairo's clock, each once", () => {
  const d = [{ id: "sheet3", title: "Sheet 3", due: "2026-11-17" }, { id: "lab", title: "Lab report", due: new Date(T("2026-11-17", "10:00")).toISOString() }];
  assert.deepEqual(deadlineReminders(d, T(SUN, "08:00")).map((r) => r.key), [], "more than 48h away");
  assert.deepEqual(deadlineReminders(d, T("2026-11-15", "10:30")).map((r) => r.key), ["remind:lab:48h"]);
  assert.deepEqual(deadlineReminders(d, T("2026-11-16", "00:30")).map((r) => r.key), ["remind:lab:48h", "remind:sheet3:48h"], "a bare day is due at 23:59 Cairo");
  assert.deepEqual(deadlineReminders(d, T("2026-11-17", "07:30")).map((r) => r.key), ["remind:lab:3h", "remind:sheet3:48h"]);
  assert.deepEqual(deadlineReminders(d, T("2026-11-17", "21:30")).map((r) => r.key), ["remind:sheet3:3h"], "only the tightest window; past ones never fire");
  assert.deepEqual(deadlineReminders(d, T("2026-11-18", "00:30")), []);
});

test("clashes: a class overlapping a timed plan item on the same day", () => {
  const slots = [{ day: "2026-11-19", start: "10:00", end: "11:30", title: "ELCT 201 Lab" }];
  assert.equal(findClashes(slots, [{ title: "Math quiz", day: "2026-11-19", time: "11:00" }]).length, 1);
  assert.equal(findClashes(slots, [{ title: "Math quiz", day: "2026-11-19", time: "11:30" }]).length, 0);
  assert.equal(findClashes(slots, [{ title: "Math quiz", day: "2026-11-18", time: "10:00" }]).length, 0);
});

test("commitments: what the person said they'd do, with its day", () => {
  const at = T(SUN, "20:00");
  const got = extractCommitments([{ id: "m1", text: "Ok. I'll finish the lab report tomorrow.", at }, { id: "m2", text: "Should I finish the lab report?", at }, { id: "m3", text: "I'll try", at }, { id: "m4", text: "remind me to email Dr. Amr about the project", at }]);
  assert.deepEqual(got.map((c) => [c.text, c.day]), [["finish the lab report", "2026-11-16"], ["email Dr. Amr about the project", undefined]]);
  assert.match(got[0].key, /^commit:m1:/);
});

test("appliers: each action applies, and Undo puts back only what it changed", () => {
  const w: Workspace = { spaces: [space("phys", "Physics") as any], plans: [], files: [{ id: "f1", name: "phys-lab.pdf", size: 1, type: "application/pdf", created: 1, spaceId: null }], memory: "Likes mornings", automations: [] };
  const now = T(SUN, "08:00");
  const ok = <X,>(r: X) => { if ((r as any).error) throw Error((r as any).error); return r as Extract<X, { state: unknown }>; };
  const a = ok(applyAction(w, { type: "plan_task", spaceId: "phys", title: "Start problem set", due: "2026-11-16" }, { now }));
  assert.equal(a.state.plans![0].tasks[0].title, "Start problem set");
  assert.deepEqual(undoAction(a.state, a.undo!).plans, [], "a plan Clem made goes once empty");
  const b = ok(applyAction(a.state, { type: "time_block", spaceId: "phys", title: "Review 5 flashcards", day: SUN, time: "09:00" }, { now }));
  assert.deepEqual(b.state.plans![0].tasks.at(-1), { id: "t2", title: "Review 5 flashcards", due: SUN, time: "09:00", group: "Today" });
  const c = ok(applyAction(b.state, { type: "plan_move", spaceId: "phys", taskId: "t1", title: "Start problem set", due: "2026-11-18" }, { now }));
  assert.equal(c.state.plans![0].tasks[0].due, "2026-11-18");
  assert.equal(undoAction(c.state, c.undo!).plans![0].tasks[0].due, "2026-11-16");
  const r = ok(applyAction(w, { type: "revision_plan", spaceId: "phys", examDate: "2026-12-01", sessions: [{ day: "2026-11-25", title: "Revision session 1" }, { day: "2026-11-30", title: "Light review" }] }, { now }));
  assert.deepEqual(r.state.plans![0].tasks.map((t) => t.group), ["Before the exam", "Before the exam"]);
  const f = ok(applyAction(w, { type: "file_move", fileId: "f1", name: "phys-lab.pdf", spaceId: "phys" }, { now }));
  assert.equal(f.state.files[0].spaceId, "phys");
  assert.equal(undoAction(f.state, f.undo!).files[0].spaceId, null);
  const m = ok(applyAction(w, { type: "memory", text: "Prefers studying before 10am" }, { now }));
  assert.equal(m.state.memory, "Likes mornings\nPrefers studying before 10am");
  assert.equal(undoAction(m.state, m.undo!).memory, "Likes mornings");
  const au = ok(applyAction(w, { type: "automation", name: "Daily quiz", prompt: "Quiz me on Physics", schedule: "daily", time: "19:00" }, { now, uid: () => "a1" }));
  assert.equal(au.state.automations[0].id, "a1");
  assert.ok(au.state.automations[0].nextRun! > now);
  assert.deepEqual(undoAction(au.state, au.undo!).automations, []);
  assert.deepEqual(applyAction(w, { type: "plan_task", spaceId: "gone", title: "x" }), { error: "That subject or project is gone." });
  assert.equal(actionKey({ type: "plan_task", spaceId: "phys", title: "Start: Problem set!", due: "2026-11-16" }), "task:phys:start problem set:2026-11-16", "keys are stable");
});

test("attention: rules rate cancelled classes, room changes, deadlines and routine slides; mutes silence a kind", () => {
  const ann = (detail: string): Change => ({ key: "ann:" + detail.length, kind: "new_announcement", title: "New announcement in ELCT 201", detail, subjectId: "circ" });
  assert.equal(importance({ key: "s", kind: "slot_cancelled", title: "ELCT 201 Lecture on Sunday 10:00 is cancelled", detail: "", soon: true }).level, "urgent");
  assert.equal(importance(ann("Today's lecture is cancelled. A compensation lecture will be announced.")).level, "urgent");
  assert.equal(importance(ann("The midterm will be held in room C7.02 on Thursday.")).level, "notify");
  assert.equal(importance({ key: "r", kind: "room_changed", title: "ELCT 201 Lab is now in C3.01", detail: "", soon: false }).level, "notify");
  assert.equal(importance(ann("Lecture 4 slides are uploaded on the CMS for your reference.")).level, "digest");
  assert.equal(importance({ key: "m", kind: "new_material", title: "New in ELCT 201: Lecture 4", detail: "" }).level, "digest");
  assert.equal(importance(ann("Welcome to the course!")).level, "silent");
  assert.deepEqual(importance(ann("Please read chapter 3 carefully and think about how it relates to what we discussed.")), { level: "digest", why: "Unclear.", ambiguous: true });
  assert.equal(importance(ann("The midterm will be held in room C7.02."), [{ kind: "new_announcement", subjectId: "circ" }]).level, "silent");
});

test("timetable changes: moved, cancelled, new room; a cancelled class frees its slot for the next task", () => {
  const now = T(SUN, "08:00");
  const before = [slot("Sunday", "10:00", "11:30"), slot("Monday", "08:15", "09:45", "MATH 103", "Lecture"), slot("Tuesday", "11:45", "13:15", "PHYS 101", "Lab", "C2")];
  const after = [slot("Thursday", "13:45", "15:15"), slot("Tuesday", "11:45", "13:15", "PHYS 101", "Lab", "C9")];
  const ch = slotChanges(before, after, now, (code) => (code === "MATH 103" ? "math" : undefined));
  assert.deepEqual(ch.map((c) => [c.kind, c.title]).sort(), [["room_changed", "PHYS 101 Lab on Tuesday is now in C9"], ["slot_cancelled", "MATH 103 Lecture on Monday 08:15 is cancelled"], ["slot_moved", "ELCT 201 Lecture moved to Thursday 13:45"]]);
  const cancelled = ch.find((c) => c.kind === "slot_cancelled")!;
  assert.equal(cancelled.day, "2026-11-16"); assert.equal(cancelled.soon, true); assert.equal(cancelled.subjectId, "math");
  assert.deepEqual(slotChanges(after, after, now), [], "nothing changed, nothing said");
  const snap = snapshotOf({ spaces: [space("math", "Math")], plans: [{ spaceId: "math", rev: 1, tasks: [{ id: "t1", title: "Problem set 2", due: "2026-11-18" }] }] }, now);
  const f: Facts = { now, snap, slots: [], deadlines: [], events: ch };
  assert.deepEqual(freedSlots(f), [{ type: "time_block", spaceId: "math", title: "Free slot (MATH 103 Lecture on Monday 08:15 cancelled): Problem set 2", day: "2026-11-16", time: "08:15" }]);
});

test("watches: deterministic match, maybe for partial words, once unless repeating, until a date", () => {
  const spaces = [{ id: "circ", name: "Circuits", code: "ELCT 201" }, { id: "math", name: "Math" }], now = T(SUN, "09:00");
  const w = parseWatch("tell me when the Circuits midterm room is posted", spaces, now, "w1");
  assert.equal(w.subjectId, "circ");
  assert.deepEqual(w.words, ["midterm", "room"]);
  assert.ok(w.kinds.includes("new_announcement"));
  const ann = (detail: string, subjectId = "circ"): Change => ({ key: "a" + detail, kind: "new_announcement", title: "New announcement in ELCT 201", detail, subjectId });
  assert.equal(matchWatch(w, ann("The midterm will be in room C7.02"), now), "yes");
  assert.equal(matchWatch(w, ann("The midterm will be in room C7.02", "math"), now), "no");
  assert.equal(matchWatch(w, ann("Midterm date is set for December 3"), now), "maybe");
  assert.equal(matchWatch(w, { key: "g", kind: "new_grade", title: "Grade out", detail: "", subjectId: "circ" }, now), "no");
  const grades = parseWatch("watch for grades in Math", spaces, now, "w2");
  assert.deepEqual([grades.subjectId, grades.kinds, grades.words], ["math", ["new_grade"], []]);
  assert.equal(matchWatch(grades, { key: "g", kind: "new_grade", title: "Grade out: MATH 103", detail: "A-", subjectId: "math" }, now), "yes");
  const lab = parseWatch("ping me if lab 3 moves until Dec 1", spaces, now, "w3");
  assert.equal(lab.until, "2026-12-01");
  assert.ok(lab.kinds.includes("slot_moved") && lab.kinds.includes("deadline_changed"));
  assert.equal(matchWatch(lab, { key: "d", kind: "deadline_changed", title: "Deadline moved", detail: "Lab 3 report · 2026-11-20 → 2026-11-22" }, now), "yes");
  assert.equal(matchWatch(lab, { key: "d", kind: "deadline_changed", title: "Deadline moved", detail: "Lab 3 report" }, T("2026-12-02", "09:00")), "no", "expired");
  assert.equal(live(w, { fired: 1 }, now), false, "fires once");
  assert.equal(live({ ...w, repeat: true }, { fired: 3 }, now), true);
  assert.equal(parseWatch("tell me every time a grade is out", spaces, now).repeat, true);
});

test("a sweep with nothing changed decides nothing and asks no model", () => {
  const now = T(SUN, "13:00");
  const snap = snapshotOf({ spaces: [space("phys", "Physics")], plans: [] }, now);
  const facts: Facts = { now, snap, prev: snap, slots: [], deadlines: [], events: [] };
  const p = planSweep("event", facts, { done: new Set() });
  assert.equal(p.changed, false); assert.equal(p.ask, undefined); assert.deepEqual(p.actions, []);
  assert.equal(planSweep("midday", facts, { done: new Set(), lastDay: SUN }).changed, false, "a timed job that already ran today with no change");
  const morning0 = () => snapshotOf({ spaces: [space("phys", "Physics")], plans: [{ spaceId: "phys", rev: 1, tasks: [{ id: "t1", title: "Problem set", due: "2026-11-14" }] }] });
  const morning = planSweep("morning", { ...facts, now: T(SUN, "07:30"), snap: morning0() }, { done: new Set(), lastDay: "2026-11-14" });
  assert.deepEqual(morning.actions, [{ type: "plan_move", spaceId: "phys", taskId: "t1", title: "Problem set", due: SUN, time: "09:00" }], "a new day: the overdue task gets today and an hour, as one task, not a copy");
  assert.ok(morning.ask?.user.includes("Sweep: the morning plan, Sunday 2026-11-15 07:30.") && /In the brief[^\n]*\n- Moved “Problem set”/.test(morning.ask.user), "the brief is said in Clem's words: one short call");
  const silent = planSweep("morning", { ...facts, now: T(SUN, "07:30"), snap: morning0() }, { done: new Set(), lastDay: "2026-11-14", voice: false });
  assert.equal(silent.ask, undefined, "kept quiet (or no model): the rules needed no model");
});

test("the organizer's reply is checked: levels, watches, and only allowed actions", () => {
  const now = T(SUN, "13:00"), snap = snapshotOf({ spaces: [space("phys", "Physics")], files: [{ id: "f1", name: "notes.pdf", spaceId: null, created: 1 }] }, now);
  const amb: Change = { key: "ann:1", kind: "new_announcement", title: "New announcement", detail: "Please read chapter 3 carefully and think about how it relates to the lecture." };
  const plan = planSweep("event", { now, snap, prev: snap, slots: [], deadlines: [], events: [amb] }, { done: new Set() });
  assert.ok(plan.ask && plan.ask.user.includes("News:\n0. course post: Please read chapter 3 carefully"), "the whole post, not its event title");
  const read = readReply('{"levels":[{"i":0,"level":"notify","why":"Reading for the quiz","say":"Read chapter 3 before Thursday."}],"actions":[{"type":"file_move","fileId":"f1","name":"notes.pdf","spaceId":"phys"},{"type":"automation","name":"x","prompt":"xyz","schedule":"daily","time":"10:00"},{"type":"file_move","fileId":"nope","name":"n","spaceId":"phys"}]}', plan, snap, new Set());
  assert.equal(read.rated[0].level, "notify");
  assert.equal(read.rated[0].say, "Read chapter 3 before Thursday.", "Clem says it in its own words");
  assert.deepEqual(read.actions.map((a) => a.type), ["file_move"], "an offer or an unknown file from the model is dropped");
  assert.equal(readReply("not json", plan, snap, new Set()), plan);
  assert.equal(read.message, undefined, "an event sweep has no message over its news");
  assert.equal(readReply('{"message":"Something","levels":[{"i":0,"level":"notify","why":"x","say":"Read chapter 3 before Thursday\'s quiz 4."}]}', plan, snap, new Set()).rated[0].say, undefined, "a quiz number it was not given: dropped");
  const morning = planSweep("morning", { now: T(SUN, "07:30"), snap: snapshotOf({ spaces: [space("phys", "Physics")], plans: [{ spaceId: "phys", rev: 1, tasks: [{ id: "t1", title: "Problem set", due: "2026-11-14" }] }] }), slots: [], deadlines: [], events: [] }, { done: new Set(), lastDay: "2026-11-14" });
  const voiced = readReply('{"message":"Heads up: **Problem set** goes first today.\\n- Then a walk. ```clem-card {} ```","actions":[{"type":"note","kind":"followup","text":"You said you would read it."}]}', morning, snap, new Set());
  assert.equal(voiced.message, "Heads up: Problem set goes first today.\nThen a walk.", "its words are plain text: no fences, no markdown, a few short lines");
  assert.deepEqual(voiced.actions.filter((a) => a.type === "note"), [], "a follow-up is asked when its day comes (the rules), not the minute it was said");
});

test("human timing: follow-ups in the evening of the day named, never for a reminder asked for or loose talk", () => {
  const said = [{ id: "m1", text: "I'll finish the lab report tomorrow.", at: T(SUN, "20:00"), main: true as const }, { id: "m2", text: "remind me to email Dr. Amr tomorrow", at: T(SUN, "20:00"), main: true as const },
    { id: "m3", text: "I should understand how op-amps work", at: T("2026-11-10", "20:00"), main: true as const }, { id: "m4", text: "I need to submit the sheet tomorrow", at: T(SUN, "20:00"), main: true as const }];
  const at = (day: string, hm: string): Facts => ({ now: T(day, hm), snap: { ...snapshotOf({}), said }, slots: [], deadlines: [], events: [] });
  assert.deepEqual(followUps(at("2026-11-16", "07:30")), [], "not at breakfast on the day they said they'd do it");
  assert.deepEqual(followUps(at("2026-11-16", "21:00")).map((a) => (a as any).text), ["You said you'd finish the lab report. Done, or should I put it in your plan?", "You said you'd submit the sheet. Done, or should I put it in your plan?"]);
  assert.equal(followUps(at("2026-11-17", "07:30")).length, 2, "or the morning after");
});

test("human tone: a grade is met as the mark deserves", () => {
  const g = (detail: string): Facts => ({ now: T(SUN, "13:00"), snap: snapshotOf({}), slots: [], deadlines: [], events: [{ key: "grade:1", kind: "new_grade", title: "Grade out: MATH 103", detail }] });
  const text = (detail: string) => (gradeNotes(g(detail))[0] as any).text;
  assert.equal(text("Quiz 1 · 18/20 (Winter 2026)"), "Your MATH 103 grade is out (18/20 (Winter 2026)). Nice work.");
  assert.equal(text("Quiz 1 · 3/10 (Winter 2026)"), "Your MATH 103 grade is out (3/10 (Winter 2026)). A rough one. Want to go over what went wrong?");
  assert.equal(text("Quiz 1 · 13/20 (Winter 2026)"), "Your MATH 103 grade is out (13/20 (Winter 2026)).");
  assert.equal(text("Final · B+ (Winter 2026)"), "Your MATH 103 grade is out (B+ (Winter 2026)).", "a letter is not guessed at");
});

test("a task that keeps slipping is asked about once, then left alone", () => {
  const now = T(SUN, "07:30"), snap = snapshotOf({ spaces: [space("phys", "Physics")], plans: [{ spaceId: "phys", rev: 3, tasks: [{ id: "t1", title: "Problem set", due: "2026-11-14" }, { id: "b1", title: "Review 5 flashcards", due: "2026-11-14", time: "09:00", group: "Today" }] }] });
  const facts: Facts = { now, snap, prev: snap, slots: [], deadlines: [], events: [] };
  const done = new Set(["move:phys:t1:2026-11-13", "move:phys:t1:2026-11-14"]);
  const p = planSweep("morning", facts, { done, lastDay: "2026-11-14", voice: false });
  assert.deepEqual(p.actions, [{ type: "note", kind: "followup", spaceId: "phys", key: "slip:phys:t1:2026-11-14", text: "I've moved “Problem set” twice and it's still open. Still worth doing? I can find it a real slot, break it down, or drop it." }], "asked, not rolled a third time; yesterday's block of Clem's own is not rolled on either");
  done.add("slip:phys:t1:2026-11-14");
  assert.deepEqual(planSweep("morning", facts, { done, lastDay: "2026-11-14", voice: false }).actions, [], "once");
});

test("the brief: exams are said, a late brief skips classes already over, a timed move reads as a block", () => {
  const snap = snapshotOf({ spaces: [space("phys", "Physics", "subject", { examDate: SUN }), space("math", "Math", "subject", { examDate: "2026-11-16" })], plans: [] });
  const slots = [{ day: SUN, start: "08:15", end: "09:45", title: "PHYS 101 Lecture" }, { day: SUN, start: "13:45", end: "15:15", title: "MATH 103 Lab" }];
  const brief = (kind: "morning" | "evening", hm: string) => planSweep(kind, { now: T(SUN, hm), snap, prev: snap, slots, deadlines: [], events: [] }, { done: new Set(), voice: false }).brief.map((b) => b.text);
  assert.deepEqual(brief("morning", "11:00"), ["Physics exam today. Good luck.", "MATH 103 Lab"]);
  assert.equal(brief("evening", "21:00")[0], "Math exam tomorrow. A light review tonight, then sleep.");
  const move = { type: "plan_move" as const, spaceId: "phys", taskId: "t1", title: "Problem set", due: SUN, time: "09:00" };
  assert.equal(briefText("morning", T(SUN, "07:30"), [], [move], () => "Physics"), "09:00 Problem set", "one line is said as it is");
  assert.equal(briefText("morning", T(SUN, "07:30"), [{ time: "08:15", text: "PHYS 101 Lecture" }, { text: "Physics exam today. Good luck." }], [move, { type: "file_move", fileId: "f", name: "notes.pdf", spaceId: "phys" }], () => "Physics"),
    "Your Sunday:\nPhysics exam today. Good luck.\n08:15 PHYS 101 Lecture\n09:00 Problem set\nI filed notes.pdf in Physics.", "a lead, the day's times one per line, then what else Clem did");
});

test("the main thread's AI reads what Clem told them: plain messages as they are, an older card as what it said", () => {
  assert.equal(turnText("Math 301 Quiz 2 is tomorrow at 3:45 pm in D1.003."), "Math 301 Quiz 2 is tomorrow at 3:45 pm in D1.003.");
  const t = turnText('Quiz 2 moved, so I shifted your revision.\n\n```clem-card\n{"type":"organizer","title":"Since you last looked","when":"event","lines":[{"text":"Quiz 2 is now on Sunday","key":"change:a","space":"Math"},{"text":"Revise chapter 4","time":"16:00"}]}\n```');
  assert.equal(t, 'Quiz 2 moved, so I shifted your revision.\n\n[You told them (Since you last looked):\n- Quiz 2 is now on Sunday (Math)\n- 16:00 Revise chapter 4]');
  assert.equal(turnText('```clem-card\n{"type":"reminder","title":"Email Dr. Amr","at":"2026-11-16T07:00Z","id":"r1","rang":true}\n```'), "[Reminder you sent them: Email Dr. Amr · 2026-11-16T07:00Z]");
});

test("organizer and lecture cards parse; lecture cards never generate anything", () => {
  assert.equal(readCard('{"type":"organizer","title":"Your Sunday, planned","when":"morning","lines":[{"text":"09:00 Review","key":"block:a","time":"09:00"}]}')?.type, "organizer");
  assert.equal(readCard('{"type":"lecture","subjectId":"phys","files":[{"id":"m1","name":"Lecture 5.pdf","saved":true}]}')?.type, "lecture");
  assert.equal(readCard('{"type":"watch","id":"w1","text":"midterm room"}')?.type, "watch");
  assert.equal(readCard('{"type":"organizer","title":"x","lines":[{"text":"a","href":"https://evil.example"}]}'), null, "links stay inside Clem");
});

// ---------- In the engine ----------
type Ws = { spaces: any[]; plans: any[]; chats: any[]; files: any[]; studySets: any[]; automations: any[]; organizer?: any };
async function engineWith(ws: Ws, clock: { t: number }, reply: (r: { system: string; user: string }) => string = () => '{"levels":[],"actions":[]}') {
  const h = Object.assign(fakeHost(), { calls: [] as { system: string; user: string }[], opened: [] as unknown[] });
  h.workspace = async () => ws;
  h.complete = async (r) => { h.calls.push(r); return reply(r); };
  h.notify = (n) => { h.notices.push(n.body); h.opened.push(n.open); };
  const engine = await Engine.open("pro-owner", h, { memory: true, jobs: false, clock: () => clock.t });
  return { engine, h, o: engine.organizer };
}
const event = (engine: Engine, key: string, kind: string, title: string, detail: string, course: string | null = null) =>
  engine.db.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail, created_at) values ($1, $2, $3, $4, $5, $6, now() + interval '1 second' * (select count(*) from guc_events))", ["pro-owner", key, kind, course, title, detail]);
const empty = (): Ws => ({ spaces: [space("phys", "Physics")], plans: [], chats: [{ id: "main", kind: "main", messages: [] }], files: [], studySets: [], automations: [] });

test("engine: no change, no model call; new words in the main thread ask once", async () => {
  const clock = { t: T(SUN, "13:00") }, ws = empty();
  const { engine, h, o } = await engineWith(ws, clock);
  try {
    assert.deepEqual(await o.sweep("event"), { changed: false, called: false, actions: 0, posted: false }, "the first sweep is a baseline");
    assert.equal((await o.sweep("event")).called, false);
    ws.chats[0].messages.push({ id: "u1", role: "user", content: "I'm a night owl, I study best after 10pm.", at: clock.t });
    const r = await o.sweep("event");
    assert.equal(r.called, true); assert.equal(h.calls.length, 1);
    assert.ok(h.calls[0].user.includes("> I'm a night owl"));
    assert.equal((await o.sweep("event")).called, false, "seen once, not asked again");
    assert.equal(h.calls.length, 1);
    const [run] = await engine.db.query<{ n: number }>("select count(*)::int as n from organizer_runs where model");
    assert.equal(run.n, 1);
  } finally { await engine.close(); }
});

test("engine: Clem judges all the news in one call and says each thing in its own message; urgent first, deduped; no cards", async () => {
  const clock = { t: T(SUN, "13:00") };
  const { engine, h, o } = await engineWith(empty(), clock, () => '{"levels":[{"i":0,"level":"notify","why":"Reading for the quiz","say":"Read chapter 3 before Thursday."},{"i":1,"level":"silent","why":"Nothing to do"},{"i":3,"level":"digest","why":"Routine"}]}');
  try {
    await o.sweep("event");
    await event(engine, "ann:1", "new_announcement", "New announcement in PHYS 101", "Please read chapter 3 carefully and think about how it relates to the lecture.");
    await event(engine, "ann:2", "new_announcement", "New announcement in PHYS 101", "Some thoughts about the history of physics and the people who shaped the field.");
    await event(engine, "ann:3", "new_announcement", "New announcement in PHYS 101", "Today's lecture is cancelled; a compensation lecture will follow.");
    await event(engine, "mat:m1", "new_material", "New in PHYS 101: Lecture 5", "slides · Week 5");
    const r = await o.sweep("event");
    assert.equal(h.calls.length, 1, "one call for the whole batch");
    assert.ok(/News:\n0\. .*chapter 3[\s\S]*\n1\. .*history[\s\S]*\n2\. .*cancelled[\s\S]*\n3\. .*Lecture 5/.test(h.calls[0].user), "every piece of news is judged, not only the unclear ones");
    assert.ok(r.posted);
    const { posts } = await o.inbox();
    assert.deepEqual(posts.map((p) => p.content), ["PHYS 101: Today's lecture is cancelled; a compensation lecture will follow.", "Read chapter 3 before Thursday. Also up: Lecture 5 in PHYS 101."],
      "the urgent one first (the rules' words: the model gave none), then the one the model raised in its words; the new file is one closing sentence");
    assert.ok(posts.every((p) => !p.content.includes("```")), "no card, no button");
    assert.deepEqual(h.notices, posts.map((p) => p.content), "one notification per message, the message as its body");
    assert.deepEqual(h.opened, posts.map((p) => ({ chat: "main", message: p.id })), "each opens its own message");
    assert.equal((await o.sweep("event")).called, false);
    assert.equal(await o.push("change:ann:3", "x", "y", {}), "sent-before", "never twice on a channel");
  } finally { await engine.close(); }
});

test("engine: a watch fires once, through its own line and a push", async () => {
  const clock = { t: T(SUN, "13:00") };
  const { engine, h, o } = await engineWith(empty(), clock);
  try {
    await o.sweep("event");
    const w = await o.tool({ action: "clem.watch", text: "tell me when the midterm room is posted" }) as { ok: boolean; id: string; watching: string; tells: string };
    assert.deepEqual([w.ok, w.watching, w.tells], [true, "tell me when the midterm room is posted", "once"], "facts for the AI to confirm in a sentence");
    assert.match((await o.tool({ action: "clem.watches" }) as { text: string }).text, /midterm room/);
    await event(engine, "ann:9", "new_announcement", "New announcement in PHYS 101", "The midterm room is C7.02.");
    await o.sweep("event");
    const { posts } = await o.inbox();
    assert.deepEqual(posts.map((p) => p.content), ["PHYS 101: The midterm room is C7.02."], "what they asked to hear, plainly");
    assert.equal(h.notices.length, 1);
    await event(engine, "ann:10", "new_announcement", "New announcement in PHYS 101", "Midterm room for group 2 is C7.03.");
    await o.sweep("event");
    assert.equal((await o.inbox()).posts.length, 1, "once");
    assert.equal((await o.watches()).find((x) => x.id === w.id)?.live, false);
    const w2 = await o.tool({ action: "clem.watch", text: "watch for grades in Physics", repeat: true }) as { id: string };
    assert.deepEqual(await o.tool({ action: "clem.unwatch", id: w2.id }), { ok: true, stopped: "watch for grades in Physics" }, "stopped by text");
    assert.equal((await o.tool({ action: "clem.watches" }) as { text: string }).text, "Not watching for anything.");
  } finally { await engine.close(); }
});

test("engine: quiet hours hold a push until they end; sent once on any channel", async () => {
  const clock = { t: T(SUN, "01:00") };
  const { engine, h, o } = await engineWith(empty(), clock);
  try {
    assert.equal(await o.push("k1", "Lab moved", "Thursday 13:45", {}), "deferred");
    assert.equal(h.notices.length, 0);
    assert.equal(await o.flush(), 0, "still quiet");
    clock.t = T(SUN, "07:40");
    assert.equal(await o.flush(), 1);
    assert.equal(await o.flush(), 0);
    assert.equal(await o.push("k1", "Lab moved", "Thursday 13:45", {}), "sent-before");
    assert.deepEqual(h.notices, ["Thursday 13:45"]);
  } finally { await engine.close(); }
});

test("engine: the morning brief writes blocks the window applies, logs them, and Undo works once", async () => {
  const clock = { t: T(SUN, "07:30") }, ws = empty();
  ws.spaces[0].examDate = "2026-11-22";
  ws.plans.push({ id: "p1", spaceId: "phys", title: "Physics plan", start: "2026-11-01", created: 1, updated: 1, rev: 1, tasks: [{ id: "t1", title: "Problem set 2", due: "2026-11-13" }, { id: "t9", title: "Session", due: "2026-11-21", group: "Before the exam" }] });
  const { engine, h, o } = await engineWith(ws, clock, () => '{"message":"Problem set 2 slipped past Friday, so it\'s first at 9. Exam in a week: I added an hour for it.","levels":[]}');
  try {
    const r = await o.sweep("morning");
    assert.ok(r.changed && r.posted && r.called, "one short call for Clem's own words");
    const box = await o.inbox();
    assert.deepEqual(box.apply.map((a) => a.action), [{ type: "plan_move", spaceId: "phys", taskId: "t1", title: "Problem set 2", due: SUN, time: "09:00" }, { type: "time_block", spaceId: "phys", title: "Revise for the Physics exam", day: SUN, time: "10:00" }]);
    assert.deepEqual(box.posts.map((p) => p.content), ["Problem set 2 slipped past Friday, so it's first at 9. Exam in a week: I added an hour for it."], "the brief is one plain message, in its words");
    assert.deepEqual(h.notices, ["Problem set 2 slipped past Friday, so it's first at 9. Exam in a week: I added an hour for it."], "the push says what Clem said");
    const w = { spaces: ws.spaces, plans: ws.plans, files: [], memory: "", automations: [] };
    let state: any = w;
    const results = box.apply.map((a) => { const x = applyAction(state, a.action, { now: clock.t }) as any; state = x.state; return { key: a.key, ok: true, undo: x.undo }; });
    await o.ack({ posts: [box.posts[0].id], results });
    assert.deepEqual(await o.inbox(), { posts: [], apply: [], revert: [] });
    const log = await o.log();
    assert.equal(log.filter((l) => l.status === "applied" && l.undo).length, 2, JSON.stringify(log));
    assert.deepEqual([state.plans[0].tasks[0].due, state.plans[0].tasks[0].time, state.plans[0].tasks.length], [SUN, "09:00", 3], "the task itself got its hour");
    // "Undo that, keep problem set 2 where it was": said in words, put back through the same path as applying it.
    assert.deepEqual(await o.tool({ action: "clem.undo", what: "problem set 2" }), { ok: true, undone: "Moved “Problem set 2” to Sun, Nov 15 09:00 · Physics" });
    const back = await o.inbox();
    assert.deepEqual(back.revert.map((r) => r.key), [results[0].key]);
    state = back.revert.reduce((w: any, r) => undoAction(w, r.undo), state);
    await o.ack({ reverted: back.revert.map((r) => r.key) });
    assert.equal(state.plans[0].tasks[0].due, "2026-11-13", "back where it was");
    assert.equal((await o.log()).find((l) => l.key === results[0].key)?.status, "undone");
    assert.deepEqual((await o.inbox()).revert, [], "once");
    assert.match(String((await o.tool({ action: "clem.undo", what: "problem set" }) as { error?: string }).error), /Nothing Clem did lately matches/);
    // Settings → Proactivity's log keeps its own Undo.
    assert.ok(await o.undo(results[1].key));
    assert.equal(await o.undo(results[1].key), null, "once");
    assert.match(String((await o.tool({ action: "clem.undo" }) as { error?: string }).error), /hasn't changed anything/);
    assert.equal((await o.sweep("morning")).posted, false, "the same morning twice says nothing new");
  } finally { await engine.close(); }
});

test("engine: deadline reminders are a sentence each, once at 48h and 3h, with a push that opens the message", async () => {
  const clock = { t: T(SUN, "13:00") }, ws = empty();
  ws.plans.push({ id: "p1", spaceId: "phys", title: "Physics plan", start: "2026-11-01", created: 1, updated: 1, rev: 1, tasks: [{ id: "t1", title: "Physics quiz", due: "2026-11-16", time: "10:00", kind: "milestone" }] });
  const { engine, h, o } = await engineWith(ws, clock);
  try {
    await o.tick();
    await o.tick();
    let posts = (await o.inbox()).posts;
    assert.deepEqual(posts.map((p) => p.content), ["Physics quiz is tomorrow at 10:00 am."], "a quiz is on a day, not due in hours");
    clock.t = T("2026-11-16", "07:30");
    await o.tick();
    posts = (await o.inbox()).posts;
    assert.deepEqual(posts.map((p) => p.content).slice(1), ["Physics quiz is in 3 hours, at 10:00 am."]);
    assert.deepEqual(h.notices, posts.map((p) => p.content));
    assert.deepEqual(h.opened, posts.map((p) => ({ chat: "main", message: p.id })));
  } finally { await engine.close(); }
});

test("engine: the timed jobs' schedules follow settings and survive a restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clem-pro-"));
  const open = () => Engine.open("pro-owner", { ...fakeHost(), paths: { data: dir, migrations } }, { jobs: true });
  try {
    let engine = await open();
    await engine.organizer.setSettings({ jobs: { morning: { time: "08:15" }, midday: { on: false } } });
    await engine.close();
    engine = await open();
    const jobs = (engine as any).jobs;
    const rows = (await jobs.schedules("organizer.sweep")).map((s: any) => [s.key, s.cron, s.timezone]).sort();
    assert.deepEqual(rows, [["evening", "0 21 * * *", "Africa/Cairo"], ["morning", "15 8 * * *", "Africa/Cairo"], ["weekly", "0 18 * * 5", "Africa/Cairo"]]);
    assert.equal((await engine.organizer.settings()).jobs.morning.time, "08:15");
    assert.equal((await jobs.schedules("organizer.tick")).length, 1);
    await engine.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("engine: news is never lost to the level: balanced says it at midday, quiet keeps it for the next card", async () => {
  const clock = { t: T(SUN, "13:30") };
  const { engine, h, o } = await engineWith(empty(), clock, (r) => '{"levels":[{"i":0,"level":"notify","why":"Reading"' + (r.user.includes("chapter 3") ? ',"say":"Read chapter 3 before Thursday."' : "") + '}]}');
  try {
    await o.sweep("event");
    await o.setSettings({ level: "balanced" });
    await event(engine, "ann:1", "new_announcement", "New announcement in PHYS 101", "Please read chapter 3 carefully and think about how it relates to the lecture.");
    assert.equal((await o.sweep("midday")).posted, true, "found by the midday check, still told");
    assert.equal((await o.inbox()).posts[0].content, "Read chapter 3 before Thursday.");
    await o.setSettings({ level: "quiet" });
    await event(engine, "ann:2", "new_announcement", "New announcement in PHYS 101", "Please read chapter 4 carefully and think about how it relates to the lecture.");
    assert.equal((await o.sweep("event")).posted, false, "quiet: not worth a message of its own");
    assert.equal((await o.log()).find((l) => l.key === "change:ann:2")?.status, "held");
    assert.equal(h.notices.length, 1);
    await engine.db.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail, created_at) values ($1, 'dl:x', 'deadline_added', null, 'Deadline in PHYS 101', $2, now() + interval '1 hour')", ["pro-owner", "Sheet 5 · " + new Date(T(SUN, "23:00")).toISOString()]);
    assert.equal((await o.sweep("event")).posted, true, "something urgent");
    assert.deepEqual((await o.inbox()).posts.slice(1).map((p) => p.content), ["Deadline in PHYS 101.", "PHYS 101: Please read chapter 4 carefully and think about how it relates to the lecture."], "what was kept back rides along, as its own message");
    assert.equal(h.notices.length, 3, "whatever is written in the thread is notified, what rode along too");
    assert.equal((await o.log()).find((l) => l.key === "change:ann:2")?.status, "said");
  } finally { await engine.close(); }
});

test("engine: the first sweep is a baseline even when GUC already holds events; opened at night, the evening prep runs, not the morning plan", async () => {
  const clock = { t: T(SUN, "22:10") };
  const { engine, h, o } = await engineWith(empty(), clock);
  try {
    await event(engine, "ann:old", "new_announcement", "New announcement in PHYS 101", "Today's lecture is cancelled; a compensation lecture will follow.");
    assert.deepEqual(await o.catchUp(), ["evening"]);
    assert.deepEqual(h.notices, ["No classes tomorrow (Monday)."], "the evening prep reaches out; old news is not news");
    assert.doesNotMatch((await o.inbox()).posts.map((p) => p.content).join(), /cancelled|planned/);
    assert.deepEqual(await o.catchUp(), [], "once");
  } finally { await engine.close(); }
});

test("engine: a deadline just told as news is not repeated by the 48-hour reminder; the 3-hour one still comes", async () => {
  const clock = { t: T(SUN, "13:00") };
  const { engine, h, o } = await engineWith(empty(), clock);
  try {
    await o.sweep("event");
    const due = new Date(T("2026-11-16", "10:00")).toISOString();
    await engine.db.query("insert into guc_deadlines (owner_id, deadline_id, course_key, title, due, source) values ($1, 'd1', 'c1', 'Sheet 5', $2, 'announcement')", ["pro-owner", due]);
    await event(engine, "dl:d1", "deadline_added", "Deadline in PHYS 101", "Sheet 5 · " + due);
    await o.sweep("event");
    const told = h.notices.length;
    await o.tick();
    assert.equal(h.notices.length, told, "no second buzz for the same thing");
  } finally { await engine.close(); }
});

// ---------- Plain messages, one per thing (docs/MAIN-THREAD.md "Proactivity" → "Plain messages") ----------
// The owner's real items (2026-11-14): two MATH 301 posts and a CSEN 301 mail, that once became one card.
const IN_CLASS = "The Fourth in-class assignment is scheduled to take place during the first tutorial of the week starting Saturday 14th of November, 2026. This will cover Stoke's Theorem and Diveregence Theorem.";
const QUIZ_POST = "Quiz 2 will be held on Monday November 16th and Tuesday November 17th. It will cover chapter 16.1,16.2 and 16.3 in Stewart Calc. and corresponding Lectures 10-12 and worksheets 5-6\nMonday 16.11 · 3:45 P.M. · T29 - T30 · D1.003\nTuesday 17.11 · 3:45 P.M. · T31 - T32 · D1.003";
const QUIZ_MAIL_TITLE = "Email from GUC Notification System (DO NOT REPLY): [EXTERNAL EMAIL] - Notification System: CSEN301 Quiz 2 [Group: Winter 2026  - CSEN 301 - 3MIET2 (Lecture)]";
const QUIZ_MAIL = "Dears. Please note that quiz 2 will be conducted for group 2 on Tuesday 24th of November, starting 3:45 pm. Content covered will be SLL (lecture 7 , PA7). No entrance to the quiz location will be allowed after 10 min of ...";
const RAW = /```|clem-card|New announcement in|Email from|EXTERNAL EMAIL|Notification System|DO NOT REPLY|\[Group:|Also new: \d/;

test("plain words: the owner's real strings read as Clem would retell them, never as raw titles", () => {
  const x = { now: T("2026-11-14", "13:00"), name: (id?: string) => ({ math: "Math 301", ds: "Data Structures" } as Record<string, string>)[id || ""] };
  assert.equal(plainText({ key: "mail:1", kind: "new_mail", title: QUIZ_MAIL_TITLE, detail: QUIZ_MAIL, subjectId: "ds" }, x),
    "CSEN 301, Quiz 2: Please note that quiz 2 will be conducted for group 2 on Tuesday 24th of November, starting 3:45 pm. Content covered will be SLL (lecture 7 , PA7).", "course and subject first, no boilerplate, cut at a sentence end");
  assert.equal(plainText({ key: "ann:1", kind: "new_announcement", title: "New announcement in MATH 301", detail: IN_CLASS, subjectId: "math" }, x), "MATH 301: " + IN_CLASS);
  assert.equal(plainText({ key: "ann:2", kind: "new_announcement", title: "New announcement in MATH 301", detail: QUIZ_POST, subjectId: "math" }, x),
    "MATH 301: Quiz 2 will be held on Monday November 16th and Tuesday November 17th. It will cover chapter 16.1,16.2 and 16.3 in Stewart Calc. and corresponding Lectures 10-12 and worksheets 5-6.", "the post's prose; its table is the model's to read");
  assert.equal(plainText({ key: "mail:2", kind: "new_mail", title: "Email from Dr. Amr Talaat: Re: Lab 3 makeup", detail: "Hi all, the makeup lab is on Sunday at 8:30 in C7.02." }, x), "Lab 3 makeup (from Dr. Amr Talaat): the makeup lab is on Sunday at 8:30 in C7.02.", "a person who wrote is named");
  assert.equal(plainText({ key: "grade:1", kind: "new_grade", title: "Midterm grade out: CSEN 701", detail: "Embedded Systems · 17/20" }, x), "Your CSEN 701 midterm grade is out (17/20).");
  assert.equal(plainText({ key: "exam:1", kind: "exam_posted", title: "Exam seat posted: MATH 301", detail: "Final · Sat 2027-01-09 09:00–12:00 · H12 · seat 44" }, x), "Your MATH 301 exam seat is out: Final · Sat 2027-01-09 09:00–12:00 · H12 · seat 44.");
  assert.equal(plainText({ key: "slot:1", kind: "slot_moved", title: "MATH 301 Tutorial moved to Monday 10:00", detail: "Saturday 08:15 → Monday 10:00 · C7.203" }, x), "MATH 301 Tutorial moved to Monday 10:00 in C7.203.");
  assert.equal(alsoLine([{ key: "m1", kind: "new_material", title: "New in PHYS 301: Chapter 18 slides", detail: "slides", subjectId: "phys" }, { key: "m2", kind: "new_material", title: "New in MATH 301: Tutorial 9 video", detail: "", subjectId: "math" }, { key: "m3", kind: "new_material", title: "New in MATH 301: Tutorial 10 video", detail: "", subjectId: "math" }], { ...x, name: (id?: string) => ({ math: "Math 301", phys: "Physics III" } as Record<string, string>)[id || ""] }),
    "Also up: Chapter 18 slides in Physics III and Tutorial 9 video and Tutorial 10 video in Math 301.", "new files named, in passing");
  assert.equal(reminderText("call the TA about the lab"), "Reminder: call the TA about the lab.");
  assert.equal(reminderText("remind me to email Dr. Amr!"), "Reminder: email Dr. Amr!");
});

test("plain words: a reminder knows a quiz from an assignment, and says where when GUC said it", () => {
  const now = T("2026-11-15", "13:00"), at = (day: string, hm: string) => new Date(T(day, hm)).toISOString();
  const quiz = { id: "q2", title: "Quiz 2", due: at("2026-11-16", "15:45"), code: "MATH301", kind: "quiz", place: "D1.003" };
  assert.equal(deadlineText(quiz, now), "MATH 301 Quiz 2 is tomorrow at 3:45 pm in D1.003.");
  assert.equal(deadlineText(quiz, T("2026-11-16", "13:00"), undefined, { left: T("2026-11-16", "15:45") - T("2026-11-16", "13:00") }), "MATH 301 Quiz 2 is in 3 hours, at 3:45 pm in D1.003.");
  const a2 = { id: "a2", title: "Assignment 2", due: at("2026-11-18", "23:59"), spaceId: "ds", kind: "assignment", place: "online" };
  assert.equal(deadlineText(a2, now, () => "Data Structures"), "Data Structures Assignment 2 is due on Wednesday at 11:59 pm.", "an assignment is due; a place is for something sat");
  assert.equal(deadlineText({ id: "s", title: "Sheet 5", due: "2026-11-15" }, now), "Sheet 5 is due today.", "a bare day has no time");
  assert.equal(deadlineText({ id: "m", title: "CSEN 301 Midterm", due: at("2026-11-30", "09:00"), code: "CSEN 301" }, now), "CSEN 301 Midterm is on Mon, Nov 30 at 9:00 am.", "no kind: read from the title; the course is not said twice");
});

const ch = (key: string, kind: Change["kind"], title: string, detail: string, o: Partial<Change> = {}): Change => ({ key, kind, title, detail, ...o });
const rc = (change: Change, level: RatedChange["level"] = "notify", say?: string): RatedChange => ({ change, level, why: "", ...(say ? { say } : {}) });
const X = { now: T(SUN, "13:00"), name: (id?: string) => ({ math: "Math 301", ds: "Data Structures" } as Record<string, string>)[id || ""] };

test("one message per thing, at most four from a sweep: the least urgent are said together in the last", () => {
  const told = ["a", "b", "c", "d", "e", "f"].map((k, i) => rc(ch("ann:" + k, "new_announcement", "New announcement in MATH 301", `Post ${k} says something that matters a great deal.`), i === 5 ? "urgent" : "notify", `Message ${k}.`));
  const msgs = sweepMessages("event", { told, asked: new Set(), also: [], brief: [], actions: [] }, X);
  assert.equal(msgs.length, MAX_MESSAGES);
  assert.deepEqual(msgs.map((m) => m.text), ["Message f.", "Message a.", "Message b.", "Message c.\nMessage d.\nMessage e."], "urgent first; the rest combined last");
  assert.deepEqual(msgs.at(-1)!.tells, ["ann:c", "ann:d", "ann:e"]);
  const one = sweepMessages("event", { told: told.slice(0, 1), asked: new Set(), also: [ch("mat:1", "new_material", "New in MATH 301: Lecture 12", "", { subjectId: "math" })], brief: [], actions: [{ type: "file_move", fileId: "f", name: "notes.pdf", spaceId: "ds" }] }, X);
  assert.deepEqual(one.map((m) => m.text), ["Message a.", "I filed notes.pdf in Data Structures. Also up: Lecture 12 in Math 301."], "what Clem did alone is one short message; new files close the last one");
  assert.deepEqual(sweepMessages("event", { told: [], asked: new Set(), also: [ch("mat:1", "new_material", "New in MATH 301: Lecture 12", "", { subjectId: "math" })], brief: [], actions: [] }, X), [], "new files alone: silent");
});

test("a deadline and the post it was read from are one message, with what Clem did about it; a mail the model marks the same is not told twice", () => {
  const post = ch("ann:2", "new_announcement", "New announcement in MATH 301", QUIZ_POST, { subjectId: "math" });
  const dl = ch("dl:q2", "deadline_added", "MATH 301 Quiz 2: due Mon 16 Nov 15:45", "Mathematics III. “Quiz 2 will be held on Monday November 16th and Tuesday November 17th.”", { subjectId: "math" });
  const deadlines = [{ id: "q2", title: "Quiz 2", due: new Date(T("2026-11-16", "15:45")).toISOString(), code: "MATH 301", spaceId: "math", kind: "quiz", place: "D1.003" }];
  const mail = ch("mail:9", "new_mail", QUIZ_MAIL_TITLE.replace("CSEN301", "MATH301"), "Quiz 2 is on Monday and Tuesday.", { subjectId: "math" });
  const msgs = sweepMessages("event", { told: [rc(post, "notify", "Math 301 Quiz 2 is Monday and Tuesday (16 and 17 Nov) on Stewart 16.1 to 16.3."), rc(dl), { ...rc(mail), same: "ann:2" }], asked: new Set(), also: [], brief: [],
    actions: [{ type: "plan_task", spaceId: "math", title: "Start: Quiz 2", due: "2026-11-14" }, { type: "plan_task", spaceId: "math", title: "Quiz 2", due: "2026-11-16", milestone: true }] }, { ...X, deadlines });
  assert.deepEqual(msgs.map((m) => [m.text, m.tells]), [["Math 301 Quiz 2 is Monday and Tuesday (16 and 17 Nov) on Stewart 16.1 to 16.3. I added “Start: Quiz 2” to your Math 301 plan for Sat, Nov 14.", ["ann:2", "dl:q2", "mail:9"]]]);
  // Alone, the deadline says itself: a quiz is on a day, in its room.
  assert.deepEqual(sweepMessages("event", { told: [rc(dl)], asked: new Set(), also: [], brief: [], actions: [] }, { ...X, deadlines }).map((m) => m.text), ["MATH 301 Quiz 2 is tomorrow at 3:45 pm in D1.003."]);
});

test("the organizer reads the whole post and the person's own classes, so it can tell them their row", () => {
  const now = T("2026-11-14", "13:00"), snap = snapshotOf({ spaces: [space("math", "Math 301"), space("ds", "Data Structures")] }, now);
  const events = [ch("ann:1", "new_announcement", "New announcement in MATH 301", IN_CLASS, { subjectId: "math" }), ch("ann:2", "new_announcement", "New announcement in MATH 301", QUIZ_POST, { subjectId: "math" }),
    ch("mail:1", "new_mail", QUIZ_MAIL_TITLE, QUIZ_MAIL, { subjectId: "ds" }), ...[1, 2, 3, 4, 5, 6].map((n) => ch("mat:" + n, "new_material", `New in MATH 301: Tutorial ${n} video`, "video", { subjectId: "math" }))];
  const classes = [{ code: "MATH 301", type: "Tutorial", group: "T29", day: "Monday", start: "15:45", end: "17:15", location: "C7.301" }, { code: "CSEN 301", type: "Lecture", group: "L2", day: "Tuesday", start: "11:45", end: "13:15", location: "H12" }];
  const plan = planSweep("event", { now, snap, prev: snap, slots: [], deadlines: [], events, classes }, { done: new Set() });
  const user = plan.ask!.user;
  assert.ok(user.includes("News:\n0. course post · Math 301: " + IN_CLASS), "the whole post, with the course as they say it");
  assert.ok(user.includes("1. course post · Math 301: Quiz 2 will be held on Monday November 16th and Tuesday November 17th. It will cover chapter 16.1,16.2 and 16.3 in Stewart Calc. and corresponding Lectures 10-12 and worksheets 5-6 / Monday 16.11 · 3:45 P.M. · T29 - T30 · D1.003 / Tuesday"), "the table too, rows as ' / '");
  assert.ok(user.includes('2. email · Data Structures (CSEN 301) · subject "Quiz 2": Dears. Please note'), "a mail by its course and subject, not its system sender");
  assert.ok(user.includes("Their classes:\n- MATH 301: Tutorial T29 (tutorial group T29) Monday 15:45–17:15 in C7.301\n- CSEN 301: Lecture L2 (lecture group 2) Tuesday 11:45–13:15 in H12"));
  assert.doesNotMatch(user, /Email from|EXTERNAL EMAIL|New announcement in/);
  assert.ok(ORGANIZER_GUIDE.includes("tell them their own row") && ORGANIZER_GUIDE.includes('"same"'));
});

const REAL_WS = (): Ws => ({ spaces: [space("math", "Math 301"), space("ds", "Data Structures"), space("phys", "Physics III")], plans: [], chats: [{ id: "main", kind: "main", messages: [] }], files: [], studySets: [], automations: [] });
async function realSweep(reply: (r: { system: string; user: string }) => string) {
  const clock = { t: T("2026-11-14", "13:00") };
  const t = await engineWith(REAL_WS(), clock, reply);
  await t.o.setSettings({ level: "balanced" });
  await t.o.sweep("event");
  for (const [s, c] of [["math", "45:70"], ["ds", "351:70"], ["phys", "20:70"]]) await t.engine.db.query("insert into subject_links (owner_id, subject_id, course_key) values ('pro-owner', $1, $2)", [s, c]);
  await event(t.engine, "ann:1", "new_announcement", "New announcement in MATH 301", IN_CLASS, "45:70");
  await event(t.engine, "ann:2", "new_announcement", "New announcement in MATH 301", QUIZ_POST, "45:70");
  await event(t.engine, "mail:1", "new_mail", QUIZ_MAIL_TITLE, QUIZ_MAIL, "351:70");
  for (const [n, c] of [["Chapter 18 slides", "20:70"], ["Tutorial 9 video", "45:70"], ["Tutorial 10 video", "45:70"], ["Lecture 12 slides", "45:70"], ["Lecture 12 recording", "45:70"], ["Sheet 6", "45:70"]]) await event(t.engine, "mat:" + n, "new_material", `New in ${c === "20:70" ? "PHYS 301" : "MATH 301"}: ${n}`, "slides", c);
  await t.o.sweep("event");
  return { ...t, clock };
}

test("engine: the owner's three real items are three plain messages, with no card and no raw title, even without the model's words", async () => {
  const { engine, h, o } = await realSweep(() => '{"levels":[]}');
  try {
    const posts = (await o.inbox()).posts.map((p) => p.content);
    assert.deepEqual(posts, [
      "MATH 301: " + IN_CLASS,
      "MATH 301: Quiz 2 will be held on Monday November 16th and Tuesday November 17th. It will cover chapter 16.1,16.2 and 16.3 in Stewart Calc. and corresponding Lectures 10-12 and worksheets 5-6.",
      "CSEN 301, Quiz 2: Please note that quiz 2 will be conducted for group 2 on Tuesday 24th of November, starting 3:45 pm. Content covered will be SLL (lecture 7 , PA7). Also up: Chapter 18 slides in Physics III and five new files in Math 301.",
    ]);
    assert.ok(posts.every((p) => !RAW.test(p)), posts.join("\n"));
    assert.equal(h.calls.length, 1, "one short call for the whole sweep");
    assert.equal(h.notices.length, 3, "one notification each");
  } finally { await engine.close(); }
});

test("engine: with the model's words, each message says what the post means for them; words it was not given fall back to the rules", async () => {
  const say = [
    "Math 301: your fourth in-class assignment is in your first tutorial this week, on Stokes' and the Divergence theorem.",
    "Math 301 Quiz 2 is Monday and Tuesday (16 and 17 Nov) on Stewart 16.1 to 16.3, lectures 10 to 12 and worksheets 5 and 6. Your group T29 sits it Monday at 3:45 pm in D1.003.",
    "Data Structures Quiz 2 for group 2 is Tuesday 24 November at 3:45 pm, on singly linked lists (lecture 7, PA7). Doors close 10 minutes in.",
  ];
  const { engine, h, o } = await realSweep(() => JSON.stringify({ message: "A summary nobody asked for.", levels: say.map((s, i) => ({ i, level: "notify", why: "Quiz", say: s })).concat([{ i: 3, level: "notify", why: "x", say: "Chapter 18 slides are up; your midterm is in room H12." } as any]) }));
  try {
    const posts = (await o.inbox()).posts.map((p) => p.content);
    assert.deepEqual(posts.slice(0, 2), say.slice(0, 2));
    assert.equal(posts[2], say[2]);
    assert.equal(posts[3], "New in PHYS 301: Chapter 18 slides. Also up: five new files in Math 301.", "the file it raised, in the rules' words (its own named a midterm it was not given)");
    assert.equal(posts.length, MAX_MESSAGES);
    assert.ok(!posts.some((p) => /midterm/.test(p)), "a midterm and a room it was not given are never said");
    assert.ok(!posts.includes("A summary nobody asked for."), "no message above the news after a change");
    assert.ok(posts.every((p) => !RAW.test(p)));
    assert.equal(h.notices.length, posts.length);
  } finally { await engine.close(); }
});

test("engine: steered by text: mute, list, unmute; a muted kind is not told", async () => {
  const clock = { t: T(SUN, "13:00") };
  const { engine, o } = await engineWith(empty(), clock);
  try {
    await o.sweep("event");
    assert.match(String((await o.tool({ action: "clem.mute", kind: "gossip" }) as { error: string }).error), /isn't a kind of news/);
    assert.match(String((await o.tool({ action: "clem.mute", kind: "files", subject: "Chemistry" }) as { error: string }).error), /No subject/);
    const files = await o.tool({ action: "clem.mute", kind: "new files", subject: "Physics" }) as { ok: boolean; muted: string; ids: string[] };
    assert.deepEqual([files.ok, files.muted], [true, "new files in Physics"]);
    const posts = await o.tool({ action: "clem.mute", kind: "announcements", words: "parking" }) as { muted: string };
    assert.equal(posts.muted, "announcements (with “parking”)");
    const listed = (await o.tool({ action: "clem.mutes" }) as { text: string }).text.split("\n").sort();
    assert.deepEqual(listed, [`- ${files.ids[0]}: new files in Physics`, "- new_announcement:*:parking: announcements (with “parking”)"].sort());
    await event(engine, "ann:p", "new_announcement", "New announcement in PHYS 101", "Parking lot B is closed on Thursday, please use the new building's room for the make-up quiz.");
    assert.equal((await o.sweep("event")).posted, false, "muted: not told");
    assert.deepEqual(await o.tool({ action: "clem.unmute", id: "new_announcement:*:parking" }), { ok: true, unmuted: "announcements (with “parking”)" });
    assert.match(String((await o.tool({ action: "clem.unmute", id: "new_announcement:*:parking" }) as { error: string }).error), /No mute has that id/);
    assert.deepEqual((await o.mutesList()).map((m) => m.kind), ["new_material"], "Settings → Proactivity lists what is left");
  } finally { await engine.close(); }
});

test("guides: the AI knows there are no buttons and which action answers what the person says", () => {
  for (const want of ["clem.mute", "clem.unmute", "clem.mutes", "clem.undo", "clem.unwatch", "clem.unremind", "clem.unroutine", "no buttons", "yes, do it"]) assert.ok(CALENDAR_GUIDE.includes(want), want);
  for (const guide of [CALENDAR_GUIDE, WATCH_GUIDE, ROUTINE_GUIDE]) assert.doesNotMatch(guide, /clem-card/, "no card to embed in a reply");
  for (const a of ["clem.watch", "clem.unwatch", "clem.watches", "clem.mute", "clem.unmute", "clem.mutes", "clem.undo"]) assert.ok(isClemAction(a), a);
  assert.equal(clemAction("clem.revert"), "clem.undo");
});

test("timetable: a class is the same class by course name, type and group, so a code resolved later is no change", () => {
  const now = T(SUN, "09:00");
  const named = (code: string) => ({ id: "s1", day: "Monday", period: 2, start: "10:00", end: "11:30", code, name: "Mathematics III", type: "Tutorial", group: "3MIET T014", location: "C7.301" });
  assert.deepEqual(slotChanges([named("Mathematics III")], [named("MATH 301")], now), [], "the portal's name became the real code: nothing moved");
  const moved = slotChanges([named("Mathematics III")], [{ ...named("MATH 301"), day: "Tuesday" }], now, (code) => (code === "MATH 301" ? "math" : undefined));
  assert.deepEqual(moved.map((c) => [c.kind, c.title, c.code, c.subjectId]), [["slot_moved", "MATH 301 Tutorial moved to Tuesday 10:00", "MATH 301", "math"]], "worded by the code once it is one");
  assert.equal(slotChanges([named("Mathematics III")], [{ ...named("Mathematics III"), location: "C7.02" }], now)[0].title, "Mathematics III Tutorial on Monday is now in C7.02", "by the name while there is no code");
});

test("the model is given the person's group as posts write it, and told a range includes it", () => {
  assert.deepEqual(["3MIET T014", "L002", "P014", "T29", "Lecture"].map(shortGroup), ["tutorial group T14", "lecture group 2", "lab group 14", "tutorial group T29", undefined]);
  const now = T("2026-11-14", "13:00"), snap = snapshotOf({ spaces: [space("math", "Math 301")] }, now);
  const rows = "Quiz 2 will be held on Monday November 16th and Tuesday November 17th.\nMonday 16.11 · 3:45 P.M. · T29 - T30 · D1.003\nTuesday 17.11 · 3:45 P.M. · T13 - T17 · Exam Hall 4";
  const plan = planSweep("event", { now, snap, prev: snap, slots: [], deadlines: [], events: [ch("ann:2", "new_announcement", "New announcement in MATH 301", rows, { subjectId: "math" })],
    classes: [{ code: "MATH 301", type: "Tutorial", group: "3MIET T014", day: "Tuesday", start: "08:15", end: "09:45", location: "C7.301" }] }, { done: new Set() });
  assert.ok(plan.ask!.user.includes("- MATH 301: Tutorial 3MIET T014 (tutorial group T14) Tuesday 08:15–09:45 in C7.301"));
  assert.ok(plan.ask!.user.includes("Tuesday 17.11 · 3:45 P.M. · T13 - T17 · Exam Hall 4"), "the row that is theirs (T14 is in T13 - T17)");
  assert.ok(ORGANIZER_GUIDE.includes('"T13 - T17" and "T11,T12,T14" both include T14'));
});

test("engine: everything Clem writes in the main thread is notified, with no daily limit", async () => {
  const t = await realSweep(() => '{"levels":[]}');
  try {
    assert.equal(t.h.notices.length, 3, "three messages, three notifications");
    for (let n = 0; n < 8; n++) {
      t.clock.t += 600e3;
      await event(t.engine, "ann:more" + n, "new_announcement", "New announcement in MATH 301", `The quiz ${n + 3} room is D1.00${n} for every group.`, "45:70");
      await t.o.sweep("event");
    }
    const posts = (await t.o.inbox()).posts;
    assert.equal(posts.length, 11);
    assert.equal(t.h.notices.length, 11, "every message has its notification, however many there were today");
  } finally { await t.engine.close(); }
});

test("a quiz with a day but no time is reminded two mornings before and the evening before, never as 'in 2 hours'", async () => {
  const { deadlineReminders } = await import("../core/proactivity/rules.ts");
  const { deadlineText } = await import("../core/proactivity/say.ts");
  const quiz = { id: "q3", title: "Quiz 3", due: "2026-11-30", code: "MATH 301", kind: "quiz", either: "Monday or Tuesday, by tutorial group" };
  const essay = { id: "a2", title: "Assignment 2", due: "2026-11-30", code: "ELCT 301", kind: "assignment" };
  const at = (iso: string) => deadlineReminders([quiz, essay], Date.parse(iso)).map((r) => r.key);
  assert.deepEqual(at("2026-11-28T05:00:00Z"), []);
  assert.deepEqual(at("2026-11-28T08:00:00Z"), ["remind:q3:48h"]);
  assert.deepEqual(at("2026-11-29T17:00:00Z"), ["remind:q3:14h", "remind:a2:48h"]);
  // On the day itself the quiz may already be over: only the assignment (due at the end of the day) is still reminded.
  assert.deepEqual(at("2026-11-30T19:30:00Z"), ["remind:a2:3h"]);
  const now = Date.parse("2026-11-29T17:00:00Z");
  assert.equal(deadlineText(quiz, now, undefined, { left: 2 * 3600e3 }), "MATH 301 Quiz 3 is tomorrow (Monday or Tuesday, by tutorial group).");
  assert.equal(deadlineText({ id: "m", title: "Midterm", due: "2026-11-30T06:30:00Z", code: "MATH 301", kind: "exam", place: "H5, seat J13" }, Date.parse("2026-11-30T04:00:00Z"), undefined, { left: 2.5 * 3600e3 }), "MATH 301 Midterm is in 3 hours, at 8:30 am in H5, seat J13.");
});
