import test from "node:test";
import assert from "node:assert/strict";
import {
  readPlanBlock, resolveSpace, newPlan, applyUpdate, canUndo, undoUpdate, toggleTask, planStatus, planSections,
  overdueByPlan, planContext, cleanDay, cleanTime, addDays, daysBetween, weekOf, dayLabel, localDay, type PlanBlock,
} from "../core/plans.ts";

const at = (day: string, h = 12) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, h).getTime(); };
const create = (json: object) => readPlanBlock(JSON.stringify(json));
const spaces = [
  { id: "s1", name: "Data Structures", kind: "subject" },
  { id: "s2", name: "Physics", kind: "subject" },
  { id: "p1", name: "Website", kind: "project" },
];

test("days are calendar days, checked strictly", () => {
  assert.equal(cleanDay("2026-10-14"), "2026-10-14");
  assert.equal(cleanDay("2026-10-14T09:00:00Z"), "2026-10-14");
  assert.equal(cleanDay("2026-02-30"), undefined);
  assert.equal(cleanDay("14/10/2026"), undefined);
  assert.equal(cleanDay(20261014), undefined);
  assert.equal(cleanTime("9:05"), "09:05");
  assert.equal(cleanTime("24:00"), undefined);
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(daysBetween("2026-10-12", "2026-10-19"), 7);
  // Across the end of daylight saving time (Europe and the US both change in this span).
  assert.equal(daysBetween("2026-10-20", "2026-11-10"), 21);
  assert.equal(weekOf("2026-10-15"), "2026-10-12"); // Thursday → Monday
  assert.equal(weekOf("2026-10-18"), "2026-10-12"); // Sunday belongs to the week that began Monday
  assert.equal(localDay(at("2026-10-12", 23)), "2026-10-12");
  assert.equal(dayLabel("2026-10-12", "2026-10-12"), "Today");
  assert.equal(dayLabel("2026-10-13", "2026-10-12"), "Tomorrow");
  assert.equal(dayLabel("2026-10-11", "2026-10-12"), "Yesterday");
  assert.equal(dayLabel("2026-10-16", "2026-10-12"), "Fri");
  assert.equal(dayLabel("2026-11-02", "2026-10-12"), "Nov 2");
  assert.equal(dayLabel("2027-01-04", "2026-10-12"), "Jan 4, 2027");
});

test("a create block is read, tidied and given unique ids", () => {
  const block = create({ action: "create", space: "s1", title: "  Midterm   plan ", goal: "Ready for the midterm", tasks: [
    { id: "t1", title: "Lecture 1", due: "2026-10-13", group: "Week 1" },
    { id: "t1", title: "Lecture 2", due: "2026-10-14T00:00", time: "18:30" },
    { title: "Midterm", due: "2026-10-20", time: "9:00", kind: "milestone" },
    { title: "" }, "nonsense", { title: "Bad date", due: "next friday", time: "10:00" },
  ] });
  assert.ok(block && block.action === "create");
  assert.equal(block.title, "Midterm plan");
  assert.deepEqual(block.tasks.map((t) => t.id), ["t1", "t2", "t3", "t4"]);
  assert.equal(block.tasks[1].due, "2026-10-14");
  assert.equal(block.tasks[1].time, "18:30");
  assert.equal(block.tasks[2].kind, "milestone");
  assert.equal(block.tasks[2].time, "09:00");
  assert.equal(block.tasks[3].due, undefined);
  assert.equal(block.tasks[3].time, undefined, "a time without a day is dropped");
  assert.equal(create({ action: "create", title: "Empty", tasks: [] }), null);
  assert.equal(create({ action: "create", tasks: [{ title: "x" }] }), null);
  assert.equal(readPlanBlock("{ not json"), null);
  assert.equal(create({ action: "explode" }), null);
});

test("update and delete blocks keep only usable changes", () => {
  const block = create({ action: "update", space: "s1", summary: "Lecture 1 done", changes: [
    { op: "done", id: "t1" }, { op: "undone", id: "t2" }, { op: "edit", id: "t3", due: "2026-10-21", title: "Midterm (moved)" },
    { op: "edit", id: "t4", fields: { notes: "bring calculator" } }, { op: "edit", id: "t5" }, { op: "add", title: "Review notes", due: "2026-10-19", after: "t2" },
    { op: "add", task: { id: "extra", title: "Past paper" } }, { op: "fly", id: "t1" }, { op: "done" },
  ] }) as Extract<PlanBlock, { action: "update" }>;
  assert.equal(block.action, "update");
  assert.deepEqual(block.changes.map((c) => c.op), ["done", "undo", "edit", "edit", "add", "add"]);
  const add = block.changes[4] as { op: "add"; task: { id: string; title: string }; after?: string };
  assert.equal(add.task.id, "", "a new task without an id is numbered when applied");
  assert.equal(add.after, "t2");
  assert.equal((block.changes[5] as { task: { id: string } }).task.id, "extra");
  assert.equal(create({ action: "update", changes: [] }), null);
  assert.deepEqual(create({ action: "delete", space: "s2", reason: "Exam is over" }), { action: "delete", space: "s2", reason: "Exam is over" });
});

test("a block's space is found by id, by a unique name, or is the chat's own", () => {
  assert.equal(resolveSpace({ space: "s2" }, spaces, null), "s2");
  assert.equal(resolveSpace({ space: "physics" }, spaces, null), "s2");
  assert.equal(resolveSpace({ space: "Chemistry" }, spaces, "s1"), null, "an unknown name never falls back to the chat's space");
  assert.equal(resolveSpace({}, spaces, "s1"), "s1");
  assert.equal(resolveSpace({}, spaces, null), null);
  assert.equal(resolveSpace({}, spaces, "gone"), null);
  assert.equal(resolveSpace({ create: { kind: "project", name: "website" } }, spaces, null), "p1", "a 'new' space that already exists is reused");
  assert.equal(resolveSpace({ create: { kind: "subject", name: "Chemistry" } }, spaces, null), null);
});

function samplePlan() {
  const block = create({ action: "create", title: "Midterm", tasks: [
    { id: "a", title: "Lecture 1", due: "2026-10-10", group: "Week 1" },
    { id: "b", title: "Lecture 2", due: "2026-10-12", group: "Week 1" },
    { id: "c", title: "Lecture 3", due: "2026-10-14", group: "Week 2" },
    { id: "q", title: "Quiz 1", due: "2026-10-15", time: "10:00", kind: "milestone", group: "Week 2" },
    { id: "d", title: "Past paper", due: "2026-10-18", group: "Week 2" },
    { id: "e", title: "Flashcards", group: "Any time" },
  ] }) as Extract<PlanBlock, { action: "create" }>;
  return newPlan("s1", block, at("2026-10-09"), "plan-1");
}

test("a new plan starts today, or at the first date already past", () => {
  const plan = samplePlan();
  assert.equal(plan.start, "2026-10-09");
  assert.equal(plan.rev, 1);
  const late = newPlan("s1", { title: "x", tasks: [{ id: "a", title: "a", due: "2026-10-01" }] }, at("2026-10-09"));
  assert.equal(late.start, "2026-10-01");
});

test("status: behind when anything is overdue, with the pace line and next steps", () => {
  const plan = samplePlan();
  let s = planStatus(plan, "2026-10-12");
  assert.equal(s.state, "behind");
  assert.equal(s.total, 5, "milestones are not counted as work");
  assert.deepEqual(s.overdue.map((t) => t.id), ["a"], "due today is not overdue yet");
  assert.deepEqual(s.today.map((t) => t.id), ["b"]);
  assert.equal(s.expected, 2);
  assert.equal(s.next?.id, "a");
  assert.equal(s.nextMilestone?.id, "q");
  assert.equal(s.end, "2026-10-18");
  assert.equal(s.daysLeft, 6);

  const caughtUp = toggleTask(toggleTask(plan, "a", at("2026-10-12")), "b", at("2026-10-12"));
  s = planStatus(caughtUp, "2026-10-12");
  assert.equal(s.state, "on-track");
  assert.equal(s.done, 2);
  assert.equal(s.percent, 0.4);

  const ahead = toggleTask(caughtUp, "c");
  assert.equal(planStatus(ahead, "2026-10-12").state, "ahead");
  assert.equal(planStatus(ahead, "2026-10-13").state, "ahead");
  // Tomorrow the past paper is still open but not yet due; after the 18th it is overdue.
  assert.equal(planStatus(ahead, "2026-10-19").state, "behind");

  const all = ["d", "e"].reduce((p, id) => toggleTask(p, id), ahead);
  assert.equal(planStatus(all, "2026-10-30").state, "done");
  assert.equal(toggleTask(all, "e").tasks.find((t) => t.id === "e")?.done, undefined, "ticking again unticks");

  const future = newPlan("s1", { title: "Later", tasks: [{ id: "a", title: "a", due: "2026-11-01" }] }, at("2026-10-12"));
  future.start = "2026-10-20";
  assert.equal(planStatus(future, "2026-10-12").state, "upcoming");
  const milestonesOnly = newPlan("s1", { title: "Exams", tasks: [{ id: "m", title: "Final", due: "2026-12-01", kind: "milestone" }] }, at("2026-10-12"));
  assert.equal(planStatus(milestonesOnly, "2026-10-12").total, 1, "a plan of only milestones counts them");
});

test("updates apply, report unknown ids, and undo only while nothing came after", () => {
  const plan = samplePlan();
  const block = create({ action: "update", summary: "Done and moved", changes: [
    { op: "done", id: "a" }, { op: "edit", id: "d", due: "2026-10-19", time: "" }, { op: "remove", id: "e" },
    { op: "add", title: "Office hours", due: "2026-10-13", after: "b" }, { op: "done", id: "zzz" }, { op: "edit", id: "q", due: "" },
  ], title: "Midterm prep" }) as Extract<PlanBlock, { action: "update" }>;
  const result = applyUpdate(plan, block, at("2026-10-12"), "snap-1");
  const next = result.plan;
  assert.deepEqual(result.missing, ["zzz"]);
  assert.equal(result.applied, 6);
  assert.equal(next.title, "Midterm prep");
  assert.ok(next.tasks.find((t) => t.id === "a")?.done);
  assert.equal(next.tasks.find((t) => t.id === "d")?.due, "2026-10-19");
  assert.equal(next.tasks.find((t) => t.id === "q")?.due, undefined, "an empty date clears it");
  assert.equal(next.tasks.find((t) => t.id === "q")?.time, undefined, "and its time with it");
  assert.equal(next.tasks.some((t) => t.id === "e"), false);
  assert.deepEqual(next.tasks.map((t) => t.id), ["a", "b", "t1", "c", "q", "d"], "the new task lands after b with a fresh id");
  assert.equal(next.rev, 2);
  assert.equal(plan.tasks.find((t) => t.id === "a")?.done, undefined, "the original plan object is untouched");

  assert.ok(canUndo(next, "snap-1"));
  const undone = undoUpdate(next, "snap-1", at("2026-10-12"))!;
  assert.deepEqual(undone.tasks, plan.tasks);
  assert.equal(undone.title, "Midterm");
  assert.equal(undone.history?.length, 0);
  assert.equal(canUndo(undone, "snap-1"), false, "an undone update cannot be undone twice");

  const touched = toggleTask(next, "b");
  assert.equal(canUndo(touched, "snap-1"), false, "a change by hand after the update blocks its undo");
  assert.equal(undoUpdate(touched, "snap-1"), null);
});

test("history keeps the last twenty snapshots", () => {
  let plan = samplePlan();
  for (let i = 0; i < 25; i++) plan = applyUpdate(plan, { action: "update", summary: "x", changes: [{ op: "done", id: "a" }] }, Date.now(), "s" + i).plan;
  assert.equal(plan.history?.length, 20);
  assert.equal(plan.history?.[19].id, "s24");
});

test("sections follow the plan's groups, or weeks when it has none", () => {
  assert.deepEqual(planSections(samplePlan()).map((s) => [s.title, s.tasks.length]), [["Week 1", 2], ["Week 2", 3], ["Any time", 1]]);
  const plain = newPlan("s1", { title: "x", tasks: [
    { id: "a", title: "a", due: "2026-10-20" }, { id: "b", title: "b", due: "2026-10-13" }, { id: "c", title: "c" }, { id: "d", title: "d", due: "2026-10-18" },
  ] }, at("2026-10-12"));
  assert.deepEqual(planSections(plain).map((s) => [s.title, s.tasks.map((t) => t.id).join("")]), [["Week of Oct 12", "bd"], ["Week of Oct 19", "a"], ["Any time", "c"]]);
});

test("overdue across plans and the model's view of them", () => {
  const a = samplePlan(), b = newPlan("s2", { title: "Physics", tasks: [{ id: "x", title: "Lab report", due: "2026-10-20" }] }, at("2026-10-09"));
  const late = overdueByPlan([a, b], "2026-10-13");
  assert.equal(late.length, 1);
  assert.deepEqual(late[0].overdue.map((t) => t.id), ["a", "b"]);

  const text = planContext(spaces, [a, b], "s2", at("2026-10-13"));
  assert.match(text, /today is Tuesday 2026-10-13/);
  assert.ok(text.indexOf('"Physics"') < text.indexOf('"Data Structures"'), "the chat's own space comes first");
  assert.match(text, /this chat is in it/);
  assert.match(text, /a \| OVERDUE \| task \| due 2026-10-10 \| group: Week 1 \| Lecture 1/);
  assert.match(text, /q \| open \| milestone \| due 2026-10-15 10:00/);
  assert.match(text, /project "Website" \(space id p1\): no plan/);

  const small = planContext(spaces, [a, b], "s2", at("2026-10-13"), 300);
  assert.ok(small.length < 700);
  assert.match(small, /more subjects and projects|ask the person to open/);
  assert.match(planContext([], [], null), /no subjects or projects yet/);
});

test("the plans playbook's own examples are read by the parser", async () => {
  const { mowrSkills, mowrSkillsFor, planIntent } = await import("../core/mowr-skills.ts");
  const steps = mowrSkills.find((s) => s.id === "plans")!.steps.join("\n");
  const created = readPlanBlock(/(\{"action":"create".*?\]\})/.exec(steps)![1].replace(/YYYY-MM-DD/g, "2026-10-20").replace(/HH:MM/g, "09:00"));
  assert.ok(created && created.action === "create" && created.tasks.length === 2);
  assert.equal(created.tasks[1].kind, "milestone");
  const updated = readPlanBlock(/(\{"action":"update".*?\]\})/.exec(steps)![1].replace(/YYYY-MM-DD/g, "2026-10-20"));
  assert.ok(updated && updated.action === "update");
  assert.deepEqual(updated.changes.map((c) => c.op), ["done", "undo", "edit", "add", "remove"]);
  assert.deepEqual(readPlanBlock(/(\{"action":"delete"[^}]*\})/.exec(steps)![1]), { action: "delete", space: "<space id>" });
  for (const t of ["make me a study plan before the midterm", "I finished lecture 3", "am I on track?", "the quiz moved to Friday, reschedule", "what should I do today"]) assert.ok(planIntent.test(t), t);
  for (const t of ["explain recursion", "draw a pulley"]) assert.equal(planIntent.test(t), false, t);
  assert.ok(mowrSkillsFor("explain recursion", { plans: true }).some((s) => s.id === "plans"), "a space with a plan always brings the playbook");
});

test("a plan saved in a subject ZIP comes back with what was done and when", () => {
  const block = create({ action: "create", title: "Kept", start: "2026-10-01", tasks: [{ id: "a", title: "Done one", due: "2026-10-02", done: true, doneAt: 1234 }, { id: "b", title: "Open one" }] }) as Extract<PlanBlock, { action: "create" }>;
  const plan = newPlan("s9", block, at("2026-10-12"));
  assert.equal(plan.start, "2026-10-01");
  assert.equal(plan.tasks[0].done, 1234);
  assert.equal(plan.tasks[1].done, undefined);
});
