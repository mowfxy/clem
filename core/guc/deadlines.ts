// Deadlines pulled out of announcements and course content: a sentence with a deadline word and a date in it.
import * as chrono from "chrono-node";
import { stableId } from "./parse.ts";
import type { GucDeadline } from "./types.ts";

const WORDS = /\b(deadline|due|submit|submission|hand[- ]?in|quiz|midterm|final exam|exam|assignment|project|milestone|lab report|report|presentation|evaluation)\b/i;

/**
 * Deadlines in `text`. `ref` anchors relative dates ("next Sunday") to when the text was read. The id leaves the
 * date out, so moving a deadline changes its due date rather than adding a second one.
 */
export function extractDeadlines(text: string, courseKey: string, source: string, ref = new Date()): GucDeadline[] {
  const found = new Map<string, GucDeadline>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)) {
    if (!WORDS.test(sentence)) continue;
    const dates = chrono.parse(sentence, { instant: ref, timezone: "EET" }, { forwardDate: true });
    const date = dates.find((d) => d.start.isCertain("day") || d.start.isCertain("weekday"));
    if (!date) continue;
    const due = date.start.date();
    if (!date.start.isCertain("hour")) due.setHours(23, 59, 0, 0);
    const title = sentence.replace(date.text, " ").replace(/\s+([,.;:])/g, "$1").replace(/\s+/g, " ").replace(/\b(on|by|before|at)\s*[,.;:]?\s*$/i, "").trim().slice(0, 160);
    const id = stableId(courseKey + "|" + source + "|" + title.toLowerCase());
    if (!found.has(id)) found.set(id, { id, courseKey, title, due: due.toISOString(), source });
  }
  return [...found.values()];
}
