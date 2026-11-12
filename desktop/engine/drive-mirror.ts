// The Drive copy of a subject's saved CMS files (docs/GUC-VPS-ENGINE.md → Drive copy): Clem/GUC/<course>/<week> in My
// Drive, or under a folder the person chose. Each file is sent once per folder and content: an unchanged file is never
// sent again, the same bytes in the same folder are one Drive file. The host hands in Drive (desktop: DriveLive).
import type { Db } from "./db.ts";

export interface DriveMirror {
  connected(): Promise<boolean>;
  /** The folder named `name` in `parentId` ("root": My Drive), made when missing. */
  folder(parentId: string, name: string): Promise<string>;
  /** Sends a file from disk; returns its Drive id. */
  upload(folderId: string, name: string, path: string, type: string): Promise<{ id: string }>;
}
export type MirrorResult = { uploaded: number; skipped: number; error?: "reconnect" | "full" | "failed"; message?: string; folderId?: string };

const clean = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Files";
/** "Week: 2026-09-26" → "Week 2026-09-26". */
export const weekFolder = (week: string) => clean(week.replace(/^\s*week\s*:?\s*/i, "Week "));

async function ensure(db: Db, owner: string, drive: DriveMirror, parent: string, path: string, name: string) {
  const [have] = await db.query<{ folder_id: string }>("select folder_id from drive_folders where owner_id = $1 and path = $2", [owner, path]);
  if (have) return have.folder_id;
  const id = await drive.folder(parent, name);
  await db.query("insert into drive_folders (owner_id, path, folder_id) values ($1, $2, $3) on conflict (owner_id, path) do update set folder_id = excluded.folder_id", [owner, path, id]);
  return id;
}
const why = (e: unknown): Pick<MirrorResult, "error" | "message"> => {
  const code = (e as { code?: string })?.code, message = String((e as Error)?.message || e);
  if (code === "not_connected" || code === "reconnect" || /reconnect|connect google drive/i.test(message)) return { error: "reconnect", message: "Reconnect Google Drive to keep copying." };
  if (/drive is full|quota/i.test(message)) return { error: "full", message: "Your Google Drive is full." };
  return { error: "failed", message: message.slice(0, 200) };
};

/** Copies the subject's saved files that Drive doesn't have yet (or has older bytes of) into their week folders. */
export async function mirror(o: { db: Db; owner: string; subjectId: string; drive?: DriveMirror; course: string; folderId?: string; folderName?: string }): Promise<MirrorResult> {
  const { db, owner, subjectId, drive } = o, out: MirrorResult = { uploaded: 0, skipped: 0 };
  const record = async (r: MirrorResult) => {
    await db.query("insert into subject_drive (owner_id, subject_id, folder_id, error, message, at) values ($1, $2, $3, $4, $5, now()) on conflict (owner_id, subject_id) do update set folder_id = coalesce(excluded.folder_id, subject_drive.folder_id), error = excluded.error, message = excluded.message, at = now()",
      [owner, subjectId, r.folderId ?? null, r.error ?? null, r.message ?? null]);
    return r;
  };
  if (!drive) return record({ ...out, error: "reconnect", message: "Google Drive isn't available here." });
  try {
    if (!(await drive.connected())) return record({ ...out, error: "reconnect", message: "Reconnect Google Drive to keep copying." });
    const rootPath = o.folderId ? "id:" + o.folderId : "Clem/GUC/" + clean(o.course);
    const root = o.folderId || await ensure(db, owner, drive, await ensure(db, owner, drive, await ensure(db, owner, drive, "root", "Clem", "Clem"), "Clem/GUC", "GUC"), rootPath, clean(o.course));
    out.folderId = root;
    const rows = await db.query<{ file_id: string; path: string; sha256: string; name: string | null; mime: string | null; week: string | null }>(`select f.file_id, f.path, f.sha256, f.name, f.mime, m.week from file_objects f
      left join guc_materials m on m.owner_id = f.owner_id and 'guc:' || m.material_id = f.file_id
      where f.owner_id = $1 and f.subject_id = $2 and f.location = 'device' and (f.drive_id is null or f.drive_sha256 is distinct from f.sha256 or f.drive_root is distinct from $3)
      order by f.saved_at`, [owner, subjectId, root]);
    for (const r of rows) {
      const week = weekFolder(r.week || "Other files"), folderPath = rootPath + "/" + week;
      const folder = await ensure(db, owner, drive, root, folderPath, week);
      // The same bytes already in this folder (another CMS entry of the same file): point at that copy.
      const [twin] = await db.query<{ drive_id: string }>("select drive_id from file_objects where owner_id = $1 and sha256 = $2 and drive_sha256 = $2 and drive_folder = $3 and drive_id is not null limit 1", [owner, r.sha256, folder]);
      let id = twin?.drive_id;
      if (id) out.skipped++;
      else {
        try { id = (await drive.upload(folder, r.name || r.file_id, r.path, r.mime || "application/octet-stream")).id; }
        catch (e) {
          // A folder deleted in Drive: forget the cached ids so the next copy makes them again.
          if (/no longer available/i.test(String((e as Error)?.message))) await db.query("delete from drive_folders where owner_id = $1 and (path = $2 or path = $3)", [owner, folderPath, rootPath]);
          throw e;
        }
        out.uploaded++;
      }
      await db.query("update file_objects set drive_id = $3, drive_sha256 = sha256, drive_folder = $4, drive_root = $5 where owner_id = $1 and file_id = $2", [owner, r.file_id, id, folder, root]);
    }
    return record(out);
  } catch (e) { return record({ ...out, ...why(e) }); }
}

/** What the Drive card shows: copied, waiting, the folder in use and the last problem. `chosen`: the folder the person
 *  picked (files copied elsewhere wait for it). */
export async function driveState(db: Db, owner: string, subjectId: string, enabled: boolean, chosen?: string) {
  const [s] = await db.query<{ folder_id: string | null; error: string | null; message: string | null }>("select folder_id, error, message from subject_drive where owner_id = $1 and subject_id = $2", [owner, subjectId]);
  const root = chosen || s?.folder_id || null;
  const [n] = await db.query<{ copied: number; waiting: number }>(`select count(*) filter (where drive_id is not null and drive_sha256 = sha256 and ($3::text is null or drive_root = $3))::int as copied,
    count(*) filter (where drive_id is null or drive_sha256 is distinct from sha256 or ($3::text is not null and drive_root is distinct from $3))::int as waiting
    from file_objects where owner_id = $1 and subject_id = $2`, [owner, subjectId, root]);
  return { folderId: root || undefined, copied: n?.copied || 0, waiting: enabled ? n?.waiting || 0 : 0, ...(enabled && s?.error ? { error: s.error as "reconnect" | "full" | "failed", message: s.message || undefined } : {}) };
}
