/**
 * A project's memory, kept as one small Markdown file beside the project (never sent whole). Each line is one topic,
 * named by its first tag (one area of the project's work), with its notes in a few words:
 *
 *   - 2026-11-01 #launch #deadline | December 3; soft launch Nov 28
 *
 * A note for a topic joins that topic's line; a line that is full, or a fact with no tag, stands alone.
 *
 * Every turn the coordinator gets only the few lines that match what is being talked about (BM25 over the words and
 * tags, a little weight for recent lines), inside a fixed character budget, so memory costs about the same few hundred
 * tokens whether the file holds ten facts or five hundred. The coordinator can also look something up itself
 * ([[recall: …]], core/coordinator.ts) when the automatic pick missed it.
 */
export type MemoryEntry = { id: string; at: string; tags: string[]; text: string };

/** The most lines a project keeps; past it the oldest go first. */
export const MEMORY_LIMIT = 500;
/** What one turn may spend on recalled memory, in characters (~350 tokens). */
export const RECALL_CHARS = 1200;
export const RECALL_COUNT = 8;

const STOP = new Set("a an and are as at be but by can could did do does for from had has have he her his how i if in into is it its just me my no not of on or our she so than that the their them then there these they this to too us was we were what when where which who why will with would you your yours i'm it's don't".split(" "));

/** Lower case without accents, so "Résumé" and "resume" meet (decomposed marks would otherwise split words in two). */
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/** Lower-case words without stop words, each cut to a rough stem so "launches", "launched" and "launch" meet. */
export function terms(text: string): string[] {
  return (fold(text).match(/[\p{L}\p{N}]+/gu) || [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}
function stem(w: string) {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && /(ing|ed)$/.test(w)) return w.replace(/(ing|ed)$/, "");
  if (w.length > 4 && /(sh|ch|x|ss|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** A short id from the text, so the same fact keeps the same id across saves. */
function idOf(text: string) {
  let h = 2166136261;
  for (const c of text.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
const cleanTag = (t: string) => t.toLowerCase().replace(/^#/, "").replace(/[^\p{L}\p{N}-]/gu, "").slice(0, 24);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function entry(text: string, tags: string[] = [], at = new Date().toISOString().slice(0, 10)): MemoryEntry {
  const clean = oneLine(text).slice(0, 400);
  return { id: idOf(clean), at, tags: [...new Set(tags.map(cleanTag).filter(Boolean))].slice(0, 6), text: clean };
}

export function parseMemory(file: string): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  for (const raw of file.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("- ")) continue;
    const m = /^- (\d{4}-\d{2}-\d{2})?\s*((?:#[\p{L}\p{N}-]+\s*)*)\|?\s*(.+)$/u.exec(line);
    if (!m || !m[3].trim()) continue;
    out.push(entry(m[3], (m[2].match(/#[\p{L}\p{N}-]+/gu) || []), m[1] || "1970-01-01"));
  }
  return out;
}

export function serializeMemory(entries: MemoryEntry[], title = "Project memory") {
  return `# ${title}\n\nOne topic per line: date, topic and tags, then its notes. Clem reads only the lines that matter to each message.\n\n` +
    entries.map((e) => `- ${e.at} ${e.tags.map((t) => "#" + t).join(" ")}${e.tags.length ? " " : ""}| ${e.text}`).join("\n") + (entries.length ? "\n" : "");
}

/** How alike two facts are (shared words over all words), to replace a fact restated instead of keeping both. */
function overlap(a: string, b: string) {
  const x = new Set(terms(a)), y = new Set(terms(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

const CHARS = 400;
const noteList = (text: string) => text.split(/;\s+/).map((n) => n.trim()).filter(Boolean);
const topicOf = (e: MemoryEntry) => e.tags[0];
/** The last line of a topic, or -1. */
const lineOf = (entries: MemoryEntry[], topic: string | undefined) => { if (topic) for (let i = entries.length - 1; i >= 0; i--) if (topicOf(entries[i]) === topic) return i; return -1; };
/** The line a note joins: the last line of its topic that has room for it, a restated note making way for the new one. */
function joined(line: MemoryEntry, fact: MemoryEntry, exact = false) {
  const notes = noteList(line.text).filter((n) => (exact ? n !== fact.text : overlap(n, fact.text) < 0.7));
  const text = [...notes, fact.text].join("; ");
  return text.length > CHARS ? undefined : entry(text, [...line.tags, ...fact.tags], fact.at > line.at ? fact.at : line.at);
}
/** Lines of the same topic, as older files have them, become one line, word for word. A full line stays apart, so nothing is cut. */
export function foldTopics(entries: MemoryEntry[]): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  for (const e of entries) {
    const at = lineOf(out, topicOf(e));
    const line = at >= 0 ? noteList(e.text).reduce<MemoryEntry | undefined>((held, n) => held && joined(held, { ...e, text: n }, true), out[at]) : undefined;
    if (line) out[at] = line;
    else out.push(e);
  }
  return out;
}
/** Adds facts, newest last. One with a topic joins that topic's line; one that restates a fact already kept (most words shared) replaces it, with the new date. */
export function remember(entries: MemoryEntry[], added: MemoryEntry[]): MemoryEntry[] {
  let next = [...entries];
  for (const fact of added) {
    if (!fact.text) continue;
    const at = lineOf(next, topicOf(fact));
    const line = at >= 0 ? joined(next[at], fact) : undefined;
    if (line) { next.splice(at, 1, line); continue; }
    const same = next.findIndex((e) => e.id === fact.id || overlap(e.text, fact.text) >= 0.7);
    if (same >= 0) next.splice(same, 1, { ...fact, tags: [...new Set([...fact.tags, ...next[same].tags])].slice(0, 6) });
    else next.push(fact);
  }
  if (next.length > MEMORY_LIMIT) next = next.slice(next.length - MEMORY_LIMIT);
  return next;
}

export const forget = (entries: MemoryEntry[], id: string) => entries.filter((e) => e.id !== id);

/**
 * The lines that matter to `query`, best first, within `chars`. BM25 on words, tags counted twice, and up to 15% more
 * for the newest lines; a line sharing no word with the query is never returned.
 */
export function recall(entries: MemoryEntry[], query: string, { count = RECALL_COUNT, chars = RECALL_CHARS }: { count?: number; chars?: number } = {}): MemoryEntry[] {
  const q = [...new Set(terms(query))];
  if (!q.length || !entries.length) return [];
  const docs = entries.map((e) => [...terms(e.text), ...e.tags.flatMap((t) => { const w = stem(fold(t)); return [w, w]; })]);
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length, k1 = 1.2, b = 0.75;
  const scored = entries.map((e, i) => {
    const d = docs[i];
    let score = 0;
    for (const w of q) {
      const tf = d.filter((x) => x === w).length;
      if (!tf) continue;
      const idf = Math.log(1 + (N - (df.get(w) || 0) + 0.5) / ((df.get(w) || 0) + 0.5));
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * d.length / avg));
    }
    return { e, score: score ? score * (1 + 0.15 * (i / Math.max(1, N - 1))) : 0 };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const out: MemoryEntry[] = [];
  let room = chars;
  for (const { e } of scored) {
    if (out.length >= count) break;
    const cost = e.text.length + 24;
    if (cost > room) continue;
    room -= cost;
    out.push(e);
  }
  return out;
}

/** Recalled lines as the model reads them. */
export const memoryLines = (entries: MemoryEntry[]) => entries.map((e) => `- (${e.at}${e.tags.length ? " " + e.tags.map((t) => "#" + t).join(" ") : ""}) ${e.text}`).join("\n");
