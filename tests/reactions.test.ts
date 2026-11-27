import test from "node:test";
import assert from "node:assert/strict";
import { canReact, feedback, groups, label, reactIn, reactionOnly, settleReactionOnly, toggle, turnNote, withoutReact } from "../core/reactions.ts";

test("toggle adds, then removes on a second tap", () => {
  const one = toggle(undefined, "👍", "you", 1);
  assert.deepEqual(one, [{ emoji: "👍", by: "you", at: 1 }]);
  assert.deepEqual(toggle(one, "👍", "you"), []);
  assert.equal(toggle(one, "👍", "clem").length, 2);
});

test("groups by emoji", () => {
  assert.deepEqual(groups([{ emoji: "👍", by: "you" }, { emoji: "👍", by: "clem" }, { emoji: "🎉", by: "you" }]), [{ emoji: "👍", by: ["you", "clem"] }, { emoji: "🎉", by: ["you"] }]);
  assert.deepEqual(groups(undefined), []);
});

test("a reaction-only reply is read; words after it are not", () => {
  assert.equal(reactionOnly("[[react: 👍]]"), "👍");
  assert.equal(reactionOnly("[[react: 👍]] Sure, here it is"), null);
  assert.equal(reactionOnly("[[react: 🦄]]"), null);
  assert.equal(withoutReact("[[react: 👍]] Hi"), "Hi");
});

test("the AI reads reactions as feedback", () => {
  const msgs = [
    { id: "a", role: "assistant", content: "Mitochondria make ATP.", reactions: [{ emoji: "👍", by: "you", at: 2 }] },
    { id: "b", role: "assistant", content: "GUC news: new announcement", own: "news", reactions: [{ emoji: "👎", by: "you", at: 3 }] },
    { id: "c", role: "user", content: "ok thanks", reactions: [{ emoji: "👍", by: "clem" }] },
  ];
  const f = feedback(msgs);
  assert.match(f, /👎 on your own post \(news\)[\s\S]*👍 on your answer/);
  assert.equal(feedback([{ id: "x", role: "user", content: "hi" }]), "");
  assert.match(turnNote(msgs[0]), /they reacted 👍/);
  assert.match(turnNote(msgs[2]), /you reacted 👍/);
  assert.equal(turnNote({ id: "x", role: "user", content: "hi" }), "");
});

test("which messages get the reaction row", () => {
  assert.equal(canReact({ content: "hi" }), true);
  assert.equal(canReact({ content: "hi" }, true), false, "not while the answer is being written");
  assert.equal(canReact({ content: "  " }), false);
  assert.equal(canReact({ content: "Trimmed 3 files", trim: { bytes: 1 } }), false);
});

test("chips say who reacted", () => {
  assert.equal(label("👍", ["you"]), "👍 from you. Press to remove yours");
  assert.equal(label("👍", ["clem"]), "👍 from Clem");
});

test("reacting in a chat touches only that message, and survives a save round trip", () => {
  const msgs = [{ id: "a", role: "user", content: "x" }, { id: "b", role: "assistant", content: "y" }];
  const next = reactIn(msgs, "b", "👎", "you", 5);
  assert.deepEqual(next[1].reactions, [{ emoji: "👎", by: "you", at: 5 }]);
  assert.equal(next[0], msgs[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
  assert.deepEqual(reactIn(next, "b", "👎", "you")[1].reactions, []);
});

test("a reaction-only answer leaves only the reaction on the person's message", () => {
  const msgs = [{ id: "q", role: "user", content: "ok thanks" }, { id: "a", role: "assistant", content: "[[react: 🙏]]" }];
  const next = settleReactionOnly(msgs, "a", "🙏", 9);
  assert.equal(next.length, 1);
  assert.deepEqual(next[0].reactions, [{ emoji: "🙏", by: "clem", at: 9 }]);
  const lone = [{ id: "a", role: "assistant", content: "" }];
  assert.equal(settleReactionOnly(lone, "a", "🙏"), lone, "no message to react to: nothing changes");
});

test("old messages without reactions still work everywhere", () => {
  const old = { id: "o", role: "assistant", content: "old answer" };
  assert.equal(turnNote(old), "");
  assert.equal(feedback([old]), "");
  assert.deepEqual(groups((old as { reactions?: [] }).reactions), []);
});
