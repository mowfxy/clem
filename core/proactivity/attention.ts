// What deserves the person's attention (docs/MAIN-THREAD.md "Proactivity" → Attention). Every change gets a level:
// urgent (pushed now), notify (a message of its own), digest (named in a closing line) or silent. Rules decide; only
// announcements the rules can't place go to the organizer model, batched into the sweep's one short call. The person
// teaches the filter by saying so ("stop telling me about new files in Math": a mute, clem.mute). Timetable changes are
// found here too. Pure.
import { stableId } from "../guc/parse.ts";
import { addDays, cairo } from "../guc/hub.ts";
import type { GucSlot } from "../guc/types.ts";
import type { Level } from "./settings.ts";

export type Importance = "urgent" | "notify" | "digest" | "silent";
export type ChangeKind = "new_grade" | "new_announcement" | "new_material" | "file_saved" | "deadline_added" | "deadline_changed" | "schedule_changed" | "slot_cancelled" | "slot_moved" | "slot_added" | "room_changed" | "exam_posted" | "new_mail";
/** A change since the last sweep: a GUC event, or a timetable change found by `slotChanges`. `soon`: it is about today
 *  or tomorrow. `everyone`: a mail GUC sent to all students that names none of this student's courses
 *  (core/guc/mail-about.ts); `mine`: a mail written to the student alone. */
export type Change = { key: string; kind: ChangeKind; title: string; detail: string; subjectId?: string; code?: string; materialId?: string; soon?: boolean; day?: string; start?: string; everyone?: true; mine?: true };
export type Mute = { kind: ChangeKind; subjectId?: string; words?: string[] };
/** `say`: the organizer's own line for it, in Clem's voice (when the model judged it). */
export type Rated = { level: Importance; why: string; ambiguous?: true; say?: string };

/** Words that make an announcement worth a message. */
export const ACTION_WORDS = /\b(cancel(?:l?ed|lation)?|postpone[ds]?|moved?|reschedul\w*|deadline|due|submit|submission|quiz(?:zes)?|exams?|midterms?|finals?|assignments?|in-?class|mandatory|attendance|compensation|make-?up|room|venue|hall|location|extra (?:lecture|tutorial|lab|class|session))\b/i;
const URGENT_WORDS = /\b(cancel(?:l?ed|lation)?|postpone[ds]?|today|tonight|tomorrow|now|immediately|urgent)\b/i;
const TRIVIAL = /^(welcome|hello|hi|dear (?:all|students)[,.!]?\s*(?:good luck|thanks?|thank you)|good luck|thanks?|thank you|reminder:? (?:have a|enjoy))\b/i;
const ROUTINE = /\b(slides?|lecture notes?|uploaded|posted the|recording|tutorial sheet|practice sheet|solutions?)\b/i;

export const muteKey = (m: Mute) => `${m.kind}:${m.subjectId || "*"}:${(m.words || []).join(",")}`;
/** The mute a told change makes (its kind, in its subject): what an old message's Mute button made. */
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
      // Mail for every student is not this student's news: it stays in the Mail tab, and the model never reads it.
      if (c.everyone) return { level: "silent", why: "Sent to everyone." };
      // Mail has its say in the subject line too ("MATH301 Extra Lecture").
      const body = (c.kind === "new_mail" ? c.title.replace(/^Email from [^:]*:s*/, "") + " " : "") + c.detail.trim();
      if (ACTION_WORDS.test(body)) return { level: URGENT_WORDS.test(body) && /\b(cancel|postpone|moved?|reschedul)/i.test(body) ? "urgent" : "notify", why: "It asks something of you." };
      if (!body || body.length < 25 || TRIVIAL.test(body)) return { level: "silent", why: "Nothing to act on." };
      if (ROUTINE.test(body)) return { level: "digest", why: "Routine." };
      if (c.mine) return { level: "notify", why: "Written to you." };
      return { level: "digest", why: "Unclear.", ambiguous: true };
    }
  }
}

/** One batch, ready for the organizer: everything that may be told, numbered, each with as much of the whole post as
 *  fits (about 900 characters an item within a budget; line breaks read as " / "). `label`: what it is and whose
 *  course, before its text. Empty when there is none. */
export function rateLines(items: Change[], label: (c: Change) => string = (c) => c.title, budget = 6000) {
  const each = Math.max(280, Math.min(900, Math.floor(budget / Math.max(1, items.length))));
  return items.map((c, i) => `${i}. ${label(c)}: ${c.detail.replace(/\s*\n+\s*/g, " / ").replace(/\s+/g, " ").trim().slice(0, each)}`).join("\n");
}
/** The model's levels for a batch ("levels":[{"i":0,"level":"notify","why":"…","say":"…","same":2}]); anything
 *  malformed keeps the rules' level. `same`: an earlier item it repeats (told once, with that one). */
export function readLevels(json: unknown, n: number): Map<number, Rated & { same?: number }> {
  const out = new Map<number, Rated & { same?: number }>();
  for (const x of Array.isArray((json as { levels?: unknown })?.levels) ? (json as { levels: any[] }).levels : []) {
    const i = Number(x?.i), level = x?.level, same = x?.same === undefined || x?.same === null ? NaN : Number(x.same);
    if (Number.isInteger(i) && i >= 0 && i < n && ["urgent", "notify", "digest", "silent"].includes(level)) {
      // Plain text: no fences (a card can't be smuggled in), no markdown marks, one paragraph.
      const say = typeof x.say === "string" ? x.say.replace(/```[\s\S]*?(```|$)/g, "").replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 500) : "";
      out.set(i, { level, why: String(x.why || "").slice(0, 160) || "The organizer's call.", ...(say.length >= 3 ? { say } : {}), ...(Number.isInteger(same) && same >= 0 && same < i ? { same } : {}) });
    }
  }
  return out;
}

/** The kinds of news a person names in words ("stop telling me about new files"), for a mute made by text. */
export const MUTE_KINDS: Record<string, ChangeKind[]> = {
  files: ["new_material"], announcements: ["new_announcement"], mail: ["new_mail"], grades: ["new_grade"],
  deadlines: ["deadline_added", "deadline_changed"], timetable: ["slot_cancelled", "slot_moved", "slot_added", "room_changed"], exams: ["exam_posted"],
};
/** What a mute covers, in words: "new files in Physics (with “lab”)". */
export const muteText = (m: Mute, name: (id?: string) => string | undefined = () => undefined) => {
  const what = (Object.entries(MUTE_KINDS).find(([, ks]) => ks.includes(m.kind))?.[0] || m.kind.replace(/_/g, " ")).replace(/^files$/, "new files");
  return `${what}${m.subjectId ? ` in ${name(m.subjectId) || "one subject"}` : ""}${m.words?.length ? ` (with “${m.words.join("”, “")}”)` : ""}`;
};

const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** The next Cairo day (from `now`, within a week) that is `weekday`. */
const nextDay = (weekday: string, now: number) => { const c = cairo(now), w = WEEK.indexOf(weekday.toLowerCase()); return w < 0 ? undefined : addDays(c.ymd, (w - c.weekday + 7) % 7); };
/** Timetable changes between two reads of the GUC schedule: a class gone (cancelled), at another time (moved), in
 *  another room, or new. A class is the same class by course, type and group. */
export function slotChanges(before: GucSlot[], after: GucSlot[], now: number, subjectOf: (code: string, name?: string) => string | undefined = () => undefined): Change[] {
  // The same class by course name, type and group, never by code: the portal's cell gives the course's name, and a
  // code resolved later ("Mathematics III" becoming "MATH 301") is not a class cancelled and another added.
  const id = (s: GucSlot) => [(s.name || s.code).toLowerCase().replace(/\s+/g, " ").trim(), s.type, s.group].join("|"), at = (s: GucSlot) => `${s.day} ${s.start}`;
  const today = cairo(now).ymd, tomorrow = addDays(today, 1), out: Change[] = [];
  const course = (s: GucSlot) => (/^[A-Z]{2,5} ?\d{3}/.test(s.code) ? s.code : s.name || s.code);
  const name = (s: GucSlot) => `${course(s)} ${s.type}`.trim();
  const base = (s: GucSlot, kind: ChangeKind, title: string, detail: string, key: string): Change => {
    const day = nextDay(s.day, now), subject = subjectOf(s.code, s.name);
    return { key: "slot:" + stableId(kind + "|" + key), kind, title, detail, ...(subject ? { subjectId: subject } : {}), code: course(s), ...(day ? { day, soon: day === today || day === tomorrow } : {}), start: s.start };
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
      if (n) out.push(base(n, "slot_moved", `${name(n)} moved to ${n.day} ${n.start}`, `${o.day} ${o.start} → ${n.day} ${n.start}${n.location ? " · " + n.location : ""}`, `${k}|${at(o)}|${at(n)}`));
      else out.push(base(o, "slot_cancelled", `${name(o)} on ${o.day} ${o.start} is cancelled`, `Not on the schedule any more`, `${k}|${at(o)}`));
    }
    for (const n of news) out.push(base(n, "slot_added", `New class: ${name(n)} on ${n.day} ${n.start}`, n.location || "", `${k}|${at(n)}`));
  }
  for (const [k, news] of now_) if (!was.has(k)) for (const n of news) out.push(base(n, "slot_added", `New class: ${name(n)} on ${n.day} ${n.start}`, n.location || "", `${k}|${at(n)}`));
  return out;
}
