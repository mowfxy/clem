// Snapshot diff → events. A course, the grades or the schedule seen for the first time is a baseline, not news.
import { sameCode } from "./codes.ts";
import { stableId } from "./parse.ts";
import type { GucEvent, GucSnapshot } from "./types.ts";

export type Seen = { courses: string[]; grades: boolean; schedule: boolean };
const short = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export const scheduleHash = (s: GucSnapshot) => stableId(s.slots.map((x) => [x.day, x.period, x.code, x.type, x.group, x.location].join("|")).sort().join("\n"));

export function diffSnapshots(prev: GucSnapshot, next: GucSnapshot, seen: Seen): GucEvent[] {
  const events: GucEvent[] = [], known = new Set(seen.courses);
  const names = new Map(next.courses.map((c) => [c.key, c.code ? `${c.code} ${c.name}` : c.name]));
  const course = (key: string) => names.get(key) || "a course";

  const oldAnn = new Set(prev.announcements.map((a) => a.id));
  for (const a of next.announcements) if (known.has(a.courseKey) && !oldAnn.has(a.id))
    events.push({ kind: "new_announcement", key: "ann:" + a.id, courseKey: a.courseKey, title: `New announcement in ${course(a.courseKey)}`, detail: short(a.text) });

  const oldMat = new Set(prev.materials.map((m) => m.id));
  for (const m of next.materials) if (known.has(m.courseKey) && !oldMat.has(m.id))
    events.push({ kind: "new_material", key: "mat:" + m.id, courseKey: m.courseKey, title: `New in ${course(m.courseKey)}: ${m.title}`, detail: [m.kind, m.week].filter(Boolean).join(" · ") });

  const oldDl = new Map(prev.deadlines.map((d) => [d.id, d]));
  for (const d of next.deadlines) {
    if (!known.has(d.courseKey)) continue;
    const was = oldDl.get(d.id);
    if (!was) events.push({ kind: "deadline_added", key: "dl:" + d.id, courseKey: d.courseKey, title: `Deadline in ${course(d.courseKey)}`, detail: `${short(d.title)} · ${d.due}` });
    else if (was.due !== d.due) events.push({ kind: "deadline_changed", key: `dl:${d.id}:${d.due}`, courseKey: d.courseKey, title: `Deadline moved in ${course(d.courseKey)}`, detail: `${short(d.title)} · ${was.due} → ${d.due}` });
  }

  if (seen.grades) {
    const oldGrades = new Map(prev.grades.map((g) => [g.id, g]));
    for (const g of next.grades) {
      const mark = g.letter || (g.numeric ?? "");
      if (mark === "") continue;
      const was = oldGrades.get(g.id), before = was ? was.letter || (was.numeric ?? "") : "";
      // A grade belongs to the newest course with its code, so it reaches that course's subject.
      const courseKey = g.code ? next.courses.filter((c) => sameCode(c.code, g.code)).sort((a, b) => b.seasonId - a.seasonId)[0]?.key : undefined;
      if (String(before) !== String(mark)) events.push({ kind: "new_grade", key: `grade:${g.id}:${mark}`, ...(courseKey ? { courseKey } : {}), title: `Grade out: ${g.code || g.name}`, detail: `${g.name} · ${mark} (${g.semester})` });
    }
  }

  if (seen.schedule && next.slots.length) {
    const before = scheduleHash(prev), after = scheduleHash(next);
    if (before !== after) events.push({ kind: "schedule_changed", key: "sched:" + after, title: "Your schedule changed", detail: `${next.slots.length} classes this week` });
  }
  return events;
}

/** Courses of the newest term that weren't in the last snapshot and no subject is linked to: a new semester. The first
 *  sync is a baseline and finds none. */
export function newCourses(prev: GucSnapshot, next: GucSnapshot, linked: Set<string>): GucEvent[] {
  if (!prev.courses.length) return [];
  const before = new Set(prev.courses.map((c) => c.key)), latest = Math.max(0, ...next.courses.map((c) => c.seasonId));
  return next.courses.filter((c) => c.active && c.seasonId === latest && !before.has(c.key) && !linked.has(c.key))
    .map((c) => ({ kind: "new_course", key: "course:" + c.key, courseKey: c.key, title: c.code ? `${c.code} ${c.name}` : c.name, detail: c.season }));
}
