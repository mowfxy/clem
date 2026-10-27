/**
 * A memory as the person reads it: a short lead and the points under it, each with its date pulled out, instead of
 * one long third-person sentence. Memories are stored as sentences for the model ("The user is preparing for a DSA
 * lab test on October 15; a DSA midterm on October 22; …"); this only changes how they are shown.
 */
export type MemoryPoint = { text: string; when?: string };
export type MemoryShape = { lead: string; points: MemoryPoint[] };

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE = new RegExp(`\\s*\\b(?:on|by|due|before)?\\s*((?:${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?)|(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+\\d{4})?)|\\d{4}-\\d{2}-\\d{2})\\b`, "i");
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "October 15, 2026", "15 Oct" or "2026-10-15" as "Oct 15". */
function shortDate(raw: string) {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${SHORT[+iso[2] - 1] || ""} ${+iso[3]}`.trim();
  const month = raw.match(new RegExp(MONTH, "i"))?.[0].slice(0, 3).toLowerCase();
  const day = raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b(?!\d)/)?.[1];
  const m = SHORT.findIndex((s) => s.toLowerCase() === month);
  return m >= 0 && day ? `${SHORT[m]} ${+day}` : raw;
}

/** Third person to second: "The user prefers" → "You prefer", "The user's exam" → "Your exam". */
export function toYou(text: string) {
  return text
    .replace(/^the user's\s+/i, "Your ")
    .replace(/^the user is\b/i, "You're")
    .replace(/^the user has\b/i, "You have")
    .replace(/^the user was\b/i, "You were")
    .replace(/^the user does\b/i, "You do")
    .replace(/^the user (\w+?)(ies|(?<=(?:sh|ch|x|ss|z|o))es|s)\b/i, (_, stem: string, end: string) => `You ${stem}${end.toLowerCase() === "ies" ? "y" : ""}`);
}

/** Splits at top-level separators, never inside brackets or quotes, and never in "October 15, 2026". */
function split(text: string, sep: RegExp) {
  const parts: string[] = [];
  let depth = 0, last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("([{“".includes(c)) depth++;
    else if (")]}”".includes(c)) depth = Math.max(0, depth - 1);
    else if (!depth) {
      const hit = sep.exec(text.slice(i, i + 6));
      if (hit && hit.index === 0 && !/^,\s*\d/.test(text.slice(i))) { parts.push(text.slice(last, i)); i += hit[0].length - 1; last = i + 1; }
    }
  }
  parts.push(text.slice(last));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const tidy = (s: string) => s.replace(/\s+([,.;:])/g, "$1").replace(/,\s*$/, "").replace(/\s{2,}/g, " ").trim();
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function point(raw: string): MemoryPoint {
  const text = raw.replace(/^(?:and|or|plus)\s+/i, "").replace(/^[-•*]\s*/, "").replace(/[.;]+$/, "");
  const date = text.match(DATE);
  if (!date || !/\p{L}/u.test(text.replace(date[0], ""))) return { text: capital(tidy(text)) };
  return { text: capital(tidy(text.replace(date[0], " "))), when: shortDate(date[1]) };
}

/** The words a list hangs from: "You prefer study plans that" in "You prefer study plans that work backward…". */
function leadOf(first: string) {
  const colon = first.indexOf(": ");
  if (colon > 0 && colon < 80) return { lead: first.slice(0, colon), rest: first.slice(colon + 2) };
  const hit = first.match(/^(.{6,90}?\b(?:that|for|to|including|such as|like|with))\s+(.+)$/i);
  if (hit && hit[2].split(/\s+/).length >= 2 && hit[1].length < first.length * 0.65) return { lead: hit[1], rest: hit[2] };
  return { lead: "", rest: first };
}

export function memoryPoints(raw: string): MemoryShape {
  const text = toYou(raw.trim());
  // Written as a list already: a lead line, then "- " lines.
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines.slice(1).every((l) => /^[-•*]\s/.test(l))) return { lead: lines[0].replace(/:$/, ""), points: lines.slice(1).map(point) };
  if (lines.length > 1) return { lead: "", points: lines.map(point) };
  const body = text.replace(/\.\s*$/, "");
  let parts = split(body, /^;\s*/);
  if (parts.length < 2) {
    const commas = split(body, /^,\s+/);
    // A list in a sentence: three or more parts, the last joined by "and" or "or".
    if (commas.length >= 3 && /^(?:and|or)\s/i.test(commas[commas.length - 1])) parts = commas;
  }
  if (parts.length < 2) {
    const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z])/);
    if (sentences.length > 1) return { lead: "", points: sentences.map(point) };
    return { lead: capital(tidy(body)), points: [] };
  }
  const { lead, rest } = leadOf(parts[0]);
  return { lead: capital(tidy(lead)), points: [rest, ...parts.slice(1)].map(point) };
}
