// Reminders and study time for the organizer (docs/MAIN-THREAD.md "Reminders and study time"): GUC classes and timed
// plan items as busy time in Cairo, study sessions only where the person's preferences allow and nothing else is, and
// reminder times read from their words. Pure.
import * as chrono from "chrono-node";
import { addDays, cairo } from "../guc/hub.ts";
import { cairoAt, type StudyPrefs } from "./settings.ts";
import type { Slot, Timed } from "./rules.ts";

const mins = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayOf = (ymd: string) => new Date(ymd + "T12:00:00Z").getUTCDay();
export const dayLabel = (ymd: string) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Anything with a time on a Cairo day, as one list: classes and timed plan items (study sessions included).
 *  `source` says which, for the wording. */
export type Busy = { title: string; day: string; start: number; end: number; source: "class" | "plan"; space?: string };
export function busyList(o: { slots?: Slot[]; timed?: Timed[] }): Busy[] {
  return [
    ...(o.slots || []).map((s): Busy => ({ title: s.title, day: s.day, start: mins(s.start), end: mins(s.end), source: "class" })),
    ...(o.timed || []).map((t): Busy => ({ title: t.title, day: t.day, start: mins(t.time), end: mins(t.time) + (t.minutes ?? 60), source: "plan", ...(t.space ? { space: t.space } : {}) })),
  ];
}

const what = (b: Busy) => (b.source === "class" ? b.title : `“${b.title}”${b.space ? ` (${b.space})` : ""}`);
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
export const CALENDAR_GUIDE = `Schedule, reminders and study time (Cairo time; read the schedule with these, never guess it):
- {"kinetra":{"action":"clem.calendar","range":"today"|"tomorrow"|"week"|"next week"|"YYYY-MM-DD"|"YYYY-MM-DD..YYYY-MM-DD"}}: their GUC classes and timed plan items by day, with every clash and their study preferences.
- {"kinetra":{"action":"clem.remind","text":"<what, in their words>","at":"<ISO time or their words: tomorrow 9am, Sunday 16:00>","before":<minutes early, optional>,"subject":"<optional>","repeat":"daily"|"weekly"}}: a reminder Clem sends at that time (in Clem, desktop and Telegram). For a quiz, exam or assignment, add one the evening before and one a few hours before unless they say otherwise. Then confirm in one sentence when it rings ("I'll remind you Sunday at 9:00.").
- {"kinetra":{"action":"clem.reminders"}} lists upcoming reminders; {"kinetra":{"action":"clem.unremind","id":"<id>"}} cancels one.
- {"kinetra":{"action":"clem.study","subject":"<subject>","sessions":N,"minutes":<session length they asked for; 50 if they didn't say>,"until":"YYYY-MM-DD","title":"<optional>"}}: puts N study sessions in their plan before that day, only in the days and hours their preferences allow and clear of classes and other plans. It sets no reminders: add one with clem.remind only if they ask. Use it for "when should I study for…", then say when and why in one line each.
- {"kinetra":{"action":"clem.prefs", any of: "level":"quiet"|"balanced"|"proactive", "quiet":{"on":true,"from":"HH:MM","to":"HH:MM"}, "jobs":{"morning"|"midday"|"evening"|"weekly":{"on":true,"time":"HH:MM","day":0-6 (weekly only)}}, "study":{"days":[0-6, 0 = Sunday],"from":"HH:MM","to":"HH:MM","gap":N}}}: how Clem runs for them: how much it speaks (quiet = only what can't wait, balanced = what matters and the briefs, proactive = anything that helps), quiet hours (no notifications), its routines (morning plan, midday check, evening prep, weekly review: when, or off) and when they study. There are no settings screens for these: they tell you. Save only what they actually said, then confirm in one line. If they answer your first message in this thread (how they'd like Clem around), turn what they said into routines (clem.routine, one per thing they asked for) and preferences (clem.prefs: quiet hours, how much it speaks, study time), then list what you set up in a few lines. Set up nothing they didn't ask for.
Clem sends reminders itself, in Clem, on the desktop and on Telegram; it has no access to Google Calendar or any other calendar app, so never offer to add anything to one.
What Clem says by itself (news, briefs, deadline reminders, a reminder ringing, what it did) comes into this thread as plain messages, with no buttons anywhere, in Clem or on Telegram. The person steers it by telling you, and you act with these, then confirm in one short sentence. Never mention buttons, cards, taps or pop-ups.
- "stop telling me about new files in Math", "no more emails about X": {"kinetra":{"action":"clem.mute","kind":"files"|"announcements"|"mail"|"grades"|"deadlines"|"timetable"|"exams","subject":"<optional>","words":["<optional, any of>"]}}. "Tell me about those again": {"kinetra":{"action":"clem.mutes"}} lists them, {"kinetra":{"action":"clem.unmute","id":"<id>"}} lifts one.
- "undo that", "put it back", "don't move that": {"kinetra":{"action":"clem.undo","what":"<optional words naming it, e.g. Assignment 2>"}} undoes Clem's own latest change to their plans, files or memory (or the one the words name).
- "cancel that reminder": clem.reminders, then clem.unremind with its id. "stop watching for that": {"kinetra":{"action":"clem.watches"}}, then {"kinetra":{"action":"clem.unwatch","id":"<id>"}}. "stop that routine": clem.routines, then clem.unroutine.
- "yes, do it" to something Clem asked in this thread (making a repeated request a routine, finding a slot for a task): do it with the matching action (clem.routine, clem.study, a plan update); "no" or "not now" needs no action.`;
