// Which files to bring from the VPS before they are asked for, so opening them still feels instant: files in the same
// subject or project from the same week as the one just opened, and the files a chat refers to. Pure.

type F = { id: string; spaceId?: string | null; created?: number; createdAt?: number | string };
const at = (f: F) => Number(f.created ?? (typeof f.createdAt === "string" ? Date.parse(f.createdAt) : f.createdAt)) || 0;
const WEEK = 7 * 86_400_000;

/** Up to `max` files likely opened next after `id`: same space, closest in time within a week, newest first. */
export function likelyNext(files: F[], id: string, max = 6): string[] {
  const f = files.find((x) => x.id === id);
  if (!f) return [];
  const t = at(f);
  return files.filter((x) => x.id !== id && (x.spaceId || null) === (f.spaceId || null) && Math.abs(at(x) - t) <= WEEK / 2)
    .sort((a, b) => Math.abs(at(a) - t) - Math.abs(at(b) - t)).slice(0, max).map((x) => x.id);
}

/** File ids a chat's messages refer to (attachments and file cards). */
export function chatFiles(messages: { attachments?: string[]; context?: string[]; pointers?: { fileId?: string }[] }[], max = 12): string[] {
  const out = new Set<string>();
  for (const m of [...messages].reverse()) { for (const id of [...(m.attachments || []), ...(m.context || []), ...(m.pointers || []).map((p) => p.fileId || "")]) if (id) out.add(id); if (out.size >= max) break; }
  return [...out].slice(0, max);
}
