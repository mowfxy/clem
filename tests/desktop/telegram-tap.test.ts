import test from "node:test";
import assert from "node:assert/strict";
import { telegramTap } from "../../desktop/messaging/telegram.ts";

const routes = [{ chatId: 42, senderId: 7, scope: "subject:bio" }];
const tap = (over: any = {}) => ({ update_id: 1, callback_query: { id: "q1", data: "m|claude:opus", from: { id: 7 }, message: { message_id: 99, chat: { id: 42, type: "private" } }, ...over } });

test("a picker tap counts only from the paired chat and person", () => {
  assert.deepEqual(telegramTap(tap(), routes), { id: "q1", data: "m|claude:opus", chatId: 42, messageId: 99, scope: "subject:bio" });
  assert.equal(telegramTap(tap({ from: { id: 8 } }), routes), null, "someone else in the chat");
  assert.equal(telegramTap(tap({ message: { message_id: 99, chat: { id: 43, type: "private" } } }), routes), null, "another chat");
  assert.equal(telegramTap(tap({ message: { message_id: 99, chat: { id: 42, type: "group" } } }), routes), null, "a group");
  assert.equal(telegramTap({ update_id: 2, message: { text: "hi" } }, routes), null, "not a tap");
});
