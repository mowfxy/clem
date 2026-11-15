// The workspace on the VPS worker (docs/GUC-VPS-ENGINE.md "Workspace on the VPS"). While the worker runs Clem, its
// copy in its own database is where the agent reads and writes: the desktop's last push (leanState) with the worker's
// own changes on top. Every change is turned into per-item operations (core/workspace/ops.ts) and kept, numbered,
// until a desktop has saved them; the desktop pulls them with proInbox and applies them with the same function.
import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { applyAction, proAction, undoAction, type Undo } from "../../../core/proactivity/actions.ts";
import { applyOps, diffOps, mergePushed, type WsBatch, type WsCursor, type WsOp } from "../../../core/workspace/ops.ts";
import { mainThreadOf, putMessage } from "../../../core/workspace/apply.ts";
import type { SpacePlan } from "../../../core/plans.ts";
import type { Automation, Chat, Space, StoredFile, StudySet } from "../../../core/types.ts";

/** The worker's copy: the saved workspace's shape (src/store.ts State), with chats cut to their latest messages. */
export type WsState = { spaces: Space[]; files: StoredFile[]; plans?: SpacePlan[]; studySets: StudySet[]; chats: Chat[]; automations: Automation[]; memory: string; name?: string; vpsSync?: WsCursor } & Record<string, any>;
type OrganizerLike = {
  inbox(): Promise<{ posts: { id: string; content: string; at: number }[]; apply: { key: string; action: unknown }[]; revert?: { key: string; undo: Undo }[] }>;
  ack(o: { posts?: string[]; results?: { key: string; ok: boolean; undo?: Undo | null; error?: string }[]; reverted?: string[] }): Promise<unknown>;
};
/** Operations kept after the desktop saved them, in case another copy of the desktop (a second PC) is behind. */
const KEEP_DAYS = 14;

export class WorkerWorkspace {
  private db: Db; private owner: string; private clock: () => number; private log: (m: string) => void;
  private chain: Promise<unknown> = Promise.resolve();
  private cached?: { id: string; state: WsState } | null;
  /** Told after every change (the worker pokes the organizer, the desktop's next beat pulls). */
  onChange?: (ops: WsOp[]) => void;
  constructor(o: { db: Db; owner: string; clock?: () => number; log?: (m: string) => void }) { this.db = o.db; this.owner = o.owner; this.clock = o.clock || Date.now; this.log = o.log || (() => {}); }

  /** One change at a time, in order. */
  private serial<T>(fn: () => Promise<T>): Promise<T> { const next = this.chain.then(fn, fn); this.chain = next.catch(() => {}); return next; }
  private async load() {
    if (this.cached !== undefined) return this.cached;
    const [row] = await this.db.query<{ copy_id: string; state: WsState | string }>("select copy_id, state from workspace_copy where owner_id = $1", [this.owner]);
    this.cached = row ? { id: row.copy_id, state: typeof row.state === "string" ? JSON.parse(row.state) : row.state } : null;
    return this.cached;
  }
  private async save(id: string, state: WsState, db: Db = this.db) {
    await db.query("insert into workspace_copy (owner_id, copy_id, state, updated_at) values ($1, $2, $3, now()) on conflict (owner_id) do update set copy_id = excluded.copy_id, state = excluded.state, updated_at = now()", [this.owner, id, JSON.stringify(state)]);
    this.cached = { id, state };
  }
  /** The copy, or null before any desktop sent one. */
  async state(): Promise<WsState | null> { return (await this.load())?.state ?? null; }
  async ready() { return !!(await this.load()); }
  async copyId() { return (await this.load())?.id; }

  /** What a desktop just sent: its workspace becomes the base, the operations it hasn't saved yet go on top. */
  receive(pushed: WsState) {
    return this.serial(async () => {
      const had = await this.load(), id = had?.id || randomUUID();
      const batch = await this.batch(id, 0);
      await this.save(id, mergePushed(pushed, batch));
      const cursor = pushed.vpsSync as WsCursor | undefined;
      // Operations every desktop has saved are pruned after a while (a second PC may still be behind).
      if (cursor?.id === id) await this.db.query("delete from workspace_ops where owner_id = $1 and seq <= $2 and created_at < now() - ($3 || ' days')::interval", [this.owner, cursor.seq, String(KEEP_DAYS)]);
    });
  }

  /** A change made here: `fn` gets the copy and returns the next one; the difference is kept as operations. */
  change<T = void>(fn: (s: WsState) => WsState | { state: WsState; value: T } | Promise<WsState | { state: WsState; value: T }>): Promise<{ state: WsState; ops: WsOp[]; value?: T }> {
    return this.serial(async () => {
      const had = await this.load();
      if (!had) throw Error("Your workspace hasn't reached your VPS yet. Open Clem on your PC once and it will.");
      const out = await fn(had.state);
      const next = (out && "state" in out && "value" in out ? out.state : out) as WsState, value = out && "value" in out ? (out as { value: T }).value : undefined;
      const ops = diffOps(had.state, next, this.clock(), "worker");
      if (!ops.length) return { state: had.state, ops, value };
      await this.db.tx(async (t) => {
        for (const op of ops) await t.query("insert into workspace_ops (owner_id, op) values ($1, $2)", [this.owner, JSON.stringify(op)]);
        await this.save(had.id, next, t);
      });
      this.onChange?.(ops);
      return { state: next, ops, value };
    });
  }
  /** Applies operations to the copy without keeping them (used by tests and by a fresh desktop push). */
  async applyLocal(ops: WsOp[]) { return this.serial(async () => { const had = await this.load(); if (had) await this.save(had.id, applyOps(had.state, ops)); }); }

  private async batch(id: string, after: number): Promise<WsBatch> {
    const rows = await this.db.query<{ seq: string | number; op: WsOp | string }>("select seq, op from workspace_ops where owner_id = $1 and seq > $2 order by seq limit 2000", [this.owner, after]);
    const ops = rows.map((r) => ({ ...(typeof r.op === "string" ? JSON.parse(r.op) : r.op), seq: Number(r.seq) }));
    const [last] = await this.db.query<{ seq: string | number | null }>("select max(seq) as seq from workspace_ops where owner_id = $1", [this.owner]);
    return { id, ops, last: ops.length ? ops[ops.length - 1].seq : Number(last?.seq || 0) };
  }
  /** The worker's operations a desktop at `cursor` hasn't saved yet. */
  async opsAfter(cursor?: WsCursor | null): Promise<WsBatch | null> {
    const had = await this.load();
    if (!had) return null;
    return this.batch(had.id, cursor && cursor.id === had.id ? cursor.seq : 0);
  }
  /** The newest operation's number, for the desktop's beat (it pulls when it is behind). */
  async head() { const had = await this.load(); if (!had) return null; const [r] = await this.db.query<{ seq: string | number | null }>("select max(seq) as seq from workspace_ops where owner_id = $1", [this.owner]); return { id: had.id, seq: Number(r?.seq || 0) }; }

  /** The organizer's decisions applied here, as the window does when it pulls (src/proactivity/pro.ts): its actions
   *  with the same appliers, what the person undid in words put back, its messages posted in the main thread. */
  async drain(o: OrganizerLike) {
    if (!(await this.ready())) return 0;
    const inbox = await o.inbox();
    const revert = inbox.revert || [];
    if (!inbox.apply.length && !inbox.posts.length && !revert.length) return 0;
    const results: { key: string; ok: boolean; undo?: Undo | null; error?: string }[] = [];
    let posted: string[] = [];
    await this.change((s) => {
      let w = s;
      for (const a of inbox.apply) {
        const parsed = proAction.safeParse(a.action);
        if (!parsed.success) { results.push({ key: a.key, ok: false, error: "Unreadable" }); continue; }
        const r = applyAction(w, parsed.data, { now: this.clock() });
        if ("error" in r) { results.push({ key: a.key, ok: false, error: r.error }); continue; }
        w = r.state; results.push({ key: a.key, ok: true, undo: r.undo });
      }
      for (const r of revert) w = undoAction(w, r.undo, this.clock());
      const main = mainThreadOf(w);
      if (main) { for (const p of inbox.posts) w = putMessage(w, main.id, { id: p.id, role: "assistant", content: p.content, at: p.at }); posted = inbox.posts.map((p) => p.id); }
      return w;
    });
    await o.ack({ posts: posted, results, reverted: revert.map((r) => r.key) });
    if (results.some((r) => !r.ok)) this.log("[worker] organizer: " + results.filter((r) => !r.ok).length + " action(s) couldn't apply");
    return results.length + posted.length + revert.length;
  }
}
