import test from "node:test";
import assert from "node:assert/strict";
import { readCard, cardBlock } from "../core/guc/cards.ts";

test("main-thread cards parse against their schema", () => {
  assert.deepEqual(readCard('{"type":"handoff","spaceId":"s1","spaceName":"Circuits","chatId":"c1","reason":"match"}'), { type: "handoff", spaceId: "s1", spaceName: "Circuits", chatId: "c1", reason: "match" });
  assert.equal(readCard('{"type":"brief","title":"Morning","items":[{"text":"Circuits lab","time":"09:00"}]}')?.type, "brief");
  assert.equal(readCard('{"type":"reminder","title":"Sheet 3","due":"2026-11-12"}')?.type, "reminder");
  assert.equal(readCard('{"type":"digest","lines":[{"text":"New grade in Physics","space":"Physics"}]}')?.type, "digest");
});

test("unknown, malformed or invalid cards read as nothing", () => {
  assert.equal(readCard('{"type":"launch_missiles"}'), null);
  assert.equal(readCard("not json"), null);
  assert.equal(readCard('{"type":"handoff","spaceName":"Circuits"}'), null, "a hand-off needs its space and chat");
  assert.equal(readCard('{"type":"reminder","title":"x","due":"tomorrow"}'), null);
  assert.equal(readCard('{"type":"digest","lines":[]}'), null);
});

test("a card is stored as a fenced block that reads back the same", () => {
  const card = { type: "handoff" as const, spaceId: "s1", spaceName: "Circuits", chatId: "c1" };
  const block = cardBlock(card);
  assert.match(block, /^```clem-card\n/);
  assert.deepEqual(readCard(block.replace(/^```clem-card\n|\n```$/g, "")), card);
  assert.throws(() => cardBlock({ type: "handoff" } as never));
});
