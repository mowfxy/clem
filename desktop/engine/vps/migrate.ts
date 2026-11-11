// "Move everything to my VPS" and "Move back to device" (docs/GUC-VPS-ENGINE.md "Moving files"). One file at a time,
// each in migration_state, so it resumes after an interruption or a restart. A file's row points at its new place only
// after the copy there is checked (sha256), and the source is freed only after that: on a failed check or an abort,
// every file is still readable where its row points. Workspace files ('ws:<id>') and saved CMS files ('guc:<id>').
import type { Db } from "../db.ts";
import { sha256, type FileStore } from "../storage.ts";
import type { MigrationDirection, MigrationView } from "../../../core/vps/types.ts";
import type { StorageRouter, LocalBlobs } from "./router.ts";
import { ChecksumError, VpsStore } from "./store.ts";

const ATTEMPTS = 3;
type Item = { item: string; size: number; sha256?: string };

export class Migrator {
  private db: Db; private owner: string; private router: StorageRouter; private local: LocalBlobs; private remote: () => VpsStore | undefined; private device: FileStore;
  private onProgress: (v: MigrationView | undefined) => void; private log: (m: string) => void;
  private running?: Promise<void>; private stopping = false;
  constructor(o: { db: Db; owner: string; router: StorageRouter; local: LocalBlobs; remote: () => VpsStore | undefined; device: FileStore; onProgress?: (v: MigrationView | undefined) => void; log?: (m: string) => void }) {
    this.db = o.db; this.owner = o.owner; this.router = o.router; this.local = o.local; this.remote = o.remote; this.device = o.device; this.onProgress = o.onProgress || (() => {}); this.log = o.log || (() => {});
  }

  async view(): Promise<MigrationView | undefined> {
    const [run] = await this.db.query<{ direction: MigrationDirection; status: MigrationView["status"]; error: string | null; started_at: Date; finished_at: Date | null }>("select direction, status, error, started_at, finished_at from migration_runs where owner_id = $1", [this.owner]);
    if (!run) return undefined;
    const [c] = await this.db.query<{ total: number; done: number; failed: number; bt: string; bd: string }>(
      "select count(*)::int as total, count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'failed')::int as failed, coalesce(sum(size), 0) as bt, coalesce(sum(size) filter (where status = 'done'), 0) as bd from migration_state where owner_id = $1", [this.owner]);
    return { direction: run.direction, status: run.status, total: c.total, done: c.done, failed: c.failed, bytesTotal: Number(c.bt), bytesDone: Number(c.bd), ...(run.error ? { error: run.error } : {}), startedAt: new Date(run.started_at).getTime(), ...(run.finished_at ? { finishedAt: new Date(run.finished_at).getTime() } : {}) };
  }
  get busy() { return !!this.running; }

  /** What is still in its old place. */
  private async items(direction: MigrationDirection): Promise<Item[]> {
    const rows = await this.db.query<{ file_id: string; location: string; size: string; sha256: string }>("select file_id, location, size, sha256 from file_objects where owner_id = $1 and (file_id like 'ws:%' or file_id like 'guc:%')", [this.owner]);
    if (direction === "down") return rows.filter((r) => r.location === "vps").map((r) => ({ item: r.file_id, size: Number(r.size), sha256: r.sha256 }));
    const onVps = new Set(rows.filter((r) => r.location === "vps").map((r) => r.file_id));
    const ws = (await this.local.list()).filter((f) => !onVps.has("ws:" + f.id)).map((f) => ({ item: "ws:" + f.id, size: f.size }));
    return [...ws, ...rows.filter((r) => r.file_id.startsWith("guc:") && r.location === "device").map((r) => ({ item: r.file_id, size: Number(r.size), sha256: r.sha256 }))];
  }

  /** Starts moving (a run already going in the same direction just carries on). */
  async start(direction: MigrationDirection) {
    if (this.running) { const v = await this.view(); if (v?.direction === direction) return v; await this.abort(); }
    // Listed first: PGlite runs one thing at a time, so nothing outside the transaction may query inside it.
    const items = await this.items(direction);
    await this.db.tx(async (t) => {
      await t.query("delete from migration_state where owner_id = $1", [this.owner]);
      await t.query("insert into migration_runs (owner_id, direction, status) values ($1, $2, 'running') on conflict (owner_id) do update set direction = excluded.direction, status = 'running', error = null, started_at = now(), finished_at = null", [this.owner, direction]);
      for (const it of items) await t.query("insert into migration_state (owner_id, item, direction, status, size, sha256) values ($1, $2, $3, 'pending', $4, $5) on conflict do nothing", [this.owner, it.item, direction, it.size, it.sha256 || null]);
    });
    this.loop();
    return this.view();
  }
  /** After a restart or a lost connection: carries on from the first file not done. */
  async resume() {
    const v = await this.view();
    if (!v || !["running", "paused"].includes(v.status) || this.running) return v;
    await this.db.query("update migration_state set status = 'pending' where owner_id = $1 and status = 'copying'", [this.owner]);
    await this.db.query("update migration_runs set status = 'running', error = null where owner_id = $1", [this.owner]);
    this.loop();
    return this.view();
  }
  /** Stops after the file in hand. Files already moved stay moved (checked); the rest stay where they were. */
  async abort() {
    this.stopping = true;
    await this.running;
    this.stopping = false;
    await this.db.query("update migration_state set status = 'pending' where owner_id = $1 and status = 'copying'", [this.owner]);
    await this.db.query("update migration_runs set status = 'aborted', finished_at = now() where owner_id = $1 and status in ('running', 'paused')", [this.owner]);
    const v = await this.view(); this.onProgress(v); return v;
  }
  wait() { return this.running || Promise.resolve(); }

  private loop() {
    this.running = (async () => {
      let lastTick = 0;
      for (;;) {
        if (this.stopping) return;
        const [next] = await this.db.query<{ item: string; direction: MigrationDirection; sha256: string | null; attempts: number }>("select item, direction, sha256, attempts from migration_state where owner_id = $1 and status = 'pending' order by item limit 1", [this.owner]);
        if (!next) break;
        await this.db.query("update migration_state set status = 'copying', attempts = attempts + 1, updated_at = now() where owner_id = $1 and item = $2", [this.owner, next.item]);
        try {
          await (next.direction === "up" ? this.up(next.item) : this.down(next.item));
          await this.db.query("update migration_state set status = 'done', error = null, updated_at = now() where owner_id = $1 and item = $2", [this.owner, next.item]);
        } catch (e) {
          const msg = (e as Error).message;
          if (!(e instanceof ChecksumError) && !(e as { item?: boolean }).item) {
            // Lost the server (or this device stopped): pause; resume() carries on from this file.
            await this.db.query("update migration_state set status = 'pending', error = $3 where owner_id = $1 and item = $2", [this.owner, next.item, msg]);
            await this.db.query("update migration_runs set status = 'paused', error = $2 where owner_id = $1", [this.owner, "Paused: " + msg]);
            this.log("[vps] migration paused: " + msg);
            this.onProgress(await this.view());
            return;
          }
          await this.db.query("update migration_state set status = $3, error = $4, updated_at = now() where owner_id = $1 and item = $2", [this.owner, next.item, next.attempts + 1 >= ATTEMPTS ? "failed" : "pending", msg]);
        }
        if (Date.now() - lastTick > 250) { lastTick = Date.now(); this.onProgress(await this.view()); }
      }
      const v = await this.view();
      const where = v?.direction === "up" ? "this device" : "your VPS";
      await this.db.query("update migration_runs set status = $2, error = $3, finished_at = now() where owner_id = $1", [this.owner, v?.failed ? "failed" : "done", v?.failed ? `${v.failed} file${v.failed === 1 ? "" : "s"} couldn't be moved. They are safe on ${where}.` : null]);
      this.onProgress(await this.view());
    })().catch(async (e) => {
      this.log("[vps] migration stopped: " + (e as Error).message);
      await this.db.query("update migration_runs set status = 'paused', error = $2 where owner_id = $1", [this.owner, "Paused: " + (e as Error).message]).catch(() => {});
    }).finally(() => { this.running = undefined; });
  }

  private store() { const s = this.remote(); if (!s) throw Error("Your VPS isn't reachable right now."); return s; }
  private async gucRow(item: string) {
    const [r] = await this.db.query<{ location: string; path: string; sha256: string; size: string }>("select location, path, sha256, size from file_objects where owner_id = $1 and file_id = $2", [this.owner, item]);
    return r;
  }
  private itemError(m: string) { return Object.assign(Error(m), { item: true }); }

  private async up(item: string) {
    const store = this.store();
    if (item.startsWith("ws:")) {
      const id = item.slice(3), bytes = await this.local.read(id);
      if (!bytes) return;
      const hash = sha256(bytes);
      const path = await store.put(hash, "blob", bytes);
      // Checked on the VPS: the row moves; this copy becomes cache (the LRU frees it under the cap).
      await this.router.markVps(id, path, hash, bytes.length, true);
      return;
    }
    const r = await this.gucRow(item);
    if (!r || r.location !== "device") return;
    const bytes = await this.device.read(r.path);
    if (sha256(bytes) !== r.sha256) throw this.itemError("This file changed on this device; it was left there.");
    const ext = r.path.match(/\.([a-z0-9]{1,5})$/)?.[1] || "";
    const path = await store.put(r.sha256, ext, bytes);
    await this.db.query("update file_objects set location = 'vps', path = $3 where owner_id = $1 and file_id = $2", [this.owner, item, path]);
    const still = await this.db.query("select 1 from file_objects where owner_id = $1 and location = 'device' and path = $2 limit 1", [this.owner, r.path]);
    if (!still.length) await this.device.remove(r.path);
  }

  private async down(item: string) {
    const store = this.store();
    if (item.startsWith("ws:")) {
      const id = item.slice(3), r = await this.router.row(id);
      if (!r || r.location !== "vps") return;
      let here = await this.local.read(id);
      if (!here || sha256(here) !== r.sha256) { here = await store.read(r.path); await this.local.write(id, here); }
      const back = await this.local.read(id);
      if (!back || sha256(back) !== r.sha256) throw new ChecksumError("The copy on this device didn't match, so the VPS copy was kept.");
      await this.router.markDevice(id);
      if (!(await this.router.used(r.path))) await store.remove(r.path).catch(() => {});
      return;
    }
    const r = await this.gucRow(item);
    if (!r || r.location !== "vps") return;
    const bytes = await store.read(r.path);
    const ext = r.path.match(/\.([a-z0-9]{1,5})$/)?.[1] || "";
    const path = await this.device.put(r.sha256, ext, bytes);
    if (sha256(await this.device.read(path)) !== r.sha256) throw new ChecksumError("The copy on this device didn't match, so the VPS copy was kept.");
    await this.db.query("update file_objects set location = 'device', path = $3 where owner_id = $1 and file_id = $2", [this.owner, item, path]);
    if (!(await this.router.used(r.path))) await store.remove(r.path).catch(() => {});
  }
}
