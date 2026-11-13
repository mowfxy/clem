// Home ⇄ main thread (docs/MAIN-THREAD.md "Home to thread"): how the move animates, and home's quick picker of
// subjects and projects for a new chat. Pure, so the window and its tests share them.
import { mentionMatches } from './route.ts';

/** The box's glide between home and the thread (--mt-glide in src/main-thread/main-thread.css): long enough to read as
 *  one piece of glass travelling the height of the window, not a jump. */
export const MORPH_MS = 440;
/** Its curve (--mt-glide-ease): a soft start that still answers the click at once, and a long settle. */
export const MORPH_EASE = 'cubic-bezier(.32,.72,0,1)';
export type Morph = 'view-transition' | 'flip' | 'instant';
/** How home and the main thread trade places: instant when reduced motion or a quieter workspace is asked for, the
 *  View Transitions API when the browser has it, else a FLIP of the composer itself. */
export function morphMode(o: { reduced: boolean; quiet?: boolean; viewTransitions: boolean }): Morph {
  if (o.reduced || o.quiet) return 'instant';
  return o.viewTransitions ? 'view-transition' : 'flip';
}
/** The FLIP's first frame: where the new box starts, as a transform from its own place back to the old one. */
export function flipFrom(from: { left: number; top: number; width: number; height: number }, to: { left: number; top: number; width: number; height: number }) {
  const sx = to.width ? from.width / to.width : 1, sy = to.height ? from.height / to.height : 1;
  return `translate(${Math.round(from.left - to.left)}px, ${Math.round(from.top - to.top)}px) scale(${+sx.toFixed(4)}, ${+sy.toFixed(4)})`;
}

type PickSpace = { id: string; name: string; kind: 'subject' | 'project'; description?: string; sample?: boolean };
type PickChat = { spaceId: string | null; updated: number; kind?: string; archived?: string; temporary?: boolean };
/** When each space was last used: its newest chat. */
export function lastUsed(chats: PickChat[]) {
  const at = new Map<string, number>();
  for (const c of chats) if (c.spaceId && !c.kind && !c.archived && !c.temporary && c.updated > (at.get(c.spaceId) || 0)) at.set(c.spaceId, c.updated);
  return at;
}
/** Home's picker: with no query, the spaces used most recently first (never-used ones after, subjects before projects,
 *  then by name); typed, the same fuzzy match as @ mentions, ties broken by recency. */
export function pickSpaces<T extends PickSpace>(spaces: T[], chats: PickChat[], query = '', limit = 8): T[] {
  const at = lastUsed(chats);
  const recent = [...spaces].sort((a, b) => (at.get(b.id) || 0) - (at.get(a.id) || 0) || (a.kind === b.kind ? 0 : a.kind === 'subject' ? -1 : 1) || a.name.localeCompare(b.name));
  if (!query.trim()) return recent.slice(0, limit);
  const hits = mentionMatches(query, recent, Math.max(limit, 20));
  // A name that starts with what was typed beats a fuzzy hit; otherwise the matcher's order, recency breaking ties.
  const q = query.trim().toLowerCase(), starts = (s: T) => (s.name.toLowerCase().startsWith(q) || s.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) ? 0 : 1);
  return hits.map((s, i) => ({ s, i })).sort((a, b) => starts(a.s) - starts(b.s) || a.i - b.i).slice(0, limit).map((x) => x.s);
}
