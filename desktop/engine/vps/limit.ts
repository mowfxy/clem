// Clem's storage limit on the VPS (core/vps/limit.ts): the disk is measured with `df` on the store's filesystem (over
// SSH from the desktop, or statfs on the worker itself), again every few minutes, and every write reserves its bytes
// first, so the disk never passes 82% full because of Clem. A write that doesn't fit is told so and goes elsewhere
// (the PC); nothing raises an error or asks.
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../db.ts";
import type { FileStore } from "../storage.ts";
import { MEASURE_MS, roomOn, parseDf, type DiskSize } from "../../../core/vps/limit.ts";
import { q, type VpsLink } from "./link.ts";

export class DiskLimit {
  private measure: () => Promise<DiskSize>;
  private clock: () => number; private ttl: number;
  private disk?: DiskSize; private at = 0; private reserved = 0;
  private job?: Promise<DiskSize | undefined>;
  constructor(o: { measure: () => Promise<DiskSize>; clock?: () => number; ttl?: number }) { this.measure = o.measure; this.clock = o.clock || Date.now; this.ttl = o.ttl ?? MEASURE_MS; }

  /** The disk as last measured (again when older than the TTL). Undefined when it can't be measured. */
  async size(fresh = false): Promise<DiskSize | undefined> {
    if (!fresh && this.disk && this.clock() - this.at < this.ttl) return this.disk;
    this.job ||= this.measure().then((d) => { this.disk = d; this.at = this.clock(); this.reserved = 0; return d; }, () => this.disk).finally(() => { this.job = undefined; });
    return this.job;
  }
  /** Room left for Clem now (counting what was written since the last measurement). */
  async room() { const d = await this.size(); return d ? Math.max(0, roomOn(d) - this.reserved) : 0; }
  /** Takes `bytes` of the room if they fit, else false (and nothing is taken). Unmeasurable counts as full. */
  async reserve(bytes: number) {
    if (bytes <= 0) return true;
    if (bytes > await this.room()) return false;
    this.reserved += bytes;
    return true;
  }
  /** A reserved write that didn't happen (an upload that failed) gives its room back. */
  release(bytes: number) { this.reserved = Math.max(0, this.reserved - bytes); }
  /** Bytes deleted from the store: room again at once, before the next measurement sees it. */
  freed(bytes: number) { if (bytes > 0) this.reserved -= bytes; }
  /** The disk as last measured, as Settings shows it. */
  get last() { return this.disk ? { ...this.disk, free: Math.max(0, this.disk.free - this.reserved), measuredAt: this.at } : undefined; }
}

/** Measuring over SSH: `df` on Clem's files folder there (made first, so df sees the right filesystem). */
export const sshDisk = (link: () => Promise<VpsLink>, root: string) => async (): Promise<DiskSize> => {
  const l = await link();
  const r = await l.exec(`mkdir -p ${q(root)} 2>/dev/null; df -Pk ${q(root)} 2>/dev/null || df -Pk ~`, { timeout: 20_000 });
  const d = parseDf(r.stdout);
  if (!d) throw Error("Couldn't read the VPS disk's size.");
  return d;
};
/** Measuring on the worker itself: statfs on its files folder. */
export const localDisk = (path: string) => async (): Promise<DiskSize> => {
  const s = await statfs(path);
  return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
};

/** What the worker couldn't keep on the VPS past the limit with the laptop off, waiting for the PC (vps_waiting). */
export class Waiting {
  private db: Db; private owner: string;
  constructor(db: Db, owner: string) { this.db = db; this.owner = owner; }
  async add(item: string, name: string, bytes: number, said: string) {
    await this.db.query("insert into vps_waiting (owner_id, item, name, bytes, said) values ($1, $2, $3, $4, $5) on conflict (owner_id, item) do update set bytes = excluded.bytes, said = excluded.said", [this.owner, item, name.slice(0, 200), bytes, said.slice(0, 400)]);
    this.onAdd?.();
  }
  async clear(items: string[]) { if (items.length) await this.db.query("delete from vps_waiting where owner_id = $1 and item = any($2::text[])", [this.owner, items]); }
  /** Everything waiting, oldest first: a note or file the worker made ("ws:<id>"), a CMS file it couldn't keep ("cms:<material id>"). */
  async items() { return (await this.db.query<{ item: string; name: string; bytes: string }>("select item, name, bytes from vps_waiting where owner_id = $1 order by created_at limit 500", [this.owner])).map((r) => ({ item: r.item, name: r.name, bytes: Number(r.bytes) })); }
  /** Called when something new waits (the worker tells the person once: desktop/engine/vps/full.ts). */
  onAdd?: () => void;
  /** Plain sentences for Settings: each note waiting, and the CMS files not kept, counted as one sentence. */
  async sentences(): Promise<string[]> {
    const rows = await this.db.query<{ item: string; said: string; bytes: string }>("select item, said, bytes from vps_waiting where owner_id = $1 order by created_at desc limit 50", [this.owner]);
    const cms = rows.filter((r) => r.item.startsWith("blob:") || r.item.startsWith("cms:")), mb = Math.max(1, Math.round(cms.reduce((n, r) => n + Number(r.bytes), 0) / 1048576));
    return [...rows.filter((r) => !r.item.startsWith("blob:") && !r.item.startsWith("cms:")).slice(0, 4).map((r) => r.said),
      ...(cms.length ? [`${cms.length === 1 ? "A CMS file" : cms.length + " CMS files"} (${mb} MB) ${cms.length === 1 ? "wasn't" : "weren't"} kept on your VPS because it's at Clem's storage limit; ${cms.length === 1 ? "it stays" : "they stay"} on the CMS and Clem reads ${cms.length === 1 ? "it" : "them"} from there.`] : [])];
  }
}
/** The worker's store with the limit: a file that would pass it isn't written; the CMS keeps it, and that is noted. */
export class LimitedStore implements FileStore {
  readonly location: "device" | "vps";
  private inner: FileStore; private limit: DiskLimit; private root: string;
  /** Set once the engine's database is open. */
  waiting?: Waiting;
  constructor(o: { inner: FileStore; limit: DiskLimit; root: string; waiting?: Waiting }) { this.inner = o.inner; this.limit = o.limit; this.root = o.root; this.waiting = o.waiting; this.location = o.inner.location; }
  async put(hash: string, ext: string, bytes: Uint8Array, about?: { item: string; name: string }) {
    const path = join(this.root, hash + (/^[a-z0-9]{1,5}$/.test(ext) ? "." + ext : ""));
    if (await this.inner.has(path)) return path;
    if (!(await this.limit.reserve(bytes.length))) {
      await this.waiting?.add(about?.item || "blob:" + hash, about?.name || (ext ? ext.toUpperCase() + " file" : "file"), bytes.length, "A CMS file wasn't kept on your VPS because it's at Clem's storage limit.").catch(() => {});
      throw Error("Your VPS is at Clem's storage limit, so this file stays on the CMS.");
    }
    return this.inner.put(hash, ext, bytes).catch((e) => { this.limit.release(bytes.length); throw e; });
  }
  has(path: string) { return this.inner.has(path); }
  read(path: string) { return this.inner.read(path); }
  expose(fileId: string, path: string) { return this.inner.expose(fileId, path); }
  remove(path: string) { return this.inner.remove(path); }
}
