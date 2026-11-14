// The AI reads a course's new announcements and week notes and keeps its deadlines (docs/GUC-VPS-ENGINE.md →
// Deadlines). It is given the person's own classes for that course and a calendar of GUC weeks, so "the second
// tutorial of the week starting Saturday 7 November" becomes their actual tutorial, on its date, at its time. It sees
// the deadlines already tracked and returns what changes: new ones, moved ones (by id), and ones cancelled. Only texts
// it hasn't read are sent, and only recent ones: the course's old history is never fed to it. The rule reader
// (deadlines.ts) stands in when no model is set up.
import { z } from "zod";
import { groupIn, groupWords, sameCode } from "./codes.ts";
import { cairoInstant, dueText, kindOf, myGroups } from "./deadlines.ts";
import { addDays, cairo, examWhen, TZ } from "./hub.ts";
import { mailAbout } from "./mail-about.ts";
import { stableId, weekDay } from "./parse.ts";
import type { GucCourse, GucCoursePage, GucDeadline, GucExam, GucMail, GucSlot } from "./types.ts";

/** A text from a course page the reader can be given: `id` is stable for the same words in the same place. */
export type CourseText = { id: string; source: "announcement" | "week" | "mail" | "file"; label: string; text: string };
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

/** A course mail's subject without the system's wrapping: "[EXTERNAL EMAIL] - Notification System: CSEN301 Quiz 2
 *  [Group: Winter 2026 - CSEN 301 - 3MIET2 (Lecture)]" → "CSEN301 Quiz 2". */
export const mailSubject = (subject: string) => subject.replace(/\[\s*external email\s*\]\s*-?\s*/i, "").replace(/^\s*notification system\s*:\s*/i, "").replace(/\s*\[group:[^\]]*\]\s*/i, " ").replace(/\s+/g, " ").trim();
/** Mail about one of the student's courses (mail-about.ts) from the last three weeks, as texts for that course's
 *  reader. Mail sent to everybody never is. */
export function mailTexts(mail: GucMail[], course: Pick<GucCourse, "key">, o: { courses: GucCourse[]; username?: string; now: number }): CourseText[] {
  const from = o.now - RECENT_DAYS * 864e5;
  return mail.filter((m) => Date.parse(m.received) >= from).flatMap((m) => {
    const a = mailAbout(m, o);
    if (a.about !== "course" || a.courseKey !== course.key) return [];
    const text = (m.text || m.preview || "").trim();
    return text.length > 3 ? [{ id: stableId("mail|" + m.id), source: "mail" as const, label: "Email: " + mailSubject(m.subject), text }] : [];
  });
}

// ---------- Seating plans and schedules uploaded as files ----------
/** A CMS file worth reading for Coming up: a seating plan or an assessment's schedule or rooms ("Quiz 2 seating plan",
 *  "Midterm schedule", "Room distribution", "Quiz 2 rooms", "In-class assignment schedule"). Solutions, samples,
 *  slides and sheets never are: Clem doesn't read files on its own, and this is the one narrow exception. */
const SEATING = /\bseat(?:s|ing)?\b|\bseat\s*plan\b|\b(?:rooms?|halls?|venues?|seats?)\s+(?:distribution|allocation|assignment|plan|list)s?\b|\b(?:quiz(?:zes)?|midterms?|finals?|exams?|tests?|in[- ]?class(?:\s+(?:assignments?|quiz(?:zes)?|evaluations?))?|evaluations?|assessments?)\b(?:\s+[\w#.-]+){0,3}?\s+(?:schedules?|timetables?|rooms?|halls?|locations?|venues?|distribution|allocation|places)\b/i;
const NOT_SEATING = /\b(?:solutions?|sample|model\s+answers?|answers?|answer\s+key|key|slides?|lectures?|sheets?|practice|revision|review|notes?|syllabus|tutorial\s+\d+)\b/i;
export function isSeatingFile(title: string, fileName = "") {
  const t = `${title} ${fileName.replace(/\.[a-z0-9]{1,5}$/i, "")}`.replace(/[_]+/g, " ");
  return SEATING.test(t) && !NOT_SEATING.test(t);
}
/** A seating plan's or schedule's text for the reader: its first ~1,500 characters (headings, header row), every line
 *  naming one of the student's groups or their sign-in name or student id, then other heading-like lines; about 4,000
 *  characters in all. */
export function fileText(text: string, o: { slots: GucSlot[]; username?: string }) {
  const groups = myGroups(o.slots), user = (o.username || "").replace(/^.*\\/, "").replace(/@.*$/, "").toLowerCase();
  const ids = [...new Set([user, ...(o.username || "").match(/\d{2}-\d{3,6}/g) || []].filter((x) => x.length >= 4))];
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const mine = (l: string) => groups.some((g) => groupIn(l, g)) || ids.some((x) => l.toLowerCase().includes(x));
  const out: string[] = [];
  let size = 0;
  const add = (l: string) => { if (size + l.length + 1 > 4000) return false; out.push(l); size += l.length + 1; return true; };
  let k = 0;
  for (; k < lines.length && size + lines[k].length < 1500; k++) add(lines[k]);
  const rest = lines.slice(k);
  for (const l of rest) if (mine(l) && !add(l)) break;
  if (rest.some((l) => !mine(l))) add("(…other groups' rows not shown)");
  return out.join("\n");
}

/** A long post cut to `max` characters without losing what matters: its sentences, a table's header row and the rows
 *  naming the student's groups, then other rows while there is room. */
export function fitText(text: string, slots: GucSlot[], max: number) {
  if (text.length <= max) return text;
  const groups = myGroups(slots), lines = text.split("\n");
  const keep = lines.map((l, i) => !l.includes(" · ") || (i > 0 && !lines[i - 1].includes(" · ")) || groups.some((g) => groupIn(l, g)));
  const kept = lines.filter((_, i) => keep[i]).join("\n");
  if (kept.length > max) return kept.slice(0, max);
  let size = kept.length;
  for (let i = 0; i < lines.length; i++) if (!keep[i] && size + lines[i].length + 1 <= max) { keep[i] = true; size += lines[i].length + 1; }
  return lines.filter((_, i) => keep[i]).join("\n") + (keep.every(Boolean) ? "" : "\n(…more rows not shown)");
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayName = (ymd: string) => DAY[new Date(ymd + "T12:00:00Z").getUTCDay()];
const short = (ymd: string) => `${dayName(ymd).slice(0, 3)} ${Number(ymd.slice(8))} ${MON[Number(ymd.slice(5, 7)) - 1]}`;
const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

export type ReaderInput = { course: Pick<GucCourse, "key" | "code" | "name">; slots: GucSlot[]; texts: CourseText[]; tracked: GucDeadline[]; now: number; /** The portal's exam seats for this course, so a midterm isn't added twice. */ exams?: GucExam[] };
/** Characters of one text, and of all of them, the model is given. */
export const TEXT_BUDGET = 6000, TOTAL_BUDGET = 24000;

/** What the model is asked: the date, a calendar of GUC weeks, the person's classes in this course, the deadlines
 *  already tracked, and the new texts. It answers with JSON only. */
export function readerPrompt(i: ReaderInput) {
  const today = cairo(i.now).ymd;
  // GUC weeks run Saturday to Thursday; the calendar spans three weeks back to ten ahead, so no date is worked out by hand.
  const sat = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 1) % 7));
  const weeks = Array.from({ length: 14 }, (_, k) => { const s = addDays(sat, (k - 3) * 7); return `- Week starting ${short(s)} ${s.slice(0, 4)}: ` + Array.from({ length: 6 }, (_, d) => short(addDays(s, d))).join(", "); }).join("\n");
  const mine = i.slots.filter((s) => sameCode(s.code, i.course.code));
  const classes = mine.length ? mine.map((s) => `- ${s.type || "Class"}: ${s.day}, ${ORD[s.period - 1] || s.period + "th"} slot ${s.start}–${s.end}${s.group ? `, group ${s.group}` : ""}${s.location ? `, ${s.location}` : ""}`).join("\n") : "- (not on their schedule)";
  const groups = myGroups(mine), groupLine = groups.length ? groups.map((g) => `${groupWords(g)} (${g.label})`).join(", ") : "(not known)";
  const tracked = i.tracked.length ? i.tracked.map((d) => `- id ${d.id}: ${d.title} · ${dueText(d.due)}${d.place ? ` · ${d.place}` : ""}${d.either ? ` · ${d.either}` : ""}${d.note ? ` · from "${d.note.slice(0, 160)}"` : ""}`).join("\n") : "- (none yet)";
  const exams = (i.exams || []).map((e) => { const w = examWhen(e); return w ? `- ${e.type || "Exam"} on ${dueText(w.start)}, ${[e.hall, e.seat && "seat " + e.seat].filter(Boolean).join(", ")}` : ""; }).filter(Boolean);
  let budget = TOTAL_BUDGET;
  const texts = i.texts.map((t) => { const body = fitText(t.text, mine, Math.max(0, Math.min(TEXT_BUDGET, budget))); budget -= body.length; return body ? `[${t.id}] ${t.label}:\n${body}` : ""; }).filter(Boolean).join("\n\n");
  const system = `You keep a GUC student's deadlines for one course, reading its new CMS posts. Times are Cairo (${TZ}). Answer with JSON only, no prose.
A deadline is something the student must hand in, sit or attend for marks: quizzes, assignments and submissions, in-class assignments and evaluations, lab reports, projects and milestones, presentations, midterms and finals. Not lectures, office hours or general news.
- Resolve every date with the calendar and the student's classes below. "During the second tutorial of the week starting Saturday 7 November" is that week's second tutorial of THEIR schedule: its date, start time and room. "The tutorial of week 14/11-19/11" and "the tutorial starting next week" are their own tutorial that week. "In your lab" is their lab slot. "The last 40 minutes" of a 90-minute slot starts 50 minutes in. When the post gives a time ("3:30-5:15"), use the start; GUC classes run 08:15–22:30, so 3:30 means 15:30.
- Groups: a table row is theirs when it names their group. "T13 - T17" and "T11,T12,T14" both include T14. Take that row's date, time and room ("place").
- When a post gives several days by group and their group is not in it, or there is no table yet, still return the item: the earliest day, "timeKnown": false, and "either" naming the days ("Monday or Tuesday, by tutorial group"). Never skip it.
- The exam seats below are already known: don't return those exams again.
- A date with no year is in the current academic year. A weekday that doesn't match the date ("Tuesday November 18th" when the 18th is a Wednesday) is a slip in the post: use the earlier of the two days and say so in "doubt" (one short sentence).
- Skip anything already past by more than a day, and anything you can't date.
- Name each one shortly and specifically: "Quiz 2", "Assignment 3", "In-class assignment 3", "Lab 4 report", "Project milestone 2", "Midterm". Never a sentence.
- If a post moves or corrects a tracked deadline, return it with that id and the new date. If a post cancels one, list its id in "cancel". Don't repeat a tracked deadline that nothing changed.
- "quote" is the post's own words that say it (under 200 characters). "covers" is what it covers when the post says (under 120 characters: "Stewart 16.1–16.3, lectures 10–12, worksheets 5–6"). "kind" is one of quiz, exam, assignment, in-class, lab, project, presentation, other. "place" is the room or hall, only when written.
- A post and an email about the same item are one item: return it once (with the tracked id when it is tracked).
- A "File:" text is a seating plan or schedule uploaded to the course. It updates the matching tracked item (its id) with the hall or room ("place"; add the seat when the student's own row is there) and the time, rather than adding a new item. Add one only when the file clearly announces a sitting that is not tracked.
Reply: {"deadlines":[{"id":"<tracked id, only when it is one>","title":"Quiz 2","kind":"quiz","due":"YYYY-MM-DD HH:MM","timeKnown":true|false,"place":"<room>","covers":"<what it covers>","either":"<only when the day depends on the group>","from":"<text id>","quote":"...","doubt":"<only when the post contradicts itself>"}],"cancel":["<tracked id>"]}. With nothing new: {"deadlines":[],"cancel":[]}.`;
  const user = `Today: ${dayName(today)} ${today}.
Course: ${i.course.code} ${i.course.name}.
GUC weeks (Saturday to Thursday):
${weeks}
The student's classes in this course each week:
${classes}
Their groups: ${groupLine}.
${exams.length ? `Exam seats the portal already lists:\n${exams.join("\n")}\n` : ""}Deadlines already tracked:
${tracked}

New posts and emails:
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
    doubt: z.string().max(300).optional().nullable(),
    kind: z.string().max(20).optional().nullable(),
    place: z.string().max(80).optional().nullable(),
    covers: z.string().max(300).optional().nullable(),
    either: z.string().max(120).optional().nullable(),
  }).passthrough();
const KINDS = new Set(["quiz", "exam", "assignment", "in-class", "lab", "project", "presentation", "other"]);
/** "Quiz 2", "CSEN 301 quiz #2", "Second quiz" → "quiz|2": one item whoever wrote it and however. */
const ORDS: Record<string, string> = { first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8" };
export function itemKey(title: string, kind?: string) {
  const t = title.toLowerCase().replace(/\b[a-z]{2,5}\s?\d{3}[a-z]?\b/g, " ").replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth)\b/g, (w) => ORDS[w]);
  const n = /(\d{1,2})/.exec(t)?.[1];
  return n ? `${kind || kindOf(title)}|${Number(n)}` : undefined;
}
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
  const byKey = new Map(i.tracked.flatMap((d) => { const k = itemKey(d.title, d.kind); return k ? [[k, d.id] as const] : []; }));
  for (const id of r.data.cancel || []) byId.delete(id);
  for (const d of items) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(d.due)!;
    const timed = !!m[4] && d.timeKnown !== false;
    const due = cairoInstant(+m[1], +m[2], +m[3], timed ? +m[4] : 23, timed ? +m[5] : 59);
    if (!Number.isFinite(due) || due < i.now - 30 * 864e5 || due > i.now + 200 * 864e5) continue;
    const title = d.title.replace(/[.\s]+$/, "");
    if (title.length > 80 || title.split(/\s+/).length > 8) continue;
    const kind = d.kind && KINDS.has(d.kind.toLowerCase()) ? d.kind.toLowerCase() : kindOf(title), key = itemKey(title, kind);
    // The same quiz from a post and a mail, or named twice: one item (the tracked one when there is one).
    const was = (d.id ? byId.get(d.id) : undefined) || (key && byKey.get(key) ? byId.get(byKey.get(key)!) : undefined);
    const id = was?.id || stableId(i.course.key + "|n|" + title.toLowerCase());
    if (key) byKey.set(key, id);
    const from = d.from ? texts.get(d.from) : undefined;
    const doubt = (d.doubt || "").trim().slice(0, 120);
    const said = (d.quote || "").trim() || from?.text.slice(0, 200) || was?.note, note = said && doubt ? said.slice(0, 150) + " " + doubt : said || doubt || undefined;
    const either = (d.either || "").trim().slice(0, 100), place = (d.place || "").trim().slice(0, 60) || (timed ? undefined : was?.place), covers = (d.covers || "").trim().slice(0, 140) || was?.covers;
    byId.set(id, { id, courseKey: i.course.key, title, due: new Date(due).toISOString(), source: from?.source || was?.source || "announcement", ...(note ? { note: note.slice(0, 280) } : {}),
      kind, timeKnown: timed, ...(place ? { place } : {}), ...(covers ? { covers } : {}), ...(either && !timed ? { either } : {}) });
  }
  return [...byId.values()].sort((a, b) => a.due.localeCompare(b.due));
}
