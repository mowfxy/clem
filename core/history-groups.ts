// Sidebar history: pinned chats first, then every other chat under the day it was last active
// ("Today", "Yesterday", "Oct 8", or "Oct 8, 2025" for an earlier year), newest first.

export type Dated = { id: string; updated: number; pinned?: boolean };
export type HistoryGroup<T> = { label: string; items: T[] };

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** The label a chat's day reads under, relative to `now` in local time. */
export function dayLabel(updated: number, now = Date.now()): string {
  const today = startOfDay(now), day = startOfDay(updated);
  // Days counted by calendar date, not 24-hour steps, so daylight-saving shifts never move a chat.
  const diff = Math.round((today - day) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = new Date(updated), sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Groups chats for the sidebar; `limit` caps how many unpinned chats are listed (pinned ones always show). */
export function groupHistory<T extends Dated>(chats: T[], now = Date.now(), limit = Infinity): HistoryGroup<T>[] {
  const pinned = chats.filter(c => c.pinned).sort((a, b) => b.updated - a.updated);
  const rest = chats.filter(c => !c.pinned).sort((a, b) => b.updated - a.updated).slice(0, limit);
  const groups: HistoryGroup<T>[] = pinned.length ? [{ label: 'Pinned', items: pinned }] : [];
  for (const chat of rest) {
    const label = dayLabel(chat.updated, now), last = groups[groups.length - 1];
    if (last && last.label === label && label !== 'Pinned') last.items.push(chat);
    else groups.push({ label, items: [chat] });
  }
  return groups;
}
