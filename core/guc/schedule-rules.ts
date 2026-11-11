// When Clem checks a linked course for new files: shortly after its lectures by default, or at times the person names,
// in Africa/Cairo. This step has the shape, the suggestion, the next run, cron lines for pg-boss and a local parser for
// the common phrasings; the full converter replaces `parseCheckSchedule` in the next step behind the same signature.
import { sameCode } from "./codes.ts";
import { TZ, addDays, cairo } from "./hub.ts";
import type { GucSlot } from "./types.ts";
import { NO, YES } from "./rules.ts";

/** `day`: 0 Sunday … 6 Saturday, as in cron and Date. `time`: "HH:MM" on Cairo's clock. */
export type CheckTime = { day: number; time: string };
export type CheckSchedule = { mode: "after_lectures" | "custom" | "off"; times: CheckTime[]; tz: string };
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** How long after a lecture ends the check runs: files usually go up right after class. */
export const AFTER_LECTURE_MIN = 30;

const pad = (n: number) => String(n).padStart(2, "0");
const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const clock = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const byTime = (a: CheckTime, b: CheckTime) => a.day - b.day || minutes(a.time) - minutes(b.time);
const uniq = (times: CheckTime[]) => [...new Map(times.map((t) => [t.day + " " + t.time, t])).values()].sort(byTime);

/** Half an hour after each of the course's lectures (any class of it when the schedule shows no lecture). */
export function suggestChecks(slots: GucSlot[], code: string): CheckTime[] {
  const own = slots.filter((s) => sameCode(s.code, code) && s.end);
  const lectures = own.filter((s) => /lecture/i.test(s.type));
  return uniq((lectures.length ? lectures : own).map((s) => ({ day: DAY_NAMES.findIndex((d) => d.toLowerCase() === s.day.toLowerCase()), time: clock(minutes(s.end) + AFTER_LECTURE_MIN) })).filter((t) => t.day >= 0));
}
/** Every GUC teaching day (Saturday to Thursday) at 20:00, for a course with no classes on the schedule. */
export const dailyChecks = (time = "20:00"): CheckTime[] => [6, 0, 1, 2, 3, 4].map((day) => ({ day, time })).sort(byTime);
export function defaultCheckSchedule(slots: GucSlot[] = [], code = ""): CheckSchedule {
  const after = code ? suggestChecks(slots, code) : [];
  return after.length ? { mode: "after_lectures", times: after, tz: TZ } : { mode: "custom", times: dailyChecks(), tz: TZ };
}

/** Milliseconds UTC of `ymd` at `time` on Cairo's clock (daylight saving included). */
export function cairoTime(ymd: string, time: string) {
  const guess = Date.parse(`${ymd}T${time}:00Z`);
  const offset = (t: number) => { const c = cairo(t); return Date.parse(`${c.ymd}T${c.time}:00Z`) - Math.floor(t / 60000) * 60000; };
  const first = guess - offset(guess);
  return guess - offset(first);
}
/** The next check after `now`, or undefined when checks are off. */
export function nextCheck(s: CheckSchedule, now: number) {
  if (s.mode === "off" || !s.times.length) return undefined;
  const today = cairo(now);
  for (let i = 0; i <= 7; i++) {
    const ymd = addDays(today.ymd, i), day = (today.weekday + i) % 7;
    const at = s.times.filter((t) => t.day === day).map((t) => cairoTime(ymd, t.time)).filter((t) => t > now).sort((a, b) => a - b)[0];
    if (at) return at;
  }
  return undefined;
}
/** One pg-boss cron line per time of day, with its days: "15 10 * * 0,2". */
export function cronLines(s: CheckSchedule) {
  if (s.mode === "off") return [];
  const at = new Map<string, number[]>();
  for (const t of s.times) at.set(t.time, [...(at.get(t.time) || []), t.day]);
  return [...at].map(([time, days]) => ({ time, cron: `${Number(time.slice(3))} ${Number(time.slice(0, 2))} * * ${[...new Set(days)].sort().join(",")}` }));
}

const short = (d: number) => DAY_NAMES[d].slice(0, 3);
/** "After each lecture: Sun 10:15, Tue 12:00", "Every day at 20:00", "Sun and Wed at 18:00", "Off". */
export function describeChecks(s: CheckSchedule) {
  if (s.mode === "off" || !s.times.length) return "Off";
  const times = [...new Set(s.times.map((t) => t.time))], days = [...new Set(s.times.map((t) => t.day))];
  const list = s.times.map((t) => `${short(t.day)} ${t.time}`).join(", ");
  if (s.mode === "after_lectures") return "After each lecture: " + list;
  if (times.length === 1 && days.length === 7) return `Every day at ${times[0]}`;
  if (times.length === 1 && days.length === 6 && !days.includes(5)) return `Saturday to Thursday at ${times[0]}`;
  if (times.length === 1) return `${days.map(short).join(", ").replace(/, ([^,]+)$/, " and $1")} at ${times[0]}`;
  return list;
}

const DAY_RE = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/g;
const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
/** "8pm", "20:00", "9 am", "noon" → "HH:MM". */
export function timesIn(text: string) {
  const out: string[] = [];
  const t = text.toLowerCase().replace(/\bnoon\b/g, "12:00").replace(/\bmidnight\b/g, "00:00");
  for (const m of t.matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=\b|\s|$)/g)) {
    const [, hh, mm = "00", ap] = m;
    let h = Number(hh);
    if (!ap && !m[2] && !/\bat\s*$/.test(t.slice(0, m.index))) continue;
    if (ap?.startsWith("p") && h < 12) h += 12;
    if (ap?.startsWith("a") && h === 12) h = 0;
    if (h > 23 || Number(mm) > 59) continue;
    out.push(`${pad(h)}:${mm}`);
  }
  if (/\bmornings?\b/.test(t) && !out.length) out.push("08:00");
  if (/\b(evenings?|nights?|tonight)\b/.test(t) && !out.length) out.push("20:00");
  if (/\bafternoons?\b/.test(t) && !out.length) out.push("15:00");
  return [...new Set(out)];
}

/** The common ways of saying when to check; `null` when this can't read it (the AI's turn). `suggested` is what
 *  "after lectures" means for this course. */
export function parseCheckSchedule(text: string, suggested: CheckTime[] = []): CheckSchedule | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^(off|never|stop|none|don't|do not|dont)\b|\b(don't|do not|stop|never) check\b|\bturn (it )?off\b/.test(t) || NO.test(t)) return { mode: "off", times: [], tz: TZ };
  if ((YES.test(t) || /\bafter (each |every |the |my )?(lecture|class|lesson)s?\b/.test(t)) && suggested.length) return { mode: "after_lectures", times: uniq(suggested), tz: TZ };
  const times = /\btwice a day\b/.test(t) ? ["08:00", "20:00"] : timesIn(t);
  if (!times.length) return null;
  const named = [...new Set([...t.matchAll(DAY_RE)].map((m) => DAY_INDEX[m[1]]))];
  // No day named: every day ("daily at 9", "every evening", "at 8pm").
  const days = named.length ? named : /\bweekdays?\b/.test(t) ? [6, 0, 1, 2, 3, 4] : [6, 0, 1, 2, 3, 4, 5];
  return { mode: "custom", times: uniq(days.flatMap((day) => times.map((time) => ({ day, time })))), tz: TZ };
}
