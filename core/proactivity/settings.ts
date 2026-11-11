// Settings → Proactivity (docs/MAIN-THREAD.md "Proactivity"): how much Clem speaks, quiet hours, which events reach
// which channel, and the timed jobs. Kept in the engine (organizer_settings) so a VPS host reads the same thing.
// Times are Cairo wall-clock times.
import { z } from "zod";
import { cairo } from "../guc/hub.ts";

export const LEVELS = ["quiet", "balanced", "proactive"] as const;
export type Level = (typeof LEVELS)[number];
/** What Clem can tell you about. `lecture`…`schedule` come from GUC; the rest from your plans, study sets and projects. */
export const EVENT_KINDS = ["lecture", "announcement", "grade", "deadline", "schedule", "plan", "study", "project", "followup"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const CHANNELS = ["app", "push", "telegram"] as const;
export type Channel = (typeof CHANNELS)[number];
export const JOB_KINDS = ["morning", "midday", "evening", "weekly"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const event = z.object({ on: z.boolean(), channels: z.array(z.enum(CHANNELS)).max(3) });
const job = z.object({ on: z.boolean(), time: hm, day: z.number().int().min(0).max(6).optional() });
export const proSettings = z.object({
  level: z.enum(LEVELS),
  quiet: z.object({ on: z.boolean(), from: hm, to: hm }),
  events: z.object(Object.fromEntries(EVENT_KINDS.map((k) => [k, event])) as Record<EventKind, typeof event>),
  jobs: z.object(Object.fromEntries(JOB_KINDS.map((k) => [k, job])) as Record<JobKind, typeof job>),
  /** Hours before a deadline that it is reminded (default 48 and 3). */
  deadlineHours: z.array(z.number().int().min(1).max(168)).min(1).max(4),
});
export type ProSettings = z.infer<typeof proSettings>;
/** A change from Settings: any part, merged into what is saved. */
export const proPatch = z.object({
  level: z.enum(LEVELS).optional(),
  quiet: proSettings.shape.quiet.partial().optional(),
  events: z.partialRecord(z.enum(EVENT_KINDS), event.partial()).optional(),
  jobs: z.partialRecord(z.enum(JOB_KINDS), job.partial()).optional(),
  deadlineHours: proSettings.shape.deadlineHours.optional(),
});
export type ProPatch = z.infer<typeof proPatch>;

const both: Channel[] = ["app", "push"];
export const DEFAULT_PRO: ProSettings = {
  level: "proactive",
  quiet: { on: true, from: "23:00", to: "07:30" },
  events: { lecture: { on: true, channels: both }, announcement: { on: true, channels: both }, grade: { on: true, channels: both }, deadline: { on: true, channels: both }, schedule: { on: true, channels: both }, plan: { on: true, channels: ["app"] }, study: { on: true, channels: ["app"] }, project: { on: true, channels: ["app"] }, followup: { on: true, channels: both } },
  // Friday is the GUC weekend: the weekly review comes then.
  jobs: { morning: { on: true, time: "07:30" }, midday: { on: true, time: "13:30" }, evening: { on: true, time: "21:00" }, weekly: { on: true, time: "18:00", day: 5 } },
  deadlineHours: [48, 3],
};

/** Saved settings read leniently: anything missing or broken is the default. */
export function readPro(saved: unknown): ProSettings {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<ProSettings>;
  const merged = mergePro(DEFAULT_PRO, { level: s.level, quiet: s.quiet, events: s.events, jobs: s.jobs, deadlineHours: s.deadlineHours } as ProPatch);
  const ok = proSettings.safeParse(merged);
  return ok.success ? ok.data : structuredClone(DEFAULT_PRO);
}
export function mergePro(cur: ProSettings, patch: ProPatch): ProSettings {
  const events = { ...cur.events }, jobs = { ...cur.jobs };
  for (const [k, v] of Object.entries(patch.events || {})) if (v && k in events) events[k as EventKind] = { ...events[k as EventKind], ...v };
  for (const [k, v] of Object.entries(patch.jobs || {})) if (v && k in jobs) jobs[k as JobKind] = { ...jobs[k as JobKind], ...v };
  return { level: patch.level || cur.level, quiet: { ...cur.quiet, ...(patch.quiet || {}) }, events, jobs, deadlineHours: patch.deadlineHours ? [...new Set(patch.deadlineHours)].sort((a, b) => b - a) : cur.deadlineHours };
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

/** What is said and where, by level. `urgent`: a 3-hour deadline reminder, a clash, something waiting on a tap. Quiet
 *  speaks only for urgent things; balanced adds the timed briefs and GUC news; proactive says everything turned on. */
export type Say = { post: boolean; channels: Channel[] };
export function delivery(s: ProSettings, what: { event?: EventKind; job?: JobKind; urgent?: boolean }): Say {
  const ev = what.event ? s.events[what.event] : undefined;
  if (ev && !ev.on) return { post: false, channels: [] };
  const speak = s.level === "proactive" || !!what.urgent || (s.level === "balanced" && (!!what.job && what.job !== "midday" || ["lecture", "announcement", "grade", "deadline", "schedule", "followup"].includes(what.event || "")));
  if (!speak) return { post: false, channels: [] };
  // The app is where every post lands; push and Telegram only for events (a job's card is not worth a buzz).
  const channels = (ev?.channels || ["app"]).filter((c) => c !== "app" && (s.level !== "quiet" || what.urgent));
  return { post: true, channels: ["app", ...channels] };
}
