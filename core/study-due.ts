import { isDue } from './srs.ts';

/** Cards to review in one subject: those with review history whose time has come (new cards don't count, as on the
 *  subject's page: “12 cards to review”). */
export type DueSubject = { spaceId: string; name: string; due: number };
type Workspace = { spaces?: { id: string; name: string; kind?: string }[]; studySets?: { spaceId: string; kind?: string; items?: unknown[]; cards?: ({ due: number; reps: number } | null | undefined)[] }[] };

/** Subjects with cards due now, most due first. */
export function dueBySubject(workspace: unknown, now = Date.now()): DueSubject[] {
  const w = (workspace && typeof workspace === 'object' ? workspace : {}) as Workspace;
  const counts = new Map<string, number>();
  for (const set of Array.isArray(w.studySets) ? w.studySets : []) {
    if (set?.kind !== 'flashcards' || !Array.isArray(set.items)) continue;
    const due = set.items.filter((_, i) => { const c = set.cards?.[i]; return !!c?.reps && isDue(c as Parameters<typeof isDue>[0], now); }).length;
    if (due) counts.set(set.spaceId, (counts.get(set.spaceId) || 0) + due);
  }
  return (Array.isArray(w.spaces) ? w.spaces : []).filter((s) => s?.kind === 'subject' && counts.has(s.id))
    .map((s) => ({ spaceId: s.id, name: String(s.name || 'A subject').slice(0, 80), due: counts.get(s.id)! }))
    .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
}
/** Whether the person has any flashcards: reminders are on by default once they do. */
export const hasFlashcards = (workspace: unknown) => ((workspace as Workspace)?.studySets || []).some((s) => s?.kind === 'flashcards' && (s.items?.length || 0) > 0);

/** The reminder for what is due, or null when nothing is: “12 cards due in Biology 101”, or a total across subjects.
 *  A click opens the subject with the most due. */
export function reminderFor(due: DueSubject[]) {
  if (!due.length) return null;
  const total = due.reduce((n, s) => n + s.due, 0), cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`;
  const body = due.length === 1 ? `${cards(total)} due in ${due[0].name}` : `${cards(total)} due across ${due.length} subjects, ${due[0].due} in ${due[0].name}`;
  return { title: 'Time to review', body, spaceId: due[0].spaceId };
}

/** “2026-10-23” in local time: one reminder a day at most is counted by this. */
export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const validTime = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
/** Whether today's reminder may go now: on, none sent today, and between the chosen time (local) and 22:00 (or an
 *  hour after a later chosen time). A PC that was asleep at the chosen time gets it when it wakes that day. */
export function reminderTime(settings: { enabled: boolean; time: string; lastSent?: string }, now = new Date()) {
  if (!settings.enabled || !validTime(settings.time) || settings.lastSent === localDay(now)) return false;
  const [h, m] = settings.time.split(':').map(Number), at = now.getHours() * 60 + now.getMinutes(), from = h * 60 + m;
  return at >= from && at < Math.max(22 * 60, from + 60);
}
