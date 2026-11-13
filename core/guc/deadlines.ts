// Deadlines pulled out of announcements and course pages. Each one is named for what it is ("Quiz 2", "In-class
// assignment 3"), dated in Cairo time, and keeps the sentence it came from as its note. Dates are read day-first (GUC
// writes 19/11/2026), a date with no year is the one closest to when it was read (never pushed into next year), a
// weekday that disagrees with the date marks text left over from another year, and an "a.m./p.m."-less time in a
// class slot ("3:30-5:15") is in the afternoon. What is long past or implausibly far off is left out.
import * as chrono from "chrono-node";
import { cairo } from "./hub.ts";
import { stableId } from "./parse.ts";
import type { GucDeadline } from "./types.ts";

/** Bump when extraction changes: the sync re-reads course pages and takes the new deadlines as a baseline, not news. */
export const DEADLINE_VERSION = 3;

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

type Found = { at: number; due: number; timed: boolean };
/** The dates in a sentence with a certain day and month, each in Cairo time. */
function dates(sentence: string, ref: Date): Found[] {
  const out: Found[] = [];
  // "postponed from 22 November to 29 November" is one range: both ends count, and a move takes the last.
  const parts = chrono.en.GB.parse(sentence, ref).flatMap((r) => (r.end ? [{ r, s: r.start }, { r, s: r.end }] : [{ r, s: r.start }]));
  for (const { r, s } of parts) {
    if (!s.isCertain("day") || !s.isCertain("month")) continue;
    const month = s.get("month")!, day = s.get("day")!;
    let year = s.get("year")!;
    if (!s.isCertain("year")) {
      // Closest to when it was read, and agreeing with a weekday written next to it ("Tuesday November 18th").
      const near = (y: number) => Math.abs(Date.UTC(y, month - 1, day) - ref.getTime());
      year = [year - 1, year, year + 1].sort((a, b) => near(a) - near(b))[0];
      const before = sentence.slice(Math.max(0, r.index - 14), r.index + r.text.length).toLowerCase();
      const said = DAYS.findIndex((d) => before.includes(d) || new RegExp(`\\b${d.slice(0, 3)}\\b`).test(before));
      if (said >= 0 && new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== said) {
        const fits = [year - 1, year + 1].find((y) => new Date(Date.UTC(y, month - 1, day)).getUTCDay() === said);
        if (fits) year = fits;
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
    out.push({ at: r.index, due: cairoInstant(year, month, day, hour, minute), timed });
  }
  return out;
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z(])|\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, s.lastIndexOf(" ", n - 1) > n / 2 ? s.lastIndexOf(" ", n - 1) : n - 1).replace(/[\s,;:.-]+$/, "") + "…" : s);
type Ranked = GucDeadline & { rank: number };

function fromText(text: string, courseKey: string, source: string, ref: Date): Ranked[] {
  const out: Ranked[] = [], list = sentences(text), now = ref.getTime();
  list.forEach((sentence, i) => {
    if (!WORDS.test(sentence)) return;
    const found = dates(sentence, ref);
    if (!found.length) return;
    let named = names(sentence);
    let note = sentence;
    if (!named.length && PRONOUN.test(sentence) && i > 0) {
      // "Its submission deadline is (19/11/2026)." names what the sentence before it is about.
      const prev = names(list[i - 1]);
      if (prev.length) { named = [{ name: prev.at(-1)!.name, at: 0 }]; note = list[i - 1] + " " + sentence; }
    }
    const moved = MOVED.test(sentence);
    const pairs: { name?: string; date: Found }[] = named.length <= 1
      ? [{ name: named[0]?.name, date: moved ? found.at(-1)! : found[0] }]
      : named.flatMap((n, k) => { const end = named[k + 1]?.at ?? Infinity, d = found.find((f) => f.at > n.at && f.at < end); return d ? [{ name: n.name, date: d }] : []; });
    for (const { name, date } of pairs) {
      // Long past (last year's text) or further off than a term: not a deadline to show.
      if (date.due < now - 30 * 864e5 || date.due > now + 200 * 864e5) continue;
      const title = name || cut(sentence.replace(/\s*\([^)]*\d[^)]*\)\s*/g, " ").replace(/\s+([,.;:])/g, "$1").trim(), 70);
      const id = stableId(courseKey + "|" + (name ? "n|" + name.toLowerCase() : source + "|" + title.toLowerCase()));
      out.push({ id, courseKey, title, due: new Date(date.due).toISOString(), source, note: cut(note, 280), rank: (moved ? 4 : 0) + (date.timed ? 2 : 0) + (source === "announcement" ? 1 : 0) });
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
export function extractDeadlines(text: string, courseKey: string, source: string, ref = new Date()): GucDeadline[] {
  return merge(fromText(text, courseKey, source, ref));
}
/** Deadlines across all of a course's texts, one per item. */
export function courseDeadlines(texts: { text: string; source: string }[], courseKey: string, ref = new Date()): GucDeadline[] {
  return merge(texts.flatMap((t) => fromText(t.text, courseKey, t.source, ref)));
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Tue 24 Nov, 15:30" in Cairo time (no time when it is the end of the day). */
export function dueText(iso: string) {
  const c = cairo(Date.parse(iso));
  return `${WD[c.weekday]} ${Number(c.ymd.slice(8))} ${MON[Number(c.ymd.slice(5, 7)) - 1]}${c.time === "23:59" ? "" : ", " + c.time}`;
}
