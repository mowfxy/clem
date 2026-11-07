/**
 * Memory is held as topics. One record is one topic of one scope: `key` carries its name and `text` its notes, short
 * fragments joined by "; ":
 *
 *   key  "topic:Exams"               text  "DSA midterm Oct 22; Physics 3 Oct 25"
 *   key  "pref:topic:Answer style"   text  "short answers; no bullet points"
 *
 * What the app needs to know about one note (the date it stops applying, the chat it was only learned from) sits in the
 * record's `derivedFrom` as a mark, because that field already syncs: the sync format is unchanged, so a PC still on an
 * older Clem keeps syncing and simply reads each topic as one memory.
 *
 *   note:<hash of the note>:<last day or nothing>:<source it was learned from or nothing>
 *
 * A note with no mark is kept and lasting. A mark with a source means learned, not kept by the person.
 */
import { terms } from "./project-memory.ts";

export type TopicFields = {
  scope: string;
  key: string;
  text: string;
  kind: "fact" | "preference" | "inference" | "temporary";
  confirmed: boolean;
  confidence: number;
  expiresAt?: string;
  derivedFrom: string[];
};
export type NoteMark = { hash: string; until?: string; from?: string };

/** The notes one topic may hold before a second part of it opens ("Exams (2)"): short enough to send whole. */
export const TOPIC_CHARS = 1200;
/** What the sync format allows in one record. */
const RECORD_CHARS = 2000;
const NAME_CHARS = 60;

const PREF = "pref:", TOPIC = "topic:";
export const isTopicKey = (key: string) => key.startsWith(TOPIC) || key.startsWith(PREF + TOPIC);
export const topicName = (key: string) => key.replace(/^(?:pref:)?topic:/, "");
/** A name as shown: one line, capitalised, "exam-dates" as "Exam dates". */
export function cleanTopic(name: string) {
  const text = name.replace(/[_-]+/g, " ").replace(/[;\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_CHARS).trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export const topicKey = (name: string, preference: boolean) => (preference ? PREF : "") + TOPIC + cleanTopic(name);

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
const words = (s: string) => fold(s).match(/[\p{L}\p{N}]+/gu) || [];
const LITTLE = new Set("the a an of and for in on to my your".split(" "));
/** The same topic however it was written: "Exams", "the exam", "exams". Numbers count, so Chapter 3 is not Chapter 4. */
const nameWords = (name: string) => [...new Set(words(name).filter((w) => !LITTLE.has(w)).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)))].sort().join(" ");
export const topicSlot = nameWords;
export const sameTopic = (a: string, b: string) => nameWords(a) === nameWords(b);

const cleanNote = (s: string) => s.replace(/^[-•*]\s+/, "").replace(/\s+/g, " ").trim().replace(/[.。]+$/, "").trim();
export const notesOf = (text: string) => text.split(/\s*[;؛](?:\s+|$)|\n+/).map(cleanNote).filter(Boolean);
export const joinNotes = (notes: string[]) => notes.join("; ");
/** The same words, whatever the punctuation and capitals. */
export const sameWords = (a: string, b: string) => words(a).join(" ") === words(b).join(" ");
/** The same note said a little differently. Any different number makes it a different note (Oct 22 is not Oct 25). */
export function sameNote(a: string, b: string) {
  if (sameWords(a, b)) return true;
  const digits = (s: string) => words(s).filter((w) => /\d/.test(w)).sort().join(" ");
  if (digits(a) !== digits(b)) return false;
  const x = new Set(terms(a)), y = new Set(terms(b));
  if (x.size < 3 || y.size < 3) return false;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both) >= 0.8;
}

export function noteHash(note: string) {
  let h = 2166136261;
  for (const c of words(note).join(" ")) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
const MARK = /^note:([0-9a-z]+):(\d{4}-\d{2}-\d{2})?:(.*)$/;
const readMark = (raw: string): NoteMark | undefined => {
  const m = MARK.exec(raw);
  return m ? { hash: m[1], ...(m[2] ? { until: m[2] } : {}), ...(m[3] ? { from: m[3] } : {}) } : undefined;
};
export const marksIn = (derivedFrom: string[]) => derivedFrom.flatMap((d) => readMark(d) || []);
/** A mark for a note, when there is something to say about it. A source too long or odd for the sync format is left out. */
export function markFor(note: string, until?: string, from?: string) {
  const source = from && /^[\w:-]{1,95}$/.test(from) ? from : "";
  return until || source ? `note:${noteHash(note)}:${until || ""}:${source}` : undefined;
}
/** A mark once the person keeps its note: the date stays, the "only learned" goes. Nothing left means no mark. */
export const keptMark = (raw: string) => { const mark = readMark(raw); return mark?.until ? `note:${mark.hash}:${mark.until}:` : undefined; };
export const notesMarks = (note: string, derivedFrom: string[]) => { const hash = noteHash(note); return marksIn(derivedFrom).filter((m) => m.hash === hash); };
/** Learned from a chat and not kept by the person. */
export const isLearned = (note: string, derivedFrom: string[]) => { const marks = notesMarks(note, derivedFrom); return marks.length > 0 && marks.every((m) => m.from); };
/** The last day a note applies, when every mark on it is dated; a lasting mark wins. */
export function noteUntil(note: string, derivedFrom: string[]) {
  const marks = notesMarks(note, derivedFrom);
  return marks.length && marks.every((m) => m.until) ? marks.map((m) => m.until!).sort().at(-1) : undefined;
}
/** Whether a note still applies at `now` (ms). */
export function noteLive(note: string, derivedFrom: string[], now: number) {
  const until = noteUntil(note, derivedFrom);
  return !until || Date.parse(until) > now;
}
/** The notes of a record that still apply. */
export const liveNotes = (m: Pick<TopicFields, "text" | "derivedFrom">, now: number) => notesOf(m.text).filter((n) => noteLive(n, m.derivedFrom, now));

/**
 * A topic with these notes and marks: the words, and everything that follows from them. It counts as kept once any note
 * is kept, so pruning and a deleted chat never take what the person kept; it expires only when every note is dated.
 */
export function settle<T extends TopicFields>(m: T, notes: string[], marks: string[]): T {
  const hashes = new Set(notes.map(noteHash));
  const others = m.derivedFrom.filter((d) => !d.startsWith("note:"));
  const held = [...new Set(marks)].filter((d) => { const mark = readMark(d); return !!mark && hashes.has(mark.hash); });
  const derivedFrom = [...others, ...held.slice(-Math.max(0, 50 - others.length))];
  const kept = notes.some((n) => !isLearned(n, derivedFrom));
  const untils = notes.map((n) => noteUntil(n, derivedFrom));
  const last = untils.every(Boolean) ? (untils as string[]).sort().at(-1) : undefined;
  const preference = m.kind === "preference" || m.key.startsWith(PREF);
  const { expiresAt: _old, ...rest } = m;
  return {
    ...rest,
    text: joinNotes(notes),
    derivedFrom,
    confirmed: kept,
    kind: last ? "temporary" : kept ? (preference ? "preference" : "fact") : "inference",
    confidence: kept ? 1 : m.confidence,
    ...(last ? { expiresAt: new Date(last).toISOString() } : {}),
  } as T;
}

/**
 * The same topic changed on two devices between syncs: what the older change added stays beside the newer one, and what
 * either removed stays removed. Whole-topic rules (moved elsewhere, renamed) stay newest-wins: returns undefined.
 */
export function mergeTopicEdits<T extends TopicFields>(base: T | undefined, newer: T, older: T): T | undefined {
  if (!isTopicKey(newer.key) || newer.key !== older.key || newer.scope !== older.scope) return undefined;
  const before = base ? notesOf(base.text) : [], ours = notesOf(newer.text);
  const added = notesOf(older.text).filter((n) => !before.some((b) => sameWords(b, n)) && !ours.some((o) => sameNote(o, n)));
  if (!added.length) return undefined;
  const notes = [...ours, ...added];
  if (joinNotes(notes).length > RECORD_CHARS) return undefined;
  const fromOlder = older.derivedFrom.filter((d) => { const mark = readMark(d); return !!mark && added.some((n) => noteHash(n) === mark.hash); });
  return settle(newer, notes, [...newer.derivedFrom.filter((d) => d.startsWith("note:")), ...fromOlder]);
}
