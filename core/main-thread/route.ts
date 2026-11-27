import Fuse from 'fuse.js';

/** A subject or project as the main thread sees it when it tells the AI which spaces a message may be about
 *  (core/main-thread/handoff.ts spaceHints) and finds the space a clem.handoff names (resolveSpace). `aliases`: other
 *  names it goes by (a course code, a short name); course codes in its name or description are found on their own. */
export type RouteSpace = { id: string; name: string; kind: 'subject' | 'project'; description?: string; aliases?: string[] };

const CODE = /\b([A-Z]{2,5})\s?-?(\d{3}[A-Z]?)\b/g;
/** Course codes ("CSEN 401", "math203") in a text, normalised to "CSEN401". */
export function courseCodes(text: string) {
  return [...new Set([...text.toUpperCase().matchAll(CODE)].map((m) => m[1] + m[2]))];
}
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'for', 'my', 'me', 'i', 'is', 'it', 'on', 'with', 'about', 'what', 'how', 'can', 'you', 'this', 'that', 'do', 'be', 'are', 'help', 'please', 'today', 'tomorrow']);

/** Whole-phrase match: "circuits" in "help with circuits hw", not in "short-circuitsy". */
function hasPhrase(text: string, phrase: string) {
  if (phrase.length < 3) return false;
  return (' ' + text + ' ').includes(' ' + phrase + ' ');
}

/** How surely `message` is about each space, 0–1. A course code or the full name scores high; a close spelling of a
 *  distinctive word in the name scores lower, so it alone rarely clears the threshold. */
export function scoreSpaces(message: string, spaces: RouteSpace[]) {
  const text = norm(message), codes = new Set(courseCodes(message));
  const words = text.split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  const grams = [...new Set([...words, ...words.slice(1).map((w, i) => words[i] + ' ' + w)])];
  const fuse = new Fuse(grams, { includeScore: true, threshold: 0.3, ignoreLocation: true, minMatchCharLength: 4 });
  return spaces.map((s) => {
    let score = 0;
    const own = [...courseCodes(s.name + ' ' + (s.description || '')), ...(s.aliases || []).flatMap(courseCodes)];
    if (own.some((c) => codes.has(c))) score = 1;
    const name = norm(s.name);
    if (hasPhrase(text, name)) score = Math.max(score, 0.95);
    for (const alias of s.aliases || []) if (hasPhrase(text, norm(alias))) score = Math.max(score, 0.9);
    // A close spelling ("cirquits") of a distinctive name word. Long names need most of their words to be there.
    const parts = name.split(' ').filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));
    if (parts.length && score < 0.9) {
      const hits = parts.map((p) => { const best = fuse.search(p)[0]; return best ? 1 - (best.score ?? 1) : 0; });
      const covered = hits.filter((h) => h > 0.6).length / parts.length;
      const fuzzy = covered * Math.max(...hits) * 0.88;
      score = Math.max(score, fuzzy);
    }
    return { spaceId: s.id, score: Math.round(score * 1000) / 1000 };
  }).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
}

/** The short note a handed-off message carries: the last few main-thread turns, clipped, oldest first. */
export function carriedNote(turns: { role: 'user' | 'assistant'; content: string }[], { turns: count = 4, chars = 700 } = {}) {
  const lines = turns.filter((t) => t.content.trim() && !t.content.includes('```clem-card')).slice(-count)
    .map((t) => `${t.role === 'user' ? 'You' : 'Clem'}: ${t.content.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 220)}`);
  let note = lines.join('\n');
  while (note.length > chars && lines.length > 1) { lines.shift(); note = lines.join('\n'); }
  return note.slice(0, chars);
}

/** The space names an `@` query matches, best first: fuzzy and forgiving, keyboard-first (the composer's popover). */
export function mentionMatches<T extends { id: string; name: string; description?: string }>(query: string, spaces: T[], limit = 8): T[] {
  const q = query.trim();
  if (!q) return spaces.slice(0, limit);
  const fuse = new Fuse(spaces, { keys: [{ name: 'name', weight: 3 }, { name: 'description', weight: 1 }], threshold: 0.4, ignoreLocation: true });
  return fuse.search(q, { limit }).map((r) => r.item);
}
