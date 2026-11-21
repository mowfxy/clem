// Corrections the person makes in words (docs/GUC-VPS-ENGINE.md → Corrections): an item Clem read wrong is removed,
// edited, marked done or annotated, and what it taught becomes a rule the deadline reader is given and the code
// enforces. Each one is keyed to a stable identity of what it corrects: the item's id, the fingerprint of what it is
// (its course and "quiz|2", or its normalized title), and the message it was read from. So the next sync, a re-read or
// a new reader finds it again and the correction holds; a NEW message about the same item is news and shows. Pure: the
// engine stores them (desktop/engine/corrections.ts) and applies them at sync time (guc-sync.ts) and read time
// (guc-read.ts).
import { itemKey, type CourseText } from "./deadline-ai.ts";
import { DONE_DAYS, endsAt } from "./hub.ts";
import type { GucDeadline } from "./types.ts";

/** hide: gone from Coming up · edit: its title, date, time or place changed · done: shown as done · note: a note added
 *  (the portal's own records can only be hidden or annotated) · rule: something learned · link: a subject's course
 *  link changed (undo puts the old one back) · add: an item the person told Clem about that no post gave it (kept in
 *  Coming up through every sync until the person removes it or a post brings the same item). */
export type CorrectionKind = "hide" | "edit" | "done" | "note" | "rule" | "link" | "add";
/** What a correction taught. max_age: texts sent more than `days` before Clem reads them create nothing. ignore: texts
 *  from a sender, or one message (`ref`), or items whose title or note has one of `words`, create nothing. note: a plain
 *  sentence the reader follows (nothing to enforce in code). */
export type Rule = { type: "max_age"; days: number } | { type: "ignore"; from?: string; words?: string[]; ref?: string } | { type: "note" };
export type Correction = {
  id: string; kind: CorrectionKind; at: number; label: string;
  itemId?: string; sourceRef?: string; fingerprint?: string; courseKey?: string;
  /** edit: { title?, due?, timeKnown?, place? } · note: { note } · rule: { rule, text } · link: { subjectId, from?, to? } · add: { item }. */
  patch: Record<string, any>;
  /** The item as it was, put back on undo. */
  before?: unknown;
};
type Item = Pick<GucDeadline, "id" | "courseKey" | "title" | "kind" | "ref" | "due" | "timeKnown" | "note" | "place"> & { either?: string; done?: boolean; removeAt?: string; ends?: string };

const plain = (s: string) => s.toLowerCase().replace(/\b[a-z]{2,5}\s?\d{3}[a-z]?\b/g, " ").replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
/** What an item is, stably: its course and "quiz|2" (however the post or mail named it), else its title's words. */
export const fingerprint = (d: Pick<GucDeadline, "courseKey" | "title" | "kind">) => `${d.courseKey}|${itemKey(d.title, d.kind) || plain(d.title)}`;

/** A correction is about this item: the same id or the same fingerprint (in the same course), and read from the same
 *  message, when both say which. */
export function matches(c: Correction, d: Item) {
  if (c.kind === "rule" || c.kind === "link" || c.patch?.target) return false;
  if (c.courseKey && d.courseKey && c.courseKey !== d.courseKey) return false;
  if (!((c.itemId && c.itemId === d.id) || (c.fingerprint && c.fingerprint === fingerprint(d)))) return false;
  return !c.sourceRef || !d.ref || c.sourceRef === d.ref;
}

/** The list with the person's corrections applied, oldest first so the latest wins: hidden items leave, edits and notes
 *  change them. `hub`: the read-time list (HubDeadline), where "done" shows the item as done until DONE_DAYS after;
 *  at sync time done items are kept as they are. The learned rules' ignored items leave too. */
export function applyCorrections<T extends Item>(list: T[], corrections: Correction[], o: { now: number; hub?: boolean; /** Sync time: the one course being read (its added items join). */ course?: string }): T[] {
  const live = [...corrections].sort((a, b) => a.at - b.at), rules = live.filter((c) => c.kind === "rule");
  // Items the person added that nothing read since has brought (same id or the same quiz/assignment of the course).
  const added = live.filter((c) => c.kind === "add" && c.patch?.item && (!o.course || c.courseKey === o.course)
    && !list.some((d) => d.id === c.patch.item.id || (!!c.fingerprint && fingerprint(d) === c.fingerprint && d.courseKey === c.patch.item.courseKey))).map((c) => c.patch.item as T);
  const out: T[] = [];
  for (const item of [...list, ...added]) {
    let d: T = item, hidden = false;
    for (const c of live) {
      if (!matches(c, d)) continue;
      if (c.kind === "hide") hidden = true;
      else if (c.kind === "edit") {
        const p = c.patch;
        d = { ...d, ...(p.title ? { title: p.title } : {}), ...(p.due ? { due: p.due, timeKnown: p.timeKnown !== false } : {}), ...(p.place !== undefined ? { place: p.place || undefined } : {}) };
        if (p.due) { delete d.either; delete d.ends; }
      } else if (c.kind === "note" && !d.note?.startsWith(`Your note: ${noteOf(c)}`)) d = { ...d, note: `Your note: ${noteOf(c)}${d.note ? ` (read: "${d.note.slice(0, 160)}")` : ""}`.slice(0, 400) };
      else if (c.kind === "done" && o.hub) d = { ...d, done: true, removeAt: new Date(Math.max(endsAt(d), c.at) + DONE_DAYS * 864e5).toISOString() };
    }
    if (hidden || (!d.id.startsWith("exam-") && !itemAllowed(d, rules))) continue;
    if (o.hub && d.done && d.removeAt && Date.parse(d.removeAt) <= o.now) continue;
    out.push(d);
  }
  return out;
}
const noteOf = (c: Correction) => String(c.patch.note || "");

/** The rules that apply to a course (and those for every course). */
export const rulesFor = (corrections: Correction[], courseKey?: string) => corrections.filter((c) => c.kind === "rule" && (!c.courseKey || !courseKey || c.courseKey === courseKey));
const ruleOf = (c: Correction) => c.patch.rule as Rule | undefined;
const hasWord = (text: string, words: string[]) => { const t = plain(text); return words.some((w) => plain(w) && ` ${t} `.includes(` ${plain(w)} `)); };
const sameSender = (a: string, b: string) => { const n = (s: string) => s.toLowerCase().replace(/[<>"]/g, " ").trim(); return n(a).includes(n(b)) || n(b).includes(n(a)); };

/** Whether a text may give the reader anything, under the learned rules (and the course they belong to). */
export function textAllowed(t: Pick<CourseText, "id" | "text" | "sent" | "around" | "sender">, rules: Correction[], now: number) {
  for (const c of rules) {
    const r = ruleOf(c);
    if (!r) continue;
    if (r.type === "max_age" && t.sent && !t.around && Date.parse(t.sent) < now - r.days * 864e5) return false;
    if (r.type === "ignore") {
      if (r.ref && r.ref === t.id) return false;
      if (r.from && t.sender && sameSender(t.sender, r.from) && (!r.words?.length || hasWord(t.text, r.words))) return false;
    }
  }
  return true;
}
/** Whether an item may stand under the learned rules: an "ignore" rule with words (and no sender) leaves out items whose
 *  title or note has one of them. */
export function itemAllowed(d: Pick<Item, "courseKey" | "title" | "note" | "ref">, rules: Correction[]) {
  return !rules.some((c) => {
    const r = ruleOf(c);
    if (!r || r.type !== "ignore" || (c.courseKey && c.courseKey !== d.courseKey)) return false;
    if (r.ref && d.ref === r.ref) return true;
    return !r.from && !!r.words?.length && hasWord(`${d.title} ${d.note || ""}`, r.words);
  });
}

/** A rule in one plain sentence (what the reader is told and the person hears). */
export function ruleSentence(r: Rule, text?: string) {
  if (text) return text;
  if (r.type === "max_age") return `Mail and posts sent more than ${r.days} days before Clem reads them don't create Coming up items.`;
  if (r.type === "ignore") return `Ignore items${r.from ? ` from ${r.from}` : ""}${r.ref ? " from that message" : ""}${r.words?.length ? ` about ${r.words.join(", ")}` : ""}.`;
  return "Follow the student's note.";
}
/** The rules as sentences for the reader's prompt (readerPrompt's `rules`). */
export const rulesText = (rules: Correction[]) => rules.map((c) => ruleSentence(ruleOf(c) || { type: "note" }, c.patch.text)).slice(0, 20);

/** When a removed item came from a message sent well before it was read (the stale-mail mistake), the rule worth
 *  learning: such old messages create nothing. Undefined when nothing general follows. */
export const STALE_DAYS = 14;
export function staleRule(d: Pick<GucDeadline, "sent" | "source">, now: number): Rule | undefined {
  return d.sent && (d.source === "mail" || d.source === "announcement") && now - Date.parse(d.sent) > STALE_DAYS * 864e5 ? { type: "max_age", days: STALE_DAYS } : undefined;
}

/** Clem's copy of the portal's own records, changed by the person (owner, 2026-11-15: the AI comes first): a grade,
 *  a class in the timetable, an announcement or a midterm hidden, edited or annotated. The portal keeps its record; the
 *  hub, the AI, the Now card and the organizer's calendar read Clem's copy, so the change holds through every sync and
 *  is undone by saying so. `patch.target` says which list; `itemId` is the record's stable id. */
export type RecordTarget = "grade" | "class" | "announcement" | "midterm";
/** The fields of each record the person may set. */
export const RECORD_FIELDS: Record<RecordTarget, string[]> = { grade: ["letter", "numeric"], class: ["day", "start", "end", "location", "name", "type"], announcement: ["text"], midterm: ["grade"] };
/** `yours`: what the person changed, with the portal's own values ("official"), so the AI can say both plainly. */
export type Overridden = { note?: string; yours?: { official: Record<string, unknown> } };
export function applyRecordCorrections<T extends { id: string }>(list: T[], corrections: Correction[], target: RecordTarget): (T & Overridden)[] {
  const mine = corrections.filter((c) => c.patch?.target === target && c.itemId).sort((a, b) => a.at - b.at);
  if (!mine.length) return list;
  const out: (T & Overridden)[] = [];
  for (const item of list) {
    let d: T & Overridden = item, hidden = false;
    for (const c of mine) {
      if (c.itemId !== item.id) continue;
      if (c.kind === "hide") hidden = true;
      else if (c.kind === "note") d = { ...d, note: `Your note: ${String(c.patch.note || "")}`.slice(0, 400) };
      else if (c.kind === "edit") {
        const set = Object.fromEntries(Object.entries(c.patch.set || {}).filter(([k]) => RECORD_FIELDS[target].includes(k)));
        const official = { ...(d.yours?.official || {}), ...Object.fromEntries(Object.keys(set).filter((k) => !(k in (d.yours?.official || {}))).map((k) => [k, (item as Record<string, unknown>)[k]])) };
        d = { ...d, ...set, yours: { official } };
      } else if (c.kind === "done" && target === "announcement") d = { ...d, read: true } as T & Overridden;
    }
    if (!hidden) out.push(d);
  }
  return out;
}
