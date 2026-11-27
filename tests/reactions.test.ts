import test from "node:test";
import assert from "node:assert/strict";
import { feedback, groups, reactionOnly, toggle, turnNote, withoutReact } from "../core/reactions.ts";

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
