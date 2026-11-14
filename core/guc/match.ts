// Which CMS course a subject is (and which subject a course is), from course codes and names: an exact code wins;
// otherwise the name's words (prefixes, small typos, roman numerals, initials) and fuse.js's fuzzy score decide.
// `sure` means good enough to ask "This looks like CSEN 701 — link it?"; otherwise the alternatives are offered.
import Fuse from "fuse.js";
import { codeKey, normCode } from "./codes.ts";

export type MatchCourse = { key: string; code: string; name: string; active?: boolean; seasonId?: number };
export type MatchSubject = { id: string; name: string; description?: string };
export type Candidate<T> = { item: T; score: number };
export type MatchResult<T> = { best?: Candidate<T>; confidence: number; sure: boolean; alternatives: Candidate<T>[] };

/** How high the best score must be, and how far ahead of the next, to be offered on its own. */
export const MATCH_SURE = 0.75;
export const MATCH_MARGIN = 0.12;

const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
const STOP = new Set(["and", "of", "the", "a", "an", "to", "in", "for", "on", "with", "intro", "introduction", "course", "subject"]);
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean)
  .map((w) => ROMAN[w] || w).filter((w) => !STOP.has(w));
const nameWords = (s: string) => words(s.replace(/\b[A-Za-z]{2,5}\s?-?\s?\d{3}[A-Za-z]?\b/g, " "));

/** Edit distance, stopping early past `max`. */
function near(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}
/** "math" ~ "mathematics", "maths" ~ "mathematics", "embeded" ~ "embedded", "3" ~ "3". */
const sameWord = (a: string, b: string): boolean => a === b || (a.length > 4 && a.endsWith("s") && sameWord(a.slice(0, -1), b)) || (/\D/.test(a) && /\D/.test(b) && ((a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b)) || (Math.min(a.length, b.length) >= 5 && near(a, b, Math.min(a.length, b.length) >= 8 ? 2 : 1))));

/** How surely the text `query` names the course `name`/`code`, 0–1. */
export function nameScore(query: string, course: { code: string; name: string }, fuzzy = 0) {
  const code = normCode(query);
  if (code && course.code && codeKey(code) === codeKey(course.code)) return 1;
  const q = nameWords(query), c = nameWords(course.name);
  if (!q.length || !c.length) return 0;
  if (q.join(" ") === c.join(" ")) return 0.97;
  const initials = c.filter((w) => /\D/.test(w)).map((w) => w[0]).join("");
  if (initials.length >= 2 && q.some((w) => w === initials)) return q.length === 1 ? 0.88 : 0.8;
  const hitQ = q.filter((w) => c.some((x) => sameWord(w, x))).length, hitC = c.filter((x) => q.some((w) => sameWord(w, x))).length;
  // A number that disagrees ("Math 2" for "Mathematics III") is a different course.
  const numsQ = q.filter((w) => /^\d+$/.test(w)), numsC = c.filter((w) => /^\d+$/.test(w));
  if (numsQ.length && numsC.length && !numsQ.some((n) => numsC.includes(n))) return 0.2 * (hitQ / q.length);
  const words = 0.6 * (hitQ / q.length) + 0.4 * (hitC / c.length);
  return Math.min(0.96, 0.75 * words + 0.25 * fuzzy);
}

function rank<T>(query: string, items: T[], view: (t: T) => { code: string; name: string; active?: boolean; seasonId?: number }): MatchResult<T> {
  if (!query.trim() || !items.length) return { confidence: 0, sure: false, alternatives: [] };
  const fuse = new Fuse(items.map((t, i) => ({ i, name: view(t).name })), { keys: ["name"], includeScore: true, ignoreLocation: true, threshold: 0.6 });
  const fuzzy = new Map(fuse.search(nameWords(query).join(" ") || query).map((r) => [r.item.i, 1 - (r.score ?? 1)]));
  const latest = Math.max(0, ...items.map((t) => view(t).seasonId || 0));
  const scored = items.map((item, i) => {
    const v = view(item), s = nameScore(query, v, fuzzy.get(i) || 0);
    // Between equal names the active course of the latest term wins.
    return { item, score: s, tie: s > 0 ? (v.active === false ? 0 : 0.002) + ((v.seasonId || 0) === latest ? 0.001 : 0) : 0 };
  }).filter((c) => c.score >= 0.3).sort((a, b) => b.score + b.tie - (a.score + a.tie));
  const [best, second] = scored;
  const sure = !!best && best.score >= MATCH_SURE && (!second || best.score === 1 || best.score - second.score >= MATCH_MARGIN || codeKey(view(best.item).code) === codeKey(view(second.item).code));
  const out = scored.map(({ item, score }) => ({ item, score: Math.round(score * 100) / 100 }));
  return { best: out[0], confidence: out[0]?.score || 0, sure, alternatives: out.slice(1, 6) };
}

/** The CMS course a subject is: its name, then its description (where a course code often sits). */
export function matchCourse<T extends MatchCourse>(subject: { name: string; description?: string }, courses: T[]): MatchResult<T> {
  const byName = rank(subject.name, courses, (c) => c);
  if (byName.sure || !subject.description?.trim()) return byName;
  const byBoth = rank(subject.name + " " + subject.description, courses, (c) => c);
  return byBoth.confidence > byName.confidence ? byBoth : byName;
}
/** The subject a CMS course is (for the hub's course rows and new-semester offers). */
export function matchSubject<T extends MatchSubject>(course: MatchCourse, subjects: T[]): MatchResult<T> {
  const code = normCode(course.code);
  const byCode = subjects.find((s) => code && normCode(s.name + " " + (s.description || "")) === code);
  if (byCode) return { best: { item: byCode, score: 1 }, confidence: 1, sure: true, alternatives: [] };
  return rank(course.name, subjects, (s) => ({ code: normCode(s.name + " " + (s.description || "")), name: s.name }));
}

/** The course a schedule slot is. The portal's schedule cell names the course ("Mathematics III", "Physics III (t)"),
 *  not its code, so each slot is matched to the course list: a code in the cell first; then the same name (case,
 *  spacing, punctuation, "&"/"and" and roman numerals aside); then the same name without its bracket ("(t)", "(A2)"),
 *  where a "(t)" or "(p)" picks between two courses of that name by the code's last letter (PHYST / PHYSP); then
 *  `rank` only when it is sure. The newest active term wins; no course: undefined. */
export function slotCourse<T extends MatchCourse>(cell: string, courses: T[]): T | undefined {
  const active = courses.filter((c) => c.active !== false), latest = Math.max(0, ...active.map((c) => c.seasonId || 0));
  const pool = active.filter((c) => (c.seasonId || 0) === latest);
  const code = normCode(cell);
  if (code) return pool.find((c) => codeKey(c.code) === codeKey(code)) || courses.find((c) => codeKey(c.code) === codeKey(code));
  const flat = (s: string) => words(s).join(" "), bare = (s: string) => flat(s.replace(/\([^)]*\)/g, " "));
  const exact = pool.filter((c) => flat(c.name) === flat(cell));
  if (exact.length === 1) return exact[0];
  const same = pool.filter((c) => bare(c.name) === bare(cell));
  if (same.length === 1) return same[0];
  if (same.length > 1) {
    const tag = /\(\s*([a-z])\s*\)/i.exec(cell)?.[1]?.toUpperCase();
    const byTag = tag ? same.filter((c) => new RegExp(`^[A-Z]+${tag}\\s`, "i").test(c.code)) : [];
    return byTag.length === 1 ? byTag[0] : undefined;
  }
  const r = rank(cell.replace(/\([^)]*\)/g, " "), pool, (c) => c);
  return r.sure ? r.best?.item : undefined;
}
