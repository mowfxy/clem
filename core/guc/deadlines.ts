// Deadlines pulled out of announcements and course pages. Each one is named for what it is ("Quiz 2", "In-class
// assignment 3"; never a sentence), dated in Cairo time, and keeps the sentence it came from as its note. Dates are
// read day-first (GUC writes 19/11/2026); words with no date in them ("now", "today") are not dates; a date with no
// year is the one closest to when it was read and never more than a term away; an "a.m./p.m."-less time in a class
// slot ("3:30-5:15") is in the afternoon. A weekday that disagrees with its date ("Tuesday November 18th" on a
// Wednesday) is a slip in the post: the earlier of the two days is kept and the note says so. "The second tutorial of
// the week starting Saturday 7 November" is the person's own second tutorial that week, when their classes are known.
// What is long past or implausibly far off is left out.
import * as chrono from "chrono-node";
import { groupIn, shortGroup } from "./codes.ts";
import { addDays, cairo } from "./hub.ts";
import { stableId } from "./parse.ts";
import type { GucDeadline, GucSlot } from "./types.ts";

/** Bump when extraction changes: the sync re-reads course pages and takes the new deadlines as a baseline, not news. */
export const DEADLINE_VERSION = 5;

const WORDS = /\b(deadlines?|due|submi(?:t|ts|tted|tting|ssions?)|hand(?:ed)?[- ]?in|quiz(?:zes)?|midterms?|final exams?|exams?|assignments?|projects?|milestones?|lab reports?|reports?|presentations?|evaluations?|deliverables?|homeworks?)\b/i;
const MOVED = /\b(postpone[ds]?|moved?|reschedul\w*|delayed|extended|extension|instead|changed?|new date|now (?:on|due))\b/i;
const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, "6th": 6, "7th": 7, "8th": 8, "9th": 9, "10th": 10 };
const ITEM = String.raw`(in[- ]class\s+)?(quiz(?:zes)?|assignments?|projects?|milestones?|lab\s+reports?|labs?|sheets?|homeworks?|hw|reports?|presentations?|deliverables?|evaluations?|midterms?|final\s+exams?|finals?|exams?|tasks?)`;
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)`;
const NUMBERED = new RegExp(String.raw`\b${ITEM}\s*(?:#|no\.?\s*|number\s+)?(\d{1,2})\b(?![\/.:-]\d)(?!\s*(?:st|nd|rd|th)?\s*(?:of\s+)?${MONTH})`, "gi");
const ORDINAL = new RegExp(String.raw`\b(${Object.keys(ORD).join("|")})\s+${ITEM}`, "gi");
const BARE = new RegExp(String.raw`\b${ITEM}\b`, "gi");
const PRONOUN = /^(its|it|this|that|the (?:submission|deadline|due date|date))\b/i;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function label(inClass: string | undefined, word: string) {
  const w = word.toLowerCase().replace(/\s+/g, " ");
  const base = /^(hw|homework)/.test(w) ? "homework" : w.startsWith("quiz") ? "quiz" : w.startsWith("final") ? "final exam" : w.replace(/s$/, "");
  const name = (inClass ? "in-class " : "") + base;
  return name[0].toUpperCase() + name.slice(1);
}
type Named = { name: string; at: number; end: number };
/** Every item a sentence names, where it is: "Quiz 2", "the third in-class assignment", "the midterm". */
function names(sentence: string): Named[] {
  const out: Named[] = [], taken: [number, number][] = [];
  const add = (name: string, m: RegExpExecArray) => { if (taken.some(([a, b]) => m.index < b && m.index + m[0].length > a)) return; taken.push([m.index, m.index + m[0].length]); out.push({ name, at: m.index, end: m.index + m[0].length }); };
  for (const m of sentence.matchAll(ORDINAL)) add(`${label(m[2], m[3])} ${ORD[m[1].toLowerCase()]}`, m as RegExpExecArray);
  for (const m of sentence.matchAll(NUMBERED)) if (Number(m[3]) <= 30) add(`${label(m[1], m[2])} ${Number(m[3])}`, m as RegExpExecArray);
  for (const m of sentence.matchAll(BARE)) if (/midterm|final|project|presentation|evaluation|lab\s+report/i.test(m[2])) add(label(m[1], m[2]), m as RegExpExecArray);
  out.sort((a, b) => a.at - b.at);
  // "Quiz 2/ Assignment 2 will be in …": one sitting with two names.
  for (let k = out.length - 1; k > 0; k--) if (/^\s*\/\s*$/.test(sentence.slice(out[k - 1].end, out[k].at))) out.splice(k - 1, 2, { name: `${out[k - 1].name} / ${out[k].name}`, at: out[k - 1].at, end: out[k].end });
  return out;
}

/** What an item is, from its name: "quiz", "exam", "assignment", "in-class", "lab", "project", "presentation" or "other". */
export function kindOf(name: string) {
  const n = name.toLowerCase();
  return /in-?class/.test(n) ? "in-class" : /quiz/.test(n) ? "quiz" : /midterm|final|exam/.test(n) ? "exam" : /lab/.test(n) ? "lab" : /project|milestone|deliverable/.test(n) ? "project"
    : /presentation/.test(n) ? "presentation" : /assignment|sheet|homework|report|submi|task/.test(n) ? "assignment" : "other";
}
const WD_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Tuesday 17 Nov at 15:45", or "Tuesday 17 Nov" when only the day is known (Cairo). */
export function whenText(due: string, timeKnown = true) {
  const c = cairo(Date.parse(due));
  return `${WD_FULL[c.weekday]} ${Number(c.ymd.slice(8))} ${MON[Number(c.ymd.slice(5, 7)) - 1]}${timeKnown && c.time !== "23:59" ? " at " + c.time : ""}`;
}

/** Cairo wall-clock time as an instant (Egypt has summer time, so the offset is looked up, not assumed). */
export function cairoInstant(y: number, mo: number, d: number, h: number, mi: number) {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let t = want - 2 * 3600e3;
  for (let i = 0; i < 3; i++) {
    const c = cairo(t), shown = Date.UTC(+c.ymd.slice(0, 4), +c.ymd.slice(5, 7) - 1, +c.ymd.slice(8, 10), +c.time.slice(0, 2), +c.time.slice(3, 5));
    if (shown === want) break;
    t += want - shown;
  }
  return t;
}

type Found = { at: number; due: number; timed: boolean; ymd: string; /** The year was written out. */ dated: boolean; /** "Tuesday" written next to a date that is a Wednesday. */ slip?: string; /** One end of a range ("14/11 to 19/11"). */ range?: boolean; /** The room of the class it was resolved to. */ place?: string; /** When it ends, for "the last 40 minutes of the tutorial". */ ends?: number };
const ymdOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** The dates in a sentence with a certain day and month, each in Cairo time. */
function dates(sentence: string, ref: Date): Found[] {
  const out: Found[] = [];
  // "postponed from 22 November to 29 November" is one range: both ends count, and a move takes the last.
  // "(14/11-19/11)" is a range chrono misreads: say it as one.
  const text = sentence.replace(/(\b\d{1,2}\/\d{1,2})\s*[-–]\s*(\d{1,2}\/\d{1,2}\b)/g, "$1 to $2");
  const parts = chrono.en.GB.parse(text, ref).flatMap((r) => (r.end ? [{ r, s: r.start, range: true }, { r, s: r.end, range: true }] : [{ r, s: r.start, range: false }]));
  sentence = text;
  for (const { r, s, range } of parts) {
    // "now", "today", "tomorrow", "the last 40 minutes": when the post was written isn't known, so only a written date
    // (a month, or day/month) counts.
    if (!s.isCertain("day") || !s.isCertain("month") || !/\d/.test(r.text) || /\b(now|today|tonight|tomorrow|yesterday)\b/i.test(r.text)) continue;
    if (!new RegExp(String.raw`\d{1,2}\s*[/.-]\s*\d{1,2}|\b${MONTH}`, "i").test(r.text)) continue;
    let month = s.get("month")!, day = s.get("day")!, year = s.get("year")!, slip: string | undefined;
    const dated = s.isCertain("year");
    if (!dated) {
      // Closest to when it was read.
      const near = (y: number) => Math.abs(Date.UTC(y, month - 1, day) - ref.getTime());
      year = [year - 1, year, year + 1].sort((a, b) => near(a) - near(b))[0];
    }
    {
      // A weekday written next to it that it doesn't fall on: the earlier of the two days, so nothing is missed.
      const before = sentence.slice(Math.max(0, r.index - 14), r.index + r.text.length).toLowerCase();
      // The weekday written nearest before the date ("Mon 30/11 and Tue 1/12": Tue for the 1st).
      const where = DAYS.map((d) => Math.max(-1, ...[...before.matchAll(new RegExp(`\\b${d.slice(0, 3)}(?:${d.slice(3)})?\\b`, "g"))].map((m) => m.index)));
      const said = Math.max(...where) >= 0 ? where.indexOf(Math.max(...where)) : -1;
      const on = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      if (said >= 0 && on !== said) {
        const back = (on - said + 7) % 7;
        slip = `The post says ${WD_LONG[said]}, but ${day} ${MON[month - 1]} is a ${WD_LONG[on]}. Check which one it is.`;
        if (back <= 3) { const d = new Date(Date.UTC(year, month - 1, day - back)); year = d.getUTCFullYear(); month = d.getUTCMonth() + 1; day = d.getUTCDate(); }
      }
    }
    let hour = 23, minute = 59, timed = false;
    const after = sentence.slice(r.index, r.index + r.text.length + 24);
    const clock = s.isCertain("hour") ? { h: s.get("hour")!, m: s.get("minute") || 0, mer: s.isCertain("meridiem") } : (() => {
      const m = /\b(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i.exec(after.slice(r.text.length));
      return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? { h: Number(m[1]) + (/^p/i.test(m[3] || "") && Number(m[1]) < 12 ? 12 : 0), m: Number(m[2]), mer: !!m[3] } : null;
    })();
    if (clock) {
      hour = clock.h; minute = clock.m; timed = true;
      // No a.m./p.m.: a class time, and GUC teaches 08:15–22:30, so 1:00–7:59 is the afternoon.
      if (!clock.mer && hour >= 1 && hour < 8) hour += 12;
    }
    out.push({ at: r.index, due: cairoInstant(year, month, day, hour, minute), timed, ymd: ymdOf(year, month, day), dated, ...(slip ? { slip } : {}), ...(range ? { range } : {}) });
  }
  return out;
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z(])|\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, s.lastIndexOf(" ", n - 1) > n / 2 ? s.lastIndexOf(" ", n - 1) : n - 1).replace(/[\s,;:.-]+$/, "") + "…" : s);
type Ranked = GucDeadline & { rank: number };

/** A deadline the post doesn't name: "Submit the form", else "Submission" or "Deadline". Never the sentence. */
function unnamed(sentence: string) {
  const m = /\b(?:submit|hand(?:ed)?[- ]?in|deliver|upload|fill(?:[- ]in| out)?)\s+((?:(?:your|the|their|a|an|all)\s+)?[a-z][a-z' -]{2,40}?)\s+(?:by|before|on|to|until|till|no later|via|through|is|are)\b/i.exec(sentence);
  const what = m?.[1].trim().replace(/\s+/g, " ");
  if (what && what.split(" ").length <= 4 && !/^(it|them|this|that|these|those)$/i.test(what)) return "Submit " + what.toLowerCase().replace(/^their /, "your ");
  return /\bsubmi|hand(?:ed)?[- ]?in|deliver/i.test(sentence) ? "Submission" : "Deadline";
}

const NTH: Record<string, number> = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, "4th": 3, last: -1 };
const IN_CLASS = new RegExp(String.raw`\b(?:(${Object.keys(NTH).join("|")})\s+)?(tutorial|lab|practical|lecture)s?\s+(?:session\s+)?(?:(?:of|in|during)\s+(?:the\s+)?(?:next\s+)?(?:week\s+)?(?:of|starting|beginning|that\s+starts)?|(?:starting|beginning)\s+(?:from\s+)?(?:the\s+)?(?:next\s+)?week)`, "i");
const GUC_WEEK = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];
/** "During the second tutorial of the week starting Saturday 7 November": that class of the person's own schedule, on
 *  its day at its start time. Null when the sentence isn't about a class of a week, or their classes aren't known. */
function inClass(sentence: string, week: Found, slots: GucSlot[]): Found | null {
  const m = IN_CLASS.exec(sentence);
  if (!m || !slots.length) return null;
  const kind = m[2].toLowerCase(), is = (s: GucSlot) => (kind === "lecture" ? /lec/i : kind === "tutorial" ? /tut/i : /lab|prac/i).test(s.type);
  const mine = slots.filter(is).sort((a, b) => GUC_WEEK.indexOf(a.day.toLowerCase()) - GUC_WEEK.indexOf(b.day.toLowerCase()) || a.period - b.period);
  const slot = m[1] ? mine.at(NTH[m[1].toLowerCase()]) : mine[0];
  if (!slot || GUC_WEEK.indexOf(slot.day.toLowerCase()) < 0) return null;
  // The week's Saturday, on or before the date written.
  const on = new Date(week.ymd + "T12:00:00Z").getUTCDay(), sat = addDays(week.ymd, -((on + 1) % 7));
  const ymd = addDays(sat, GUC_WEEK.indexOf(slot.day.toLowerCase())), t = /^(\d{1,2}):(\d{2})/.exec(slot.start), e = /^(\d{1,2}):(\d{2})/.exec(slot.end);
  const start = cairoInstant(+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10), t ? +t[1] : 23, t ? +t[2] : 59);
  const end = e ? cairoInstant(+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10), +e[1], +e[2]) : undefined;
  // "In the last 40 minutes of the tutorial": 50 minutes into a 90-minute slot; "the first 30 minutes": at its start.
  const part = /\b(last|first)\s+(\d{1,3})\s*min/i.exec(sentence), mins = part ? Number(part[2]) * 60_000 : 0;
  const due = part && /last/i.test(part[1]) && end ? end - mins : start;
  return { ...week, ymd, timed: !!t, due, ...(slot.location ? { place: slot.location } : {}), ...(part && end ? { ends: /last/i.test(part[1]) ? end : start + mins } : end ? { ends: end } : {}) };
}

/** What a post says an item covers: the words after "will cover" / "covers" / "covering", up to the sentence's end. */
const coversIn = (sentence: string) => { const m = /\b(?:will\s+cover|covers|covering|content\s+covered\s+(?:will\s+be|is))\s*:?\s+(.+)$/i.exec(sentence); return m ? cut(m[1].replace(/[.;\s]+$/, ""), 140) : undefined; };
const SITTING = /^(quiz|exam|in-class|lab|presentation)$/;
const dayNames = (ymds: string[]) => { const n = ymds.map((d) => WD_FULL[new Date(d + "T12:00:00Z").getUTCDay()]); return n.length > 1 ? n.slice(0, -1).join(", ") + " or " + n.at(-1) : n[0]; };

/** The student's groups in this course, from their classes: tutorial (T14), lecture (L2) and lab (P14). */
export function myGroups(slots: GucSlot[]) {
  const out = new Map<string, { kind: "T" | "L" | "P"; n: number; label: string }>();
  for (const s of slots) { const g = shortGroup(s.group); if (g) out.set(g.label, g); }
  return [...out.values()];
}
/** A table row ("Date · Time · Tutorial · Location") naming one of the student's groups: its date, time and room. */
function groupRow(text: string, slots: GucSlot[], ref: Date) {
  const groups = myGroups(slots).sort((a, b) => "TPL".indexOf(a.kind) - "TPL".indexOf(b.kind));
  if (!groups.length) return undefined;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(" · ") || !groups.some((g) => groupIn(lines[i], g))) continue;
    let h = i; while (h > 0 && lines[h - 1].includes(" · ")) h--;
    const head = h < i ? lines[h].split(" · ").map((c) => c.toLowerCase()) : [], cells = lines[i].split(" · ");
    const col = (re: RegExp) => { const k = head.findIndex((x) => re.test(x)); return k >= 0 && k < cells.length ? cells[k] : undefined; };
    const dateCell = col(/date|day/) ?? cells.find((c) => /\d{1,2}\s*[./]\s*\d{1,2}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i.test(c));
    if (!dateCell) continue;
    const dm = /(\d{1,2})\s*[./]\s*(\d{1,2})(?:\s*[./]\s*(\d{2,4}))?/.exec(dateCell);
    let ymd: string | undefined;
    if (dm) {
      const day = +dm[1], month = +dm[2], near = (y: number) => Math.abs(Date.UTC(y, month - 1, day) - ref.getTime()), y0 = ref.getUTCFullYear();
      const year = dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : [y0 - 1, y0, y0 + 1].sort((a, b) => near(a) - near(b))[0];
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) ymd = ymdOf(year, month, day);
    } else { const r = chrono.en.GB.parse(dateCell, ref)[0]; if (r?.start.isCertain("day") && r.start.isCertain("month")) ymd = ymdOf(r.start.get("year")!, r.start.get("month")!, r.start.get("day")!); }
    if (!ymd) continue;
    const timeCell = col(/time/) ?? cells.find((c) => /\b\d{1,2}[:.]\d{2}\b/.test(c) && c !== dateCell);
    const t = timeCell && /\b(\d{1,2})[:.](\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i.exec(timeCell);
    let hour = t ? +t[1] : 23;
    if (t && (/^p/i.test(t[3] || "") ? hour < 12 : !t[3] && hour >= 1 && hour < 8)) hour += 12;
    const place = col(/location|hall|room|venue|place/) ?? (head.length ? undefined : cells.at(-1));
    return { ymd, due: cairoInstant(+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10), hour, t ? +t[2] : 59), timed: !!t, place: place && !groups.some((g) => groupIn(place, g)) ? place : undefined };
  }
  return undefined;
}

function fromText(text: string, courseKey: string, source: string, ref: Date, slots: GucSlot[] = []): Ranked[] {
  // "[4/11/2026]: …" at a line's start is when the post was written, not a date in it.
  const out: (Ranked & { at: number })[] = [], list = sentences(text.replace(/^[ \t]*[[(]\s*\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\s*[\])]\s*:?\s*|^[ \t]*\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\s*:\s*/gm, "")), now = ref.getTime();
  const covers = list.map(coversIn);
  list.forEach((sentence, i) => {
    if (!WORDS.test(sentence) || sentence.includes(" · ")) return;
    const found = dates(sentence, ref).map((f) => inClass(sentence, f, slots) || f);
    if (!found.length) return;
    let named = names(sentence);
    let note = sentence;
    if (!named.length && i > 0 && PRONOUN.test(sentence)) {
      // "Its submission deadline is (19/11/2026)." names what the post was just about, up to two sentences back.
      for (let k = i - 1; k >= Math.max(0, i - 2) && !named.length; k--) {
        const prev = names(list[k]);
        if (prev.length && !dates(list[k], ref).length) { named = [{ name: prev.at(-1)!.name, at: 0, end: 0 }]; note = list.slice(k, i + 1).join(" "); }
      }
    }
    // Still unnamed ("Students submit their solutions to their TAs. The deadline is 20/11."): the sentence before says what.
    let about = sentence;
    if (!named.length && i > 0 && PRONOUN.test(sentence) && !dates(list[i - 1], ref).length) { about = list[i - 1]; note = list[i - 1] + " " + sentence; }
    const moved = MOVED.test(sentence);
    // "On Monday November 16th and Tuesday November 17th": a sitting on one of several days by group. The earliest is
    // kept, with its time unknown, and the days are said; a row of the post's table naming their group settles it below.
    const days = [...new Set(found.filter((f) => !f.range).map((f) => f.ymd))].sort();
    const either = !moved && named.length <= 1 && days.length > 1 && Date.parse(days.at(-1)!) - Date.parse(days[0]) <= 7 * 864e5 && /\b(and|or)\b/i.test(sentence) ? dayNames(days) + ", by tutorial group" : undefined;
    const pairs: { name?: string; date: Found }[] = named.length <= 1
      ? [{ name: named[0]?.name, date: either ? found.filter((f) => f.ymd === days[0])[0] : moved ? found.at(-1)! : found[0] }]
      : named.flatMap((n, k) => { const end = named[k + 1]?.at ?? Infinity, d = found.find((f) => f.at > n.at && f.at < end); return d ? [{ name: n.name, date: d }] : []; });
    const said = covers.slice(i, i + 3).find(Boolean);
    for (const { name, date } of pairs) {
      // Long past (last year's text) or further off than a term (two, with the year written): not a deadline to show.
      if (date.due < now - 30 * 864e5 || date.due > now + (date.dated ? 200 : 150) * 864e5) continue;
      const title = name || unnamed(about), kind = kindOf(title), timeKnown = date.timed && !either;
      const id = stableId(courseKey + "|" + (name ? "n|" + name.toLowerCase() : "u|" + title.toLowerCase() + "|" + date.ymd));
      const due = timeKnown ? date.due : cairoInstant(+date.ymd.slice(0, 4), +date.ymd.slice(5, 7), +date.ymd.slice(8, 10), 23, 59);
      out.push({ id, courseKey, title, due: new Date(due).toISOString(), source, note: cut(note, date.slip ? 180 : 280) + (date.slip ? " " + date.slip : ""), kind, timeKnown,
        ...(date.place && SITTING.test(kind) ? { place: date.place } : {}), ...(said && SITTING.test(kind) ? { covers: said } : {}), ...(either ? { either } : {}),
        rank: (moved ? 4 : 0) + (timeKnown ? 2 : 0) + (source === "announcement" || source === "mail" ? 1 : 0), at: i });
    }
  });
  // A table in the post with a row for the student's group: that row's day, time and room are theirs, for the sitting
  // the post is about (the one closest before the table).
  const row = groupRow(text, slots, ref);
  if (row) {
    const tableAt = list.findIndex((l) => l.includes(" · "));
    const item = out.filter((d) => SITTING.test(d.kind || "") && (tableAt < 0 || d.at <= tableAt)).at(-1);
    if (item && Math.abs(row.due - Date.parse(item.due)) <= 8 * 864e5) {
      Object.assign(item, { due: new Date(row.due).toISOString(), timeKnown: row.timed, rank: item.rank + 3 });
      if (row.place) item.place = row.place;
      delete item.either;
    }
  }
  return out.map(({ at: _a, ...d }) => d);
}

/** One deadline per id: a sentence saying it moved wins, then one with a time, then an announcement over a week's notes. */
function merge(list: Ranked[]): GucDeadline[] {
  const best = new Map<string, Ranked>();
  for (const d of list) { const was = best.get(d.id); if (!was || d.rank > was.rank) best.set(d.id, d); }
  return [...best.values()].map(({ rank: _, ...d }) => d).sort((a, b) => a.due.localeCompare(b.due));
}

/** Deadlines in one text. `ref`: when it was read. The id is the item's name, so a moved date changes its due date
 *  rather than adding a second one. */
export function extractDeadlines(text: string, courseKey: string, source: string, ref = new Date(), slots: GucSlot[] = []): GucDeadline[] {
  return merge(fromText(text, courseKey, source, ref, slots));
}
/** Deadlines across all of a course's texts, one per item. `slots`: the person's classes in this course. */
export function courseDeadlines(texts: { text: string; source: string }[], courseKey: string, ref = new Date(), slots: GucSlot[] = []): GucDeadline[] {
  return merge(texts.flatMap((t) => fromText(t.text, courseKey, t.source, ref, slots)));
}

/** "Tue 24 Nov, 15:30" in Cairo time (no time when it is the end of the day). */
export function dueText(iso: string) {
  const c = cairo(Date.parse(iso));
  return `${WD[c.weekday]} ${Number(c.ymd.slice(8))} ${MON[Number(c.ymd.slice(5, 7)) - 1]}${c.time === "23:59" ? "" : ", " + c.time}`;
}

// ---------- Seating plans and schedules uploaded as files ----------
const ROOM = /\b(exam\s+hall\s*\d+[a-z]?|hall\s*\d+[a-z]?|H\s?\d{1,2}[a-z]?|[A-Z]\d{1,2}\.\d{2,3}[a-z]?)\b/i;
/** A seating plan or schedule file (its text already trimmed to the student's rows, deadline-ai.ts fileText) applied to
 *  the tracked item its title names ("Quiz 2 seating plan" → that course's Quiz 2): a line naming the student's group
 *  gives the room, and the day and time when the line has them near the item's date. Which item, or which row, unclear:
 *  nothing changes. Returns the updated item, or undefined. */
export function fileUpdate(file: { title: string; text: string }, tracked: GucDeadline[], slots: GucSlot[]): GucDeadline | undefined {
  const named = names(file.title)[0]?.name;
  if (!named) return undefined;
  const want = named.toLowerCase(), kind = kindOf(named), n = /\d+/.exec(named)?.[0];
  const items = tracked.filter((d) => d.title.toLowerCase() === want || (!!n && (d.kind || kindOf(d.title)) === kind && /\d+/.exec(d.title)?.[0] === n));
  if (items.length !== 1) return undefined;
  const groups = myGroups(slots);
  const rows = file.text.split("\n").filter((l) => groups.some((g) => groupIn(l, g)) && ROOM.test(l));
  if (rows.length !== 1 && new Set(rows.map((l) => ROOM.exec(l)![1].toLowerCase())).size !== 1) return undefined;
  const line = rows[0], place = ROOM.exec(line)![1].replace(/\s+/g, " ").replace(/^exam hall/i, "Exam Hall").replace(/^hall/i, "Hall");
  const item = { ...items[0], place, source: "file", note: cut(`From the file “${file.title}”: ${line}`, 280) };
  // The row's own day and time, when it has them and they are near the item's date (a seating plan is for that sitting).
  const dm = /\b(\d{1,2})\s*[./]\s*(\d{1,2})\b(?:\s*[./]\s*\d{2,4})?/.exec(line), t = /\b(\d{1,2})[:.](\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i.exec(line.replace(dm?.[0] || "", " "));
  if (dm) {
    const was = Date.parse(item.due), year = new Date(was).getUTCFullYear(), day = +dm[1], month = +dm[2];
    let hour = t ? +t[1] : 23;
    if (t && (/^p/i.test(t[3] || "") ? hour < 12 : !t[3] && hour >= 1 && hour < 8)) hour += 12;
    const due = month >= 1 && month <= 12 ? cairoInstant(year, month, day, hour, t ? +t[2] : 59) : NaN;
    if (Number.isFinite(due) && Math.abs(due - was) <= 8 * 864e5) { item.due = new Date(due).toISOString(); item.timeKnown = !!t; delete item.either; }
  } else if (t && item.timeKnown === false && !item.either) {
    const c = cairo(Date.parse(item.due)).ymd;
    let hour = +t[1];
    if (/^p/i.test(t[3] || "") ? hour < 12 : !t[3] && hour >= 1 && hour < 8) hour += 12;
    item.due = new Date(cairoInstant(+c.slice(0, 4), +c.slice(5, 7), +c.slice(8, 10), hour, +t[2])).toISOString(); item.timeKnown = true;
  }
  return item;
}
