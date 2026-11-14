import test from "node:test";
import assert from "node:assert/strict";
import { busyList, studySlots, whenOf } from "../core/proactivity/calendar.ts";
import { clashNotes, morningBlocks, type Facts } from "../core/proactivity/rules.ts";
import { cairoAt, DEFAULT_PRO, mergePro, readPro } from "../core/proactivity/settings.ts";
import { snapshotOf } from "../core/proactivity/snapshot.ts";
import { agendaText, findSpace, readClemArgs } from "../core/proactivity/tools.ts";
import { cardsIn, readCard } from "../core/guc/cards.ts";
import { Engine } from "../desktop/engine/index.ts";
import { host as fakeHost } from "./guc-fake.ts";

const T = (day: string, hm: string) => cairoAt(day, hm);
// Sunday 15 November 2026, Cairo (UTC+2).
const SUN = "2026-11-15", MON = "2026-11-16", TUE = "2026-11-17";
const space = (id: string, name: string, extra = {}) => ({ id, name, kind: "subject" as const, description: "", memory: "", sources: [], ...extra });

test("study slots: only allowed days and hours, clear of everything with the gap, spread one a day first", () => {
  const p = { ...DEFAULT_PRO.study, days: [0, 1, 2], from: "16:00", to: "20:00", gap: 10 };
  const busy = busyList({ timed: [{ title: "Club", day: SUN, time: "16:00", minutes: 60 }], slots: [{ day: MON, start: "16:00", end: "18:00", title: "Lab" }] });
  const picks = studySlots(p, busy, { now: T(SUN, "09:00"), until: TUE, count: 4 });
  assert.equal(picks[0].minutes, 50, "50 minutes when the person doesn't say");
  assert.deepEqual(picks.map((x) => `${x.day} ${x.time}`), [`${SUN} 17:15`, `${SUN} 18:15`, `${MON} 18:15`, `${TUE} 16:00`], "one a day across the days, then a second where it fits");
  // No cap a day beyond what fits: four 50-minute sessions with 10 minutes between fill 16:00–20:00.
  assert.deepEqual(studySlots(p, [], { now: T(SUN, "09:00"), until: SUN, count: 6 }).map((x) => x.time), ["16:00", "17:00", "18:00", "19:00"]);
  // The length the person asked for; sessions already in the plan are busy like anything else.
  const long = studySlots(p, busyList({ timed: [{ title: "Study: Math", day: SUN, time: "16:00", minutes: 50 }] }), { now: T(SUN, "09:00"), until: SUN, count: 3, minutes: 90 });
  assert.deepEqual(long.map((x) => `${x.time} ${x.minutes}`), ["17:00 90"]);
  // Today leaves an hour's notice; nothing fits after `until`.
  const later = studySlots(p, [], { now: T(SUN, "17:50"), until: SUN, count: 3 });
  assert.deepEqual(later.map((x) => x.time), ["19:00"], "an hour from 17:50, on the quarter hour");
  // Friday isn't a study day by default (the GUC weekend).
  assert.equal(DEFAULT_PRO.study.days.includes(5), false);
});

test("settings: study preferences merge and read leniently", () => {
  const s = mergePro(DEFAULT_PRO, { study: { gap: 30, days: [3, 1, 1] } });
  assert.equal(s.study.gap, 30);
  assert.deepEqual(s.study.days, [1, 3]);
  assert.equal(s.study.from, DEFAULT_PRO.study.from);
  assert.deepEqual(readPro({ level: "quiet" }).study, DEFAULT_PRO.study, "settings saved before study prefs get the defaults");
  // Saved when session length, sessions a day and the reminder were settings: still read, those three dropped.
  const old = readPro({ level: "quiet", study: { days: [1, 2], from: "17:00", to: "21:00", minutes: 90, gap: 15, perDay: 2, remind: 10 } });
  assert.equal(old.level, "quiet");
  assert.deepEqual(old.study, { days: [1, 2], from: "17:00", to: "21:00", gap: 15 });
});

test("reminder times: ISO, Cairo wall clock and words; never the past", () => {
  const now = T(SUN, "12:00");
  assert.equal(whenOf("2026-11-16T09:00", now), T(MON, "09:00"), "no zone is Cairo time");
  assert.equal(whenOf("2026-11-16T07:00:00Z", now), Date.parse("2026-11-16T07:00:00Z"));
  assert.equal(whenOf("2026-11-16", now), T(MON, "09:00"), "a bare day is 9 in the morning");
  assert.equal(whenOf("tomorrow at 3pm", now), T(MON, "15:00"));
  assert.equal(whenOf("2026-11-14T09:00", now), null);
  assert.equal(whenOf("whenever", now), null);
});

test("rules: morning blocks go around classes and timed plan items; a class against a plan item is a note", () => {
  const now = T(SUN, "07:30");
  const snap = snapshotOf({ spaces: [space("phys", "Physics")], plans: [{ spaceId: "phys", rev: 1, tasks: [{ id: "t1", title: "Problem set", due: SUN }, { id: "t2", title: "Coffee", due: SUN, time: "09:30" }, { id: "t3", title: "Work", due: SUN, time: "10:30" }] }] }, now);
  const f: Facts = { now, snap, slots: [{ day: SUN, start: "09:00", end: "10:00", title: "PHYS Lecture" }], deadlines: [], events: [] };
  const [block] = morningBlocks(f);
  assert.deepEqual(block, { type: "plan_move", spaceId: "phys", taskId: "t1", title: "Problem set", due: SUN, time: "11:30" }, "after the class, coffee and work: the task itself gets the hour");
  const notes = clashNotes(f);
  assert.equal(notes.length, 1);
  assert.match((notes[0] as { text: string }).text, /PHYS Lecture on Sunday at 09:00 clashes with “Coffee” \(Physics\)/);
});

test("tools: arguments are checked, subjects found by code or name, and the agenda shows clashes and preferences", () => {
  assert.deepEqual(readClemArgs("clem.study", { sessions: "3", until: "2026-11-20" }), { ok: true, args: { sessions: 3, until: "2026-11-20" } });
  const bad = readClemArgs("clem.remind", { text: "x" });
  assert.equal(bad.ok, false);
  const spaces = [{ id: "circ", name: "Circuits", code: "ELCT 201" }, { id: "math", name: "Math" }];
  assert.equal(findSpace("elct201", spaces)?.id, "circ");
  assert.equal(findSpace("@Math", spaces)?.id, "math");
  const text = agendaText({ days: [MON], slots: [{ day: MON, start: "10:00", end: "11:30", title: "ELCT 201 Lecture" }], timed: [{ title: "Review", day: MON, time: "11:00", space: "Circuits" }], prefs: DEFAULT_PRO.study, now: T(SUN, "12:00") });
  assert.match(text, /10:00–11:30 ELCT 201 Lecture \(class\)/);
  assert.match(text, /11:00–12:00 Review \(plan · Circuits\)/);
  assert.match(text, /Clashes:\n- Monday 11:00: ELCT 201 Lecture clashes with “Review” \(Circuits\)\./);
  assert.match(text, /Study preferences: Sat, Sun, Mon, Tue, Wed, Thu, 16:00–22:00/);
  assert.match(agendaText({ days: [MON], slots: [], timed: [], prefs: DEFAULT_PRO.study, now: T(SUN, "12:00") }), /nothing scheduled\nNo clashes\./);
  assert.doesNotMatch(text, /calendar/i, "no calendar app is mentioned");
});

test("reminder cards carry an id and when they ring", () => {
  assert.equal(readCard('{"type":"reminder","title":"Submit the lab","at":"2026-11-16T07:00Z","id":"r0123456789abcdef"}')?.type, "reminder");
  assert.equal(readCard('{"type":"reminder","title":"x","id":"bad id"}'), null);
});

// ---------- In the engine ----------
/** `club`: a timed plan item on Sunday 16:00–17:00 in Circuits, to plan around. */
async function engine(clock: { t: number }, o: { club?: boolean } = {}) {
  const h = Object.assign(fakeHost(), { pushed: [] as { title: string; body: string }[] });
  const plans = o.club ? [{ spaceId: "circ", rev: 1, tasks: [{ id: "club", title: "Club", due: SUN, time: "16:00" }] }] : [];
  h.workspace = async () => ({ spaces: [space("circ", "Circuits", { description: "ELCT 201" })], plans, chats: [{ id: "main", kind: "main", messages: [] }], files: [], studySets: [], automations: [] });
  h.notify = (n) => { h.pushed.push({ title: n.title, body: n.body }); };
  const e = await Engine.open("cal-owner", h, { memory: true, jobs: false, clock: () => clock.t });
  return { e, o: e.organizer, h };
}

test("engine: a reminder rings once at its time (through quiet hours when the person set it), then a daily one moves on", async () => {
  const clock = { t: T(SUN, "12:00") }, { e, o, h } = await engine(clock);
  try {
    const r = await o.tool({ action: "clem.remind", text: "Submit the lab report", at: "2026-11-15T23:30", subject: "circuits" }) as { ok: boolean; card: string };
    assert.equal(r.ok, true);
    const card = cardsIn(r.card)[0] as { type: string; id: string; space?: string };
    assert.equal(card.type, "reminder"); assert.equal(card.space, "Circuits");
    const daily = await o.remind({ text: "Flashcards", at: T(SUN, "13:00"), repeat: "daily" });
    assert.equal(await o.ring(), 0, "nothing due yet");
    clock.t = T(SUN, "13:01");
    assert.equal(await o.ring(), 1);
    assert.deepEqual(h.pushed, [{ title: "Reminder", body: "Flashcards" }]);
    assert.equal((await o.reminders()).find((x) => x.id === daily.id)?.at, T(MON, "13:00"), "the next day");
    clock.t = T(SUN, "23:31");
    await o.tick();
    assert.equal(h.pushed.at(-1)?.body, "Submit the lab report", "rings in quiet hours: they asked for that time");
    await o.tick();
    assert.equal(h.pushed.filter((p) => p.body === "Submit the lab report").length, 1, "once");
    const { posts } = await o.inbox();
    assert.equal(posts.filter((p) => cardsIn(p.content).some((c) => c.type === "reminder")).length, 2);
    assert.deepEqual(await o.tool({ action: "clem.unremind", id: daily.id }), { ok: true });
    assert.deepEqual((await o.reminders()).map((x) => x.id), []);
    assert.match(String((await o.tool({ action: "clem.remind", text: "Too late", at: "2026-11-01T09:00" }) as { error?: string }).error), /passed/);
  } finally { await e.close(); }
});

test("engine: study sessions avoid other plans, land in the plan with Undo, and set no reminders", async () => {
  const clock = { t: T(SUN, "09:00") };
  const { e, o } = await engine(clock, { club: true });
  try {
    await o.setSettings({ study: { days: [0, 1], from: "16:00", to: "20:00" } });
    const r = await o.tool({ action: "clem.study", subject: "ELCT 201", sessions: 5, minutes: 90, until: TUE }) as { ok: boolean; planned: string[]; note?: string; card: string };
    assert.equal(r.ok, true);
    assert.deepEqual(r.planned, ["Sun, Nov 15 · Study: Circuits (90 min) at 17:15", "Mon, Nov 16 · Study: Circuits (90 min) at 16:00", "Mon, Nov 16 · Study: Circuits (90 min) at 17:45"]);
    assert.match(String(r.note), /Only 3 of 5/);
    assert.equal((cardsIn(r.card)[0] as { type: string }).type, "organizer");
    const { apply } = await o.inbox();
    assert.deepEqual(apply.map((a) => `${a.action.type} ${(a.action as { due?: string }).due} ${(a.action as { time?: string }).time}`).sort(), [`plan_task ${SUN} 17:15`, `plan_task ${MON} 16:00`, `plan_task ${MON} 17:45`]);
    assert.deepEqual(await o.reminders(), [], "the person sets reminders themselves");
    const again = await o.tool({ action: "clem.study", subject: "Circuits", sessions: 2, minutes: 90, until: TUE }) as { error?: string };
    assert.match(String(again.error), /No free time/, "the same sessions aren't planned twice");
    assert.match(String((await o.tool({ action: "clem.calendar", range: SUN }) as { text: string }).text), /16:00–17:00 Club \(plan · Circuits\)/);
  } finally { await e.close(); }
});

test("engine: a new person gets quiet defaults and no hello; everything is changed in chat when they say so (clem.prefs)", async () => {
  const clock = { t: T(SUN, "09:00") };
  const { e, o } = await engine(clock);
  try {
    assert.equal(await o.quietStart(), true);
    assert.equal(await o.quietStart(), false, "once");
    assert.deepEqual((await o.inbox()).posts, [], "nothing is posted: no hello, no questions");
    assert.equal((await o.settings()).level, "balanced");
    assert.deepEqual(Object.values((await o.settings()).jobs).map((j) => j.on), [false, false, false, false], "a new person starts with no timed routines");
    const r = await o.tool({ action: "clem.prefs", level: "balanced", quiet: { from: "00:30", to: "08:00" }, jobs: { morning: { time: "08:15" }, midday: { on: false } }, study: { days: [0, 1, 2] } }) as { ok: boolean; text: string };
    assert.equal(r.ok, true);
    const s = await o.settings();
    assert.equal(s.level, "balanced");
    assert.deepEqual([s.quiet.from, s.quiet.to, s.jobs.morning.time, s.jobs.midday.on, s.jobs.evening.on], ["00:30", "08:00", "08:15", false, false]);
    assert.deepEqual(s.study.days, [0, 1, 2]);
    assert.match(r.text, /balanced[\s\S]*00:30–08:00[\s\S]*morning plan off, midday check off/);
    assert.match(String((await o.tool({ action: "clem.prefs" }) as { error?: string }).error), /nothing to change/);
  } finally { await e.close(); }
});
