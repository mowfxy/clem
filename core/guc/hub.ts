// The GUC hub's shared shapes and pure helpers: the read API's results, the Sat–Thu week grid, deadline order and
// relative times in Cairo, semester order and the hub's #/app/guc routes. No I/O, no cheerio: the window imports it.
import type { GucCoursework, GucErrorKind, GucExam, GucMail, GucMidterm, GucSlot } from "./types.ts";

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
export type HubDeadline = { id: string; courseKey: string; code: string; title: string; due: string; source: string; note?: string };
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
