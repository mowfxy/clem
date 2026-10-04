import type { Chat, VisualRecord } from "./types";
/** Temporary chats (and visuals drawn in them) are never written to disk. */
export function withoutTemporary<T extends { chats: Chat[]; visuals: VisualRecord[] }>(state: T): T {
  const temporary = new Set(state.chats.filter((c) => c.temporary).map((c) => c.id));
  if (!temporary.size) return state;
  return { ...state, chats: state.chats.filter((c) => !c.temporary), visuals: state.visuals.filter((v) => !temporary.has(v.chatId)) };
}
