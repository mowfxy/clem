// The AI comes first (docs/GUC-VPS-ENGINE.md "The AI comes first"): what the person tells the AI to do to Clem's own
// systems is done by a tool, recorded as theirs, survives the next automated run and is undone by saying so. The
// portal's own records (grades, the timetable, announcements) are changed in Clem's copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../desktop/engine/index.ts";
import { runGucTool } from "../desktop/engine/ai-tools.ts";
import { GUC_GUIDE } from "../core/guc/ai-tools.ts";
import { CALENDAR_GUIDE } from "../core/proactivity/calendar.ts";
import { readClemArgs } from "../core/proactivity/tools.ts";
import { AI_FIRST } from "../core/main-thread/context.ts";
import { snapshotOf } from "../core/proactivity/snapshot.ts";
import { planSweep } from "../core/proactivity/sweep.ts";
import { actionKey } from "../core/proactivity/actions.ts";
import { cairoAt } from "../core/proactivity/settings.ts";
import type { Facts } from "../core/proactivity/rules.ts";
import { fakeGuc, host, noWait, site } from "./guc-fake.ts";

const NOW = Date.parse("2026-11-08T08:00:00Z");
const SUBJECTS = [{ id: "subj-emb", name: "Embedded" }, { id: "subj-mp", name: "Micro" }];

async function open() {
  const dir = await mkdtemp(join(tmpdir(), "clem-first-")), owner = "owner-a";
  const guc = fakeGuc(site(), {});
  const engine = await Engine.open(owner, host({ files: join(dir, "Files"), temp: join(dir, "temp") }), { http: guc.http, sleep: noWait, memory: true, jobs: false });
  await engine.connect("student.name", "secret");
  await engine.link("subj-emb", "1201:64");
  await (engine as any).light;
  const run = (r: Record<string, unknown>) => runGucTool({ engine, owner, subjects: SUBJECTS, now: NOW }, r);
  return { engine, run, close: async () => { await engine.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("grades, classes and announcements: changed in Clem's copy, said plainly, kept through the next sync, undone by saying so", async () => {
  const { engine, run, close } = await open();
  try {
    // A grade: overridden in Clem's copy, the portal's value kept beside it.
    const g = (await engine.grades())[0];
    assert.ok(g, "the fixture has grades");
    const said = String(await run({ action: "guc.correct", what: "grade", item: g.id, do: "edit", grade: "A+" }));
    assert.match(said, /portal's own record is unchanged/);
    const shown = (await engine.grades()).find((x) => x.id === g.id) as any;
    assert.equal(shown.letter, "A+");
    assert.equal(shown.yours.official.letter, g.letter, "the portal's value is still known");
    // A class: hidden from the timetable, so the organizer's calendar doesn't see it either.
    const slots = (await engine.schedule("2026-11-07")).slots;
    assert.ok(slots.length, "the fixture has classes");
    const cls = slots[0];
    assert.match(String(await run({ action: "guc.correct", what: "class", item: cls.id, do: "remove" })), /Hid/);
    assert.ok(!(await engine.schedule("2026-11-07")).slots.some((s) => s.id === cls.id));
    assert.ok(!(await (engine as any).gucFacts()).slots.some((s: any) => s.id === cls.id), "the organizer's calendar respects it");
    // An announcement: annotated.
    const a = (await engine.announcements()).items[0];
    if (a) {
      await run({ action: "guc.correct", what: "announcement", item: a.id, do: "note", note: "Already handled" });
      assert.equal(((await engine.announcements()).items.find((x) => x.id === a.id) as any).note, "Your note: Already handled");
    }
    // The next automated sync reads the portal again: every change holds.
    await engine.resync();
    assert.equal(((await engine.grades()).find((x) => x.id === g.id) as any).letter, "A+");
    assert.ok(!(await engine.schedule("2026-11-07")).slots.some((s) => s.id === cls.id));
    // "Bring it back": undone by saying so.
    assert.match(String(await run({ action: "guc.correct", what: "class", item: cls.id, do: "restore" })), /Brought back/);
    assert.ok((await engine.schedule("2026-11-07")).slots.some((s) => s.id === cls.id));
    // And "undo that" (the organizer's undo by text) lifts the latest correction too.
    await engine.organizer.undoByText();
    const back = (await engine.grades()).find((x) => x.id === g.id) as any;
    assert.ok(back.letter === g.letter || (a && back.letter === "A+"), "the latest change was lifted");
  } finally { await close(); }
});

test("the organizer doesn't put back what the person removed: a deadline's tasks and an exam's revision sessions", () => {
  const now = cairoAt("2026-11-15", "13:00");
  const space = { id: "math", name: "Math", kind: "subject" as const, description: "", memory: "", sources: [], examDate: "2026-12-05" };
  const snap = snapshotOf({ spaces: [space], plans: [{ spaceId: "math", rev: 1, tasks: [] }] }, now);
  const deadline = (due: string) => ({ id: "d1", title: "Assignment 2", due, spaceId: "math" });
  const first = planSweep("evening", { now, snap, slots: [], deadlines: [deadline("2026-11-20T21:59:00Z")], events: [] } as Facts, { done: new Set() });
  const added = first.actions.filter((a) => a.type === "plan_task" || a.type === "revision_plan");
  assert.ok(added.some((a) => a.type === "plan_task") && added.some((a) => a.type === "revision_plan"), "Clem adds them once");
  // The person removed them (the plan is empty again); the deadline then moved and the exam date changed.
  const done = new Set(added.map(actionKey));
  const moved = snapshotOf({ spaces: [{ ...space, examDate: "2026-12-07" }], plans: [{ spaceId: "math", rev: 2, tasks: [] }] }, now);
  const later = planSweep("evening", { now, snap: moved, prev: snap, slots: [], deadlines: [deadline("2026-11-22T21:59:00Z")], events: [] } as Facts, { done });
  assert.deepEqual(later.actions.filter((a) => a.type === "plan_task" || a.type === "revision_plan"), [], "what they took away stays away");
});

test("every setting of the automated systems has a tool, and no guide says something can't be changed", async () => {
  assert.ok(readClemArgs("clem.prefs", { action: "clem.prefs", deadlineHours: [72, 2] }).ok, "deadline reminder times are the person's to set");
  assert.match(AI_FIRST, /Never answer that something is automatic, synced or can't be changed/);
  for (const guide of [GUC_GUIDE, CALENDAR_GUIDE]) assert.doesNotMatch(guide.replace(/[Nn]ever answer that something[^.]*\./g, ""), /can't be changed|cannot be changed|can't be falsified|synced automatically/);
  const app = await readFile("src/App.tsx", "utf8"), worker = await readFile("desktop/engine/vps/agent.ts", "utf8");
  assert.match(app, /MAIN_THREAD_NOTE = [^\n]*AI_FIRST/, "the window's main thread carries the rule");
  assert.match(worker, /MAIN_NOTE = [^\n]*AI_FIRST/, "the VPS worker's main thread carries it");
});
