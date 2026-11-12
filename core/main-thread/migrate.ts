import type { Chat } from '../types.ts';

/** Marks the one-time move of standalone chats to Earlier chats (docs/MAIN-THREAD.md). */
export const EARLIER_MIGRATION = 'main-thread-1';
export const MAIN_TITLE = 'Clem';

type Workspace = { chats: Chat[]; migrations?: string[] };

export const mainThreadOf = (chats: Chat[]) => chats.find((c) => c.kind === 'main');
/** A chat the sidebar, search and Usage list: saved, in a subject or project, not the main thread. */
export const isSpaceChat = (c: Chat) => !c.temporary && c.kind !== 'main' && !c.archived && !!c.spaceId;
export const earlierChats = (chats: Chat[]) => chats.filter((c) => c.archived === 'earlier').sort((a, b) => b.updated - a.updated);

/**
 * Every workspace has exactly one main thread, and its chats from before subjects and projects held every chat sit in
 * Earlier chats. Idempotent: the move runs once (recorded in `migrations`), a second main thread left by a merge is
 * folded into the first, and an unchanged workspace comes back as the same object.
 */
export function withMainThread<T extends Workspace>(state: T, now = Date.now(), id: () => string = () => crypto.randomUUID()): T {
  let chats = state.chats, migrations = state.migrations, changed = false;
  const mains = chats.filter((c) => c.kind === 'main');
  if (!mains.length) {
    chats = [{ id: id(), kind: 'main', title: MAIN_TITLE, titled: true, renamed: true, pinned: true, spaceId: null, messages: [], updated: now }, ...chats];
    changed = true;
  } else if (mains.length > 1) {
    const [keep, ...rest] = mains;
    const messages = [...keep.messages, ...rest.flatMap((c) => c.messages)].filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    chats = chats.filter((c) => !rest.includes(c)).map((c) => (c === keep ? { ...c, messages } : c));
    changed = true;
  }
  if (!migrations?.includes(EARLIER_MIGRATION)) {
    chats = chats.map((c) => (c.kind !== 'main' && !c.spaceId && !c.temporary && !c.archived ? { ...c, archived: 'earlier' as const, pinned: false } : c));
    migrations = [...(migrations || []), EARLIER_MIGRATION];
    changed = true;
  }
  return changed ? { ...state, chats, migrations } : state;
}

/** Moves an earlier chat into a subject or project: it becomes an ordinary chat there. */
export function moveEarlier(chats: Chat[], chatId: string, spaceId: string): Chat[] {
  return chats.map((c) => (c.id === chatId && c.kind !== 'main' ? (({ archived: _, ...rest }) => ({ ...rest, spaceId }))(c) : c));
}
