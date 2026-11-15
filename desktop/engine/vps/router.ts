// Where a workspace file's bytes live (docs/GUC-VPS-ENGINE.md "Storage on the VPS"). The window's file API is
// unchanged (/api/local/files/<id>); main asks this router instead of the disk. This PC always keeps every file (owner,
// 2026-11-15: "files live on both"). With "Keep a copy of my files on the VPS" on (mode "vps"), each file is also copied
// there in the background, checked, while Clem's share of the VPS disk stays at or under 82% (file_objects 'ws:<id>',
// location 'vps' = it has a VPS copy too). Past the limit a file simply stays on this PC only. Copying never blocks a
// write; what a dropped connection left out is copied by the mover later.
import type { Db } from "../db.ts";
import { sha256 } from "../storage.ts";
import type { StorageMode, StorageUsage } from "../../../core/vps/types.ts";
import type { VpsStore } from "./store.ts";
import type { DiskLimit } from "./limit.ts";
import { limitView } from "../../../core/vps/limit.ts";

/** This device's Files folder for one owner (desktop: WorkspaceDisk). */
export type LocalBlobs = {
  read(id: string): Promise<Uint8Array | null>;
  write(id: string, bytes: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
  has(id: string): Promise<boolean>;
  path(id: string): string;
  list(): Promise<{ id: string; size: number }[]>;
};
export type FileRow = { file_id: string; location: "device" | "vps" | "drive"; path: string; sha256: string; size: number; pinned: boolean; cached: boolean };

export class StorageRouter {
  readonly owner: string;
  private db: Db; private local: LocalBlobs; private remote: () => VpsStore | undefined; private mode: () => StorageMode; private log: (m: string) => void;
  private fetching = new Map<string, Promise<Uint8Array | null>>();
  private queue: string[] = []; private prefetching = 0;
  /** Background copies to the VPS, one after another (`idle` waits for them). */
  private copying: Promise<unknown> = Promise.resolve();
  /** The VPS's storage limit: a copy that would pass it isn't made (the file stays on this PC only). */
  private limit?: DiskLimit;
  /** What the worker couldn't keep there with the laptop off (it reports them), shown with the limit. */
  waiting: string[] = [];
  constructor(o: { db: Db; owner: string; local: LocalBlobs; remote: () => VpsStore | undefined; mode: () => StorageMode; log?: (m: string) => void; limit?: DiskLimit }) {
    this.db = o.db; this.owner = o.owner; this.local = o.local; this.remote = o.remote; this.mode = o.mode; this.log = o.log || (() => {}); this.limit = o.limit;
  }
  async init() { return this; }
  /** Waits for the background copies started so far (tests, and the mover before it lists what is left). */
  idle() { return this.copying.then(() => {}); }

  async row(id: string): Promise<FileRow | undefined> {
    const [r] = await this.db.query<FileRow & { size: string }>("select file_id, location, path, sha256, size, pinned, cached from file_objects where owner_id = $1 and file_id = $2", [this.owner, "ws:" + id]);
    return r && { ...r, size: Number(r.size) };
  }
  /** The file has a checked copy on the VPS (`cached`: and here, as every file should). */
  async markVps(id: string, path: string, hash: string, size: number, cached: boolean) {
    await this.db.query("insert into file_objects (owner_id, file_id, location, path, sha256, size, cached, last_access) values ($1, $2, 'vps', $3, $4, $5, $6, now()) on conflict (owner_id, file_id) do update set location = 'vps', path = excluded.path, sha256 = excluded.sha256, size = excluded.size, cached = excluded.cached, last_access = now()",
      [this.owner, "ws:" + id, path, hash, size, cached]);
  }
  /** The file lives on this device only again (its VPS copy is dropped by the caller once nothing else uses it). */
  async markDevice(id: string) { await this.db.query("delete from file_objects where owner_id = $1 and file_id = $2", [this.owner, "ws:" + id]); }
  /** Whether any file still uses this VPS path. */
  async used(path: string) { return (await this.db.query("select 1 from file_objects where owner_id = $1 and location = 'vps' and path = $2 limit 1", [this.owner, path])).length > 0; }
  /** This PC's copy; a file only on the VPS (an install from before both kept everything) is brought here and kept. */
  async readFile(id: string): Promise<Uint8Array | null> {
    const here = await this.local.read(id);
    if (here) return here;
    let job = this.fetching.get(id);
    if (!job) {
      job = (async () => {
        const r = await this.row(id), store = this.remote();
        if (!r || r.location !== "vps") return null;
        if (!store) throw Error("Your VPS isn't reachable right now, and this file isn't on this device yet.");
        const bytes = await store.read(r.path);
        await this.local.write(id, bytes);
        await this.db.query("update file_objects set cached = true, last_access = now() where owner_id = $1 and file_id = $2", [this.owner, "ws:" + id]);
        return bytes;
      })().finally(() => this.fetching.delete(id));
      this.fetching.set(id, job);
    }
    return job;
  }

  /** A write lands here and returns; with copies on, the VPS gets a checked copy in the background (never blocking). A
   *  changed file's old VPS copy goes once nothing else uses it. */
  async writeFile(id: string, bytes: Uint8Array) {
    const before = await this.row(id);
    await this.local.write(id, bytes);
    if (before) await this.markDevice(id);
    const hash = sha256(bytes);
    this.copying = this.copying.then(async () => {
      await this.copy(id, bytes, hash).catch((e) => this.log("[vps] copy later: " + (e as Error).message));
      if (before?.location === "vps" && before.path !== (await this.row(id))?.path) await this.dropRemote(before.path, id, before.size).catch(() => {});
    });
  }
  /** One file's copy on the VPS, when copies are on, the person didn't keep it on the PC, and it fits under the limit. */
  async copy(id: string, bytes: Uint8Array, hash = sha256(bytes)) {
    if (this.mode() !== "vps" || await this.keepOf(id) === "pc") return false;
    const store = this.remote();
    if (!store) return false;
    if (this.limit && !(await this.limit.reserve(bytes.length))) { this.log("[vps] at the storage limit: a file stays on this PC only"); return false; }
    try {
      const path = await store.put(hash, "blob", bytes);
      // Deleted or changed meanwhile: no copy for bytes the person no longer has.
      const now = await this.local.read(id);
      if (!now || sha256(now) !== hash) { if (!(await this.used(path))) await store.remove(path).catch(() => {}); this.limit?.freed(bytes.length); return false; }
      await this.markVps(id, path, hash, bytes.length, true);
      return true;
    } catch (e) { this.limit?.release(bytes.length); throw e; }
  }
  /** Deleting a file deletes its bytes here and on the VPS, and its row and cache entry (docs/GUC-VPS-ENGINE.md
   *  "Deleting"). With the VPS out of reach, the path is kept in vps_deletes and removed when it's back (sweepDeletes),
   *  once; bytes another file still uses (the same content) are left. The freed room counts toward the limit at once. */
  async deleteFile(id: string) {
    const r = await this.row(id);
    await this.local.remove(id);
    await this.db.query("delete from file_keep where owner_id = $1 and file_id = $2", [this.owner, id]);
    if (r) { await this.markDevice(id); if (r.location === "vps") await this.dropRemote(r.path, id, r.size); }
  }
  /** One VPS path no file uses any more: removed now, or remembered until the VPS is reachable. */
  async dropRemote(path: string, id: string, size: number) {
    if (await this.used(path)) return;
    const store = this.remote();
    try {
      if (!store) throw Error("offline");
      await store.remove(path).catch((e: Error) => { if (!/no such file|ENOENT/i.test(e.message)) throw e; });
      this.limit?.freed(size);
      await this.db.query("delete from vps_deletes where owner_id = $1 and path = $2", [this.owner, path]);
    } catch {
      await this.db.query("insert into vps_deletes (owner_id, path, file_id, size) values ($1, $2, $3, $4) on conflict do nothing", [this.owner, path, id, size]);
    }
  }
  /** Deletes made while the VPS was out of reach, applied now: each path once, and never one a file uses again (the
   *  same bytes re-added since). Returns how many were removed. */
  async sweepDeletes(usedElsewhere: (path: string) => boolean = () => false) {
    const store = this.remote();
    if (!store) return 0;
    let n = 0;
    for (const d of await this.db.query<{ path: string; file_id: string; size: string }>("select path, file_id, size from vps_deletes where owner_id = $1 order by created_at limit 500", [this.owner])) {
      if (!(await this.used(d.path)) && !usedElsewhere(d.path)) { try { await store.remove(d.path); this.limit?.freed(Number(d.size)); n++; } catch (e) { if (!/no such file|ENOENT/i.test((e as Error).message)) continue; } }
      await this.db.query("delete from vps_deletes where owner_id = $1 and path = $2", [this.owner, d.path]);
    }
    return n;
  }
  /** Where the person said a file is kept (vps.keep), if they did. */
  async keepOf(id: string): Promise<"pc" | "vps" | undefined> {
    const [r] = await this.db.query<{ place: "pc" | "vps" }>("select place from file_keep where owner_id = $1 and file_id = $2", [this.owner, id]);
    return r?.place;
  }
  /** The person's word on where a file is kept, carried out at once when the VPS is reachable: "pc" brings it here and
   *  removes it from the VPS, "vps" puts it there, "auto" (undefined) lets Clem decide again. */
  async keepOn(id: string, place: "pc" | "vps" | undefined) {
    if (place) await this.db.query("insert into file_keep (owner_id, file_id, place) values ($1, $2, $3) on conflict (owner_id, file_id) do update set place = excluded.place, created_at = now()", [this.owner, id, place]);
    else await this.db.query("delete from file_keep where owner_id = $1 and file_id = $2", [this.owner, id]);
    const r = await this.row(id);
    if (place === "pc" && r?.location === "vps") {
      const bytes = await this.readFile(id);
      if (!bytes) throw Error("That file's bytes couldn't be read from the VPS.");
      await this.local.write(id, bytes);
      await this.markDevice(id);
      await this.dropRemote(r.path, id, r.size);
      return "moved to this PC";
    }
    if (place === "vps" && r?.location !== "vps") {
      const bytes = await this.local.read(id);
      if (!bytes) return "kept on the VPS from now on";
      const store = this.remote();
      if (!store) return "goes to the VPS when it's reachable";
      if (this.limit && !(await this.limit.reserve(bytes.length))) return "stays on this PC for now: the VPS is at its storage limit";
      const hash = sha256(bytes), path = await store.put(hash, "blob", bytes);
      await this.markVps(id, path, hash, bytes.length, true);
      return "moved to the VPS";
    }
    return place === "pc" ? "kept on this PC" : place === "vps" ? "kept on the VPS" : "left to Clem";
  }
  async hasFile(id: string) { return (await this.local.has(id)) || (await this.row(id))?.location === "vps"; }
  /** Where the bytes are on this device (call `ensure` first for files that may be only on the VPS). */
  blobPath(id: string) { return this.local.path(id); }
  /** Brings these files to this device (the AI's working folder copies them from here). Missing ones are skipped. */
  async ensure(ids: string[]) { await Promise.all(ids.map((id) => this.readFile(id).catch(() => null))); }
  /** Brings likely-next files in the background, two at a time. */
  prefetch(ids: string[]) {
    for (const id of ids) if (!this.queue.includes(id)) this.queue.push(id);
    const next = () => {
      while (this.prefetching < 2 && this.queue.length) {
        const id = this.queue.shift()!;
        this.prefetching++;
        void this.local.has(id).then((h) => (h ? null : this.readFile(id))).catch(() => null).finally(() => { this.prefetching--; next(); });
      }
    };
    next();
  }
  async usage(): Promise<StorageUsage> {
    const [local, rows] = await Promise.all([this.local.list(), this.db.query<{ file_id: string; size: string }>("select file_id, size from file_objects where owner_id = $1 and location = 'vps'", [this.owner])]);
    const onVps = new Set(rows.filter((r) => r.file_id.startsWith("ws:")).map((r) => r.file_id.slice(3)));
    let device = 0, only = 0, onlyBytes = 0;
    for (const f of local) { device += f.size; if (!onVps.has(f.id)) { only++; onlyBytes += f.size; } }
    const vps = rows.reduce((n, r) => n + Number(r.size), 0), disk = this.limit?.last;
    return { mode: this.mode(), device, vps, files: { device: local.length, vps: rows.length },
      ...(disk ? { vpsLimit: { ...limitView(disk, vps, disk.measuredAt), heldHere: this.mode() === "vps" ? only : 0, heldBytes: this.mode() === "vps" ? onlyBytes : 0, ...(this.waiting.length ? { waiting: this.waiting } : {}) } } : {}) };
  }
}
