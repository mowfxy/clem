// Saving a subject's CMS files (docs/GUC-VPS-ENGINE.md → Checks and saved files): after the course page is read (only
// when it changed), every file its save rules keep that isn't saved yet, or whose link changed, is downloaded once,
// hashed, stored once per content and shown in the subject's Files. Nothing else is downloaded.
import { materialFile } from "../../core/guc/hub.ts";
import { materialKind, matches, weekNumbers, type SaveRules } from "../../core/guc/rules.ts";
import type { Db } from "./db.ts";
import { GucError } from "./errors.ts";
import { fetchFile, fileSize, type GucClient } from "./guc-client.ts";
import { sha256, type FileStore } from "./storage.ts";

export type SaveStats = { requests: number; bytes: number; saved: number; skipped: number; deduped: number; ms: number };
const GUC_HOST = /^https:\/\/([\w-]+\.)*guc\.edu\.eg\//;
/** The workspace file id a saved CMS file shows under in Files ("guc_<material>"); the viewer and the AI read it there. */
export const workspaceId = (materialId: string) => "guc_" + materialId.replace(/[^\w-]/g, "_").slice(0, 96);

/** Downloads what `rules` keep from the course and isn't saved yet. Two at a time (the client's per-host limit). */
export async function saveFiles(o: { db: Db; owner: string; subjectId: string; courseKey: string; rules: SaveRules; client: () => GucClient; store: FileStore }): Promise<SaveStats> {
  const { db, owner, store } = o, started = Date.now();
  const stats: SaveStats = { requests: 0, bytes: 0, saved: 0, skipped: 0, deduped: 0, ms: 0 };
  const materials = await db.query<{ material_id: string; week: string; title: string; kind: string; url: string }>("select material_id, week, title, kind, url from guc_materials where owner_id = $1 and course_key = $2", [owner, o.courseKey]);
  if (!materials.length) return { ...stats, ms: Date.now() - started };
  const saved = new Map((await db.query<{ file_id: string; url: string | null }>("select file_id, url from file_objects where owner_id = $1 and file_id = any($2::text[])", [owner, materials.map((m) => "guc:" + m.material_id)])).map((r) => [r.file_id, r.url]));
  // Files a size rule turned away after downloading (GUC didn't say the size up front): not asked for again.
  const refused = new Set((await db.query<{ event_key: string }>("select event_key from notifications_sent where owner_id = $1 and channel = 'too_big'", [owner])).map((r) => r.event_key));
  const weeks = weekNumbers(materials.map((m) => m.week));
  const wanted = materials.filter((m) => {
    const keep = m.url && GUC_HOST.test(m.url) && materialKind(m) !== "links" && matches(o.rules, m, { week: weeks.get(m.week) }) && saved.get("guc:" + m.material_id) !== m.url && !refused.has(m.material_id + "|" + m.url);
    if (!keep) stats.skipped++;
    return keep;
  });
  let client: GucClient | undefined, writing: Promise<void> = Promise.resolve();
  const queue = [...wanted];
  const one = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      client ||= o.client();
      const before = client.requests;
      try {
        const limit = o.rules.maxMB ? o.rules.maxMB * 1024 * 1024 : 0;
        if (limit) { const size = await fileSize(client, m.url); if (size && size > limit) { stats.skipped++; continue; } }
        const file = await fetchFile(client, m.url);
        stats.bytes += file.bytes.length;
        if (limit && file.bytes.length > limit) {
          stats.skipped++;
          await db.query("insert into notifications_sent (owner_id, event_key, channel) values ($1, $2, 'too_big') on conflict do nothing", [owner, m.material_id + "|" + m.url]);
          continue;
        }
        // Downloads overlap; storing is one at a time, so the same bytes fetched twice at once are still kept once.
        const done = (writing = writing.then(() => keep(o, m, file, stats)));
        await done;
      } catch (e) {
        if (e instanceof GucError && (e.kind === "auth" || e.kind === "offline")) throw e;
        stats.skipped++; // a broken link on CMS: tried again next check
      } finally { stats.requests += client.requests - before; }
    }
  };
  await Promise.all([one(), one()]);
  return { ...stats, ms: Date.now() - started };
}

async function keep(o: { db: Db; owner: string; subjectId: string; courseKey: string; store: FileStore }, m: { material_id: string; week: string; title: string; url: string }, file: { bytes: Uint8Array; type: string }, stats: SaveStats) {
  const { db, owner, store } = o, hash = sha256(file.bytes), { name, type } = materialFile(m.url, m.title);
  const mime = type === "application/octet-stream" && file.type ? file.type : type, ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase() || "";
  // The same bytes saved before (another entry, or the same file posted again): no second copy.
  const [twin] = await db.query<{ path: string }>("select path from file_objects where owner_id = $1 and sha256 = $2 and location = $3 limit 1", [owner, hash, store.location]);
  const path = twin && await store.has(twin.path) ? twin.path : await store.put(hash, ext, file.bytes);
  if (twin?.path === path) stats.deduped++;
  const [was] = await db.query<{ path: string; sha256: string }>("select path, sha256 from file_objects where owner_id = $1 and file_id = $2", [owner, "guc:" + m.material_id]);
  if (was?.sha256 === hash && was.path === path) {
    // A new link to the same bytes: nothing new to show.
    await db.query("update file_objects set url = $3 where owner_id = $1 and file_id = $2", [owner, "guc:" + m.material_id, m.url]);
    return;
  }
  await store.expose(workspaceId(m.material_id), path);
  await db.tx(async (t) => {
    await t.query(`insert into file_objects (owner_id, file_id, location, path, sha256, size, material_id, subject_id, url, name, mime, saved_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
      on conflict (owner_id, file_id) do update set location = excluded.location, path = excluded.path, sha256 = excluded.sha256, size = excluded.size, subject_id = excluded.subject_id, url = excluded.url, name = excluded.name, mime = excluded.mime, saved_at = now()`,
      [owner, "guc:" + m.material_id, store.location, path, hash, file.bytes.length, m.material_id, o.subjectId, m.url, name, mime]);
    await t.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail) values ($1, $2, 'file_saved', $3, $4, $5) on conflict do nothing",
      [owner, `file:${m.material_id}:${hash.slice(0, 16)}`, o.courseKey, name, JSON.stringify({ id: m.material_id, size: file.bytes.length, week: m.week, type: mime, subjectId: o.subjectId })]);
  });
  stats.saved++;
  // The bytes this file held before, when nothing else uses them any more.
  if (was && was.path !== path) {
    const [used] = await db.query("select 1 from file_objects where owner_id = $1 and path = $2 limit 1", [owner, was.path]);
    if (!used) await store.remove(was.path);
  }
}
