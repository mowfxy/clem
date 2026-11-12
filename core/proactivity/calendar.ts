// Google Calendar, reminders and study time for the organizer (docs/MAIN-THREAD.md "Calendar, reminders and study
// time"). Events come in read-only from the person's own calendars (desktop/calendar-live.ts) and are read here as
// busy time in Cairo, as quizzes, exams and assignments the organizer reminds about, and as clashes with classes, plan
// items and each other. Study sessions go only where the person's preferences allow and nothing else is. Pure.
import * as chrono from "chrono-node";
import { addDays, cairo } from "../guc/hub.ts";
import { cairoAt, type StudyPrefs } from "./settings.ts";
import type { Deadline, Slot, Timed } from "./rules.ts";

/** One event from the person's calendar. Timed: ISO instants. All day: YYYY-MM-DD days, `end` exclusive as Google
 *  sends them. `free`: marked "show me as available" (still listed, never busy). */
export type CalEvent = { id: string; title: string; start: string; end: string; allDay?: true; free?: true; calendar?: string; location?: string };

const mins = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayOf = (ymd: string) => new Date(ymd + "T12:00:00Z").getUTCDay();
export const dayLabel = (ymd: string) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

type GoogleTime = { dateTime?: string; date?: string };
type GoogleEvent = { id?: string; status?: string; summary?: string; location?: string; transparency?: string; start?: GoogleTime; end?: GoogleTime; attendees?: { self?: boolean; responseStatus?: string }[]; eventType?: string };
/** A Google Calendar API event as Clem keeps it; cancelled ones, ones the person declined and working-location or
 *  out-of-office markers are left out. */
export function fromGoogle(e: GoogleEvent, calendar?: string): CalEvent | null {
  if (!e?.id || e.status === "cancelled" || !e.start || !e.end) return null;
  if (e.eventType === "workingLocation" || e.eventType === "outOfOffice") return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const allDay = !!e.start.date && !e.start.dateTime;
  const start = allDay ? e.start.date : e.start.dateTime, end = allDay ? e.end.date : e.end.dateTime;
  if (!start || !end || (!allDay && (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))))) return null;
  return {
    id: String(e.id).slice(0, 200), title: (e.summary || "Busy").trim().slice(0, 200) || "Busy", start, end,
    ...(allDay ? { allDay: true as const } : {}), ...(e.transparency === "transparent" ? { free: true as const } : {}),
    ...(calendar ? { calendar: calendar.slice(0, 120) } : {}), ...(e.location ? { location: e.location.slice(0, 200) } : {}),
  };
}

/** Timed events as Cairo wall-clock pieces, one per day they cover (an overnight event is two), busy ones only. */
export function busyOf(events: CalEvent[]): (Timed & { id: string })[] {
  const out: (Timed & { id: string })[] = [];
  for (const e of events) {
    if (e.allDay || e.free) continue;
    const a = Date.parse(e.start), b = Date.parse(e.end);
    if (!(b > a)) continue;
    for (let day = cairo(a).ymd, n = 0; n < 14; day = addDays(day, 1), n++) {
      const from = Math.max(a, cairoAt(day)), to = Math.min(b, cairoAt(addDays(day, 1)));
      if (to <= from) break;
      const start = cairo(from).time;
      out.push({ id: e.id, title: e.title, day, time: start, minutes: Math.max(1, Math.round((to - from) / 60_000)) });
    }
  }
  return out;
}

/** Events that are schoolwork with a date: quizzes, exams, assignments, submissions. They become deadlines the
 *  organizer reminds about (48 h and 3 h before, by default) and, with a subject, plan tasks. */
const ACADEMIC = /\b(quiz(?:zes)?|exams?|midterms?|finals?|tests?|assignments?|assign\.|homework|hw\s?\d*|sheets?\s+due|lab\s+reports?|reports?\s+due|project\s+(?:due|submission|deadline|demo)|deliverables?|submissions?|submit|deadlines?|due|presentations?|evaluations?|tutorial\s+quiz)\b/i;
export const isAcademic = (e: Pick<CalEvent, "title">) => ACADEMIC.test(e.title);
/** The subject an event is about: its course code, or one subject's name in the title. */
export function subjectOf(title: string, spaces: { id: string; name: string; code?: string }[]) {
  const low = norm(title), squash = low.replace(/\s+/g, "");
  const byCode = spaces.filter((s) => s.code && squash.includes(norm(s.code).replace(/\s+/g, "")));
  if (byCode.length === 1) return byCode[0].id;
  const byName = spaces.filter((s) => norm(s.name).length >= 3 && ` ${low} `.includes(` ${norm(s.name)} `)).sort((a, b) => b.name.length - a.name.length);
  return byName[0]?.id;
}
export function calendarDeadlines(events: CalEvent[], spaces: { id: string; name: string; code?: string }[], now: number): Deadline[] {
  return events.filter((e) => isAcademic(e) && (e.allDay ? cairoAt(e.start, "23:59") : Date.parse(e.start)) > now - 864e5).map((e) => {
    const spaceId = subjectOf(e.title, spaces);
    return { id: "gcal-" + e.id, title: e.title, due: e.allDay ? e.start : new Date(Date.parse(e.start)).toISOString(), ...(spaceId ? { spaceId } : {}) };
  });
}

/** Anything with a time on a Cairo day, as one list: classes, calendar events and timed plan items (study sessions
 *  included). `source` says which, for the wording. */
export type Busy = { title: string; day: string; start: number; end: number; source: "class" | "calendar" | "plan"; space?: string; id?: string };
export function busyList(o: { slots?: Slot[]; calendar?: CalEvent[]; timed?: Timed[] }): Busy[] {
  return [
    ...(o.slots || []).map((s): Busy => ({ title: s.title, day: s.day, start: mins(s.start), end: mins(s.end), source: "class" })),
    ...busyOf(o.calendar || []).map((t): Busy => ({ title: t.title, day: t.day, start: mins(t.time), end: mins(t.time) + (t.minutes ?? 60), source: "calendar", id: t.id })),
    ...(o.timed || []).map((t): Busy => ({ title: t.title, day: t.day, start: mins(t.time), end: mins(t.time) + (t.minutes ?? 60), source: "plan", ...(t.space ? { space: t.space } : {}) })),
  ];
}

/** Overlaps on the days from `from` for `days`: calendar against classes, plan items against calendar, and two calendar
 *  events at once. (Classes against plan items are rules.clashNotes'.) Each pair once, keyed so it is said once. */
export function calendarClashes(busy: Busy[], from: string, days = 7) {
  const last = addDays(from, days - 1), out: { a: Busy; b: Busy; key: string }[] = [];
  const list = busy.filter((x) => x.day >= from && x.day <= last).sort((x, y) => x.day.localeCompare(y.day) || x.start - y.start);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    // Sorted by day and start: nothing later overlaps `a` either.
    if (b.day !== a.day || b.start >= a.end) break;
    const pair = [a.source, b.source].sort().join("+");
    if (pair === "class+class" || pair === "plan+plan" || pair === "class+plan") continue;
    if (a.id && a.id === b.id) continue;
    out.push({ a, b, key: `clash:${a.day}:${hhmm(Math.max(a.start, b.start))}:${[norm(a.title), norm(b.title)].sort().join(":")}`.slice(0, 200) });
  }
  return out;
}
const what = (b: Busy) => (b.source === "class" ? b.title : b.source === "calendar" ? `“${b.title}” (calendar)` : `“${b.title}”${b.space ? ` (${b.space})` : ""}`);
export const clashText = (c: { a: Busy; b: Busy }) => `${WEEK[weekdayOf(c.a.day)]} ${hhmm(Math.max(c.a.start, c.b.start))}: ${what(c.a)} clashes with ${what(c.b)}.`;

/** Study sessions are this long when the person doesn't say. */
export const STUDY_MINUTES = 50;
/** Where study sessions can go: days and hours the person allows, `gap` minutes clear of anything busy (study sessions
 *  already planned included), from `now` (an hour's notice today) to `until` (inclusive). `minutes`: each session's
 *  length, as the person said it (50 when they didn't). Sessions are spread: one a day across the days first, then a
 *  second, and so on, as many a day as fit. */
export function studySlots(p: StudyPrefs, busy: Busy[], o: { now: number; until: string; count: number; minutes?: number }) {
  const c = cairo(o.now), len = o.minutes ?? STUDY_MINUTES, out: { day: string; time: string; minutes: number }[] = [];
  const from = mins(p.from), to = mins(p.to) <= from ? 24 * 60 : mins(p.to);
  const days: string[] = [];
  for (let d = c.ymd, n = 0; d <= o.until && n < 90; d = addDays(d, 1), n++) if (p.days.includes(weekdayOf(d))) days.push(d);
  const taken = new Map<string, [number, number][]>();
  for (const b of busy) (taken.get(b.day) || taken.set(b.day, []).get(b.day)!).push([b.start, b.end]);
  const pick = (day: string) => {
    const start = day === c.ymd ? Math.max(from, Math.ceil((mins(c.time) + 60) / 15) * 15) : from;
    const blocks = taken.get(day) || [];
    for (let t = start; t + len <= to; t += 15) if (!blocks.some(([a, b]) => t < b + p.gap && a < t + len + p.gap)) return t;
    return null;
  };
  // Each round adds at most one a day; a round where nothing fits anywhere is the end.
  while (out.length < o.count) {
    let any = false;
    for (const day of days) {
      if (out.length >= o.count) break;
      const t = pick(day);
      if (t === null) continue;
      any = true;
      out.push({ day, time: hhmm(t), minutes: len });
      (taken.get(day) || taken.set(day, []).get(day)!).push([t, t + len]);
    }
    if (!any) break;
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time));
}

/** When a reminder is for: an ISO time, or the person's words ("tomorrow at 9", "Sunday 4pm", "in 2 hours") read in
 *  Cairo time, never in the past. A day with no time is 09:00. Null when it can't be read. */
export function whenOf(at: string, now: number): number | null {
  const s = at.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const t = /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? Date.parse(s) : cairoAt(s.slice(0, 10), s.slice(11, 16));
    return Number.isFinite(t) && t > now - 60_000 ? t : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const t = cairoAt(s, "09:00"); return t > now ? t : null; }
  const hit = chrono.parse(s, { instant: new Date(now), timezone: "EET" }, { forwardDate: true })[0];
  if (!hit) return null;
  const known = hit.start.isCertain("hour");
  const t = known ? hit.start.date().getTime() : cairoAt(cairo(hit.start.date().getTime()).ymd, "09:00");
  return t > now - 60_000 ? t : null;
}

/** The byte-stable guide line for the main thread's AI (like WATCH_GUIDE). */
export const CALENDAR_GUIDE = `Calendar, reminders and study time (Cairo time; read the calendar with these, never guess it):
- {"kinetra":{"action":"clem.calendar","range":"today"|"tomorrow"|"week"|"next week"|"YYYY-MM-DD"|"YYYY-MM-DD..YYYY-MM-DD"}}: their Google Calendar events, GUC classes and timed plan items by day, with every clash and their study preferences.
- {"kinetra":{"action":"clem.remind","text":"<what, in their words>","at":"<ISO time or their words: tomorrow 9am, Sunday 16:00>","before":<minutes early, optional>,"subject":"<optional>","repeat":"daily"|"weekly"}}: a reminder Clem sends at that time (in Clem, desktop and Telegram). For a quiz, exam or assignment, add one the evening before and one a few hours before unless they say otherwise. Put the returned clem-card in your reply.
- {"kinetra":{"action":"clem.reminders"}} lists upcoming reminders; {"kinetra":{"action":"clem.unremind","id":"<id>"}} cancels one.
- {"kinetra":{"action":"clem.study","subject":"<subject>","sessions":N,"minutes":<session length they asked for; 50 if they didn't say>,"until":"YYYY-MM-DD","title":"<optional>"}}: puts N study sessions in their plan before that day, only in the days and hours their preferences allow and clear of classes, calendar events and other plans. It sets no reminders: add one with clem.remind only if they ask. Use it for "when should I study for…", then say when and why in one line each.
- {"kinetra":{"action":"clem.prefs", any of: "level":"quiet"|"balanced"|"proactive", "quiet":{"on":true,"from":"HH:MM","to":"HH:MM"}, "jobs":{"morning"|"midday"|"evening"|"weekly":{"on":true,"time":"HH:MM","day":0-6 (weekly only)}}, "study":{"days":[0-6, 0 = Sunday],"from":"HH:MM","to":"HH:MM","gap":N}}}: how Clem runs for them: how much it speaks (quiet = only what can't wait, balanced = what matters and the briefs, proactive = anything that helps), quiet hours (no notifications), its routines (morning plan, midday check, evening prep, weekly review: when, or off) and when they study. There are no settings screens for these: they tell you. Save only what they actually said, then confirm in one line. If you asked them how they'd like Clem to run (your first message in this thread) and they answer, save all of it in one clem.prefs.
If the calendar isn't connected, say they can connect Google Calendar in Settings → Connectors, and still use classes and plans.`;

/** What moved in the calendar since the last sweep, as lines for the sweep's diff: new events and moved ones from now
 *  on. No earlier look (`prev` undefined) is the baseline: nothing to say. */
export function calendarDiff(prev: CalEvent[] | undefined, next: CalEvent[], now: number) {
  if (!prev) return [];
  const was = new Map(prev.map((e) => [e.id, e])), out: string[] = [];
  const when = (e: CalEvent) => (e.allDay ? dayLabel(e.start) : `${dayLabel(cairo(Date.parse(e.start)).ymd)} ${cairo(Date.parse(e.start)).time}`);
  for (const e of next) {
    if ((e.allDay ? cairoAt(e.start, "23:59") : Date.parse(e.end)) < now) continue;
    const old = was.get(e.id);
    if (!old) out.push(`New in your calendar: ${e.title} (${when(e)})`);
    else if (old.start !== e.start || old.end !== e.end) out.push(`Moved in your calendar: ${e.title}, now ${when(e)}`);
  }
  return out.slice(0, 10);
}

/** Calendar lines for the briefs: a day's timed events and all-day items. */
export function dayEvents(events: CalEvent[], day: string) {
  return [
    ...events.filter((e) => e.allDay && e.start <= day && day < e.end).map((e) => ({ text: `${e.title} (all day)` })),
    ...busyOf(events.filter((e) => !e.free)).filter((t) => t.day === day).sort((a, b) => a.time.localeCompare(b.time)).map((t) => ({ time: t.time, text: t.title })),
  ];
}
