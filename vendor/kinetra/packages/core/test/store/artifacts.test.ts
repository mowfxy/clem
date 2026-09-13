import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemorySqlite } from "../../src/store/sqlite.js";
import { ArtifactStore } from "../../src/store/artifacts.js";

function fresh() {
  const db = new InMemorySqlite();
  return new ArtifactStore(db);
}

const sample = (overrides: Partial<{ id: string; kind: string; title: string; createdAt: string; updatedAt: string; model: Record<string, unknown>; hash: string; courseId: string | null }> = {}) => ({
  id: "art-1",
  kind: "kmap",
  title: "K-map for F=AB+BC",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  model: { variables: ["A", "B", "C"], minterms: [3, 7] },
  hash: "h1",
  ...overrides,
});

test("artifacts: upsert and get round-trip", () => {
  const a = fresh();
  const r = a.upsert(sample());
  assert.equal(r.id, "art-1");
  assert.deepEqual(r.model, { variables: ["A", "B", "C"], minterms: [3, 7] });
  assert.deepEqual(r.tags, []);
  const g = a.get("art-1");
  assert.deepEqual(g, r);
});

test("artifacts: upsert with same id replaces", () => {
  const a = fresh();
  a.upsert(sample());
  a.upsert(sample({ title: "Updated", model: { x: 1 }, hash: "h2" }));
  const g = a.get("art-1")!;
  assert.equal(g.title, "Updated");
  assert.deepEqual(g.model, { x: 1 });
  assert.equal(g.hash, "h2");
});

test("artifacts: byKind filters by kind and courseId", () => {
  const a = fresh();
  a.upsert(sample({ id: "a1", kind: "kmap" }));
  a.upsert(sample({ id: "a2", kind: "truth-table" }));
  a.upsert(sample({ id: "a3", kind: "kmap", courseId: "C1" }));
  const kmaps = a.byKind("kmap");
  assert.equal(kmaps.length, 2);
  const kmapsC1 = a.byKind("kmap", "C1");
  assert.equal(kmapsC1.length, 1);
  assert.equal(kmapsC1[0].id, "a3");
});

test("artifacts: listForCourse returns all artifacts for a course", () => {
  const a = fresh();
  a.upsert(sample({ id: "a1", courseId: "C1" }));
  a.upsert(sample({ id: "a2", courseId: "C1" }));
  a.upsert(sample({ id: "a3", courseId: "C2" }));
  const c1 = a.listForCourse("C1");
  assert.equal(c1.length, 2);
});

test("artifacts: remove returns true and clears the row", () => {
  const a = fresh();
  a.upsert(sample());
  assert.equal(a.remove("art-1"), true);
  assert.equal(a.get("art-1"), null);
  assert.equal(a.remove("art-1"), false);
});

test("artifacts: validation rejects empty id", () => {
  const a = fresh();
  assert.throws(() => a.upsert(sample({ id: "" })));
});
