// The organizer's rules: what it decides without a model (docs/MAIN-THREAD.md "Proactivity"). Deadline reminders,
// clashes, commitments, today's time blocks, rescheduling, revision plans, deadline tasks, filing, grade pings,
// project nudges, repeated requests and new-lecture cards. Pure; all days and times are Cairo's.
import * as chrono from "chrono-node";
import { addDays, cairo } from "../guc/hub.ts";
import type { ProAction } from "./actions.ts";
import { cairoAt } from "./settings.ts";
import type { Snapshot } from "./snapshot.ts";
import type { Change } from "./attention.ts";

const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const mins = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

export type Slot = { day: string; start: string; end: string; title: string; code?: string };
export type Deadline = { id: string; title: string; due: string; code?: string; spaceId?: string };

/** A deadline's instant: an ISO time, or a bare day meaning its end (23:59 Cairo). */
export const dueAt = (due: string) => (/^\d{4}-\d{2}-\d{2}$/.test(due) ? cairoAt(due, "23:59") : Date.parse(due));

/** Deadline reminders due now: for each deadline, the tightest window `now` is in (48h, then 3h), keyed per window so
 *  each is sent once. A reminder whose window has passed (now inside 3h) is not sent late as the 48h one. */
export function deadlineReminders(deadlines: Deadline[], now: number, hours = [48, 3]) {
  const sorted = [...hours].sort((a, b) => a - b), out: { key: string; hours: number; deadline: Deadline; left: number }[] = [];
  for (const d of deadlines) {
    const at = dueAt(d.due), left = at - now;
    if (!(left > 0)) continue;
    const h = sorted.find((x) => left <= x * 3600e3);
    if (h !== undefined) out.push({ key: `remind:${d.id}:${h}h`, hours: h, deadline: d, left });
  }
  return out.sort((a, b) => a.left - b.left);
}
/** "in 2 hours", "in 47 hours" → wording for a reminder. */
export const leftText = (ms: number) => { const h = Math.round(ms / 3600e3); return h < 1 ? "in under an hour" : h < 36 ? `in ${h} hour${h === 1 ? "" : "s"}` : `in ${Math.round(h / 24)} days`; };

/** This GUC week's classes (weekday names) on real Cairo days from `from`, for `n` days. */
export function datedSlots(slots: { day: string; start: string; end: string; code: string; type: string; name?: string }[], from: string, n = 7): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const day = addDays(from, i), wd = WEEK[new Date(day + "T12:00:00Z").getUTCDay()];
    for (const s of slots) if (s.day.toLowerCase() === wd) out.push({ day, start: s.start, end: s.end, title: `${s.code} ${s.type}`.trim(), code: s.code });
  }
  return out;
}

/** Classes overlapping timed plan items (a quiz, a time block, a meeting) on the same day. */
export type Timed = { title: string; day: string; time: string; minutes?: number; space?: string };
export function findClashes(slots: Slot[], items: Timed[]) {
  const out: { slot: Slot; item: Timed; key: string }[] = [];
  for (const item of items) {
    const a = mins(item.time), b = a + (item.minutes ?? 60);
    for (const s of slots) if (s.day === item.day && a < mins(s.end) && mins(s.start) < b)
      out.push({ slot: s, item, key: `clash:${s.day}:${s.start}:${norm(s.title)}:${norm(item.title)}` });
  }
  return out;
}

/** Things the person said they'd do ("I'll finish the lab report tomorrow"), with a day when they gave one. */
const PROMISE = /\b(?:i'?ll|i will|i'm going to|im going to|i am going to|i need to|i have to|i must|i plan to|remind me to|i should)\s+([^.!?\n]{3,140})/gi;
export function extractCommitments(said: { id: string; text: string; at: number }[]) {
  const out: { key: string; text: string; day?: string; at: number }[] = [];
  for (const m of said) {
    if (/\?\s*$/.test(m.text.trim())) continue;
    // Titles keep their dot: "Dr. Amr" is not the end of a sentence.
    const text = m.text.replace(/\b(Dr|Mr|Mrs|Ms|Prof|Eng|St)\./g, "$1\u2024");
    for (const hit of text.matchAll(PROMISE)) {
      let what = hit[1].trim().replace(/\s+/g, " ").replace(/\u2024/g, ".");
      if (/^(be|try|think|let you know|see)\b/i.test(what) || what.split(" ").length < 2) continue;
      const date = chrono.parse(what, { instant: new Date(m.at), timezone: "EET" }, { forwardDate: true })[0];
      if (date) what = what.replace(date.text, " ").replace(/\s+(by|on|before|at)?\s*$/i, "").replace(/\s+/g, " ").trim();
      out.push({ key: `commit:${m.id}:${norm(what).slice(0, 60)}`, text: what, at: m.at, ...(date ? { day: cairo(date.start.date().getTime()).ymd } : {}) });
    }
  }
  return out;
}

/** Free hours on a day, between 09:00 and 22:00, around classes and timed tasks; from `after` (minutes) on. */
export function freeHours(day: string, slots: Slot[], timed: Timed[], after = 0) {
  const busy = [...slots.filter((s) => s.day === day).map((s) => [mins(s.start), mins(s.end)]), ...timed.filter((t) => t.day === day).map((t) => [mins(t.time), mins(t.time) + (t.minutes ?? 60)])];
  const out: string[] = [];
  for (let t = Math.max(9 * 60, Math.ceil(after / 30) * 30); t + 60 <= 22 * 60; t += 30)
    if (!busy.some(([a, b]) => t < b && a < t + 60)) { out.push(hhmm(t)); busy.push([t, t + 60]); }
  return out;
}

export type Facts = { now: number; snap: Snapshot; prev?: Snapshot; slots: Slot[]; deadlines: Deadline[]; events: Change[] };
const nameOf = (snap: Snapshot, id?: string) => snap.spaces.find((s) => s.id === id)?.name;
const timedOf = (snap: Snapshot): Timed[] => snap.plans.flatMap((p) => p.tasks.filter((t) => !t.done && t.due && t.time).map((t) => ({ title: t.title, day: t.due!, time: t.time!, space: nameOf(snap, p.spaceId) })));

/** The morning brief's blocks for today: due and overdue work, due flashcards and the nearest exam, in free hours. */
export function morningBlocks(f: Facts): ProAction[] {
  const c = cairo(f.now), today = c.ymd, timed = timedOf(f.snap);
  const want: { spaceId: string; title: string }[] = [];
  for (const p of f.snap.plans) for (const t of p.tasks) if (!t.done && !t.milestone && !t.time && t.due && t.due <= today && t.group !== "Today") want.push({ spaceId: p.spaceId, title: t.title });
  for (const s of f.snap.study) if (s.due) want.push({ spaceId: s.spaceId, title: `Review ${s.due} flashcard${s.due === 1 ? "" : "s"}` });
  const exam = f.snap.spaces.filter((s) => s.examDate && s.examDate >= today && days(today, s.examDate) <= 14).sort((a, b) => a.examDate!.localeCompare(b.examDate!))[0];
  if (exam) want.push({ spaceId: exam.id, title: `Revise for the ${exam.name} exam` });
  const free = freeHours(today, f.slots, timed, mins(c.time));
  return want.slice(0, Math.min(5, free.length)).map((w, i) => ({ type: "time_block" as const, spaceId: w.spaceId, title: w.title, day: today, time: free[i] }));
}

/** Overdue tasks moved to the next day with room (today in the morning, tomorrow later on), at most 5 a sweep. */
export function reschedule(f: Facts): ProAction[] {
  const c = cairo(f.now), to = mins(c.time) < 12 * 60 ? c.ymd : addDays(c.ymd, 1);
  return f.snap.plans.flatMap((p) => p.tasks.filter((t) => !t.done && !t.milestone && t.due && t.due < c.ymd).map((t) => ({ type: "plan_move" as const, spaceId: p.spaceId, taskId: t.id, title: t.title, due: to }))).slice(0, 5);
}

/** A new or moved GUC deadline becomes a task to start two days before (today at the latest), and the deadline itself
 *  marks the timeline. */
export function deadlineTasks(f: Facts): ProAction[] {
  const today = cairo(f.now).ymd, out: ProAction[] = [];
  for (const d of f.deadlines) {
    if (!d.spaceId || dueAt(d.due) < f.now || dueAt(d.due) - f.now > 21 * 864e5) continue;
    const day = cairo(dueAt(d.due)).ymd, plan = f.snap.plans.find((p) => p.spaceId === d.spaceId);
    if (plan?.tasks.some((t) => norm(t.title).includes(norm(d.title).slice(0, 40)))) continue;
    const start = days(today, day) > 2 ? addDays(day, -2) : today;
    out.push({ type: "plan_task", spaceId: d.spaceId, title: `Start: ${d.title}`.slice(0, 160), due: start });
    out.push({ type: "plan_task", spaceId: d.spaceId, title: d.title.slice(0, 160), due: day, milestone: true });
  }
  return out;
}

/** An exam date 4-60 days away pulls revision sessions back from it: one every two days over the last two weeks
 *  (fewer when it is closer), skipped when the plan already has them. */
export function revisionPlans(f: Facts): ProAction[] {
  const today = cairo(f.now).ymd, out: ProAction[] = [];
  for (const s of f.snap.spaces) {
    if (s.kind !== "subject" || !s.examDate) continue;
    const left = days(today, s.examDate);
    if (left < 4 || left > 60) continue;
    if (f.snap.plans.find((p) => p.spaceId === s.id)?.tasks.some((t) => t.group === "Before the exam")) continue;
    const weak = f.snap.study.find((x) => x.spaceId === s.id)?.weak || [];
    const sessions: { day: string; title: string }[] = [];
    for (let back = Math.min(14, left - 1), n = 1; back >= 1; back -= 2, n++) sessions.push({ day: addDays(s.examDate, -back), title: weak[n - 1] ? `Revise: ${weak[n - 1]}`.slice(0, 160) : `Revision session ${n}` });
    sessions.push({ day: addDays(s.examDate, -1), title: "Light review and rest" });
    out.push({ type: "revision_plan", spaceId: s.id, examDate: s.examDate, sessions: sessions.filter((x, i, a) => a.findIndex((y) => y.day === x.day) === i).slice(0, 30) });
  }
  return out;
}

/** A loose upload whose name carries one subject's course code, or one subject's or project's name, is filed there. */
export function fileLoose(snap: Snapshot): { actions: ProAction[]; unsure: Snapshot["loose"] } {
  const actions: ProAction[] = [], unsure: Snapshot["loose"] = [];
  for (const f of snap.loose) {
    const n = norm(f.name), squash = n.replace(/\s+/g, "");
    const hits = snap.spaces.filter((s) => (s.code && squash.includes(norm(s.code).replace(/\s+/g, ""))) || (norm(s.name).length >= 4 && ` ${n} `.includes(` ${norm(s.name)} `)));
    if (hits.length === 1) actions.push({ type: "file_move", fileId: f.id, name: f.name, spaceId: hits[0].id });
    else unsure.push(f);
  }
  return { actions, unsure };
}

/** A grade: a cheer, or, when the subject has shaky cards, an offer to review them. */
export function gradeNotes(f: Facts): ProAction[] {
  return f.events.filter((e) => e.kind === "new_grade").map((e) => {
    const weak = f.snap.study.find((s) => s.spaceId === e.subjectId)?.weak.length || 0;
    const what = e.title.replace(/^Grade out:\s*/, "");
    return { type: "note" as const, kind: "grade" as const, key: "grade:" + e.key, ...(e.subjectId ? { spaceId: e.subjectId } : {}),
      text: weak ? `Your ${what} grade is out (${e.detail.split(" · ").pop()}). ${weak} card${weak === 1 ? " is" : "s are"} still shaky: a 10-minute review would help.` : `Your ${what} grade is out (${e.detail.split(" · ").pop()}). Nice work!` };
  });
}

/** A project quiet for 5+ days with open tasks, or with a failed thread: a nudge with its next step. Weekly key. */
export function projectNudges(f: Facts): ProAction[] {
  const week = cairo(f.now).ymd.slice(0, 8), out: ProAction[] = [];
  for (const s of f.snap.spaces.filter((x) => x.kind === "project")) {
    const room = f.snap.rooms.find((r) => r.spaceId === s.id), plan = f.snap.plans.find((p) => p.spaceId === s.id);
    const next = plan?.tasks.filter((t) => !t.done && !t.milestone).sort((a, b) => (a.due || "9").localeCompare(b.due || "9"))[0];
    const quiet = room?.last ? Math.floor((f.now - room.last) / 864e5) : undefined;
    if (room?.failed) out.push({ type: "note", kind: "project", spaceId: s.id, key: `project:${s.id}:failed:${room.failed}`, text: `A thread in ${s.name} stopped with an error. Open the project to retry it${next ? `, then: ${next.title}` : ""}.` });
    else if (next && quiet !== undefined && quiet >= 5) out.push({ type: "note", kind: "project", spaceId: s.id, key: `project:${s.id}:${week}`, text: `${s.name} has been quiet for ${quiet} days. Next step: ${next.title}${next.due ? ` (due ${next.due})` : ""}.` });
  }
  return out;
}

/** The same request on 3+ different days, with no routine for it: offer one (made after a tap). */
export function repeatedRequests(snap: Snapshot): ProAction[] {
  const groups = new Map<string, { text: string; days: Set<string>; hours: number[] }>();
  for (const m of snap.said) {
    const k = norm(m.text).split(" ").filter((w) => w.length > 2).slice(0, 8).join(" ");
    if (k.split(" ").length < 3) continue;
    const g = groups.get(k) || { text: m.text.trim(), days: new Set(), hours: [] };
    g.days.add(cairo(m.at).ymd); g.hours.push(mins(cairo(m.at).time));
    groups.set(k, g);
  }
  const have = new Set(snap.automations.map((a) => norm(a.prompt)));
  return [...groups.values()].filter((g) => g.days.size >= 3 && !have.has(norm(g.text))).slice(0, 1).map((g) => {
    const at = g.hours.sort((a, b) => a - b)[Math.floor(g.hours.length / 2)];
    return { type: "automation" as const, name: g.text.slice(0, 60), prompt: g.text.slice(0, 600), schedule: "daily" as const, time: hhmm(Math.floor(at / 30) * 30) };
  });
}

/** Follow-ups: a commitment whose day has come (or, without a day, one made 2+ days ago). */
export function followUps(f: Facts): ProAction[] {
  const today = cairo(f.now).ymd;
  return extractCommitments(f.snap.said.filter((m) => m.main)).filter((c) => (c.day ? c.day <= today : f.now - c.at > 2 * 864e5) && f.now - c.at < 10 * 864e5)
    .slice(0, 3).map((c) => ({ type: "note" as const, kind: "followup" as const, key: c.key, text: `You said you'd ${c.text}. Done, or should I put it in your plan?` }));
}

/** Clashes between this week's classes and timed plan items, said once each. */
export function clashNotes(f: Facts): ProAction[] {
  return findClashes(f.slots, timedOf(f.snap)).map((c) => ({ type: "note" as const, kind: "clash" as const, key: c.key, text: `${c.slot.title} on ${new Date(c.slot.day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })} at ${c.slot.start} clashes with “${c.item.title}”${c.item.space ? ` (${c.item.space})` : ""}.` }));
}

/** New lectures (CMS files) for linked subjects: cards with Summarize and Make flashcards. Nothing is read or made. */
export const lectures = (events: Change[]) => {
  const seen = new Set<string>();
  return events.filter((e) => (e.kind === "new_material" || e.kind === "file_saved") && e.subjectId && e.materialId && !seen.has(e.materialId) && seen.add(e.materialId))
    .map((e) => ({ key: "lecture:" + e.materialId, subjectId: e.subjectId!, materialId: e.materialId!, title: e.title.replace(/^New in [^:]+:\s*/, ""), saved: e.kind === "file_saved" }));
};

/** A cancelled class in the coming week frees its slot: the next open task (the subject's first) goes there. */
export function freedSlots(f: Facts): ProAction[] {
  const today = cairo(f.now).ymd, out: ProAction[] = [];
  for (const c of f.events) {
    if (c.kind !== "slot_cancelled" || !c.day || !c.start || c.day < today || days(today, c.day) > 7) continue;
    const plans = [...f.snap.plans].sort((a, b) => (a.spaceId === c.subjectId ? -1 : b.spaceId === c.subjectId ? 1 : 0));
    const plan = plans.find((p) => p.tasks.some((t) => !t.done && !t.milestone && !t.time)), task = plan?.tasks.find((t) => !t.done && !t.milestone && !t.time);
    const spaceId = plan?.spaceId || c.subjectId;
    if (!spaceId) continue;
    out.push({ type: "time_block", spaceId, title: `Free slot (${c.title.replace(/ is cancelled$/, " cancelled")}): ${task ? task.title : "review " + (nameOf(f.snap, spaceId) || "your notes")}`.slice(0, 160), day: c.day, time: c.start });
  }
  return out;
}
