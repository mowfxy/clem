// The AI reads a course's new announcements and week notes and keeps its deadlines (docs/GUC-VPS-ENGINE.md →
// Deadlines). It is given the person's own classes for that course and a calendar of GUC weeks, so "the second
// tutorial of the week starting Saturday 7 November" becomes their actual tutorial, on its date, at its time. It sees
// the deadlines already tracked and returns what changes: new ones, moved ones (by id), and ones cancelled. Only texts
// it hasn't read are sent, and only recent ones: the course's old history is never fed to it. The rule reader
// (deadlines.ts) stands in when no model is set up.
import { z } from "zod";
import { sameCode } from "./codes.ts";
import { cairoInstant, dueText } from "./deadlines.ts";
import { addDays, cairo, TZ } from "./hub.ts";
import { stableId, weekDay } from "./parse.ts";
import type { GucCourse, GucCoursePage, GucDeadline, GucSlot } from "./types.ts";

/** A text from a course page the reader can be given: `id` is stable for the same words in the same place. */
export type CourseText = { id: string; source: "announcement" | "week"; label: string; text: string };
/** Week notes older than this (by their week's date) are history, not news. */
const RECENT_DAYS = 21;

/** The course page's texts worth reading: the course's announcement box, and the announcements and notes of weeks from
 *  the last three weeks on (or the three newest weeks when they carry no dates). Empty texts are left out. */
export function courseTexts(page: GucCoursePage, now: number): CourseText[] {
  const today = cairo(now).ymd, from = addDays(today, -RECENT_DAYS);
  const dated = page.weeks.every((w) => weekDay(w.title));
  const recent = new Set(page.weeks.filter((w, i) => (dated ? weekDay(w.title)! >= from : i < 3)).map((w) => w.title));
  const out: CourseText[] = [];
  for (const a of page.announcements) {
    if (a.scope === "week" && !recent.has(a.week || "")) continue;
    out.push({ id: a.id, source: "announcement", label: a.scope === "week" ? `Announcement, ${a.week}` : "Course announcement", text: a.text });
  }
  for (const w of page.weeks) if (recent.has(w.title) && w.description.trim())
    out.push({ id: stableId(page.courseKey + "|wd|" + w.title + "|" + w.description), source: "week", label: `Notes, ${w.title}`, text: w.description });
  return out.filter((t) => t.text.trim().length > 3);
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayName = (ymd: string) => DAY[new Date(ymd + "T12:00:00Z").getUTCDay()];
const short = (ymd: string) => `${dayName(ymd).slice(0, 3)} ${Number(ymd.slice(8))} ${MON[Number(ymd.slice(5, 7)) - 1]}`;
const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

export type ReaderInput = { course: Pick<GucCourse, "key" | "code" | "name">; slots: GucSlot[]; texts: CourseText[]; tracked: GucDeadline[]; now: number };

/** What the model is asked: the date, a calendar of GUC weeks, the person's classes in this course, the deadlines
 *  already tracked, and the new texts. It answers with JSON only. */
export function readerPrompt(i: ReaderInput) {
  const today = cairo(i.now).ymd;
  // GUC weeks run Saturday to Thursday; the calendar spans three weeks back to ten ahead, so no date is worked out by hand.
  const sat = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 1) % 7));
  const weeks = Array.from({ length: 14 }, (_, k) => { const s = addDays(sat, (k - 3) * 7); return `- Week starting ${short(s)} ${s.slice(0, 4)}: ` + Array.from({ length: 6 }, (_, d) => short(addDays(s, d))).join(", "); }).join("\n");
  const mine = i.slots.filter((s) => sameCode(s.code, i.course.code));
  const classes = mine.length ? mine.map((s) => `- ${s.type || "Class"}: ${s.day}, ${ORD[s.period - 1] || s.period + "th"} slot ${s.start}–${s.end}${s.group ? `, group ${s.group}` : ""}${s.location ? `, ${s.location}` : ""}`).join("\n") : "- (not on their schedule)";
  const tracked = i.tracked.length ? i.tracked.map((d) => `- id ${d.id}: ${d.title} · ${dueText(d.due)}${d.note ? ` · from "${d.note.slice(0, 160)}"` : ""}`).join("\n") : "- (none yet)";
  let budget = 14000;
  const texts = i.texts.map((t) => { const body = t.text.slice(0, Math.max(0, Math.min(2500, budget))); budget -= body.length; return body ? `[${t.id}] ${t.label}:\n${body}` : ""; }).filter(Boolean).join("\n\n");
  const system = `You keep a GUC student's deadlines for one course, reading its new CMS posts. Times are Cairo (${TZ}). Answer with JSON only, no prose.
A deadline is something the student must hand in, sit or attend for marks: quizzes, assignments and submissions, in-class assignments and evaluations, lab reports, projects and milestones, presentations, midterms and finals. Not lectures, office hours or general news.
- Resolve every date with the calendar and the student's classes below. "During the second tutorial of the week starting Saturday 7 November" is that week's second tutorial of THEIR schedule: its date and its start time. "In your lab" is their lab slot. When the post gives a time ("3:30-5:15"), use the start; GUC classes run 08:15–22:30, so 3:30 means 15:30.
- A date with no year is in the current academic year. A weekday that doesn't match the date means the text is left over from an earlier year: skip it.
- Skip anything already past by more than a day, and anything you can't date.
- Name each one shortly and specifically: "Quiz 2", "Assignment 3", "In-class assignment 3", "Lab 4 report", "Project milestone 2", "Midterm". Never a sentence.
- If a post moves or corrects a tracked deadline, return it with that id and the new date. If a post cancels one, list its id in "cancel". Don't repeat a tracked deadline that nothing changed.
- "quote" is the post's own words that say it (under 200 characters).
Reply: {"deadlines":[{"id":"<tracked id, only when it is one>","title":"Quiz 2","due":"YYYY-MM-DD HH:MM","timeKnown":true|false,"from":"<text id>","quote":"..."}],"cancel":["<tracked id>"]}. With nothing new: {"deadlines":[],"cancel":[]}.`;
  const user = `Today: ${dayName(today)} ${today}.
Course: ${i.course.code} ${i.course.name}.
GUC weeks (Saturday to Thursday):
${weeks}
The student's classes in this course each week:
${classes}
Deadlines already tracked:
${tracked}

New posts:
${texts}`;
  return { system, user };
}

const item = z.object({
    id: z.string().max(40).optional().nullable(),
    title: z.string().trim().min(1).max(200),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:[ T](\d{2}):(\d{2}))?/),
    timeKnown: z.boolean().optional(),
    from: z.string().max(40).optional().nullable(),
    quote: z.string().max(1000).optional().nullable(),
  }).passthrough();
const reply = z.object({ deadlines: z.array(z.unknown()).max(40), cancel: z.array(z.string().max(40)).max(40).optional() }).passthrough();

/** The course's deadlines after the model's answer: tracked ones it moved or cancelled change, new ones join. Null when
 *  the answer isn't the JSON asked for (the caller falls back). Dates further than a month back or 200 days ahead, and
 *  titles that are sentences, are left out. */
export function applyReader(json: unknown, i: ReaderInput): GucDeadline[] | null {
  const r = reply.safeParse(json);
  if (!r.success) return null;
  // One malformed item is skipped; an answer with nothing usable in it is no answer.
  const items = r.data.deadlines.flatMap((x) => { const p = item.safeParse(x); return p.success ? [p.data] : []; });
  if (r.data.deadlines.length && !items.length && !r.data.cancel?.length) return null;
  const byId = new Map(i.tracked.map((d) => [d.id, d])), texts = new Map(i.texts.map((t) => [t.id, t]));
  for (const id of r.data.cancel || []) byId.delete(id);
  for (const d of items) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(d.due)!;
    const timed = !!m[4] && d.timeKnown !== false;
    const due = cairoInstant(+m[1], +m[2], +m[3], timed ? +m[4] : 23, timed ? +m[5] : 59);
    if (!Number.isFinite(due) || due < i.now - 30 * 864e5 || due > i.now + 200 * 864e5) continue;
    const title = d.title.replace(/[.\s]+$/, "");
    if (title.length > 80 || title.split(/\s+/).length > 8) continue;
    const was = d.id ? byId.get(d.id) : undefined;
    const id = was?.id || stableId(i.course.key + "|n|" + title.toLowerCase());
    const from = d.from ? texts.get(d.from) : undefined;
    const note = (d.quote || "").trim() || from?.text.slice(0, 200) || was?.note;
    byId.set(id, { id, courseKey: i.course.key, title, due: new Date(due).toISOString(), source: from?.source || was?.source || "announcement", ...(note ? { note: note.slice(0, 280) } : {}) });
  }
  return [...byId.values()].sort((a, b) => a.due.localeCompare(b.due));
}
