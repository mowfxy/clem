// The person's corrections, stored (docs/GUC-VPS-ENGINE.md → Corrections; core/guc/corrections.ts decides what they
// mean). A correction is written once and applied where the item lives now (its row and the latest snapshot), at the
// next sync (guc-sync.ts), and at read time (guc-read.ts). Undo puts the item back as it was. Every query filters on
// owner_id.
import { randomUUID } from "node:crypto";
import type { Correction, CorrectionKind } from "../../core/guc/corrections.ts";
import type { GucDeadline, GucSnapshot } from "../../core/guc/types.ts";
import type { Db } from "./db.ts";

type Row = { correction_id: string; kind: CorrectionKind; item_id: string | null; source_ref: string | null; fingerprint: string | null; course_key: string | null; patch: Record<string, unknown>; before: unknown; label: string; created_at: Date };
const fromRow = (r: Row): Correction => ({ id: r.correction_id, kind: r.kind, at: new Date(r.created_at).getTime(), label: r.label, patch: r.patch || {},
  ...(r.item_id ? { itemId: r.item_id } : {}), ...(r.source_ref ? { sourceRef: r.source_ref } : {}), ...(r.fingerprint ? { fingerprint: r.fingerprint } : {}), ...(r.course_key ? { courseKey: r.course_key } : {}), ...(r.before ? { before: r.before } : {}) });

/** The corrections in force, oldest first (`since`: only those made after it). */
export async function loadCorrections(db: Db, owner: string, since?: number): Promise<Correction[]> {
  const rows = await db.query<Row>("select * from guc_corrections where owner_id = $1 and undone_at is null and created_at > $2 order by created_at, correction_id limit 500", [owner, new Date(since ?? 0)]);
  return rows.map(fromRow);
}

/** `at`: when it was made (the engine's clock). */
export async function addCorrection(db: Db, owner: string, c: Omit<Correction, "id" | "at">, at = Date.now()): Promise<Correction> {
  const id = "fix" + randomUUID().replace(/-/g, "").slice(0, 12);
  const [row] = await db.query<Row>(`insert into guc_corrections (owner_id, correction_id, kind, item_id, source_ref, fingerprint, course_key, patch, before, label, created_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`, [owner, id, c.kind, c.itemId ?? null, c.sourceRef ?? null, c.fingerprint ?? null, c.courseKey ?? null, c.patch, c.before ?? null, c.label.slice(0, 300), new Date(at)]);
  return fromRow(row);
}

/** Lifts one correction (undo): it no longer applies, and the item it changed is put back as it was. Returns it, or
 *  null when there is none in force with that id. A link change is put back by the caller (it needs the engine). */
export async function undoCorrection(db: Db, owner: string, id: string): Promise<Correction | null> {
  const [row] = await db.query<Row>("update guc_corrections set undone_at = now() where owner_id = $1 and correction_id = $2 and undone_at is null returning *", [owner, id]);
  if (!row) return null;
  const c = fromRow(row), before = c.before as GucDeadline | undefined;
  if (before && typeof before === "object" && before.id && !before.id.startsWith("exam-")) await putItem(db, owner, before);
  // An item the person added leaves again.
  if (c.kind === "add" && c.itemId) await dropItems(db, owner, { id: c.itemId });
  return c;
}

/** A tracked item as stored (the latest snapshot has every field, its row the rest). */
export async function storedItems(db: Db, owner: string): Promise<GucDeadline[]> {
  const [row] = await db.query<{ data: Partial<GucSnapshot> }>("select data from guc_snapshots where owner_id = $1 order by id desc limit 1", [owner]);
  return row?.data.deadlines || [];
}

/** Writes one tracked item where it lives: its row and the latest snapshot (which the next sync starts from). */
export async function putItem(db: Db, owner: string, d: GucDeadline) {
  await db.tx(async (t) => {
    await t.query("delete from guc_deadlines where owner_id = $1 and deadline_id = $2", [owner, d.id]);
    await t.query(`insert into guc_deadlines (owner_id, deadline_id, course_key, title, due, source, note, kind, place, covers, time_known, either, source_ref, sent_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`, [owner, d.id, d.courseKey, d.title, d.due, d.source, d.note ?? null, d.kind ?? null, d.place ?? null, d.covers ?? null, d.timeKnown ?? null, d.either ?? null, d.ref ?? null, d.sent ?? null]);
    await snapshotItems(t, owner, (list) => [...list.filter((x) => x.id !== d.id), d].sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id)));
  });
}
/** Removes tracked items (one id, or every item of a course) from their rows and the latest snapshot. */
export async function dropItems(db: Db, owner: string, o: { id?: string; courseKey?: string }) {
  await db.tx(async (t) => {
    if (o.id) await t.query("delete from guc_deadlines where owner_id = $1 and deadline_id = $2", [owner, o.id]);
    if (o.courseKey) await t.query("delete from guc_deadlines where owner_id = $1 and course_key = $2", [owner, o.courseKey]);
    await snapshotItems(t, owner, (list) => list.filter((x) => x.id !== o.id && x.courseKey !== o.courseKey));
  });
}
async function snapshotItems(t: Db, owner: string, change: (list: GucDeadline[]) => GucDeadline[]) {
  const [row] = await t.query<{ id: number; data: Partial<GucSnapshot> }>("select id, data from guc_snapshots where owner_id = $1 order by id desc limit 1 for update", [owner]);
  if (row) await t.query("update guc_snapshots set data = jsonb_set(data, '{deadlines}', $2::jsonb) where id = $1", [row.id, JSON.stringify(change(row.data.deadlines || []))]);
}

/** Makes the deadline reader read a course's texts again (all of them, or only `textIds`): they are forgotten as read,
 *  and the course's page is read past its cache, on the next sync of it. What it finds then is a quiet baseline. */
export async function forgetRead(db: Db, owner: string, courseKey: string, textIds?: string[]) {
  await db.tx(async (t) => {
    const [row] = await t.query<{ id: number; seen: { deadlines?: { v: number; courses: string[]; read?: Record<string, string[]>; fails?: Record<string, unknown> } } }>("select id, seen from guc_snapshots where owner_id = $1 order by id desc limit 1 for update", [owner]);
    const dl = row?.seen?.deadlines;
    if (!row || !dl) return;
    const read = { ...(dl.read || {}) }, fails = { ...(dl.fails || {}) };
    if (textIds) read[courseKey] = (read[courseKey] || []).filter((x) => !textIds.includes(x)); else delete read[courseKey];
    delete fails[courseKey];
    await t.query("update guc_snapshots set seen = $2 where id = $1", [row.id, { ...row.seen, deadlines: { ...dl, courses: dl.courses.filter((c) => c !== courseKey), read, fails } }]);
  });
}
