import test from "node:test";
import assert from "node:assert/strict";
import {
  pairing,
  verifyPairing,
  telegramEnvelope,
} from "../../desktop/messaging/telegram.ts";
test("pairing is expiring and bound to a selected scope", () => {
  const p = pairing("project:a");
  assert.ok(verifyPairing(p.code, p.record));
  assert.ok(!verifyPairing("wrong", p.record));
  assert.ok(!verifyPairing(p.code, p.record, p.record.expires));
  assert.equal(p.record.scope, "project:a");
});
test("Telegram rejects unpaired senders, groups and oversized media", () => {
  const routes = [{ senderId: 1, chatId: 2, scope: "project:a" }];
  const update = {
    update_id: 1,
    message: {
      chat: { id: 2, type: "private" },
      from: { id: 1 },
      text: "hello",
    },
  };
  assert.equal(telegramEnvelope(update, routes)?.scope, "project:a");
  assert.equal(
    telegramEnvelope(
      { ...update, message: { ...update.message, from: { id: 3 } } },
      routes,
    ),
    null,
  );
  assert.equal(
    telegramEnvelope(
      {
        ...update,
        message: { ...update.message, chat: { id: 2, type: "group" } },
      },
      routes,
    ),
    null,
  );
  assert.throws(() =>
    telegramEnvelope(
      {
        ...update,
        message: { ...update.message, document: { file_size: 21_000_000 } },
      },
      routes,
    ),
  );
});
