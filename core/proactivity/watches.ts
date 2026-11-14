// Watches: "tell me when the Circuits midterm room is posted", "ping me if lab 3 moves", "watch for grades in Math"
// (docs/MAIN-THREAD.md "Proactivity" → Watches). A watch is the person's words plus a matcher: a subject, kinds of
// change, keywords and an end date. Every change is matched deterministically; only a partial keyword match is
// borderline and goes to the organizer in the sweep's one batched call. A watch fires once unless asked to repeat. Pure.
import * as chrono from "chrono-node";
import { z } from "zod";
import { addDays, cairo } from "../guc/hub.ts";
import type { Change, ChangeKind } from "./attention.ts";

const KINDS = ["new_grade", "new_announcement", "new_material", "file_saved", "deadline_added", "deadline_changed", "slot_cancelled", "slot_moved", "slot_added", "room_changed", "exam_posted", "new_mail"] as const satisfies readonly ChangeKind[];
export const watchSchema = z.object({
  id: z.string().regex(/^[\w-]{1,80}$/), text: z.string().trim().min(3).max(300),
  subjectId: z.string().max(80).optional(), kinds: z.array(z.enum(KINDS)).max(10), words: z.array(z.string().min(1).max(40)).max(8),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), repeat: z.boolean().optional(), channel: z.enum(["app", "push"]).optional(),
});
export type Watch = z.infer<typeof watchSchema>;
/** The one line every chat's AI is told about watches (byte-stable). */
export const WATCH_GUIDE = `- {"kinetra":{"action":"clem.watch","text":"<what to tell them about, in their words>","repeat":false}}: when the person asks to be told about something later ("tell me when the midterm room is posted", "ping me if lab 3 moves", "watch for grades in Math"), Clem watches every GUC change for it and tells them once (repeat: every time). Then confirm in one sentence what you will tell them. {"kinetra":{"action":"clem.watches"}} lists watches; {"kinetra":{"action":"clem.unwatch","id":"<id>"}} stops one.`;

const KIND_WORDS: [RegExp, Watch["kinds"]][] = [
  [/\bgrades?|marks?|results?\b/i, ["new_grade"]],
  [/\bdeadlines?|due\b/i, ["deadline_added", "deadline_changed"]],
  [/\bmoves?|moved|reschedul\w*|postpone\w*|cancel\w*|room|venue|hall\b/i, ["slot_moved", "slot_cancelled", "room_changed", "deadline_changed", "new_announcement"]],
  [/\bannounce\w*|posted|says?|news\b/i, ["new_announcement"]],
  [/\b(e-?mails?|inbox)\b/i, ["new_mail"]],
  [/\bseats?\b|\b(exam|final|midterm)s?\b.*\b(hall|room|venue)\b/i, ["exam_posted"]],
  [/\bslides?|lectures?|materials?|files?|uploads?|uploaded|sheets?|notes\b/i, ["new_material", "file_saved"]],
];
const STOP = new Set("tell me when the a an is are be if of for in on to at ping notify let know watch track keep eye out any new gets got get posted post moves move moved changes change grade grades deadline deadlines announcement announcements slides slide lecture lectures file files please and or my about there it this that whenever every time each always until by".split(" "));

/** A watch from the person's words. `spaces` resolve the subject by name or course code. */
export function parseWatch(text: string, spaces: { id: string; name: string; code?: string }[], now: number, id: string = crypto.randomUUID()): Watch {
  const low = text.toLowerCase(), squash = low.replace(/\s+/g, "");
  const subject = spaces.find((s) => s.code && squash.includes(s.code.toLowerCase().replace(/\s+/g, ""))) || spaces.filter((s) => low.includes(s.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  const kinds = [...new Set(KIND_WORDS.filter(([re]) => re.test(text)).flatMap(([, k]) => k))];
  let rest = low;
  if (subject) rest = rest.replace(subject.name.toLowerCase(), " ").replace(new RegExp((subject.code || "\u0000").toLowerCase().replace(/\s+/g, "\\s*"), "g"), " ");
  const date = chrono.parse(text, { instant: new Date(now), timezone: "EET" }, { forwardDate: true }).find((d) => /\b(until|till|by|before)\b/i.test(text.slice(Math.max(0, d.index - 8), d.index)));
  if (date) rest = rest.replace(date.text.toLowerCase(), " ");
  const words = [...new Set(rest.split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w) && (w.length > 2 || /\d/.test(w))))].slice(0, 6);
  return { id, text: text.trim().slice(0, 300), ...(subject ? { subjectId: subject.id } : {}), kinds, words, until: date ? cairo(date.start.date().getTime()).ymd : addDays(cairo(now).ymd, 60), ...(/\b(every time|each time|whenever|always|keep)\b/i.test(text) ? { repeat: true } : {}) };
}

/** Whether a change is what the watch waits for: yes, no, or maybe (some keywords, not all: the organizer decides). */
export function matchWatch(w: Watch, c: Change, now: number): "yes" | "maybe" | "no" {
  if (w.until && cairo(now).ymd > w.until) return "no";
  if (w.subjectId && c.subjectId !== w.subjectId) return "no";
  if (w.kinds.length && !(w.kinds as string[]).includes(c.kind) && !(c.kind === "file_saved" && w.kinds.includes("new_material"))) return "no";
  if (!w.words.length) return "yes";
  const text = `${c.title} ${c.detail}`.toLowerCase(), hits = w.words.filter((x) => new RegExp(`(^|[^\\p{L}\\p{N}])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(text)).length;
  return hits === w.words.length ? "yes" : hits ? "maybe" : "no";
}
/** Whether a watch still listens: not stopped, not past its end, and not already fired unless it repeats. */
export const live = (w: Watch, o: { fired: number; stopped?: boolean }, now: number) => !o.stopped && !(w.until && cairo(now).ymd > w.until) && (w.repeat || o.fired === 0);
/** How a watch reads back on its card. */
export function describeWatch(w: Watch, subject?: string) {
  return [subject, w.kinds.length ? undefined : "anything", w.words.length ? `“${w.words.join(" ")}”` : undefined, w.until ? `until ${w.until}` : undefined, w.repeat ? "every time" : "once"].filter(Boolean).join(" · ");
}
