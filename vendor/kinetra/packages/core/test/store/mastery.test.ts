import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemorySqlite } from "../../src/store/sqlite.js";
import { MasteryStore } from "../../src/store/mastery.js";

function fresh() {
  const db = new InMemorySqlite();
  return new MasteryStore(db);
}

test("mastery: empty store returns null for unknown topic", () => {
  const m = fresh();
  assert.equal(m.get("nope"), null);
});

test("mastery: first correct event sets score to 0.6 prior", () => {
  const m = fresh();
  const s = m.applyEvent({ topicId: "T1", correct: true });
  assert.equal(s.attempts, 1);
  assert.equal(s.correct, 1);
  assert.equal(s.mistakes, 0);
  assert.equal(s.score, 0.6);
});

test("mastery: first incorrect event sets score to 0.2 prior", () => {
  const m = fresh();
  const s = m.applyEvent({ topicId: "T1", correct: false });
  assert.equal(s.score, 0.2);
  assert.equal(s.mistakes, 1);
});

test("mastery: weighted running average of correct/wrong", () => {
  const m = fresh();
  // 3 correct, 1 wrong in any order
  m.applyEvent({ topicId: "T1", correct: true });
  m.applyEvent({ topicId: "T1", correct: true });
  m.applyEvent({ topicId: "T1", correct: false });
  m.applyEvent({ topicId: "T1", correct: true });
  const s = m.get("T1")!;
  assert.equal(s.attempts, 4);
  assert.equal(s.correct, 3);
  assert.equal(s.mistakes, 1);
  // score = (0.6 + 1 + 0 + 1) / 4 = 0.65
  assert.equal(s.score, 0.65);
});

test("mastery: weakTopics filters by threshold ordered asc", () => {
  const m = fresh();
  m.applyEvent({ topicId: "weak1", correct: false });
  m.applyEvent({ topicId: "weak2", correct: false });
  m.applyEvent({ topicId: "strong", correct: true });
  m.applyEvent({ topicId: "strong", correct: true });
  const weak = m.weakTopics(0.5);
  assert.equal(weak.length, 2);
  for (const w of weak) assert.ok(w.score < 0.5);
});

test("mastery: reset removes a topic's state", () => {
  const m = fresh();
  m.applyEvent({ topicId: "T1", correct: true });
  assert.notEqual(m.get("T1"), null);
  m.reset("T1");
  assert.equal(m.get("T1"), null);
});

test("mastery: list returns all topics sorted by score asc", () => {
  const m = fresh();
  m.applyEvent({ topicId: "a", correct: false });
  m.applyEvent({ topicId: "b", correct: true });
  m.applyEvent({ topicId: "b", correct: true });
  const list = m.list();
  assert.equal(list.length, 2);
  assert.ok(list[0].score <= list[1].score);
});
