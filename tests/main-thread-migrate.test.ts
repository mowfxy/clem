import test from "node:test";
import assert from "node:assert/strict";
import { withMainThread, moveEarlier, mainThreadOf, isSpaceChat, earlierChats, EARLIER_MIGRATION } from "../core/main-thread/migrate.ts";
import type { Chat } from "../core/types.ts";

const chat = (id: string, spaceId: string | null, extra: Partial<Chat> = {}): Chat => ({ id, title: id, spaceId, messages: [{ id: id + "-m", role: "user", content: "hi" }], updated: 1, ...extra });
let n = 0;
const ids = () => "main-" + ++n;

test("a workspace gets one pinned main thread and its standalone chats move to Earlier chats", () => {
  const state = { chats: [chat("a", null), chat("b", "s1"), chat("t", null, { temporary: true }), chat("p", null, { pinned: true })] };
  const next = withMainThread(state, 100, ids);
  const main = mainThreadOf(next.chats)!;
  assert.equal(main.kind, "main");
  assert.equal(main.pinned, true);
  assert.equal(main.spaceId, null);
  assert.equal(next.chats.filter((c) => c.kind === "main").length, 1);
  assert.equal(next.chats.find((c) => c.id === "a")!.archived, "earlier");
  assert.equal(next.chats.find((c) => c.id === "p")!.archived, "earlier");
  assert.equal(next.chats.find((c) => c.id === "p")!.pinned, false);
  assert.equal(next.chats.find((c) => c.id === "b")!.archived, undefined);
  assert.equal(next.chats.find((c) => c.id === "t")!.archived, undefined, "temporary chats are never saved, so never archived");
  assert.equal(next.chats.length, state.chats.length + 1, "nothing is deleted");
  assert.deepEqual(next.migrations, [EARLIER_MIGRATION]);
});

test("the migration is idempotent", () => {
  const once = withMainThread({ chats: [chat("a", null), chat("b", "s1")] }, 100, ids);
  const twice = withMainThread(once, 200, ids);
  assert.equal(twice, once, "an already migrated workspace comes back unchanged");
  assert.deepEqual(withMainThread(structuredClone(once), 300, ids), once);
});

test("after the move runs once, later chats outside a space are left alone", () => {
  const once = withMainThread({ chats: [chat("a", null)] }, 100, ids);
  const later = { ...once, chats: [...once.chats, chat("late", null)] };
  assert.equal(withMainThread(later, 200, ids).chats.find((c) => c.id === "late")!.archived, undefined);
});

test("two main threads (after a merge) become one, keeping every message once", () => {
  const m = (id: string, at: number) => ({ id, role: "user" as const, content: id, at });
  const state = { migrations: [EARLIER_MIGRATION], chats: [chat("m1", null, { kind: "main", messages: [m("x", 1), m("z", 3)] }), chat("m2", null, { kind: "main", messages: [m("y", 2), m("x", 1)] })] };
  const next = withMainThread(state, 10, ids);
  assert.equal(next.chats.length, 1);
  assert.deepEqual(next.chats[0].messages.map((x) => x.id), ["x", "y", "z"]);
});

test("moving an earlier chat files it in a subject; the main thread never moves", () => {
  const once = withMainThread({ chats: [chat("a", null), chat("b", "s1")] }, 100, ids);
  assert.deepEqual(earlierChats(once.chats).map((c) => c.id), ["a"]);
  const moved = moveEarlier(once.chats, "a", "s2");
  const a = moved.find((c) => c.id === "a")!;
  assert.equal(a.spaceId, "s2");
  assert.equal(a.archived, undefined);
  assert.equal(isSpaceChat(a), true);
  assert.equal(isSpaceChat(mainThreadOf(moved)!), false);
  assert.equal(mainThreadOf(moveEarlier(moved, mainThreadOf(moved)!.id, "s2"))!.spaceId, null);
});
