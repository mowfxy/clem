import test from "node:test";
import assert from "node:assert/strict";
import { routeMessage, scoreSpaces, courseCodes, carriedNote, mentionMatches, type RouteSpace } from "../core/main-thread/route.ts";

const spaces: RouteSpace[] = [
  { id: "circ", name: "Circuits", kind: "subject", description: "ELCT 201 · Electric circuits" },
  { id: "ds", name: "Data Structures", kind: "subject", description: "CSEN 301" },
  { id: "phys", name: "Physics", kind: "subject" },
  { id: "web", name: "Portfolio website", kind: "project", aliases: ["site"] },
  { id: "math", name: "Math 2", kind: "subject", aliases: ["MATH 203"] },
];

test("course codes are found however they are written", () => {
  assert.deepEqual(courseCodes("Is the elct201 quiz on CSEN 301-style trees?"), ["ELCT201", "CSEN301"]);
});

test("an @mention always hands off", () => {
  const r = routeMessage("what should I do today", spaces, { mentions: ["web"] });
  assert.deepEqual(r, { kind: "handoff", spaceId: "web", reason: "mention", score: 1 });
  assert.equal(routeMessage("hi", spaces, { mentions: ["gone"] }).kind, "stay", "a mention of a space that no longer exists is ignored");
});

test("a confident match hands off: full name, course code or alias", () => {
  for (const [text, id] of [["Can you explain Thevenin equivalents for circuits?", "circ"], ["help with the ELCT 201 sheet", "circ"], ["my data structures assignment on AVL trees", "ds"], ["the MATH203 midterm topics", "math"], ["fix the navbar on my site", "web"]] as const) {
    const r = routeMessage(text, spaces);
    assert.equal(r.kind, "handoff", text);
    assert.equal(r.kind === "handoff" && r.spaceId, id, text);
  }
});

test("a close misspelling of a distinctive name still ranks it first; a loose word does not hand off", () => {
  const scored = scoreSpaces("explain cirquits nodal analysis", spaces);
  assert.equal(scored[0].spaceId, "circ");
  assert.equal(routeMessage("what's the structure of my week", spaces).kind, "stay");
});

test("ambiguous or unrelated messages stay in the main thread", () => {
  const two = routeMessage("compare what I have due in physics and circuits", spaces);
  assert.equal(two.kind, "stay");
  assert.equal(two.kind === "stay" && two.reason, "ambiguous");
  assert.equal(routeMessage("plan my day please", spaces).kind, "stay");
  const hi = routeMessage("thanks!", spaces);
  assert.equal(hi.kind === "stay" && hi.reason, "small-talk");
  assert.equal(routeMessage("anything", []).kind, "stay");
});

test("the carried note is the last few turns, short, without cards", () => {
  const note = carriedNote([
    { role: "user", content: "old " + "x".repeat(500) },
    { role: "assistant", content: "```clem-card\n{\"type\":\"handoff\"}\n```" },
    { role: "user", content: "I have the circuits quiz tomorrow" },
    { role: "assistant", content: "Then let's review nodal analysis tonight." },
  ], { chars: 200 });
  assert.ok(note.length <= 200);
  assert.match(note, /You: I have the circuits quiz tomorrow\nClem: Then let's review/);
  assert.doesNotMatch(note, /clem-card/);
});

test("@ suggestions are fuzzy and keep their order without a query", () => {
  assert.deepEqual(mentionMatches("", spaces, 3).map((s) => s.id), ["circ", "ds", "phys"]);
  assert.equal(mentionMatches("strct", spaces)[0].id, "ds");
  assert.equal(mentionMatches("portf", spaces)[0].id, "web");
});
