// When Clem checks a linked course for new files (docs/GUC-VPS-ENGINE.md → Check schedules), always on Cairo's clock.
// A schedule is fixed times on given days, optionally a repeat ("every 2 hours, 08:00–22:00") and a date range it is
// limited to ("during exams"). `convertCheckSchedule` reads the person's words; `cronLines` turns a schedule into
// pg-boss cron lines (tz Africa/Cairo) and `nextRuns` lists what is coming. At GUC the week is Saturday to Thursday,
// so "weekdays" means Sat–Thu, and descriptions say so.
import { sameCode } from "./codes.ts";
import { TZ, addDays, cairo } from "./hub.ts";
import type { GucSlot } from "./types.ts";
import { NO, YES } from "./rules.ts";

/** `day`: 0 Sunday … 6 Saturday, as in cron and Date. `time`: "HH:MM" on Cairo's clock. */
export type CheckTime = { day: number; time: string };
/** Every `minutes` from `from` to `to` (inclusive) on `days`. */
export type CheckEvery = { minutes: number; from: string; to: string; days: number[] };
/** Dates (Cairo, inclusive) outside which the schedule doesn't run: the job wakes up and does nothing. */
export type CheckDuring = { from: string; to: string; label?: string };
export type CheckSchedule = { mode: "after_lectures" | "custom" | "off"; times: CheckTime[]; every?: CheckEvery; during?: CheckDuring; tz: string };
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** GUC's teaching week, Saturday to Thursday: what "weekdays" means here. */
export const GUC_DAYS = [6, 0, 1, 2, 3, 4];
/** How long after a lecture ends the check runs: files usually go up right after class. */
export const AFTER_LECTURE_MIN = 30;
/** One more check on lecture days, for files that go up later. */
export const EVENING = "21:00";
/** Never more often than this, whatever is asked: GUC is a shared server and checks cost battery and data. */
export const MIN_EVERY = 30;

const pad = (n: number) => String(n).padStart(2, "0");
const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const clock = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const byTime = (a: CheckTime, b: CheckTime) => (a.day + 1) % 7 - (b.day + 1) % 7 || minutes(a.time) - minutes(b.time);
const uniq = (times: CheckTime[]) => [...new Map(times.map((t) => [t.day + " " + t.time, t])).values()].sort(byTime);
const dayOf = (name: string) => DAY_NAMES.findIndex((d) => d.toLowerCase() === name.toLowerCase());
const ownSlots = (slots: GucSlot[], code: string) => { const own = slots.filter((s) => sameCode(s.code, code) && s.end), lectures = own.filter((s) => /lecture/i.test(s.type)); return lectures.length ? lectures : own; };

/** Half an hour after each of the course's lectures (any class of it when the schedule shows no lecture). */
export function suggestChecks(slots: GucSlot[], code: string): CheckTime[] {
  return uniq(ownSlots(slots, code).map((s) => ({ day: dayOf(s.day), time: clock(minutes(s.end) + AFTER_LECTURE_MIN) })).filter((t) => t.day >= 0));
}
/** The days the course has lectures (or any class). */
export const lectureDays = (slots: GucSlot[], code: string) => [...new Set(ownSlots(slots, code).map((s) => dayOf(s.day)).filter((d) => d >= 0))].sort((a, b) => (a + 1) % 7 - (b + 1) % 7);
/** After each lecture, plus one evening check those days. */
export function suggestSchedule(slots: GucSlot[], code: string): CheckTime[] {
  const after = suggestChecks(slots, code);
  return after.length ? uniq([...after, ...[...new Set(after.map((t) => t.day))].map((day) => ({ day, time: EVENING }))]) : [];
}
/** Every GUC teaching day (Saturday to Thursday) at 20:00, for a course with no classes on the schedule. */
export const dailyChecks = (time = "20:00"): CheckTime[] => GUC_DAYS.map((day) => ({ day, time })).sort(byTime);
export function defaultCheckSchedule(slots: GucSlot[] = [], code = ""): CheckSchedule {
  const after = code ? suggestSchedule(slots, code) : [];
  return after.length ? { mode: "after_lectures", times: after, tz: TZ } : { mode: "custom", times: dailyChecks(), tz: TZ };
}

/** Every time of the week the schedule runs (fixed times and the repeat's), sorted Saturday first. */
export function weekly(s: CheckSchedule): CheckTime[] {
  if (s.mode === "off") return [];
  const out = [...s.times];
  if (s.every) {
    const step = Math.max(MIN_EVERY, s.every.minutes), end = minutes(s.every.to);
    for (const day of s.every.days) for (let m = minutes(s.every.from); m <= end; m += step) out.push({ day, time: clock(m) });
  }
  return uniq(out);
}

/** Milliseconds UTC of `ymd` at `time` on Cairo's clock (daylight saving included). */
export function cairoTime(ymd: string, time: string) {
  const guess = Date.parse(`${ymd}T${time}:00Z`);
  const offset = (t: number) => { const c = cairo(t); return Date.parse(`${c.ymd}T${c.time}:00Z`) - Math.floor(t / 60000) * 60000; };
  const first = guess - offset(guess);
  return guess - offset(first);
}
/** Whether the schedule is in its date range at `now` (always, without one). */
export const active = (s: CheckSchedule, now: number) => !s.during || (cairo(now).ymd >= s.during.from && cairo(now).ymd <= s.during.to);
/** The next `n` checks after `now`, soonest first (none when off). Looks a year ahead at most. */
export function nextRuns(s: CheckSchedule, now: number, n = 5): number[] {
  const all = weekly(s), out: number[] = [];
  if (!all.length) return out;
  const today = cairo(now);
  for (let i = 0; i <= 370 && out.length < n; i++) {
    const ymd = addDays(today.ymd, i), day = (today.weekday + i) % 7;
    if (s.during && (ymd < s.during.from || ymd > s.during.to)) continue;
    for (const at of [...new Set(all.filter((t) => t.day === day).map((t) => cairoTime(ymd, t.time)))].sort((a, b) => a - b)) if (at > now && out.length < n && !out.includes(at)) out.push(at);
  }
  return out;
}
/** The next check after `now`, or undefined when checks are off. */
export const nextCheck = (s: CheckSchedule, now: number) => nextRuns(s, now, 1)[0];

/** pg-boss cron lines: times sharing a minute and days share a line ("0 8,10,12 * * 0,1,2,3,4,6"). `key` is stable for the
 *  same line, so reconciling only touches lines that changed (pg-boss keys allow letters, digits, . - _ /). */
export function cronLines(s: CheckSchedule) {
  const days = new Map<string, number[]>();
  for (const t of weekly(s)) days.set(t.time, [...(days.get(t.time) || []), t.day]);
  const lines = new Map<string, { minute: number; hours: number[]; days: number[] }>();
  for (const [time, ds] of days) {
    const d = [...new Set(ds)].sort((a, b) => a - b), minute = minutes(time) % 60, k = minute + "|" + d.join(",");
    const line = lines.get(k) || { minute, hours: [], days: d };
    line.hours.push(Math.floor(minutes(time) / 60));
    lines.set(k, line);
  }
  return [...lines.values()].map((l) => ({ key: `m${l.minute}h${l.hours.sort((a, b) => a - b).join(".")}d${l.days.join("")}`, cron: `${l.minute} ${l.hours.join(",")} * * ${l.days.join(",")}` })).sort((a, b) => a.key.localeCompare(b.key));
}

// ---------- In words ----------
const short = (d: number) => DAY_NAMES[d].slice(0, 3);
const sameSet = (a: number[], b: number[]) => a.length === b.length && b.every((x) => a.includes(x));
/** "Sat–Thu (GUC week)", "every day", "Sun, Tue and Wed". */
export function daysLabel(days: number[]) {
  const d = [...new Set(days)].sort((a, b) => (a + 1) % 7 - (b + 1) % 7);
  if (d.length === 7) return "every day";
  if (sameSet(d, GUC_DAYS)) return "Sat–Thu (GUC week)";
  return d.map(short).join(", ").replace(/, ([^,]+)$/, " and $1");
}
const everyLabel = (m: number) => (m % 60 ? `Every ${m} minutes` : m === 60 ? "Every hour" : `Every ${m / 60} hours`);
const fmtDay = (ymd: string) => { const [, mo, d] = ymd.split("-").map(Number); return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1]}`; };
/** "After each lecture: Sun 12:00 · evening check 21:00", "Every 2 hours, 08:00–22:00, Sat–Thu (GUC week)", "Off". */
export function describeChecks(s: CheckSchedule) {
  if (s.mode === "off" || !weekly(s).length) return "Off";
  const during = s.during ? ` · ${s.during.label ? `during ${s.during.label} ` : ""}(${fmtDay(s.during.from)}–${fmtDay(s.during.to)})` : "";
  if (s.mode === "after_lectures") {
    const after = s.times.filter((t) => t.time !== EVENING), evening = s.times.some((t) => t.time === EVENING);
    return "After each lecture: " + (after.length ? after : s.times).map((t) => `${short(t.day)} ${t.time}`).join(", ") + (evening && after.length ? ` · evening check ${EVENING}` : "") + during;
  }
  const parts: string[] = [];
  if (s.every) parts.push(`${everyLabel(Math.max(MIN_EVERY, s.every.minutes))}, ${s.every.from}–${s.every.to}, ${daysLabel(s.every.days)}`);
  if (s.times.length) {
    const times = [...new Set(s.times.map((t) => t.time))].sort(), byTimes = new Map<string, number[]>();
    for (const t of s.times) byTimes.set(t.time, [...(byTimes.get(t.time) || []), t.day]);
    const sameDays = [...byTimes.values()].every((d) => sameSet(d, byTimes.get(times[0])!));
    if (sameDays) { const d = daysLabel(byTimes.get(times[0])!); parts.push(`${d === "every day" ? "Every day" : d} at ${times.join(" and ")}`); }
    else parts.push(uniq(s.times).map((t) => `${short(t.day)} ${t.time}`).join(", "));
  }
  return parts.join(" · ") + during;
}
export const describe = describeChecks;

// ---------- From the person's words ----------
const DAY_RE = /\b(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:days?)?\b/g;
const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, "a couple of": 2, few: 3 };
const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
const hhmm = (hh: string, mm = "00", ap?: string, pmHint = false) => {
  let h = Number(hh);
  if (ap?.startsWith("p") && h < 12) h += 12;
  if (ap?.startsWith("a") && h === 12) h = 0;
  if (!ap && pmHint && h < 12) h += 12;
  return h > 23 || Number(mm) > 59 ? undefined : `${pad(h)}:${mm}`;
};
/** "8pm", "20:00", "9 am", "noon" → "HH:MM". A bare number counts only after "at". */
export function timesIn(text: string) {
  const out: string[] = [];
  const t = text.toLowerCase().replace(/\bnoon\b/g, "12:00").replace(/\bmidnight\b/g, "00:00");
  for (const m of t.matchAll(new RegExp(String.raw`\b${TIME}(?=\b|\s|$)`, "g"))) {
    const [, hh, mm, ap] = m;
    if (!ap && !m[2] && !/\b(at|and)\s*$/.test(t.slice(0, m.index))) continue;
    const time = hhmm(hh, mm, ap);
    if (time) out.push(time);
  }
  if (/\bmornings?\b/.test(t) && !out.length) out.push("08:00");
  if (/\b(evenings?|nights?|tonight)\b/.test(t) && !out.length) out.push("20:00");
  if (/\bafternoons?\b/.test(t) && !out.length) out.push("15:00");
  return [...new Set(out)];
}

export type ScheduleContext = {
  /** What "after each lecture" means for this course (suggestSchedule). */
  suggested?: CheckTime[];
  /** The course's classes, for "only on lecture days". */
  slots?: GucSlot[]; code?: string;
  /** The subject's exam date (YYYY-MM-DD), for "during exams". */
  exam?: string;
};
export type ScheduleResult = CheckSchedule | { needsAI: true } | { ask: string };
const FILLER = new Set(("a an the and or on at in of to for from between until till through every each per day days daily please check checking checks look " +
  "it them cms guc files new for me my i want would like could you can just only also too around about time times o'clock oclock clock cairo pm am a.m. p.m. " +
  "during week weeks weekly is are be when there any ok okay then same also plus with hour hours minutes minute mins min hourly once twice thrice " +
  "lecture lectures class classes lesson lessons after each period season").split(" "));

/** The person's words as a check schedule; { needsAI: true } when it can't read them for sure, { ask } when it needs
 *  something only the person knows (the exam date, a course with no lectures on the schedule). */
export function convertCheckSchedule(text: string, ctx: ScheduleContext = {}): ScheduleResult {
  let t = " " + text.trim().toLowerCase().replace(/[’']/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ") + " ";
  const ai = { needsAI: true } as const, suggested = ctx.suggested || [];
  if (!t.trim()) return ai;
  if (/^\s*(off|never|stop|none|no checks?|don't|do not|dont)\b|\b(don't|do not|stop|never|no need to) check\b|\bturn (it |checks |checking )?off\b|\bmanually\b|\bmyself\b/.test(t) || NO.test(t.trim())) return { mode: "off", times: [], tz: TZ };
  const after = /\bafter (each |every |the |my |all )?(lecture|class|lesson)s?\b/.test(t);
  if (YES.test(t.trim()) || (after && !/\b(every|hourly|at \d|\d\s*(am|pm))/.test(t.replace(/\bafter (each|every)\b/, "")))) {
    return suggested.length ? { mode: "after_lectures", times: uniq(suggested), tz: TZ } : { ask: "This course has no lectures on your schedule yet, so I can't time checks after them. Tell me a time instead, like \"every day at 8pm\"." };
  }
  let during: CheckDuring | undefined;
  t = t.replace(/\b(?:only\s+)?(?:during|in|for)\s+(?:the\s+)?(?:exams?|exam (?:period|season|weeks?)|finals?|midterms?)( period| season| weeks?)?\b/g, () => { during = { from: "", to: "", label: "exams" }; return " "; });
  if (during) {
    if (!ctx.exam) return { ask: "When is the exam? Set the exam date on the subject page, then tell me again and I'll check more often in the three weeks before it." };
    during = { from: addDays(ctx.exam, -21), to: ctx.exam, label: "exams" };
  }
  let days: number[] | undefined;
  t = t.replace(/\b(?:only\s+)?on\s+(?:my\s+)?(?:lecture|class) days\b|\b(?:on\s+)?days (?:with|i have) (?:a\s+)?(?:lectures?|class(?:es)?)\b|\b(?:lecture|class) days(?: only)?\b/g, () => { days = ctx.code && ctx.slots ? lectureDays(ctx.slots, ctx.code) : []; return " "; });
  if (days && !days.length) return { ask: "This course has no classes on your schedule yet, so I don't know its lecture days. Name the days instead, like \"Sunday and Tuesday at 8pm\"." };
  t = t.replace(/\b(?:on\s+)?(?:week ?days?|school days|uni days|university days|working days|work days|study days)\b/g, () => { days = [...(days || []), ...GUC_DAYS]; return " "; });
  t = t.replace(/\b(?:on\s+)?(?:the\s+)?weekends?\b/g, () => { days = [...(days || []), 5]; return " "; });
  t = t.replace(/\b(?:every ?day|daily|each day|all week|7 days a week)\b/g, () => { days = [...(days || []), 0, 1, 2, 3, 4, 5, 6]; return " "; });
  t = t.replace(DAY_RE, (m, d) => { days = [...(days || []), DAY_INDEX[d.slice(0, 3)]]; return " "; });
  // "except Fridays" etc. would need subtraction: let the AI read it.
  if (/\b(except|but not|apart from|excluding)\b/.test(t)) return ai;

  let window: [string, string] | undefined;
  t = t.replace(new RegExp(String.raw`\b(?:from|between)?\s*${TIME}\s*(?:-|to|until|till|and)\s*${TIME}`, "g"), (m, h1, m1, a1, h2, m2, a2) => {
    if (!a1 && !a2 && !m1 && !m2 && !/\b(from|between)\b/.test(m)) return m;
    const pmFirst = !a1 && a2?.startsWith("p") && Number(h1) <= Number(h2) && Number(h1) < 12;
    const from = hhmm(h1, m1, a1 || (pmFirst ? a2 : undefined)), toRaw = hhmm(h2, m2, a2);
    let to = toRaw;
    if (from && to && !a2 && minutes(to) <= minutes(from)) to = hhmm(h2, m2, undefined, true);
    if (!from || !to || minutes(to) <= minutes(from)) return m;
    window = [from, to];
    return " ";
  });
  let every: number | undefined;
  t = t.replace(/\b(?:every|each)\s+(half (?:an )?hour|(\d+(?:\.\d+)?|a couple of|a few|couple of|few|an?|one|two|three|four|five|six)?\s*(hours?|hrs?|h|minutes?|mins?|m))\b|\bhourly\b|\bhalf-hourly\b/g, (m, _all, n, unit) => {
    if (m === "hourly") every = 60;
    else if (m === "half-hourly" || /half/.test(m)) every = 30;
    else { const k = (n || "1").trim(), count = COUNT[k] ?? Number(k); every = Math.round(count * (/^h/.test(unit) ? 60 : 1)); }
    return " ";
  });
  let times: string[] = [];
  t = t.replace(/\b(once|twice|thrice|(\d|two|three|four|five|six) times)\s+(?:a|per|each)\s+day\b/g, (m, w, n) => {
    const count = w === "once" ? 1 : w === "twice" ? 2 : w === "thrice" ? 3 : COUNT[n] ?? Number(n);
    times = count === 1 ? ["20:00"] : count === 2 ? ["08:00", "20:00"] : Array.from({ length: Math.min(count, 8) }, (_, i) => clock(8 * 60 + Math.round((i * 14 * 60) / (Math.min(count, 8) - 1))));
    return " ";
  });
  const named = timesIn(t);
  t = t.replace(new RegExp(String.raw`\b${TIME}(?=\b|\s|$)`, "g"), " ").replace(/\b(noon|midnight|mornings?|evenings?|nights?|tonight|afternoons?)\b/g, " ");
  times = [...new Set([...times, ...named])];
  const leftover = t.replace(/[^a-z' ]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w));
  if (leftover.length) return ai;
  if (!every && !times.length && !days && !during) return ai;
  if (every !== undefined && (!Number.isFinite(every) || every <= 0 || every > 24 * 60)) return ai;
  const d = days ? [...new Set(days as number[])] : [0, 1, 2, 3, 4, 5, 6];
  // Days alone ("only on lecture days", "weekdays") keep the usual evening check.
  if (!every && !times.length) times = after && suggested.length ? [] : ["20:00"];
  const out: CheckSchedule = { mode: "custom", times: uniq(d.flatMap((day) => times.map((time) => ({ day, time })))), tz: TZ };
  if (every) out.every = { minutes: Math.max(MIN_EVERY, every), from: window?.[0] || "08:00", to: window?.[1] || "22:00", days: d.sort((a, b) => a - b) };
  else if (window) out.times = uniq([...out.times, ...d.flatMap((day) => [{ day, time: window![0] }, { day, time: window![1] }])]);
  if (after && suggested.length) out.times = uniq([...out.times, ...suggested]);
  if (during) out.during = during;
  return out;
}
/** The local reading only: null where the AI (or the person) is needed. */
export function parseCheckSchedule(text: string, suggested: CheckTime[] = [], ctx: Omit<ScheduleContext, "suggested"> = {}): CheckSchedule | null {
  const r = convertCheckSchedule(text, { ...ctx, suggested });
  return "mode" in r ? r : null;
}
