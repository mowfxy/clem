import test from "node:test";
import assert from "node:assert/strict";
import { withoutTemporary } from "../core/temporary-chat.ts";

const emptyState = { chats: [] as ReturnType<typeof chat>[], visuals: [] as { id: string; chatId: string; title: string; created: number }[] };

const chat = (id: string, temporary?: boolean) => ({ id, title: id, spaceId: null, messages: [], updated: 1, ...(temporary ? { temporary } : {}) });

test("temporary chats and their visuals are never persisted", () => {
  const state = { ...emptyState, chats: [chat("a"), chat("b", true)], visuals: [{ id: "v1", chatId: "a", title: "x", created: 1 }, { id: "v2", chatId: "b", title: "y", created: 1 }] };
  const saved = withoutTemporary(state);
  assert.deepEqual(saved.chats.map((c) => c.id), ["a"]);
  assert.deepEqual(saved.visuals.map((v) => v.id), ["v1"]);
});
test("a state without temporary chats is returned untouched", () => {
  const state = { ...emptyState, chats: [chat("a")] };
  assert.equal(withoutTemporary(state), state);
});
