import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemorySqlite } from "../../src/store/sqlite.js";
import { HistoryStore } from "../../src/store/history.js";

function fresh() {
  const db = new InMemorySqlite();
  return { db, history: new HistoryStore(db) };
}

test("history: record assigns id, ts, and round-trips payload", () => {
  const { history } = fresh();
  const e = history.record({ type: "import", courseId: "C1", payload: { src: "x.pdf" } });
  assert.ok(e.id > 0);
  assert.equal(e.type, "import");
  assert.equal(e.courseId, "C1");
  assert.deepEqual(e.payload, { src: "x.pdf" });
  assert.equal(e.correct, null);
});

test("history: list orders by ts desc with limit", () => {
  const { history } = fresh();
  history.record({ type: "import", ts: "2025-01-01T00:00:00Z" });
  history.record({ type: "question-asked", ts: "2025-01-02T00:00:00Z" });
  history.record({ type: "practice-attempt", ts: "2025-01-03T00:00:00Z" });
  const all = history.list();
  assert.equal(all.length, 3);
  assert.equal(all[0].type, "practice-attempt");
  assert.equal(all[2].type, "import");
  const limited = history.list({ limit: 1 });
  assert.equal(limited.length, 1);
});

test("history: filter by courseId, topicId, type, since", () => {
  const { history } = fresh();
  history.record({ type: "import", courseId: "A", ts: "2025-01-01T00:00:00Z" });
  history.record({ type: "question-asked", courseId: "B", ts: "2025-01-02T00:00:00Z" });
  history.record({ type: "practice-attempt", courseId: "A", topicId: "T1", ts: "2025-01-03T00:00:00Z" });
  const a = history.list({ courseId: "A" });
  assert.equal(a.length, 2);
  const t = history.list({ topicId: "T1" });
  assert.equal(t.length, 1);
  const imp = history.list({ type: "import" });
  assert.equal(imp.length, 1);
  const since = history.list({ since: "2025-01-02T00:00:00Z" });
  assert.equal(since.length, 2);
});

test("history: attemptsByTopic and mistakesByTopic", () => {
  const { history } = fresh();
  history.record({ type: "practice-attempt", topicId: "T1", correct: true });
  history.record({ type: "practice-attempt", topicId: "T1", correct: false });
  history.record({ type: "practice-attempt", topicId: "T1", correct: false });
  history.record({ type: "mistake", topicId: "T1" });
  history.record({ type: "practice-attempt", topicId: "T2", correct: true });
  assert.equal(history.attemptsByTopic("T1"), 3);
  assert.equal(history.mistakesByTopic("T1"), 1);
  assert.equal(history.attemptsByTopic("T2"), 1);
});

test("history: resetTopic removes rows but keeps others", () => {
  const { history } = fresh();
  history.record({ type: "practice-attempt", topicId: "T1", correct: true });
  history.record({ type: "practice-attempt", topicId: "T2", correct: true });
  const removed = history.resetTopic("T1");
  assert.equal(removed, 1);
  assert.equal(history.size(), 1);
  assert.equal(history.attemptsByTopic("T1"), 0);
  assert.equal(history.attemptsByTopic("T2"), 1);
});

test("history: size reflects record count", () => {
  const { history } = fresh();
  assert.equal(history.size(), 0);
  history.record({ type: "import" });
  history.record({ type: "import" });
  assert.equal(history.size(), 2);
});
