// Where a workspace file's bytes live (docs/GUC-VPS-ENGINE.md "Storage on the VPS"). The window's file API is
// unchanged (/api/local/files/<id>); main asks this router instead of the disk. With "Store my files on my VPS" on, a
// file's bytes are kept on the VPS (file_objects 'ws:<id>', location 'vps') and this device keeps only an LRU cache of
// recent and pinned files in the same Files/<id>.blob places, so the AI's working folder and the viewer read them as
// before. Device-only files are never evicted; pinned files are never evicted; the cache stays under its cap.
import { LRUCache } from "lru-cache";
import type { Db } from "../db.ts";
import { sha256 } from "../storage.ts";
import type { StorageMode, StorageUsage } from "../../../core/vps/types.ts";
import { DEFAULT_CACHE_CAP } from "../../../core/vps/types.ts";
import type { VpsStore } from "./store.ts";

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
  private lru!: LRUCache<string, number>;
  private cap: number;
  private fetching = new Map<string, Promise<Uint8Array | null>>();
  private queue: string[] = []; private prefetching = 0;
  constructor(o: { db: Db; owner: string; local: LocalBlobs; remote: () => VpsStore | undefined; mode: () => StorageMode; cap?: number; log?: (m: string) => void }) {
    this.db = o.db; this.owner = o.owner; this.local = o.local; this.remote = o.remote; this.mode = o.mode; this.log = o.log || (() => {});
    this.cap = o.cap || DEFAULT_CACHE_CAP;
    this.makeLru();
  }
  private makeLru() {
    const old: [string, number][] = this.lru ? [...this.lru.rentries()] as [string, number][] : [];
    this.lru = new LRUCache<string, number>({ maxSize: this.cap, sizeCalculation: (n) => Math.max(1, n), dispose: (_size, id, reason) => { if (reason === "evict") void this.evict(id); } });
    for (const [id, size] of old) this.lru.set(id, size);
  }
  /** Loads the cache's order from file_objects (oldest access first). */
  async init() {
    const rows = await this.db.query<{ file_id: string; size: string }>("select file_id, size from file_objects where owner_id = $1 and file_id like 'ws:%' and location = 'vps' and cached and not pinned order by last_access nulls first", [this.owner]);
    for (const r of rows) this.lru.set(r.file_id.slice(3), Number(r.size));
    return this;
  }
  setCap(bytes: number) { this.cap = bytes; this.makeLru(); }
  get capBytes() { return this.cap; }

  async row(id: string): Promise<FileRow | undefined> {
    const [r] = await this.db.query<FileRow & { size: string }>("select file_id, location, path, sha256, size, pinned, cached from file_objects where owner_id = $1 and file_id = $2", [this.owner, "ws:" + id]);
    return r && { ...r, size: Number(r.size) };
  }
  /** The file is on the VPS (verified there); `cached`: this device has a copy too. */
  async markVps(id: string, path: string, hash: string, size: number, cached: boolean) {
    await this.db.query("insert into file_objects (owner_id, file_id, location, path, sha256, size, cached, last_access) values ($1, $2, 'vps', $3, $4, $5, $6, now()) on conflict (owner_id, file_id) do update set location = 'vps', path = excluded.path, sha256 = excluded.sha256, size = excluded.size, cached = excluded.cached, last_access = now()",
      [this.owner, "ws:" + id, path, hash, size, cached]);
    const r = await this.row(id);
    if (cached && !r?.pinned) this.keep(id, size); else this.lru.delete(id);
  }
  /** The file lives on this device only again (its VPS copy is dropped by the caller once nothing else uses it). */
  async markDevice(id: string) { this.lru.delete(id); await this.db.query("delete from file_objects where owner_id = $1 and file_id = $2", [this.owner, "ws:" + id]); }
  /** Whether any file still uses this VPS path. */
  async used(path: string) { return (await this.db.query("select 1 from file_objects where owner_id = $1 and location = 'vps' and path = $2 limit 1", [this.owner, path])).length > 0; }
  private keep(id: string, size: number) {
    // Bigger than the whole cache: not kept (the caller drops the local copy).
    if (size > this.cap) return false;
    this.lru.set(id, size);
    return true;
  }
  private async evict(id: string) {
    const r = await this.row(id);
    if (!r || r.location !== "vps" || r.pinned) return;
    await this.db.query("update file_objects set cached = false where owner_id = $1 and file_id = $2", [this.owner, "ws:" + id]);
    await this.local.remove(id).catch((e) => this.log("[vps] evict: " + (e as Error).message));
  }

  async readFile(id: string): Promise<Uint8Array | null> {
    const here = await this.local.read(id);
    if (here) { if (this.lru.has(id)) { this.lru.get(id); void this.touch(id); } return here; }
    let job = this.fetching.get(id);
    if (!job) {
      job = (async () => {
        const r = await this.row(id), store = this.remote();
        if (!r || r.location !== "vps") return null;
        if (!store) throw Error("Your VPS isn't reachable right now, and this file isn't on this device.");
        const bytes = await store.read(r.path);
        await this.local.write(id, bytes);
        await this.db.query("update file_objects set cached = true, last_access = now() where owner_id = $1 and file_id = $2", [this.owner, "ws:" + id]);
        if (!r.pinned && !this.keep(id, bytes.length)) await this.evict(id);
        return bytes;
      })().finally(() => this.fetching.delete(id));
      this.fetching.set(id, job);
    }
    return job;
  }
  private async touch(id: string) { await this.db.query("update file_objects set last_access = now() where owner_id = $1 and file_id = $2", [this.owner, "ws:" + id]).catch(() => {}); }

  /** Writes always land here first (the cache); in VPS mode they go to the VPS too, checked, before the row says so. */
  async writeFile(id: string, bytes: Uint8Array) {
    const before = await this.row(id);
    await this.local.write(id, bytes);
    const store = this.mode() === "vps" ? this.remote() : undefined;
    if (store) {
      try {
        const hash = sha256(bytes), path = await store.put(hash, "blob", bytes);
        await this.markVps(id, path, hash, bytes.length, true);
      } catch (e) {
        // Kept on this device: the next "Move everything" (or the background mover) takes it.
        this.log("[vps] write kept on device: " + (e as Error).message);
        await this.markDevice(id);
      }
    } else if (before) await this.markDevice(id);
    if (before?.location === "vps" && before.path !== (await this.row(id))?.path && !(await this.used(before.path))) await this.remote()?.remove(before.path).catch(() => {});
  }
  async deleteFile(id: string) {
    const r = await this.row(id);
    await this.local.remove(id);
    if (r) { await this.markDevice(id); if (r.location === "vps" && !(await this.used(r.path))) await this.remote()?.remove(r.path).catch(() => {}); }
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
  /** Pinned files stay on this device whatever the cap. */
  async pin(id: string, on: boolean) {
    const r = await this.row(id);
    if (!r) return false;
    await this.db.query("update file_objects set pinned = $3 where owner_id = $1 and file_id = $2", [this.owner, "ws:" + id, on]);
    if (on) { this.lru.delete(id); if (!(await this.local.has(id))) await this.readFile(id); }
    else if (await this.local.has(id)) { if (!this.keep(id, r.size)) await this.evict(id); }
    return true;
  }
  async pinned() { return (await this.db.query<{ file_id: string }>("select file_id from file_objects where owner_id = $1 and file_id like 'ws:%' and pinned", [this.owner])).map((r) => r.file_id.slice(3)); }

  async usage(): Promise<StorageUsage> {
    const [local, rows] = await Promise.all([this.local.list(), this.db.query<{ file_id: string; size: string; pinned: boolean; location: string }>("select file_id, size, pinned, location from file_objects where owner_id = $1 and location = 'vps'", [this.owner])]);
    const onVps = new Map(rows.filter((r) => r.file_id.startsWith("ws:")).map((r) => [r.file_id.slice(3), r]));
    let device = 0, cache = 0, pinned = 0, deviceFiles = 0;
    for (const f of local) { if (onVps.has(f.id)) { cache += f.size; if (onVps.get(f.id)!.pinned) pinned += f.size; } else { device += f.size; deviceFiles++; } }
    const vps = rows.reduce((n, r) => n + Number(r.size), 0);
    return { mode: this.mode(), device: device + cache, vps, cache, cap: this.cap, pinned, files: { device: deviceFiles, vps: rows.length } };
  }
}
