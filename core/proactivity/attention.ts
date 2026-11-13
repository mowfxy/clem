// What deserves the person's attention (docs/MAIN-THREAD.md "Proactivity" → Attention). Every change gets a level:
// urgent (pushed now), notify (one message per sweep), digest (a line in the next card) or silent. Rules decide; only
// announcements the rules can't place go to the organizer model, batched into the sweep's one short call. The person
// teaches the filter with "Don't tell me about this kind of thing" (a mute). Timetable changes are found here too. Pure.
import { stableId } from "../guc/parse.ts";
import { addDays, cairo } from "../guc/hub.ts";
import type { GucSlot } from "../guc/types.ts";
import type { Level } from "./settings.ts";

export type Importance = "urgent" | "notify" | "digest" | "silent";
export type ChangeKind = "new_grade" | "new_announcement" | "new_material" | "file_saved" | "deadline_added" | "deadline_changed" | "schedule_changed" | "slot_cancelled" | "slot_moved" | "slot_added" | "room_changed" | "exam_posted" | "new_mail";
/** A change since the last sweep: a GUC event, or a timetable change found by `slotChanges`. `soon`: it is about today
 *  or tomorrow. */
export type Change = { key: string; kind: ChangeKind; title: string; detail: string; subjectId?: string; code?: string; materialId?: string; soon?: boolean; day?: string; start?: string };
export type Mute = { kind: ChangeKind; subjectId?: string; words?: string[] };
/** `say`: the organizer's own line for it, in Clem's voice (when the model judged it). */
export type Rated = { level: Importance; why: string; ambiguous?: true; say?: string };

/** Words that make an announcement worth a message. */
export const ACTION_WORDS = /\b(cancel(?:l?ed|lation)?|postpone[ds]?|moved?|reschedul\w*|deadline|due|submit|submission|quiz(?:zes)?|exams?|midterms?|finals?|mandatory|attendance|compensation|make-?up|room|venue|hall|location)\b/i;
const URGENT_WORDS = /\b(cancel(?:l?ed|lation)?|postpone[ds]?|today|tonight|tomorrow|now|immediately|urgent)\b/i;
const TRIVIAL = /^(welcome|hello|hi|dear (?:all|students)[,.!]?\s*(?:good luck|thanks?|thank you)|good luck|thanks?|thank you|reminder:? (?:have a|enjoy))\b/i;
const ROUTINE = /\b(slides?|lecture notes?|uploaded|posted the|recording|tutorial sheet|practice sheet|solutions?)\b/i;

export const muteKey = (m: Mute) => `${m.kind}:${m.subjectId || "*"}:${(m.words || []).join(",")}`;
/** The mute "Don't tell me about this kind of thing" makes from a change: its kind, in its subject. */
export const muteFor = (c: Change): Mute => ({ kind: c.kind === "file_saved" ? "new_material" : c.kind, ...(c.subjectId ? { subjectId: c.subjectId } : {}) });
const muted = (c: Change, mutes: Mute[]) => mutes.some((m) => (m.kind === c.kind || (m.kind === "new_material" && c.kind === "file_saved")) && (!m.subjectId || m.subjectId === c.subjectId) && (!m.words?.length || m.words.some((w) => (c.title + " " + c.detail).toLowerCase().includes(w.toLowerCase()))));

/** The rules' level for a change. An announcement they can't place is `digest` with `ambiguous` (the model may raise it). */
export function importance(c: Change, mutes: Mute[] = []): Rated {
  if (muted(c, mutes)) return { level: "silent", why: "You asked not to hear about these." };
  switch (c.kind) {
    case "slot_cancelled": case "slot_moved": case "room_changed": return { level: c.soon ? "urgent" : "notify", why: "Your timetable changed." };
    case "deadline_added": case "deadline_changed": return { level: c.soon ? "urgent" : "notify", why: "A deadline." };
    case "new_grade": return { level: "notify", why: "A grade." };
    case "exam_posted": return { level: "notify", why: "Where and when an exam is." };
    case "new_material": case "file_saved": case "slot_added": return { level: "digest", why: "Routine." };
    case "schedule_changed": return { level: "silent", why: "Said by the class changes." };
    case "new_mail": case "new_announcement": {
      const body = c.detail.trim();
      if (ACTION_WORDS.test(body)) return { level: URGENT_WORDS.test(body) && /\b(cancel|postpone|moved?|reschedul)/i.test(body) ? "urgent" : "notify", why: "It asks something of you." };
      if (!body || body.length < 25 || TRIVIAL.test(body)) return { level: "silent", why: "Nothing to act on." };
      if (ROUTINE.test(body)) return { level: "digest", why: "Routine." };
      return { level: "digest", why: "Unclear.", ambiguous: true };
    }
  }
}

/** Pushes a day, by level; the rest wait for the next card (digest). */
export const PUSH_CAP: Record<Level, number> = { quiet: 2, balanced: 5, proactive: 12 };
/** Splits pushes into what goes now and what joins the next digest, given how many went out today. Urgent first. */
export function capPushes<T extends { level: Importance }>(level: Level, sentToday: number, items: T[]) {
  const room = Math.max(0, PUSH_CAP[level] - sentToday), sorted = [...items].sort((a, b) => (a.level === "urgent" ? 0 : 1) - (b.level === "urgent" ? 0 : 1));
  return { push: sorted.slice(0, room), digest: sorted.slice(room) };
}

/** One batch, ready for the organizer: the ambiguous announcements to rate, numbered. Empty when there are none. */
export const rateLines = (items: Change[]) => items.map((c, i) => `${i}. ${c.title}: ${c.detail.replace(/\s+/g, " ").slice(0, 280)}`).join("\n");
/** The model's levels for a batch ("levels":[{"i":0,"level":"notify","why":"…","say":"…"}]); anything malformed keeps
 *  the rules' level. */
export function readLevels(json: unknown, n: number): Map<number, Rated> {
  const out = new Map<number, Rated>();
  for (const x of Array.isArray((json as { levels?: unknown })?.levels) ? (json as { levels: any[] }).levels : []) {
    const i = Number(x?.i), level = x?.level;
    if (Number.isInteger(i) && i >= 0 && i < n && ["urgent", "notify", "digest", "silent"].includes(level)) {
      const say = typeof x.say === "string" ? x.say.replace(/\s+/g, " ").trim().slice(0, 280) : "";
      out.set(i, { level, why: String(x.why || "").slice(0, 160) || "The organizer's call.", ...(say.length >= 3 ? { say } : {}) });
    }
  }
  return out;
}

const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** The next Cairo day (from `now`, within a week) that is `weekday`. */
const nextDay = (weekday: string, now: number) => { const c = cairo(now), w = WEEK.indexOf(weekday.toLowerCase()); return w < 0 ? undefined : addDays(c.ymd, (w - c.weekday + 7) % 7); };
/** Timetable changes between two reads of the GUC schedule: a class gone (cancelled), at another time (moved), in
 *  another room, or new. A class is the same class by course, type and group. */
export function slotChanges(before: GucSlot[], after: GucSlot[], now: number, subjectOf: (code: string) => string | undefined = () => undefined): Change[] {
  const id = (s: GucSlot) => [s.code, s.type, s.group].join("|"), at = (s: GucSlot) => `${s.day} ${s.start}`;
  const today = cairo(now).ymd, tomorrow = addDays(today, 1), out: Change[] = [];
  const name = (s: GucSlot) => `${s.code} ${s.type}`.trim();
  const base = (s: GucSlot, kind: ChangeKind, title: string, detail: string, key: string): Change => {
    const day = nextDay(s.day, now);
    return { key: "slot:" + stableId(kind + "|" + key), kind, title, detail, ...(subjectOf(s.code) ? { subjectId: subjectOf(s.code) } : {}), code: s.code, ...(day ? { day, soon: day === today || day === tomorrow } : {}), start: s.start };
  };
  const was = new Map<string, GucSlot[]>(), now_ = new Map<string, GucSlot[]>();
  for (const s of before) was.set(id(s), [...(was.get(id(s)) || []), s]);
  for (const s of after) now_.set(id(s), [...(now_.get(id(s)) || []), s]);
  for (const [k, olds] of was) {
    const news = [...(now_.get(k) || [])], gone: GucSlot[] = [];
    for (const o of olds) {
      const same = news.findIndex((n) => at(n) === at(o));
      if (same >= 0) {
        const n = news.splice(same, 1)[0];
        if (n.location !== o.location && n.location && o.location) out.push(base(n, "room_changed", `${name(n)} on ${n.day} is now in ${n.location}`, `${o.location} → ${n.location}`, `${k}|${at(n)}|${n.location}`));
      } else gone.push(o);
    }
    for (const o of gone) {
      const n = news.shift();
      if (n) out.push(base(n, "slot_moved", `${name(o)} moved to ${n.day} ${n.start}`, `${o.day} ${o.start} → ${n.day} ${n.start}${n.location ? " · " + n.location : ""}`, `${k}|${at(o)}|${at(n)}`));
      else out.push(base(o, "slot_cancelled", `${name(o)} on ${o.day} ${o.start} is cancelled`, `Not on the schedule any more`, `${k}|${at(o)}`));
    }
    for (const n of news) out.push(base(n, "slot_added", `New class: ${name(n)} on ${n.day} ${n.start}`, n.location || "", `${k}|${at(n)}`));
  }
  for (const [k, news] of now_) if (!was.has(k)) for (const n of news) out.push(base(n, "slot_added", `New class: ${name(n)} on ${n.day} ${n.start}`, n.location || "", `${k}|${at(n)}`));
  return out;
}
