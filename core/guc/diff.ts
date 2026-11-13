// Snapshot diff → events. A course, the grades or the schedule seen for the first time is a baseline, not news.
import { sameCode } from "./codes.ts";
import { mailAbout } from "./mail-about.ts";
import { DEADLINE_VERSION, dueText } from "./deadlines.ts";
import { stableId } from "./parse.ts";
import type { GucEvent, GucSnapshot } from "./types.ts";

/** What was read at least once, so its first read is a baseline. `mailIds`: hashes of every Inbox id seen. */
export type Seen = { courses: string[]; grades: boolean; schedule: boolean; portal?: boolean; exams?: boolean; mailIds?: string[]; /** When each part was last read (ms), for the pulse. */ lastRead?: Record<string, number>; /** The transcript's study years: when each was last read, and the oldest one there is. */ transcript?: { at: Record<string, number>; end?: string }; /** The deadline extractor's version, and the courses whose deadlines it read. */ deadlines?: { v: number; courses: string[]; /** Per course, the ids of the posts the deadline reader has read. */ read?: Record<string, string[]> } };
const short = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export const scheduleHash = (s: GucSnapshot) => stableId(s.slots.map((x) => [x.day, x.period, x.code, x.type, x.group, x.location].join("|")).sort().join("\n"));

/** `username`: the GUC sign-in name, so a mail written to the student alone is told apart from one sent to everybody. */
export function diffSnapshots(prev: GucSnapshot, next: GucSnapshot, seen: Seen, at = Date.now(), o: { username?: string } = {}): GucEvent[] {
  const events: GucEvent[] = [], known = new Set(seen.courses);
  const names = new Map(next.courses.map((c) => [c.key, c.code ? `${c.code} ${c.name}` : c.name]));
  const course = (key: string) => names.get(key) || "a course";
  const code = (key: string) => next.courses.find((c) => c.key === key)?.code || course(key);

  const oldAnn = new Set(prev.announcements.map((a) => a.id));
  for (const a of next.announcements) if (known.has(a.courseKey) && !oldAnn.has(a.id))
    events.push({ kind: "new_announcement", key: "ann:" + a.id, courseKey: a.courseKey, title: `New announcement in ${code(a.courseKey)}`, detail: short(a.text, 1000) });

  const oldMat = new Set(prev.materials.map((m) => m.id));
  for (const m of next.materials) if (known.has(m.courseKey) && !oldMat.has(m.id))
    events.push({ kind: "new_material", key: "mat:" + m.id, courseKey: m.courseKey, title: `New in ${course(m.courseKey)}: ${m.title}`, detail: [m.kind, m.week].filter(Boolean).join(" · ") });

  // Deadlines: only from courses whose deadlines the same extractor read last time (a new extractor is a baseline), and
  // only ones still ahead. Each says what is due and when, and a move says from when to when.
  const sameReader = new Set(seen.deadlines?.v === DEADLINE_VERSION ? seen.deadlines.courses : []);
  const oldDl = new Map(prev.deadlines.map((d) => [d.id, d])), now = at;
  for (const d of next.deadlines) {
    if (!known.has(d.courseKey) || !sameReader.has(d.courseKey) || Date.parse(d.due) < now) continue;
    const was = oldDl.get(d.id), quote = d.note ? ` “${short(d.note, 280)}”` : "";
    if (!was) events.push({ kind: "deadline_added", key: "dl:" + d.id, courseKey: d.courseKey, title: `${code(d.courseKey)} ${d.title}: due ${dueText(d.due)}`, detail: `${course(d.courseKey)}.${quote}` });
    else if (Math.abs(Date.parse(was.due) - Date.parse(d.due)) >= 60_000) events.push({ kind: "deadline_changed", key: `dl:${d.id}:${d.due}`, courseKey: d.courseKey, title: `${code(d.courseKey)} ${d.title} moved to ${dueText(d.due)}`, detail: `Was ${dueText(was.due)}.${quote}` });
  }

  if (seen.grades) {
    const oldGrades = new Map(prev.grades.map((g) => [g.id, g]));
    for (const g of next.grades) {
      const mark = g.letter || (g.numeric ?? "");
      if (mark === "") continue;
      // The transcript is read a study year at a time; a year read for the first time is a baseline, not news.
      if (g.year && !seen.transcript?.at?.[g.year]) continue;
      const was = oldGrades.get(g.id), before = was ? was.letter || (was.numeric ?? "") : "";
      // A grade belongs to the newest course with its code, so it reaches that course's subject.
      const courseKey = g.code ? next.courses.filter((c) => sameCode(c.code, g.code)).sort((a, b) => b.seasonId - a.seasonId)[0]?.key : undefined;
      if (String(before) !== String(mark)) events.push({ kind: "new_grade", key: `grade:${g.id}:${mark}`, ...(courseKey ? { courseKey } : {}), title: `Grade out: ${g.code || g.name}`, detail: `${g.name} · ${mark} (${g.semester})` });
    }
  }

  // This term's grades: a midterm, or a coursework mark, that wasn't there (or changed).
  if (seen.portal) {
    const courseOf = (code: string) => (code ? next.courses.filter((c) => sameCode(c.code, code)).sort((a, b) => b.seasonId - a.seasonId)[0]?.key : undefined);
    const oldMid = new Map((prev.midterms || []).map((m) => [m.id, m.grade]));
    for (const m of next.midterms || []) if (m.grade && oldMid.get(m.id) !== m.grade) {
      const courseKey = courseOf(m.code);
      events.push({ kind: "new_grade", key: `mid:${m.id}:${m.grade}`, ...(courseKey ? { courseKey } : {}), title: `Midterm grade out: ${m.code || m.course}`, detail: `${m.course} · ${m.grade}` });
    }
    const marks = (w: NonNullable<GucSnapshot["coursework"]>[number]) => new Map(w.entries.flatMap((e) => e.elements.map((x) => [`${e.name}|${x.name}`, x.grade] as const)));
    const oldWork = new Map((prev.coursework || []).map((w) => [w.course, marks(w)]));
    for (const w of next.coursework || []) {
      const was = oldWork.get(w.course) || new Map<string, string>(), courseKey = courseOf(w.code);
      for (const [k, grade] of marks(w)) if (grade && was.get(k) !== grade) {
        const [entry, part] = k.split("|");
        events.push({ kind: "new_grade", key: `cw:${stableId(w.course + "|" + k)}:${grade}`, ...(courseKey ? { courseKey } : {}), title: `New mark in ${w.code || w.course}: ${entry}`, detail: `${[entry, part].filter(Boolean).join(" · ")} · ${grade}` });
      }
    }
  }
  if (seen.exams) {
    const old = new Map((prev.exams || []).map((e) => [e.id, `${e.hall}|${e.seat}`]));
    for (const e of next.exams || []) {
      const was = old.get(e.id), now = `${e.hall}|${e.seat}`;
      if (was === now) continue;
      const courseKey = e.code ? next.courses.filter((c) => sameCode(c.code, e.code)).sort((a, b) => b.seasonId - a.seasonId)[0]?.key : undefined;
      events.push({ kind: "exam_posted", key: `exam:${e.id}:${stableId(now)}`, ...(courseKey ? { courseKey } : {}), title: `${was ? "Exam seat changed" : "Exam seat posted"}: ${e.code || e.course}`, detail: `${e.type} · ${[e.day, e.date].filter(Boolean).join(" ")} ${e.start}${e.end ? "–" + e.end : ""} · ${e.hall}${e.seat ? ", seat " + e.seat : ""}` });
    }
  }
  if (seen.mailIds) {
    const known = new Set(seen.mailIds);
    // A new mail is the student's news only when it names a course they take or was written to them (mail-about.ts).
    // One sent to everybody is still an event (key "mail:all:…"), so a watch or routine they asked for can see it, but
    // the organizer never tells it.
    for (const m of next.mail || []) if (!known.has(m.id)) { const a = mailAbout(m, { courses: next.courses, username: o.username });
      events.push({ kind: "new_mail", key: (a.about === "everyone" ? "mail:all:" : "mail:") + m.id, ...(a.about === "course" ? { courseKey: a.courseKey } : {}), title: `Email from ${m.from.replace(/\s*<[^>]+>$/, "")}: ${short(m.subject, 100)}`, detail: short(m.preview || "", 280) }); }
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
