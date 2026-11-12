import test from "node:test";
import assert from "node:assert/strict";
import { flipFrom, lastUsed, morphMode, pickSpaces } from "../core/main-thread/home.ts";

const sp = (id: string, name: string, kind: "subject" | "project" = "subject", description = "") => ({ id, name, kind, description });
const spaces = [sp("bio", "Biology 101"), sp("circ", "Circuits", "subject", "ELCT 201"), sp("site", "Portfolio website", "project"), sp("thesis", "Thesis", "project"), sp("calc", "Calculus II")];
const chats = [
  { spaceId: "site", updated: 500 }, { spaceId: "circ", updated: 900 }, { spaceId: "circ", updated: 100 }, { spaceId: "bio", updated: 300 },
  { spaceId: null, updated: 9999, kind: "main" }, { spaceId: "thesis", updated: 9999, archived: "earlier" }, { spaceId: "calc", updated: 9999, temporary: true },
];

test("morph: instant for reduced motion or a quieter workspace, View Transitions when there, else FLIP", () => {
  assert.equal(morphMode({ reduced: true, viewTransitions: true }), "instant");
  assert.equal(morphMode({ reduced: false, quiet: true, viewTransitions: true }), "instant");
  assert.equal(morphMode({ reduced: false, viewTransitions: true }), "view-transition");
  assert.equal(morphMode({ reduced: false, viewTransitions: false }), "flip");
  assert.equal(flipFrom({ left: 300, top: 400, width: 760, height: 150 }, { left: 280, top: 700, width: 800, height: 120 }), "translate(20px, -300px) scale(0.95, 1.25)");
});

test("picker: most recently used first, never-used after (subjects first, then by name)", () => {
  assert.deepEqual([...lastUsed(chats)], [["site", 500], ["circ", 900], ["bio", 300]], "the main thread, earlier and temporary chats don't count");
  assert.deepEqual(pickSpaces(spaces, chats).map((s) => s.id), ["circ", "site", "bio", "calc", "thesis"]);
  assert.deepEqual(pickSpaces(spaces, chats, "", 3).map((s) => s.id), ["circ", "site", "bio"]);
});

test("picker: typed, fuzzy like @ mentions; a word that starts with it wins; nothing for nonsense", () => {
  assert.equal(pickSpaces(spaces, chats, "circ")[0].id, "circ");
  assert.equal(pickSpaces(spaces, chats, "elct")[0].id, "circ", "a course code in the description");
  assert.equal(pickSpaces(spaces, chats, "web")[0].id, "site", "any word of the name");
  assert.equal(pickSpaces(spaces, chats, "biolgy")[0].id, "bio", "a typo");
  assert.deepEqual(pickSpaces(spaces, chats, "zzzzqx"), []);
  assert.equal(pickSpaces(spaces, chats, "c", 2).length, 2, "limited");
});
