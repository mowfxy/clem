// The worker's standing state (migration 032): small values by key, kept in its database so they survive a restart.
import type { Db } from "../db.ts";

export class WorkerState {
  private db: Db; private owner: string;
  constructor(db: Db, owner: string) { this.db = db; this.owner = owner; }
  async get<T>(key: string): Promise<T | undefined> {
    const [row] = await this.db.query<{ value: T }>("select value from worker_state where owner_id = $1 and key = $2", [this.owner, key]);
    return row?.value;
  }
  async set(key: string, value: unknown) {
    await this.db.query("insert into worker_state (owner_id, key, value, at) values ($1, $2, $3, now()) on conflict (owner_id, key) do update set value = excluded.value, at = now()", [this.owner, key, JSON.stringify(value)]);
  }
  /** Removes the key and returns what it held (so a pending question is taken exactly once). */
  async take<T>(key: string): Promise<T | undefined> {
    const rows = await this.db.query<{ value: T }>("delete from worker_state where owner_id = $1 and key = $2 returning value", [this.owner, key]);
    return rows[0]?.value;
  }
  async delete(key: string) { await this.db.query("delete from worker_state where owner_id = $1 and key = $2", [this.owner, key]); }
}
