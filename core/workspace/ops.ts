// The workspace in two places (docs/GUC-VPS-ENGINE.md "Workspace on the VPS"): the window's State on the PC, and the
// VPS worker's durable copy while the laptop is off. Every change either side makes is a list of per-item operations;
// both sides apply them with this one pure function, so they end up with the same workspace. Pure and tested
// (tests/vps-workspace.test.ts).
//
// Conflicts, per item: the newer write wins (an item's own time — a plan's or chat's `updated`, a file's `updated` or
// `created`, a study set's last attempt — against the operation's `at`). Chat messages are merged by id and never
// dropped: a message for a chat the other side deleted brings the chat back with it. Deletions are operations too
// (tombstones with a time), applied only when nothing changed the item after them.

export type WsKind = "space" | "file" | "plan" | "studySet" | "automation";
export type WsOp = { at: number; by: "worker" | "desktop" } & (
  | { t: "put"; kind: WsKind; item: Record<string, any> }
  | { t: "del"; kind: WsKind | "chat"; id: string }
  /** A chat's own fields (title, subject, kind…), never its messages. */
  | { t: "chat"; chat: Record<string, any> }
  /** One message, added or replaced by id; `chat` carries the chat's fields so a missing chat is made with it. */
  | { t: "msg"; chat: Record<string, any>; message: Record<string, any> }
  | { t: "memory"; value: string }
);
/** Operations as the worker keeps them: numbered in order, under the id of its copy (a reinstalled worker starts a new one). */
export type WsBatch = { id: string; ops: (WsOp & { seq: number })[]; last: number };
/** Where a desktop's saved workspace is in the worker's operations (`State.vpsSync`). */
export type WsCursor = { id: string; seq: number };

type Any = Record<string, any>;
const LISTS: Record<WsKind, string> = { space: "spaces", file: "files", plan: "plans", studySet: "studySets", automation: "automations" };
/** The key an item is found by: a plan by its subject or project (one plan each), everything else by id. */
const keyOf = (kind: WsKind, item: Any) => String(kind === "plan" ? item.spaceId : item.id);
/** When an item last changed, as far as it says. Subjects and projects carry no time, so a later operation wins. */
export function itemTime(kind: WsKind | "chat", item: Any): number {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (kind === "plan" || kind === "chat") return n(item.updated);
  if (kind === "file") return Math.max(n(item.updated), n(item.created));
  if (kind === "studySet") return Math.max(n(item.created), n(item.updated), ...((Array.isArray(item.attempts) ? item.attempts : []) as Any[]).map((a) => n(a?.at)), ...((Array.isArray(item.cards) ? item.cards : []) as Any[]).map((c) => n(c?.last)));
  if (kind === "automation") return Math.max(n(item.updated), n(item.lastRun));
  return n(item.updated);
}
const chatFields = (c: Any) => { const { messages: _m, ...rest } = c; return rest; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Applies operations in order. Operations a side already has change nothing, so pulling the same ones twice is safe. */
export function applyOps<S extends Any>(state: S, ops: WsOp[]): S {
  const s: Any = { ...state };
  for (const op of ops) {
    if (op.t === "memory") { s.memory = op.value; continue; }
    if (op.t === "put" || (op.t === "del" && op.kind !== "chat")) {
      const kind = op.kind as WsKind, list: Any[] = Array.isArray(s[LISTS[kind]]) ? s[LISTS[kind]] : [];
      const id = op.t === "put" ? keyOf(kind, op.item) : op.id, i = list.findIndex((x) => keyOf(kind, x) === id);
      if (op.t === "put") {
        if (i < 0) s[LISTS[kind]] = kind === "space" ? [op.item, ...list] : [...list, op.item];
        else if (itemTime(kind, list[i]) <= op.at || itemTime(kind, list[i]) <= itemTime(kind, op.item)) s[LISTS[kind]] = list.map((x, j) => (j === i ? op.item : x));
      } else if (i >= 0 && itemTime(kind, list[i]) <= op.at) s[LISTS[kind]] = list.filter((_, j) => j !== i);
      continue;
    }
    const chats: Any[] = Array.isArray(s.chats) ? s.chats : [];
    if (op.t === "del") {
      // A chat with a message newer than its deletion stays: messages are never dropped.
      const c = chats.find((x) => x.id === op.id);
      if (c && itemTime("chat", c) <= op.at && !(c.messages || []).some((m: Any) => (m.at || 0) > op.at)) s.chats = chats.filter((x) => x !== c);
      continue;
    }
    const id = String(op.chat.id), i = chats.findIndex((x) => x.id === id);
    if (op.t === "chat") {
      if (i < 0) s.chats = [{ ...op.chat, messages: [] }, ...chats];
      else if (itemTime("chat", chats[i]) <= op.at) s.chats = chats.map((c, j) => (j === i ? { ...c, ...chatFields(op.chat), messages: c.messages || [] } : c));
      continue;
    }
    const m = op.message;
    if (i < 0) { s.chats = [{ ...chatFields(op.chat), messages: [m], updated: Math.max(Number(op.chat.updated) || 0, op.at) }, ...chats]; continue; }
    const c = chats[i], msgs: Any[] = c.messages || [], at = msgs.findIndex((x) => x.id === m.id);
    const next = at < 0 ? [...msgs, m] : msgs.map((x, j) => (j === at && ((x.at || 0) <= (m.at || op.at)) ? m : x));
    s.chats = chats.map((x, j) => (j === i ? { ...x, messages: next, updated: Math.max(Number(x.updated) || 0, op.at) } : x));
  }
  return s as S;
}

/** The operations that turn `before` into `after` (what one side changed), each stamped `at`. Messages that went
 *  missing are not deleted: only a whole chat can be. */
export function diffOps(before: Any, after: Any, at: number, by: WsOp["by"]): WsOp[] {
  const ops: WsOp[] = [];
  for (const kind of Object.keys(LISTS) as WsKind[]) {
    const was = new Map(((before[LISTS[kind]] || []) as Any[]).map((x) => [keyOf(kind, x), x]));
    const now = new Map(((after[LISTS[kind]] || []) as Any[]).map((x) => [keyOf(kind, x), x]));
    for (const [id, item] of now) if (!was.has(id) || !same(was.get(id), item)) ops.push({ at, by, t: "put", kind, item });
    for (const id of was.keys()) if (!now.has(id)) ops.push({ at, by, t: "del", kind, id });
  }
  const was = new Map(((before.chats || []) as Any[]).map((c) => [c.id, c]));
  for (const c of (after.chats || []) as Any[]) {
    const old = was.get(c.id);
    if (!old || !same(chatFields(old), chatFields(c))) ops.push({ at, by, t: "chat", chat: chatFields(c) });
    const seen = new Map(((old?.messages || []) as Any[]).map((m) => [m.id, m]));
    for (const m of (c.messages || []) as Any[]) if (!seen.has(m.id) || !same(seen.get(m.id), m)) ops.push({ at, by, t: "msg", chat: chatFields(c), message: m });
  }
  const kept = new Set(((after.chats || []) as Any[]).map((c) => c.id));
  for (const id of was.keys()) if (!kept.has(id)) ops.push({ at, by, t: "del", kind: "chat", id: String(id) });
  if ((before.memory ?? "") !== (after.memory ?? "")) ops.push({ at, by, t: "memory", value: String(after.memory ?? "") });
  return ops;
}

/** How many of a chat's latest messages the worker keeps (the main thread keeps more: it is the conversation). */
export const LEAN_MAIN = 60, LEAN_CHAT = 8;
/** What the desktop sends the worker: everything the agent and the organizer use, chats cut to their latest messages,
 *  temporary chats left out. Bytes stay where they are (files carry only their metadata). */
export function leanState(state: unknown) {
  const s: Any = state && typeof state === "object" ? state : {};
  const pick = (k: string) => (Array.isArray(s[k]) ? s[k] : []);
  return {
    name: s.name, memory: s.memory ?? "", organizer: s.organizer, spaces: pick("spaces"), files: pick("files"), plans: pick("plans"), studySets: pick("studySets"), automations: pick("automations"),
    chats: (pick("chats") as Any[]).filter((c) => !c.temporary).map((c) => ({ ...c, messages: (c.messages || []).slice(c.kind === "main" ? -LEAN_MAIN : -LEAN_CHAT) })),
    ...(s.vpsSync ? { vpsSync: s.vpsSync } : {}),
  };
}
/** Merges what the desktop just sent with the worker's operations it has not saved yet: the desktop's copy is the
 *  base (it holds every message), the worker's newer operations go on top, item by item. */
export function mergePushed<S extends Any>(pushed: S, batch: WsBatch): S {
  const cursor = pushed.vpsSync as WsCursor | undefined;
  const after = cursor && cursor.id === batch.id ? cursor.seq : 0;
  return applyOps(pushed, batch.ops.filter((o) => o.seq > after));
}
/** The desktop applying a pull: its workspace with the worker's operations and the new cursor (saved with it). */
export function applyPull<S extends Any>(state: S, batch: WsBatch): S {
  const cursor = state.vpsSync as WsCursor | undefined;
  const after = cursor && cursor.id === batch.id ? cursor.seq : 0;
  const fresh = batch.ops.filter((o) => o.seq > after);
  if (!fresh.length && cursor?.id === batch.id) return state;
  return { ...applyOps(state, fresh), vpsSync: { id: batch.id, seq: Math.max(after, batch.last) } };
}
