// The organizer's calendar, reminder and study tools for the AI (kinetra actions "clem.*", guide in calendar.ts
// CALENDAR_GUIDE): argument checks and the compact text each answer is written as. Pure; the engine's organizer runs
// them (desktop/engine/organizer.ts) and desktop/main.ts dispatches them.
import { z } from "zod";
import { cairo } from "../guc/hub.ts";
import { busyList, calendarClashes, clashText, dayLabel, type Busy, type CalEvent } from "./calendar.ts";
import type { Slot, Timed } from "./rules.ts";
import { studyPrefs, type StudyPrefs } from "./settings.ts";

export const CLEM_ACTIONS = ["clem.calendar", "clem.remind", "clem.reminders", "clem.unremind", "clem.study", "clem.prefs"] as const;
export type ClemAction = (typeof CLEM_ACTIONS)[number];
/** Names a model may guess, read as the action they mean. */
const ALIASES: Record<string, ClemAction> = { "clem.agenda": "clem.calendar", "clem.schedule": "clem.calendar", "clem.reminder": "clem.remind", "clem.cancel_reminder": "clem.unremind", "clem.plan_study": "clem.study", "clem.preferences": "clem.prefs" };
export function clemAction(action: unknown): ClemAction | null {
  const a = String(action || "");
  return (CLEM_ACTIONS as readonly string[]).includes(a) ? (a as ClemAction) : ALIASES[a] || null;
}
export const isClemAction = (action: unknown) => clemAction(action) !== null;

const subject = z.string().trim().max(200).optional();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const clemArgs = {
  "clem.calendar": z.object({ range: z.string().trim().max(60).optional() }),
  "clem.remind": z.object({ text: z.string().trim().min(2).max(300), at: z.string().trim().min(2).max(80), before: z.number().int().min(0).max(10_080).optional(), subject, repeat: z.enum(["daily", "weekly"]).optional() }),
  "clem.reminders": z.object({}),
  "clem.unremind": z.object({ id: z.string().regex(/^r[\w-]{1,40}$/) }),
  "clem.study": z.object({ subject, sessions: z.number().int().min(1).max(30), minutes: z.number().int().min(15).max(240).optional(), until: ymd, title: z.string().trim().min(2).max(120).optional() }),
  "clem.prefs": z.object({ study: studyPrefs.partial() }),
} satisfies Record<ClemAction, z.ZodType>;

/** A request's fields for `action`, checked (numbers sent as text are read); an error says what was wrong in one line. */
export function readClemArgs<A extends ClemAction>(action: A, request: Record<string, unknown>): { ok: true; args: z.infer<(typeof clemArgs)[A]> } | { ok: false; error: string } {
  const { action: _a, ...rest } = request;
  for (const k of ["before", "sessions", "minutes"]) if (typeof rest[k] === "string" && /^\d+$/.test(rest[k] as string)) rest[k] = Number(rest[k]);
  const r = (clemArgs[action] as z.ZodType).safeParse(rest);
  if (r.success) return { ok: true, args: r.data as never };
  const i = r.error.issues[0];
  return { ok: false, error: `${action}: ${i.path.join(".") || "request"} ${i.message.toLowerCase()}.` };
}

/** A subject or project named by id, @mention, course code or name (exact, then contained). */
export function findSpace(arg: string | undefined, spaces: { id: string; name: string; code?: string }[]) {
  const s = (arg || "").trim().replace(/^@/, "").toLowerCase();
  if (!s) return undefined;
  const squash = s.replace(/\s+/g, "");
  return spaces.find((x) => x.id === arg) || spaces.find((x) => x.code && x.code.toLowerCase().replace(/\s+/g, "") === squash)
    || spaces.find((x) => x.name.toLowerCase() === s) || spaces.find((x) => x.name.toLowerCase().includes(s) || s.includes(x.name.toLowerCase()));
}

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const tag = (b: Busy) => (b.source === "class" ? "class" : b.source === "calendar" ? "calendar" : b.space ? `plan · ${b.space}` : "plan");
export const prefsText = (p: StudyPrefs) => `Study preferences: ${p.days.length === 7 ? "every day" : p.days.map((d) => WD[d].slice(0, 3)).join(", ")}, ${p.from}–${p.to}, ${p.gap} min clear around other things.`;

/** The agenda for some days: everything timed, all-day calendar items, every clash, and the study preferences. */
export function agendaText(o: { days: string[]; slots: Slot[]; calendar: CalEvent[] | null; timed: Timed[]; prefs: StudyPrefs; now: number }) {
  const busy = busyList({ slots: o.slots, calendar: o.calendar || [], timed: o.timed });
  const out: string[] = [];
  for (const day of o.days) {
    const items = busy.filter((b) => b.day === day).sort((a, b) => a.start - b.start);
    const allDay = (o.calendar || []).filter((e) => e.allDay && e.start <= day && day < e.end);
    out.push(`${dayLabel(day)}${day === cairo(o.now).ymd ? " (today)" : ""}:`);
    if (!items.length && !allDay.length) out.push("- nothing scheduled");
    for (const e of allDay) out.push(`- all day: ${e.title} (calendar)`);
    for (const b of items) out.push(`- ${hhmm(b.start)}–${hhmm(b.end)} ${b.title} (${tag(b)})`);
  }
  const clashes = o.days.length ? calendarClashes(busy, o.days[0], o.days.length).filter((c) => o.days.includes(c.a.day)) : [];
  // Classes against plan items too, here: this answer is the one place all of it is seen together.
  for (const day of o.days) {
    const list = busy.filter((b) => b.day === day).sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].start < list[i].end; j++) {
      const pair = [list[i].source, list[j].source].sort().join("+");
      if (pair === "class+plan") clashes.push({ a: list[i], b: list[j], key: "" });
    }
  }
  out.push(clashes.length ? "Clashes:\n" + clashes.map((c) => "- " + clashText(c)).join("\n") : "No clashes.");
  if (o.calendar === null) out.push("Google Calendar isn't connected (Settings → Connectors), so only classes and plans are shown.");
  out.push(prefsText(o.prefs));
  return out.join("\n");
}

export type ReminderRow = { id: string; text: string; at: number; repeat?: "daily" | "weekly"; space?: string; source: string };
export const remindersText = (rows: ReminderRow[]) => !rows.length ? "No upcoming reminders."
  : rows.map((r) => `- ${r.id}: ${dayLabel(cairo(r.at).ymd)} ${cairo(r.at).time} · ${r.text}${r.space ? ` (${r.space})` : ""}${r.repeat ? ` · every ${r.repeat === "daily" ? "day" : "week"}` : ""}`).join("\n");
