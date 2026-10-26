import type { Chat, StoredFile } from "./types";
/** How long before a message an upload counts as sent with it, for files saved before uploads were tagged with their chat. */
const UPLOAD_WINDOW = 30 * 60 * 1000;
/** Uploads sent in a chat are tagged with it from 0.3.6 on; an untagged file newer than this came from the library. */
const TAGGED_SINCE = Date.parse("2026-10-26T00:00:00Z");
/** The stored files that go with a chat when it is deleted, so a deleted chat does not leave its files filling the disk.
 *  Files sent in the chat always go. Files Clem made in it go too, unless the chat is in a subject or project: there
 *  they stay in its files like any other. A file picked from the library, or one another chat still uses, stays. */
export function filesOfDeletedChat(chat: Chat, chats: Chat[], files: StoredFile[]): StoredFile[] {
  const elsewhere = new Set(chats.filter((c) => c.id !== chat.id).flatMap((c) => c.messages.flatMap((m) => [...(m.attachments || []), ...(m.context || []), ...(m.pointers || []).flatMap((p) => (p.fileId ? [p.fileId] : []))])));
  const first = new Map<string, { role: "user" | "assistant"; at?: number }>();
  for (const m of chat.messages) for (const id of m.attachments || []) if (!first.has(id)) first.set(id, { role: m.role, at: m.at });
  return files.filter((f) => {
    if (elsewhere.has(f.id) || f.id.startsWith("drive_")) return false;
    if (f.chatId) return f.chatId === chat.id && (!f.made || !chat.spaceId);
    const seen = first.get(f.id);
    if (!seen) return false;
    if (f.made) return seen.role === "assistant" && !chat.spaceId && !f.spaceId;
    return seen.role === "user" && (f.spaceId || null) === (chat.spaceId || null) && f.created < TAGGED_SINCE && seen.at !== undefined && f.created <= seen.at && seen.at - f.created <= UPLOAD_WINDOW;
  });
}
