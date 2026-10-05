import { z } from "zod";
const id = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\w:-]+$/);
const scope = z.string().regex(/^(chat|project|subject|user):[\w-]{1,100}$/);
const source = z
  .object({
    id: z.string().max(200),
    locator: z.string().max(300),
    at: z.string().datetime(),
  })
  .strict();
export const memoryRecord = z
  .object({
    id,
    scope,
    key: z.string().max(100),
    text: z.string().max(2000),
    kind: z.enum(["fact", "preference", "inference", "temporary"]),
    confirmed: z.boolean(),
    confidence: z.number().min(0).max(1),
    source,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    supersededBy: z.string().max(120).optional(),
    derivedFrom: z.array(id).max(50),
    sharedWith: z.array(scope).max(10),
  })
  .strict();
export const syncSchemas = {
  skills: z
    .array(
      z
        .object({
          id,
          name: z.string().max(150),
          description: z.string().max(3000),
          category: z.string().max(100),
          icon: z.string().max(80),
          steps: z.array(z.string().max(12000)).min(2).max(30),
          builtin: z.literal(false),
        })
        .strict(),
    )
    .max(200),
  memory: z.array(memoryRecord).max(1000),
  notes: z
    .array(z.object({ id, text: z.string().max(30000) }).strict())
    .max(200),
};
export type SyncKind = keyof typeof syncSchemas;
export type SyncItem = { id: string; [key: string]: unknown };
export function validateSync(kind: SyncKind, data: unknown): SyncItem[] {
  const parsed = syncSchemas[kind].parse(data);
  if (new Set(parsed.map((x) => x.id)).size !== parsed.length)
    throw Error("Duplicate sync record.");
  return parsed as SyncItem[];
}
const stamped = (x: SyncItem) =>
  typeof x.updatedAt === "string" && Number.isFinite(Date.parse(x.updatedAt));
/**
 * When a record changed. A time more than a day ahead comes from a broken clock (real ones are minutes apart at
 * most), so it loses to any plausible time instead of winning every conflict until that date.
 */
const at = (x: SyncItem) => { const t = Date.parse(x.updatedAt as string); return t > Date.now() + 86_400_000 ? -Infinity : t; };
/** A stable id for the local side of a conflict, so every device derives the same one. */
function conflictId(item: SyncItem) {
  let h = 0x811c9dc5;
  for (const c of JSON.stringify(item)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return `${item.id.slice(0, 100)}-copy-${h.toString(36)}`;
}
/** Three-way comparison includes deletions. Conflicts resolve per record so one never blocks the collection:
 * - both edited, timestamps on both (memory) → newest update wins, ties go to remote;
 * - both edited, no timestamps (notes, skills) → both are kept, the local copy under a derived id;
 * - edited on one side, deleted on the other → a timestamped record (memory) stays forgotten; notes and skills keep the edit. */
export function mergeSync(
  base: SyncItem[],
  local: SyncItem[],
  remote: SyncItem[],
) {
  const maps = [base, local, remote].map(
      (list) => new Map(list.map((x) => [x.id, x])),
    ),
    result: SyncItem[] = [];
  for (const id of new Set([...base, ...local, ...remote].map((x) => x.id))) {
    const [b, l, r] = maps.map((m) => m.get(id)),
      equal = (a: unknown, b: unknown) =>
        JSON.stringify(a) === JSON.stringify(b);
    if (equal(l, b) || equal(l, r)) { if (r) result.push(r); continue; }
    if (equal(r, b)) { if (l) result.push(l); continue; }
    if (l && r) {
      if (stamped(l) && stamped(r)) result.push(at(l) > at(r) ? l : r);
      else result.push(r, { ...l, id: conflictId(l) });
    } else {
      const edited = (l || r)!;
      if (!stamped(edited)) result.push(edited);
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
