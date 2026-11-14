// The GUC hub's shared shapes and pure helpers: the read API's results, the Sat–Thu week grid, deadline order and
// relative times in Cairo, semester order and the hub's #/app/guc routes. No I/O, no cheerio: the window imports it.
import { sameCode } from "./codes.ts";
import type { GucCoursework, GucDeadline, GucErrorKind, GucExam, GucMail, GucMidterm, GucSlot } from "./types.ts";

export const TZ = "Africa/Cairo";
/** GUC's teaching slots ("periods"), first to eighth. */
export const PERIOD_TIMES: [string, string][] = [["08:15", "09:45"], ["10:00", "11:30"], ["11:45", "13:15"], ["13:45", "15:15"], ["15:45", "17:15"], ["17:30", "19:00"], ["19:15", "20:45"], ["21:00", "22:30"]];
export const WEEK_DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"] as const;

export type Page<T> = { items: T[]; next?: string };
export type HubOverview = {
  connected: boolean; syncing: boolean; username?: string; lastSync?: number;
  error?: { kind: GucErrorKind; message: string };
  passwordNeeded?: boolean;
  counts: { courses: number; unread: number; materials: number; deadlines: number; grades: number; exams?: number; mail?: number };
  /** Parts of GUC the last sync couldn't read ("schedule", "grades", "mail"…). */
  missed?: string[];
};
export type HubTerm = { midterms: (GucMidterm & { fresh?: boolean })[]; coursework: GucCoursework[]; exams: GucExam[] };
export type HubMail = { items: GucMail[]; missed: boolean };
export type HubCourse = { key: string; code: string; name: string; season: string; active: boolean; subjectId?: string; unread: number; materials: number };
export type HubSchedule = { weekStart: string; slots: GucSlot[] };
export type HubAnnouncement = { id: string; courseKey: string; code: string; course: string; scope: "course" | "week"; week?: string; text: string; firstSeen: number; read: boolean };
export type HubMaterial = { id: string; courseKey: string; week: string; title: string; kind: string; name: string; type: string; firstSeen: number; stored: boolean };
export type HubWeek = { week: string; date?: string; items: HubMaterial[] };
export type HubMaterials = { courseKey: string; weeks: HubWeek[] };
export type HubHit = { type: "material" | "announcement"; id: string; courseKey: string; code: string; title: string; snippet: string; week?: string; name?: string; fileType?: string };
export type HubGrade = { id: string; semester: string; code: string; name: string; hours: number | null; numeric: number | null; letter: string; latest: boolean; fresh: boolean };
/** One thing at uni with a time: a tracked item read from a post or a mail, or an exam seat from the portal ("Coming
 *  up"). `due`: when it is (its start); `ends`: when it is over; `done`: over; `removeAt`: when it leaves the list. */
export type HubDeadline = { id: string; courseKey: string; code: string; title: string; due: string; /** "announcement", "week", "mail" or "portal". */ source: string; note?: string; kind?: string; place?: string; covers?: string; timeKnown?: boolean; either?: string; ends?: string; done?: boolean; removeAt?: string };
export type HubFile = { id: string; name: string; type: string; size: number; stored: boolean };

const TYPES: Record<string, string> = { pdf: "application/pdf", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint", doc: "application/msword", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", zip: "application/zip", txt: "text/plain", mp4: "video/mp4" };
/** A material's file name from its download URL (the title when the URL has none), and its media type. */
/** "Week: 2026-11-07" → "Week of November 7" (in the person's locale); the hub and the file_saved card both say it so. */
export function weekLabel(week: string, month: "long" | "short" = "long") {
  const d = /(\d{4}-\d{2}-\d{2})/.exec(week)?.[1];
  return d ? "Week of " + new Date(d + "T12:00:00Z").toLocaleDateString([], { day: "numeric", month, timeZone: "UTC" }) : week;
}

export function materialFile(url: string, title: string) {
  let base = "";
  try { base = decodeURIComponent(new URL(url).pathname.split("/").at(-1) || ""); } catch {}
  const ext = /\.([a-z0-9]{1,5})$/i.exec(base)?.[1]?.toLowerCase() || "";
  const name = ext ? (title && !title.toLowerCase().endsWith("." + ext) ? `${title.replace(/[\\/:*?"<>|]+/g, " ").trim()}.${ext}` : base) : title || base || "file";
  return { name, type: TYPES[ext] || "application/octet-stream" };
}

/** A GUC grade or mark with at most one decimal, everywhere one is shown: "92.5926" → "92.6", "97.5" and "60" as they
 *  are, "8.75 / 10" → "8.8 / 10"; "/ 10" (not graded yet) and letters unchanged. */
export function markText(mark: string | number | null | undefined): string {
  if (mark === null || mark === undefined) return "";
  return String(mark).replace(/\d+(?:\.\d+)?/g, (n) => (n.includes(".") ? String(Math.round(Number(n) * 10) / 10) : n));
}

/** Winter 2025 → Spring 2026 → Summer 2026 → Winter 2026: year, then term (winter is the autumn term). */
export function semesterOrder(label: string) {
  const year = Number(/(20\d{2})/.exec(label)?.[1] || 0), l = label.toLowerCase();
  return year * 10 + (/spring/.test(l) ? 1 : /summer/.test(l) ? 2 : /winter|fall|autumn/.test(l) ? 3 : 0);
}

// ---------- Cairo time ----------
const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The wall clock in Cairo at `t`. */
export function cairo(t: number) {
  const p = Object.fromEntries(parts.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, weekday: WD.indexOf(p.weekday), time: `${p.hour}:${p.minute}` };
}
export const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
/** The Saturday that starts the GUC week holding `t` (Friday belongs to the week before). */
export function weekStart(t: number) { const c = cairo(t); return addDays(c.ymd, -((c.weekday + 1) % 7)); }

export type GridDay = { name: string; date: string; today: boolean; cells: GucSlot[][] };
/** Saturday to Thursday by period; a period with two classes (a split lab) keeps both. */
export function weekGrid(slots: GucSlot[], start: string, now: number) {
  const today = cairo(now).ymd;
  const periods = Math.max(5, ...slots.map((s) => s.period).filter((p) => p >= 1 && p <= PERIOD_TIMES.length));
  const days: GridDay[] = WEEK_DAYS.map((name, i) => {
    const date = addDays(start, i);
    const cells = Array.from({ length: periods }, (_, p) => slots.filter((s) => s.day.toLowerCase() === name.toLowerCase() && s.period === p + 1));
    return { name, date, today: date === today, cells };
  });
  return { days, periods: PERIOD_TIMES.slice(0, periods).map(([start, end], i) => ({ n: i + 1, start, end })) };
}

// ---------- Deadlines ----------
/** Upcoming first (soonest at the top), then the ones already past (most recent first). */
export function sortDeadlines<T extends { due: string }>(list: T[], now: number) {
  const at = (d: T) => Date.parse(d.due);
  const upcoming = list.filter((d) => at(d) >= now).sort((a, b) => at(a) - at(b));
  const past = list.filter((d) => at(d) < now).sort((a, b) => at(b) - at(a));
  return [...upcoming.map((d) => ({ ...d, past: false })), ...past.map((d) => ({ ...d, past: true }))];
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (ymd: string) => `${Number(ymd.slice(8))} ${MON[Number(ymd.slice(5, 7)) - 1]}`;
/** "in 40 min", "today at 14:00", "tomorrow at 23:59", "Sun at 09:00", "in 9 days", "2 days ago", in Cairo time.
 *  `tone`: past, soon (under two days) or later. */
export function relativeDue(due: string | number, now: number): { label: string; date: string; tone: "past" | "soon" | "later" } {
  const t = typeof due === "number" ? due : Date.parse(due), ms = t - now, d = cairo(t), n = cairo(now), days = dayDiff(n.ymd, d.ymd);
  const date = `${WD[d.weekday]} ${shortDate(d.ymd)}, ${d.time}`;
  if (ms < 0) {
    const ago = -ms;
    const label = ago < 3600e3 ? `${Math.max(1, Math.round(ago / 60e3))} min ago` : days === 0 ? `${Math.round(ago / 3600e3)} h ago` : days === -1 ? "yesterday" : `${-days} days ago`;
    return { label, date, tone: "past" };
  }
  const tone = ms < 2 * 864e5 ? "soon" : "later";
  if (ms < 3600e3) return { label: `in ${Math.max(1, Math.round(ms / 60e3))} min`, date, tone };
  if (days === 0) return { label: `today at ${d.time}`, date, tone };
  if (days === 1) return { label: `tomorrow at ${d.time}`, date, tone };
  if (days < 7) return { label: `${WD[d.weekday]} at ${d.time}`, date, tone };
  return { label: `in ${days} days`, date, tone };
}

// ---------- Routes: #/app/guc/<tab>/<id>/<sub> ----------
export const HUB_TABS = ["schedule", "announcements", "cms", "grades", "exams", "deadlines", "mail"] as const;
export type HubTab = (typeof HUB_TABS)[number];
export type HubRoute = { tab: HubTab; id?: string; sub?: string };
export function parseHubRoute(route: string): HubRoute | null {
  const m = /^\/app\/guc(?:\/([a-z]+))?(?:\/([^/]+))?(?:\/([^/]+))?\/?$/.exec(route);
  if (!m) return null;
  const tab = (HUB_TABS as readonly string[]).includes(m[1] || "") ? (m[1] as HubTab) : "schedule";
  const dec = (s?: string) => { if (!s) return undefined; try { return decodeURIComponent(s); } catch { return undefined; } };
  return { tab, id: dec(m[2]), sub: dec(m[3]) };
}
export const hubPath = (tab: HubTab, id?: string, sub?: string) => "/app/guc/" + [tab, id, sub].filter(Boolean).map((s) => encodeURIComponent(s!)).join("/");

// ---------- Coming up: everything at uni with a time ----------
/** Kept this long after it is over, in the Done section; then removed (tracked items are pruned by the sync). */
export const DONE_DAYS = 14;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Cairo wall clock → instant (the offset is looked up: Egypt has summer time). */
function cairoAt(ymd: string, h: number, m: number) {
  const want = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), h, m);
  let t = want - 2 * 3600e3;
  for (let i = 0; i < 3; i++) { const c = cairo(t), shown = Date.UTC(+c.ymd.slice(0, 4), +c.ymd.slice(5, 7) - 1, +c.ymd.slice(8, 10), +c.time.slice(0, 2), +c.time.slice(3, 5)); if (shown === want) break; t += want - shown; }
  return t;
}
const clock = (s: string) => { const m = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?/i.exec(s || ""); if (!m) return undefined; let h = +m[1]; if (/p/i.test(m[3] || "") && h < 12) h += 12; if (/a/i.test(m[3] || "") && h === 12) h = 0; return h < 24 && +m[2] < 60 ? { h, m: +m[2] } : undefined; };
/** An exam seat's date and times: "29 - October - 2026" (or "2026-10-29", "29/10/2026") with "8:30:00 AM"–"10:30:00 AM". */
export function examWhen(e: Pick<GucExam, "date" | "start" | "end">): { start: string; end?: string; timed: boolean } | undefined {
  const d = e.date || "";
  let ymd = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(d)?.slice(1).map(Number);
  if (!ymd) { const m = /(\d{1,2})\s*[-/ ]\s*([A-Za-z]+|\d{1,2})\s*[-/ ]\s*(\d{4})/.exec(d); if (m) { const mo = /^\d+$/.test(m[2]) ? +m[2] : MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3))) + 1; if (mo > 0) ymd = [+m[3], mo, +m[1]]; } }
  if (!ymd) return undefined;
  const day = `${ymd[0]}-${String(ymd[1]).padStart(2, "0")}-${String(ymd[2]).padStart(2, "0")}`, a = clock(e.start), b = clock(e.end);
  return { start: new Date(cairoAt(day, a?.h ?? 23, a ? a.m : 59)).toISOString(), ...(a && b ? { end: new Date(cairoAt(day, b.h, b.m)).toISOString() } : {}), timed: !!a };
}

/** Sat in a room at a time (over two hours after it starts, unless its end is known), rather than handed in. */
export const isSitting = (kind?: string) => /^(quiz|exam|in-class|lab|presentation)$/.test(kind || "");
/** When it is over: its end; a timed sitting two hours after it starts; anything else at its time (a day-only item's
 *  `due` is already the end of its day). */
export function endsAt(d: { due: string; ends?: string; kind?: string; timeKnown?: boolean }) {
  if (d.ends) return Date.parse(d.ends);
  const t = Date.parse(d.due);
  return d.timeKnown !== false && isSitting(d.kind) ? t + 2 * 3600e3 : t;
}

/** The exam seats and the tracked items as one list. A seat and a read item that are the same sitting (same course, an
 *  exam, within a day) are one row: the portal's date, hall and seat, the post's title and what it covers. A seat over
 *  for more than DONE_DAYS is left out (the portal keeps listing them for weeks). */
export function comingUp(tracked: (GucDeadline & { code: string })[], exams: GucExam[], courses: { key: string; code: string; seasonId?: number }[], now: number): HubDeadline[] {
  const out: HubDeadline[] = tracked.map((d) => ({ ...d }));
  for (const e of exams) {
    const when = examWhen(e);
    if (!when) continue;
    const place = [e.hall, e.seat ? "seat " + e.seat : ""].filter(Boolean).join(", ");
    const course = courses.filter((c) => sameCode(c.code, e.code)).sort((a, b) => (b.seasonId || 0) - (a.seasonId || 0))[0];
    const same = out.find((d) => d.source !== "portal" && sameCode(d.code, e.code) && d.kind === "exam" && Math.abs(Date.parse(d.due) - Date.parse(when.start)) < 864e5);
    const seat = { due: when.start, ...(when.end ? { ends: when.end } : {}), timeKnown: when.timed, ...(place ? { place } : {}) };
    if (same) { Object.assign(same, seat); delete same.either; continue; }
    const title = /mid|final|make-?up|re-?exam/i.test(e.type) ? e.type.replace(/\s+exam$/i, "") + " exam" : "Exam";
    out.push({ id: "exam-" + e.id, courseKey: course?.key || "", code: e.code, title: title.replace(/^\w/, (c) => c.toUpperCase()), source: "portal", kind: "exam", ...seat });
  }
  return out.map((d) => { const end = endsAt(d), done = end <= now; return { ...d, ...(done ? { done: true, removeAt: new Date(end + DONE_DAYS * 864e5).toISOString() } : {}) }; })
    .filter((d) => !d.done || Date.parse(d.removeAt!) > now)
    .sort((a, b) => (a.done === b.done ? (a.done ? Date.parse(b.due) - Date.parse(a.due) : Date.parse(a.due) - Date.parse(b.due)) : a.done ? 1 : -1));
}

/** Where an upcoming item sits in Coming up: today, tomorrow, the rest of this GUC week (Saturday to Friday), next week,
 *  or later; Cairo days. */
export function dueGroup(due: string | number, now: number): "Today" | "Tomorrow" | "This week" | "Next week" | "Later" {
  const t = typeof due === "number" ? due : Date.parse(due), d = cairo(t).ymd, today = cairo(now).ymd;
  if (d <= today) return "Today";
  if (d === addDays(today, 1)) return "Tomorrow";
  const start = weekStart(now);
  if (d < addDays(start, 7)) return "This week";
  return d < addDays(start, 14) ? "Next week" : "Later";
}
