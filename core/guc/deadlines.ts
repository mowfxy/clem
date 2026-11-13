// Deadlines pulled out of announcements and course pages. Each one is named for what it is ("Quiz 2", "In-class
// assignment 3"; never a sentence), dated in Cairo time, and keeps the sentence it came from as its note. Dates are
// read day-first (GUC writes 19/11/2026); words with no date in them ("now", "today") are not dates; a date with no
// year is the one closest to when it was read and never more than a term away; an "a.m./p.m."-less time in a class
// slot ("3:30-5:15") is in the afternoon. A weekday that disagrees with its date ("Tuesday November 18th" on a
// Wednesday) is a slip in the post: the earlier of the two days is kept and the note says so. "The second tutorial of
// the week starting Saturday 7 November" is the person's own second tutorial that week, when their classes are known.
// What is long past or implausibly far off is left out.
import * as chrono from "chrono-node";
import { addDays, cairo } from "./hub.ts";
import { stableId } from "./parse.ts";
import type { GucDeadline, GucSlot } from "./types.ts";

/** Bump when extraction changes: the sync re-reads course pages and takes the new deadlines as a baseline, not news. */
export const DEADLINE_VERSION = 4;

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
type Named = { name: string; at: number };
/** Every item a sentence names, where it is: "Quiz 2", "the third in-class assignment", "the midterm". */
function names(sentence: string): Named[] {
  const out: Named[] = [], taken: [number, number][] = [];
  const add = (name: string, m: RegExpExecArray) => { if (taken.some(([a, b]) => m.index < b && m.index + m[0].length > a)) return; taken.push([m.index, m.index + m[0].length]); out.push({ name, at: m.index }); };
  for (const m of sentence.matchAll(ORDINAL)) add(`${label(m[2], m[3])} ${ORD[m[1].toLowerCase()]}`, m as RegExpExecArray);
  for (const m of sentence.matchAll(NUMBERED)) if (Number(m[3]) <= 30) add(`${label(m[1], m[2])} ${Number(m[3])}`, m as RegExpExecArray);
  for (const m of sentence.matchAll(BARE)) if (/midterm|final|project|presentation|evaluation|lab\s+report/i.test(m[2])) add(label(m[1], m[2]), m as RegExpExecArray);
  return out.sort((a, b) => a.at - b.at);
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

type Found = { at: number; due: number; timed: boolean; ymd: string; /** The year was written out. */ dated: boolean; /** "Tuesday" written next to a date that is a Wednesday. */ slip?: string };
const ymdOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** The dates in a sentence with a certain day and month, each in Cairo time. */
function dates(sentence: string, ref: Date): Found[] {
  const out: Found[] = [];
  // "postponed from 22 November to 29 November" is one range: both ends count, and a move takes the last.
  const parts = chrono.en.GB.parse(sentence, ref).flatMap((r) => (r.end ? [{ r, s: r.start }, { r, s: r.end }] : [{ r, s: r.start }]));
  for (const { r, s } of parts) {
    // "now", "today", "tomorrow": when the post was written isn't known, so only a written date counts.
    if (!s.isCertain("day") || !s.isCertain("month") || !/\d/.test(r.text) || /\b(now|today|tonight|tomorrow|yesterday)\b/i.test(r.text)) continue;
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
      const said = DAYS.findIndex((d) => before.includes(d) || new RegExp(`\\b${d.slice(0, 3)}\\b`).test(before));
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
    out.push({ at: r.index, due: cairoInstant(year, month, day, hour, minute), timed, ymd: ymdOf(year, month, day), dated, ...(slip ? { slip } : {}) });
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
const IN_CLASS = new RegExp(String.raw`\b(?:(${Object.keys(NTH).join("|")})\s+)?(tutorial|lab|practical|lecture)s?\s+(?:session\s+)?(?:of|in|during)\s+(?:the\s+)?(?:week\s+)?(?:of|starting|beginning|that\s+starts)?`, "i");
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
  const ymd = addDays(sat, GUC_WEEK.indexOf(slot.day.toLowerCase())), t = /^(\d{1,2}):(\d{2})/.exec(slot.start);
  return { ...week, ymd, timed: !!t, due: cairoInstant(+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10), t ? +t[1] : 23, t ? +t[2] : 59) };
}

function fromText(text: string, courseKey: string, source: string, ref: Date, slots: GucSlot[] = []): Ranked[] {
  const out: Ranked[] = [], list = sentences(text), now = ref.getTime();
  list.forEach((sentence, i) => {
    if (!WORDS.test(sentence)) return;
    const found = dates(sentence, ref).map((f) => inClass(sentence, f, slots) || f);
    if (!found.length) return;
    let named = names(sentence);
    let note = sentence;
    if (!named.length && i > 0 && PRONOUN.test(sentence)) {
      // "Its submission deadline is (19/11/2026)." names what the post was just about, up to two sentences back.
      for (let k = i - 1; k >= Math.max(0, i - 2) && !named.length; k--) {
        const prev = names(list[k]);
        if (prev.length && !dates(list[k], ref).length) { named = [{ name: prev.at(-1)!.name, at: 0 }]; note = list.slice(k, i + 1).join(" "); }
      }
    }
    // Still unnamed ("Students submit their solutions to their TAs. The deadline is 20/11."): the sentence before says what.
    let about = sentence;
    if (!named.length && i > 0 && PRONOUN.test(sentence) && !dates(list[i - 1], ref).length) { about = list[i - 1]; note = list[i - 1] + " " + sentence; }
    const moved = MOVED.test(sentence);
    const pairs: { name?: string; date: Found }[] = named.length <= 1
      ? [{ name: named[0]?.name, date: moved ? found.at(-1)! : found[0] }]
      : named.flatMap((n, k) => { const end = named[k + 1]?.at ?? Infinity, d = found.find((f) => f.at > n.at && f.at < end); return d ? [{ name: n.name, date: d }] : []; });
    for (const { name, date } of pairs) {
      // Long past (last year's text) or further off than a term (two, with the year written): not a deadline to show.
      if (date.due < now - 30 * 864e5 || date.due > now + (date.dated ? 200 : 150) * 864e5) continue;
      const title = name || unnamed(about);
      const id = stableId(courseKey + "|" + (name ? "n|" + name.toLowerCase() : "u|" + title.toLowerCase() + "|" + date.ymd));
      out.push({ id, courseKey, title, due: new Date(date.due).toISOString(), source, note: cut(note, date.slip ? 180 : 280) + (date.slip ? " " + date.slip : ""), rank: (moved ? 4 : 0) + (date.timed ? 2 : 0) + (source === "announcement" ? 1 : 0) });
    }
  });
  return out;
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
