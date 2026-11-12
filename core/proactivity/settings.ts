// Settings → Proactivity (docs/MAIN-THREAD.md "Proactivity"): how much Clem speaks, quiet hours and the timed jobs.
// What is worth telling is Clem's judgement, not a switch per kind of news (user, 2026-11-12). Kept in the engine (organizer_settings) so a VPS host reads the same thing.
// Times are Cairo wall-clock times.
import { z } from "zod";
import { cairo } from "../guc/hub.ts";

export const LEVELS = ["quiet", "balanced", "proactive"] as const;
export type Level = (typeof LEVELS)[number];
export const CHANNELS = ["app", "push", "telegram"] as const;
export type Channel = (typeof CHANNELS)[number];
export const JOB_KINDS = ["morning", "midday", "evening", "weekly"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const job = z.object({ on: z.boolean(), time: hm, day: z.number().int().min(0).max(6).optional() });
/** When the person likes to study (docs/MAIN-THREAD.md "Calendar, reminders and study time"): the days (0 = Sunday)
 *  and hours study sessions may go in, and the gap kept around anything else. How long a session is and any reminder
 *  for it are the person's to say in chat. (Older saves also carried minutes, perDay and remind; they are dropped.) */
export const studyPrefs = z.object({
  days: z.array(z.number().int().min(0).max(6)).max(7),
  from: hm, to: hm,
  gap: z.number().int().min(0).max(120),
});
export type StudyPrefs = z.infer<typeof studyPrefs>;
export const proSettings = z.object({
  level: z.enum(LEVELS),
  quiet: z.object({ on: z.boolean(), from: hm, to: hm }),
  jobs: z.object(Object.fromEntries(JOB_KINDS.map((k) => [k, job])) as Record<JobKind, typeof job>),
  /** Hours before a deadline that it is reminded (default 48 and 3). */
  deadlineHours: z.array(z.number().int().min(1).max(168)).min(1).max(4),
  study: studyPrefs,
  /** Also put the person's reminders in Clem's own "Clem" calendar in Google Calendar (calendar.app.created). */
  googleReminders: z.boolean(),
});
export type ProSettings = z.infer<typeof proSettings>;
/** A change from Settings: any part, merged into what is saved. */
export const proPatch = z.object({
  level: z.enum(LEVELS).optional(),
  quiet: proSettings.shape.quiet.partial().optional(),
  jobs: z.partialRecord(z.enum(JOB_KINDS), job.partial()).optional(),
  deadlineHours: proSettings.shape.deadlineHours.optional(),
  study: studyPrefs.partial().optional(),
  googleReminders: z.boolean().optional(),
});
export type ProPatch = z.infer<typeof proPatch>;

export const DEFAULT_PRO: ProSettings = {
  level: "proactive",
  quiet: { on: true, from: "23:00", to: "07:30" },
  // Friday is the GUC weekend: the weekly review comes then.
  jobs: { morning: { on: true, time: "07:30" }, midday: { on: true, time: "13:30" }, evening: { on: true, time: "21:00" }, weekly: { on: true, time: "18:00", day: 5 } },
  deadlineHours: [48, 3],
  // Saturday to Thursday (Friday is the GUC weekend), late afternoon and evening, 10 minutes kept around other things.
  study: { days: [6, 0, 1, 2, 3, 4], from: "16:00", to: "22:00", gap: 10 },
  googleReminders: false,
};

/** Saved settings read leniently: anything missing or broken is the default. Older saves also carried a switch and
 *  channels per kind of news (`events`); they are dropped. */
export function readPro(saved: unknown): ProSettings {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<ProSettings>;
  const merged = mergePro(DEFAULT_PRO, { level: s.level, quiet: s.quiet, jobs: s.jobs, deadlineHours: s.deadlineHours, study: s.study, googleReminders: s.googleReminders } as ProPatch);
  const ok = proSettings.safeParse(merged);
  return ok.success ? ok.data : structuredClone(DEFAULT_PRO);
}
export function mergePro(cur: ProSettings, patch: ProPatch): ProSettings {
  const jobs = { ...cur.jobs };
  for (const [k, v] of Object.entries(patch.jobs || {})) if (v && k in jobs) jobs[k as JobKind] = { ...jobs[k as JobKind], ...v };
  return { level: patch.level || cur.level, quiet: { ...cur.quiet, ...(patch.quiet || {}) }, jobs, deadlineHours: patch.deadlineHours ? [...new Set(patch.deadlineHours)].sort((a, b) => b - a) : cur.deadlineHours,
    study: { ...cur.study, ...(patch.study || {}), ...(patch.study?.days ? { days: [...new Set(patch.study.days)].sort((a, b) => a - b) } : {}) },
    googleReminders: patch.googleReminders ?? cur.googleReminders };
}

/** A timed job's pg-boss cron line (Cairo time): daily, or weekly on its day. */
export const jobCron = (j: ProSettings["jobs"][JobKind]) => { const [h, m] = j.time.split(":").map(Number); return `${m} ${h} * * ${j.day ?? "*"}`; };

const minutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
/** Whether `t` falls in quiet hours (they may run past midnight). */
export function inQuiet(s: ProSettings, t: number) {
  if (!s.quiet.on || s.quiet.from === s.quiet.to) return false;
  const now = minutes(cairo(t).time), from = minutes(s.quiet.from), to = minutes(s.quiet.to);
  return from < to ? now >= from && now < to : now >= from || now < to;
}
/** When the quiet hours holding `t` end (`t` itself outside them). */
export function quietEnd(s: ProSettings, t: number) {
  if (!inQuiet(s, t)) return t;
  const wait = (minutes(s.quiet.to) - minutes(cairo(t).time) + 1440) % 1440;
  return Math.floor(t / 60_000) * 60_000 + wait * 60_000;
}

/** Wall-clock `hm` on Cairo day `ymd` as an instant (daylight saving included). */
export function cairoAt(ymd: string, hm = "00:00") {
  const want = Date.parse(`${ymd}T${hm}:00Z`);
  let t = want;
  for (let i = 0; i < 3; i++) { const c = cairo(t); t -= Date.parse(`${c.ymd}T${c.time}:00Z`) - want; }
  return t;
}

/** Where the person can be reached away from the window: the desktop and, once paired, Telegram. */
export const OUTWARD = ["push", "telegram"] as const satisfies readonly Channel[];
/** What is said and where, by level. `urgent`: a 3-hour deadline reminder, a clash, something waiting on a tap.
 *  `news`: something Clem judged worth telling (a change that matters to them, a deadline). Quiet speaks only for urgent
 *  things; balanced adds the timed briefs and news; proactive says everything worth saying. */
export type Say = { post: boolean; channels: Channel[] };
export function delivery(s: ProSettings, what: { news?: boolean; job?: JobKind; urgent?: boolean }): Say {
  const speak = s.level === "proactive" || !!what.urgent || (s.level === "balanced" && (!!what.job && what.job !== "midday" || !!what.news));
  if (!speak) return { post: false, channels: [] };
  // The app is where every post lands; the desktop and Telegram only for news (a job's card is not worth a buzz).
  return { post: true, channels: ["app", ...(what.news || what.urgent) && (s.level !== "quiet" || what.urgent) ? OUTWARD : []] };
}
