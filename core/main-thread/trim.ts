import type { Chat, Message, StoredFile } from '../types.ts';

/**
 * The main thread's size cap. The thread never ends, so its own data on disk (its messages in the saved workspace, and
 * the files only its messages use) is kept under TRIM_LIMIT: once over, the oldest material goes until it is at
 * TRIM_TARGET, so the next save does not trim again. Files go first, oldest first, each leaving a "removed to save space"
 * note on its message; then, if that is not enough, old messages a digest already covers (the digest stays, so the
 * summary, recall and context keep working). Never cut: the last KEEP_DAYS, messages no digest covers, digests, and any
 * card still waiting on the person. A file a subject, project, the library or another chat uses is not counted and never
 * deleted. Pure: the window measures, applies and deletes (src/main-thread/useSizeCap.ts).
 */
export const MB = 1024 * 1024;
export const TRIM_LIMIT = 650 * MB;
export const TRIM_TARGET = 600 * MB;
export const KEEP_DAYS = 30;

type Workspace = { chats: Chat[]; files: StoredFile[] } & Record<string, unknown>;
export type TrimPlan = {
  /** The main thread's own bytes before and after. */
  before: number; after: number;
  /** Files to delete (with their versions), oldest first. */
  files: StoredFile[];
  /** Folded messages to cut. */
  messages: string[];
  /** Bytes the files and the messages free. */
  fileBytes: number; messageBytes: number;
};
export type RemovedFile = NonNullable<Message['removed']>[number];

const encoder = new TextEncoder();
/** A message's bytes as saved in the workspace. */
export const messageBytes = (m: Message) => encoder.encode(JSON.stringify(m)).length;
/** A stored file's bytes with its kept earlier versions. */
export const fileBytes = (f: StoredFile) => (f.size || 0) + (f.versions || []).reduce((n, v) => n + (v.size || 0), 0);
const refsOf = (m: Message) => [...(m.attachments || []), ...(m.context || []), ...(m.pointers || []).flatMap((p) => (p.fileId ? [p.fileId] : []))];

/** Cards that ask nothing of the person once they are old: anything else (Undo, a confirm, a watch, an upcoming reminder,
 *  a setup question, a card this build can't read) keeps its message. */
const PASSIVE = new Set(['brief', 'digest', 'handoff', 'vps_moved', 'file_saved', 'announcement', 'grade', 'deadline', 'setup_done']);
function waitsOnPerson(m: Message, today: string) {
  if (m.plan && m.plan.tasks.some((t) => t.status === 'pending' || t.status === 'running')) return true;
  if (m.limit?.auto && !m.limit.done) return true;
  for (const [, body] of m.content.matchAll(/```clem-card\s*([\s\S]*?)```/g)) {
    let card: { type?: unknown; due?: unknown };
    try { card = JSON.parse(body); } catch { return true; }
    if (card.type === 'reminder') { if (typeof card.due !== 'string' || card.due.slice(0, 10) >= today) return true; continue; }
    if (typeof card.type !== 'string' || !PASSIVE.has(card.type)) return true;
  }
  return false;
}
const isoDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** The main thread's own data: its messages' bytes, and the files only its messages use (with the times they were last
 *  used there). A file tied to a subject or project, placed in a library folder, from Drive, not sent in the main thread,
 *  or named anywhere else in the workspace (another chat, a space's sources, a plan, a room…) is not the thread's. */
export function mainThreadSize(ws: Workspace) {
  const main = ws.chats.find((c) => c.kind === 'main');
  if (!main) return { main, messages: 0, files: 0, total: 0, own: [] as StoredFile[] };
  const { chats, files: _files, ...rest } = ws;
  // Ids are random UUIDs, so a file named anywhere else in the saved workspace shows up in its text.
  const elsewhere = JSON.stringify([rest, chats.filter((c) => c !== main)]);
  const used = new Set(main.messages.flatMap(refsOf));
  const own = ws.files.filter((f) => used.has(f.id) && f.chatId === main.id && !f.spaceId && !f.folderId && !f.id.startsWith('drive_') && !elsewhere.includes(f.id));
  const messages = main.messages.reduce((n, m) => n + messageBytes(m), 0);
  const files = own.reduce((n, f) => n + fileBytes(f), 0);
  return { main, messages, files, total: messages + files, own };
}

/** What to cut, or null while the thread is at or under `limit`. */
export function planTrim(ws: Workspace, now = Date.now(), { limit = TRIM_LIMIT, target = TRIM_TARGET, keepDays = KEEP_DAYS } = {}): TrimPlan | null {
  const size = mainThreadSize(ws);
  if (!size.main || size.total <= limit) return null;
  const msgs = size.main.messages, today = isoDay(now), cutoff = now - keepDays * 864e5;
  const old = (m: Message) => !m.digest && m.at !== undefined && m.at < cutoff && !waitsOnPerson(m, today);
  let total = size.total;
  // 1. Files, oldest first: only those every message using them is old and asks nothing of the person.
  const lastUse = new Map<string, number>(), blocked = new Set<string>();
  for (const m of msgs) for (const id of refsOf(m)) {
    if (!old(m)) blocked.add(id);
    else lastUse.set(id, Math.max(lastUse.get(id) ?? 0, m.at!));
  }
  const files: StoredFile[] = [];
  for (const f of size.own.filter((f) => !blocked.has(f.id) && lastUse.has(f.id)).sort((a, b) => lastUse.get(a.id)! - lastUse.get(b.id)! || a.created - b.created)) {
    if (total <= target) break;
    files.push(f); total -= fileBytes(f);
  }
  const freedFiles = size.total - total;
  // 2. Old messages a digest covers, oldest first. The digest stays.
  const ranges = msgs.filter((m) => m.digest).map((m) => m.digest!);
  const folded = (m: Message) => ranges.some((d) => m.at! >= d.from && m.at! <= d.to);
  const messages: string[] = [];
  if (total > target) for (const m of msgs.filter((m) => old(m) && folded(m)).sort((a, b) => a.at! - b.at!)) {
    if (total <= target) break;
    messages.push(m.id); total -= messageBytes(m);
  }
  if (!files.length && !messages.length) return null;
  return { before: size.total, after: total, files, messages, fileBytes: freedFiles, messageBytes: size.total - freedFiles - total };
}

/** The main thread with a plan applied: cut messages gone, each deleted file's reference replaced by a small note. */
export function applyTrim(chat: Chat, plan: TrimPlan, at = Date.now()): Chat {
  const gone = new Map(plan.files.map((f) => [f.id, f])), cut = new Set(plan.messages);
  const messages = chat.messages.filter((m) => !cut.has(m.id)).map((m) => {
    const hit = [...new Set(refsOf(m))].filter((id) => gone.has(id));
    if (!hit.length) return m;
    const removed: RemovedFile[] = hit.map((id) => ({ name: gone.get(id)!.name, size: fileBytes(gone.get(id)!), at }));
    const keep = (id: string) => !gone.has(id);
    return {
      ...m,
      ...(m.attachments ? { attachments: m.attachments.filter(keep) } : {}),
      ...(m.context ? { context: m.context.filter(keep) } : {}),
      ...(m.pointers ? { pointers: m.pointers.map(({ fileId, ...p }) => (fileId && !keep(fileId) ? p : { ...p, ...(fileId ? { fileId } : {}) })) } : {}),
      removed: [...(m.removed || []), ...removed],
    };
  });
  return { ...chat, messages };
}

const mb = (n: number) => `${Math.max(1, Math.round(n / MB))} MB`;
/** The one quiet line the thread shows after a trim. */
export function trimLine(plan: TrimPlan, limit = TRIM_LIMIT) {
  const what = plan.files.length && plan.messages.length ? 'old main-thread files and messages' : plan.files.length ? 'old main-thread files' : 'old main-thread messages';
  return `Cleared ${mb(plan.before - plan.after)} of ${what} to stay under ${mb(limit)}.`;
}
