// The organizer's tools for the AI (kinetra actions "clem.*", guide in calendar.ts CALENDAR_GUIDE): the schedule,
// reminders, study time, watches, routines, and, since what Clem says by itself has no buttons, what the person steers
// by text (mute, unmute, undo). Argument checks and the compact text each answer is written as: facts, never a card to
// embed. Pure; the engine's organizer runs them (desktop/engine/organizer.ts), from the window (desktop/main.ts), from
// Telegram through it, and on the VPS worker.
import { z } from "zod";
import { cairo } from "../guc/hub.ts";
import { MUTE_KINDS, type ChangeKind } from "./attention.ts";
import { busyList, clashText, dayLabel, type Busy } from "./calendar.ts";
import type { Slot, Timed } from "./rules.ts";
import { proPatch, type ProSettings, type StudyPrefs } from "./settings.ts";

export const CLEM_ACTIONS = ["clem.calendar", "clem.remind", "clem.reminders", "clem.unremind", "clem.study", "clem.prefs", "clem.routine", "clem.routines", "clem.unroutine", "clem.run_routine",
  "clem.watch", "clem.unwatch", "clem.watches", "clem.mute", "clem.unmute", "clem.mutes", "clem.undo"] as const;
export type ClemAction = (typeof CLEM_ACTIONS)[number];
/** Names a model may guess, read as the action they mean. */
const ALIASES: Record<string, ClemAction> = { "clem.agenda": "clem.calendar", "clem.schedule": "clem.calendar", "clem.reminder": "clem.remind", "clem.cancel_reminder": "clem.unremind", "clem.plan_study": "clem.study", "clem.preferences": "clem.prefs", "clem.automation": "clem.routine", "clem.webhook": "clem.routine", "clem.list_routines": "clem.routines", "clem.stop_routine": "clem.unroutine",
  "clem.stop_watch": "clem.unwatch", "clem.list_watches": "clem.watches", "clem.list_mutes": "clem.mutes", "clem.silence": "clem.mute", "clem.revert": "clem.undo" };
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
  // Everything the person can tell Clem about how it runs: how much it speaks, quiet hours, its routines, study time.
  "clem.prefs": proPatch.omit({ deadlineHours: true }).refine((p) => Object.values(p).some((v) => v !== undefined), "says nothing to change"),
  // Checked in full by the organizer (core/proactivity/routines.ts), which says exactly what was wrong.
  "clem.routine": z.object({ title: z.string() }).passthrough(),
  "clem.routines": z.object({}),
  "clem.unroutine": z.object({ id: z.string().regex(/^rt[\w-]{4,40}$/) }),
  "clem.run_routine": z.object({ id: z.string().regex(/^rt[\w-]{4,40}$/) }),
  "clem.watch": z.object({ text: z.string().trim().min(3).max(300), repeat: z.boolean().optional(), push: z.boolean().optional() }),
  "clem.unwatch": z.object({ id: z.string().regex(/^[\w-]{1,80}$/) }),
  "clem.watches": z.object({}),
  // A kind in the person's words ("files", "announcements"…, see muteKinds), optionally one subject and some words.
  "clem.mute": z.object({ kind: z.string().trim().min(2).max(40), subject, words: z.union([z.string().trim().min(1).max(40), z.array(z.string().trim().min(1).max(40)).max(5)]).optional() }),
  "clem.unmute": z.object({ id: z.string().trim().min(3).max(200) }),
  "clem.mutes": z.object({}),
  "clem.undo": z.object({ what: z.string().trim().max(200).optional() }),
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

/** The kinds of news a mute names, read from the person's words ("new files", "emails", "classes") or a change kind. */
const MUTE_WORDS: [RegExp, string][] = [[/^(new )?(files?|materials?|slides?|uploads?|lectures?)$/, "files"], [/^(course )?(announcements?|posts?|news)$/, "announcements"], [/^(e-?mails?|mails?|inbox)$/, "mail"],
  [/^(grades?|marks?|results?)$/, "grades"], [/^(deadlines?|due dates?)$/, "deadlines"], [/^(timetable|schedule|classes|class changes?|rooms?)$/, "timetable"], [/^(exams?|exam seats?|seats?)$/, "exams"]];
export function muteKinds(kind: string): ChangeKind[] | null {
  const k = kind.trim().toLowerCase();
  const named = MUTE_WORDS.find(([re]) => re.test(k))?.[1];
  if (named) return MUTE_KINDS[named];
  return (Object.values(MUTE_KINDS).flat() as string[]).includes(k) ? [k as ChangeKind] : null;
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
const tag = (b: Busy) => (b.source === "class" ? "class" : b.space ? `plan · ${b.space}` : "plan");
const JOB_NAMES = { morning: "morning plan", midday: "midday check", evening: "evening prep", weekly: "weekly review" } as const;
const LEVEL_NAMES = { quiet: "only what can't wait", balanced: "what matters, with briefs", proactive: "anything that will help" } as const;
/** How Clem runs for this person, in one short paragraph (clem.prefs' answer and the first-setup question). */
export const settingsText = (s: ProSettings) => [
  `How much Clem speaks: ${s.level} (${LEVEL_NAMES[s.level]}).`,
  `Quiet hours: ${s.quiet.on ? `${s.quiet.from}–${s.quiet.to}` : "off"}.`,
  "Routines: " + (Object.keys(JOB_NAMES) as (keyof typeof JOB_NAMES)[]).map((k) => `${JOB_NAMES[k]} ${s.jobs[k].on ? `${s.jobs[k].day !== undefined ? WD[s.jobs[k].day!] + "s " : ""}${s.jobs[k].time}` : "off"}`).join(", ") + ".",
  prefsText(s.study),
].join(" ");
export const prefsText = (p: StudyPrefs) => `Study preferences: ${p.days.length === 7 ? "every day" : p.days.map((d) => WD[d].slice(0, 3)).join(", ")}, ${p.from}–${p.to}, ${p.gap} min clear around other things.`;

/** The agenda for some days: classes and timed plan items, every clash between them, and the study preferences. */
export function agendaText(o: { days: string[]; slots: Slot[]; timed: Timed[]; prefs: StudyPrefs; now: number }) {
  const busy = busyList({ slots: o.slots, timed: o.timed });
  const out: string[] = [];
  for (const day of o.days) {
    const items = busy.filter((b) => b.day === day).sort((a, b) => a.start - b.start);
    out.push(`${dayLabel(day)}${day === cairo(o.now).ymd ? " (today)" : ""}:`);
    if (!items.length) out.push("- nothing scheduled");
    for (const b of items) out.push(`- ${hhmm(b.start)}–${hhmm(b.end)} ${b.title} (${tag(b)})`);
  }
  const clashes: { a: Busy; b: Busy }[] = [];
  for (const day of o.days) {
    const list = busy.filter((b) => b.day === day).sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].start < list[i].end; j++) {
      const pair = [list[i].source, list[j].source].sort().join("+");
      if (pair === "class+plan") clashes.push({ a: list[i], b: list[j] });
    }
  }
  out.push(clashes.length ? "Clashes:\n" + clashes.map((c) => "- " + clashText(c)).join("\n") : "No clashes.");
  out.push(prefsText(o.prefs));
  return out.join("\n");
}

export type ReminderRow = { id: string; text: string; at: number; repeat?: "daily" | "weekly"; space?: string; source: string };
export const remindersText = (rows: ReminderRow[]) => !rows.length ? "No upcoming reminders."
  : rows.map((r) => `- ${r.id}: ${dayLabel(cairo(r.at).ymd)} ${cairo(r.at).time} · ${r.text}${r.space ? ` (${r.space})` : ""}${r.repeat ? ` · every ${r.repeat === "daily" ? "day" : "week"}` : ""}`).join("\n");
