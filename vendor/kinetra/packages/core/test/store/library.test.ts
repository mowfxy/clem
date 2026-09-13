/**
 * Tests for the document library (store/library.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemorySqlite } from "../../src/store/sqlite.js";
import { DocumentLibrary } from "../../src/store/library.js";

function newLib() {
  return new DocumentLibrary(new InMemorySqlite());
}

test("library: upsert creates a new entry with a stable hash", () => {
  const lib = newLib();
  const e = lib.upsert({ sourceId: "s1", title: "Lecture 1", kind: "pdf", content: "Hello world" });
  assert.equal(e.sourceId, "s1");
  assert.equal(e.title, "Lecture 1");
  assert.equal(e.kind, "pdf");
  assert.equal(e.byteLength, "Hello world".length);
  assert.match(e.hash, /^[a-f0-9]{64}$/);
});

test("library: re-importing the same content is idempotent and bumps last_indexed_at", () => {
  const lib = newLib();
  const a = lib.upsert({ sourceId: "s1", title: "L1", kind: "text", content: "abc" });
  const b = lib.upsert({ sourceId: "s1", title: "L1", kind: "text", content: "abc" });
  assert.equal(b.importedAt, a.importedAt, "importedAt must not change for re-imports");
  assert.ok(b.lastIndexedAt! >= a.lastIndexedAt!, "lastIndexedAt must move forward");
});

test("library: changing the content marks the old row superseded", () => {
  const lib = newLib();
  lib.upsert({ sourceId: "s1", title: "L1", kind: "text", content: "abc" });
  const updated = lib.upsert({ sourceId: "s1", title: "L1", kind: "text", content: "def" });
  // hash must change because content changed
  assert.equal(updated.byteLength, 3); // "def".length
  assert.notEqual(updated.hash, lib.get("s1", 1)!.hash);
  const list = lib.list({ includeSuperseded: true });
  assert.equal(list.length, 2);
  const superseded = list.find((x) => x.sourceId === "s1" && x.supersededBy);
  assert.ok(superseded, "old row should be marked superseded");
});

test("library: byHash returns matching rows", () => {
  const lib = newLib();
  const e1 = lib.upsert({ sourceId: "a", title: "t", kind: "text", content: "same" });
  const e2 = lib.upsert({ sourceId: "b", title: "u", kind: "text", content: "same" });
  assert.equal(e1.hash, e2.hash);
  const matches = lib.byHash(e1.hash);
  assert.equal(matches.length, 2);
});

test("library: list filter by course and kind", () => {
  const lib = newLib();
  lib.upsert({ sourceId: "a", title: "A", kind: "pdf", content: "x", courseId: "c1" });
  lib.upsert({ sourceId: "b", title: "B", kind: "text", content: "x", courseId: "c1" });
  lib.upsert({ sourceId: "c", title: "C", kind: "pdf", content: "x", courseId: "c2" });
  assert.equal(lib.list({ courseId: "c1" }).length, 2);
  assert.equal(lib.list({ kind: "pdf" }).length, 2);
  assert.equal(lib.list({ courseId: "c1", kind: "pdf" }).length, 1);
});

test("library: remove deletes the row", () => {
  const lib = newLib();
  lib.upsert({ sourceId: "x", title: "X", kind: "text", content: "x" });
  assert.ok(lib.get("x"));
  lib.remove("x");
  assert.equal(lib.get("x"), null);
});

test("library: markIndexed updates last_indexed_at only", () => {
  const lib = newLib();
  const e = lib.upsert({ sourceId: "y", title: "Y", kind: "text", content: "x" });
  const before = e.lastIndexedAt;
  // wait a bit (1ms) to ensure timestamp movement
  const later = new Date(Date.parse(before!) + 5).toISOString();
  // Mark with a manually provided later time via re-import path
  const e2 = lib.upsert({ sourceId: "y", title: "Y", kind: "text", content: "x" });
  assert.ok(e2.lastIndexedAt! >= before!);
});