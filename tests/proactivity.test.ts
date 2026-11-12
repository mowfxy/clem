import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionKey, applyAction, undoAction, type Workspace } from "../core/proactivity/actions.ts";
import { capPushes, importance, slotChanges, type Change } from "../core/proactivity/attention.ts";
import { deadlineReminders, extractCommitments, findClashes, followUps, freedSlots, gradeNotes, type Facts } from "../core/proactivity/rules.ts";
import { cairoAt, delivery, DEFAULT_PRO, inQuiet, mergePro, quietEnd, readPro } from "../core/proactivity/settings.ts";
import { snapshotOf } from "../core/proactivity/snapshot.ts";
import { planSweep, readReply, sweepCard } from "../core/proactivity/sweep.ts";
import { turnText } from "../core/main-thread/context.ts";
import { live, matchWatch, parseWatch } from "../core/proactivity/watches.ts";
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

test("push cap: urgent first, the rest wait for the next digest", () => {
  const items = [{ level: "notify" as const, n: 1 }, { level: "urgent" as const, n: 2 }, { level: "notify" as const, n: 3 }];
  assert.deepEqual(capPushes("proactive", 11, items).push.map((x) => x.n), [2]);
  assert.deepEqual(capPushes("proactive", 11, items).digest.map((x) => x.n), [1, 3]);
  assert.equal(capPushes("quiet", 0, items).push.length, 2);
  assert.equal(capPushes("balanced", 9, items).push.length, 0);
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
  assert.ok(morning.ask?.user.includes("Sweep: the morning plan, Sunday 07:30.") && /In the card[^\n]*\n- Moved “Problem set”/.test(morning.ask.user), "the brief is said in Clem's words: one short call");
  const silent = planSweep("morning", { ...facts, now: T(SUN, "07:30"), snap: morning0() }, { done: new Set(), lastDay: "2026-11-14", voice: false });
  assert.equal(silent.ask, undefined, "kept quiet (or no model): the rules needed no model");
});

test("the organizer's reply is checked: levels, watches, and only allowed actions", () => {
  const now = T(SUN, "13:00"), snap = snapshotOf({ spaces: [space("phys", "Physics")], files: [{ id: "f1", name: "notes.pdf", spaceId: null, created: 1 }] }, now);
  const amb: Change = { key: "ann:1", kind: "new_announcement", title: "New announcement", detail: "Please read chapter 3 carefully and think about how it relates to the lecture." };
  const plan = planSweep("event", { now, snap, prev: snap, slots: [], deadlines: [], events: [amb] }, { done: new Set() });
  assert.ok(plan.ask && plan.ask.user.includes("News:\n0. New announcement"));
  const read = readReply('{"levels":[{"i":0,"level":"notify","why":"Reading for the quiz","say":"Read chapter 3 before Thursday\'s quiz."}],"actions":[{"type":"file_move","fileId":"f1","name":"notes.pdf","spaceId":"phys"},{"type":"automation","name":"x","prompt":"xyz","schedule":"daily","time":"10:00"},{"type":"file_move","fileId":"nope","name":"n","spaceId":"phys"}]}', plan, snap, new Set());
  assert.equal(read.rated[0].level, "notify");
  assert.equal(read.rated[0].say, "Read chapter 3 before Thursday's quiz.", "Clem says it in its own words");
  assert.deepEqual(read.actions.map((a) => a.type), ["file_move"], "an offer or an unknown file from the model is dropped");
  assert.equal(readReply("not json", plan, snap, new Set()), plan);
  assert.equal(read.message, undefined);
  const voiced = readReply('{"message":"Heads up: **read chapter 3** before Thursday. ```clem-card {} ```","actions":[{"type":"note","kind":"followup","text":"You said you would read it."}]}', plan, snap, new Set());
  assert.equal(voiced.message, "Heads up: read chapter 3 before Thursday. clem-card {}", "its words are plain text: no fences, no markdown");
  assert.deepEqual(voiced.actions, [], "a follow-up is asked when its day comes (the rules), not the minute it was said");
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
  const card = sweepCard("morning", T(SUN, "07:30"), { said: [], hits: [], brief: [], actions: [{ type: "plan_move", spaceId: "phys", taskId: "t1", title: "Problem set", due: SUN, time: "09:00" }] }, () => "Physics");
  assert.deepEqual(card?.lines, [{ text: "Problem set", key: "move:phys:t1:" + SUN, time: "09:00", space: "Physics" }]);
});

test("the main thread's AI reads what Clem told them, not just that a card was there", () => {
  const t = turnText('Quiz 2 moved, so I shifted your revision.\n\n```clem-card\n{"type":"organizer","title":"Since you last looked","when":"event","lines":[{"text":"Quiz 2 is now on Sunday","key":"change:a","space":"Math"},{"text":"Revise chapter 4","time":"16:00"}]}\n```');
  assert.equal(t, 'Quiz 2 moved, so I shifted your revision.\n\n[You told them, in a card "Since you last looked":\n- Quiz 2 is now on Sunday (Math)\n- 16:00 Revise chapter 4]');
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
async function engineWith(ws: Ws, clock: { t: number }, reply = () => '{"levels":[],"actions":[]}') {
  const h = Object.assign(fakeHost(), { calls: [] as { system: string; user: string }[], opened: [] as unknown[] });
  h.workspace = async () => ws;
  h.complete = async (r) => { h.calls.push(r); return reply(); };
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

test("engine: Clem judges all the news in one call and says it in its own words; urgent is pushed at once, deduped; no lecture cards", async () => {
  const clock = { t: T(SUN, "13:00") };
  const { engine, h, o } = await engineWith(empty(), clock, () => '{"levels":[{"i":0,"level":"notify","why":"Reading for the quiz","say":"Read chapter 3 before the quiz."},{"i":1,"level":"silent","why":"Nothing to do"},{"i":3,"level":"digest","why":"Routine"}]}');
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
    const card = cardsIn(posts[0].content).find((c) => c.type === "organizer") as any;
    assert.deepEqual(card.lines.map((l: any) => l.key?.split(":").slice(0, 2).join(":")).filter(Boolean), ["change:ann", "change:ann"], "the urgent one and the one the model raised");
    assert.ok(card.lines.some((l: any) => l.text === "Read chapter 3 before the quiz."), "the line is Clem's own words");
    assert.ok(card.lines.some((l: any) => /Also new: 1 update/.test(l.text)), "routine material is one digest line");
    assert.equal(cardsIn(posts[0].content).some((c) => c.type === "lecture"), false, "no new-lecture card unless asked");
    assert.deepEqual(h.notices, ["Today's lecture is cancelled; a compensation lecture will follow.", "Read chapter 3 before the quiz."], "the urgent one alone, the rest in one push");
    assert.deepEqual(h.opened[0], { chat: "main", message: posts[0].id }, "the push opens the card");
    assert.equal((await o.sweep("event")).called, false);
    assert.equal(await o.push("change:ann:3", "x", "y", {}), "sent-before", "never twice on a channel");
    // Taught: the person mutes this kind of thing in this subject.
    const muted = await o.mute(card.lines[0].key);
    assert.equal(muted?.kind, "new_announcement");
  } finally { await engine.close(); }
});

test("engine: a watch fires once, through its own line and a push", async () => {
  const clock = { t: T(SUN, "13:00") };
  const { engine, h, o } = await engineWith(empty(), clock);
  try {
    await o.sweep("event");
    const w = await o.watch("tell me when the midterm room is posted", []);
    await event(engine, "ann:9", "new_announcement", "New announcement in PHYS 101", "The midterm room is C7.02.");
    await o.sweep("event");
    const { posts } = await o.inbox();
    assert.ok(/You asked to hear/.test(posts.at(-1)!.content));
    assert.equal(h.notices.length, 1);
    await event(engine, "ann:10", "new_announcement", "New announcement in PHYS 101", "Midterm room for group 2 is C7.03.");
    await o.sweep("event");
    assert.ok(!(await o.inbox()).posts.slice(1).some((p) => /You asked to hear/.test(p.content)), "once");
    assert.equal((await o.watches()).find((x) => x.id === w.id)?.live, false);
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
    assert.ok(box.posts[0].content.startsWith("Problem set 2 slipped past Friday, so it's first at 9. Exam in a week: I added an hour for it.\n\n```clem-card"), "its words first, the card under them");
    const card = cardsIn(box.posts[0].content)[0] as any;
    assert.equal(card.title, "Your Sunday, planned");
    assert.deepEqual(h.notices, ["Problem set 2 slipped past Friday, so it's first at 9. Exam in a week: I added an hour for it."], "the push says what Clem said");
    const w = { spaces: ws.spaces, plans: ws.plans, files: [], memory: "", automations: [] };
    let state: any = w;
    const results = box.apply.map((a) => { const x = applyAction(state, a.action, { now: clock.t }) as any; state = x.state; return { key: a.key, ok: true, undo: x.undo }; });
    await o.ack({ posts: [box.posts[0].id], results });
    assert.deepEqual(await o.inbox(), { posts: [], apply: [] });
    const log = await o.log();
    assert.equal(log.filter((l) => l.status === "applied" && l.undo).length, 2, JSON.stringify(log));
    assert.deepEqual([state.plans[0].tasks[0].due, state.plans[0].tasks[0].time, state.plans[0].tasks.length], [SUN, "09:00", 3], "the task itself got its hour");
    const undo = await o.undo(results[0].key);
    assert.equal(undoAction(state, undo!).plans[0].tasks[0].due, "2026-11-13");
    assert.equal(await o.undo(results[0].key), null, "once");
    assert.equal((await o.sweep("morning")).posted, false, "the same morning twice says nothing new");
  } finally { await engine.close(); }
});

test("engine: deadline reminders post once at 48h and 3h, with a push that opens the deadline", async () => {
  const clock = { t: T(SUN, "13:00") }, ws = empty();
  ws.plans.push({ id: "p1", spaceId: "phys", title: "Physics plan", start: "2026-11-01", created: 1, updated: 1, rev: 1, tasks: [{ id: "t1", title: "Physics quiz", due: "2026-11-16", time: "10:00", kind: "milestone" }] });
  const { engine, h, o } = await engineWith(ws, clock);
  try {
    await o.tick();
    await o.tick();
    let posts = (await o.inbox()).posts;
    assert.equal(posts.length, 1);
    assert.match(posts[0].content, /Physics quiz is due in 21 hours/);
    clock.t = T("2026-11-16", "07:30");
    await o.tick();
    posts = (await o.inbox()).posts;
    assert.equal(posts.length, 2);
    assert.match(posts[1].content, /due in 3 hours/);
    assert.deepEqual(h.notices, ["Physics quiz", "Physics quiz"]);
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
  const { engine, h, o } = await engineWith(empty(), clock, () => '{"levels":[{"i":0,"level":"notify","why":"Reading","say":"Read chapter 3 before the quiz."}]}');
  try {
    await o.sweep("event");
    await o.setSettings({ level: "balanced" });
    await event(engine, "ann:1", "new_announcement", "New announcement in PHYS 101", "Please read chapter 3 carefully and think about how it relates to the lecture.");
    assert.equal((await o.sweep("midday")).posted, true, "found by the midday check, still told");
    assert.match((await o.inbox()).posts[0].content, /Read chapter 3 before the quiz\./);
    await o.setSettings({ level: "quiet" });
    await event(engine, "ann:2", "new_announcement", "New announcement in PHYS 101", "Please read chapter 4 carefully and think about how it relates to the lecture.");
    assert.equal((await o.sweep("event")).posted, false, "quiet: not worth a message of its own");
    assert.equal((await o.log()).find((l) => l.key === "change:ann:2")?.status, "held");
    assert.equal(h.notices.length, 1);
    await engine.db.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail, created_at) values ($1, 'dl:x', 'deadline_added', null, 'Deadline in PHYS 101', $2, now() + interval '1 hour')", ["pro-owner", "Sheet 5 · " + new Date(T(SUN, "23:00")).toISOString()]);
    assert.equal((await o.sweep("event")).posted, true, "something urgent");
    const card = cardsIn((await o.inbox()).posts.at(-1)!.content)[0] as any;
    assert.deepEqual(card.lines.map((l: any) => l.key), ["change:dl:x", "change:ann:2"], "what was kept back rides along");
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
