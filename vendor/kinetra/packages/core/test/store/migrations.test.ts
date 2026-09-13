import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemorySqlite } from "../../src/store/sqlite.js";
import { MigrationRunner } from "../../src/store/migrations.js";

test("migrations: empty db applies all migrations in order", () => {
  const db = new InMemorySqlite();
  const calls = [];
  const runner = new MigrationRunner([
    { version: 1, name: "create_users", apply: () => calls.push("v1") },
    { version: 2, name: "create_posts", apply: () => calls.push("v2") },
    { version: 3, name: "add_index",   apply: () => calls.push("v3") },
  ]);
  const r = runner.applyAll(db);
  assert.equal(r.applied, 3);
  assert.equal(r.current, 3);
  assert.deepEqual(calls, ["v1", "v2", "v3"]);
});

test("migrations: rerun is a no-op once current version reached", () => {
  const db = new InMemorySqlite();
  let count = 0;
  const runner = new MigrationRunner([
    { version: 1, name: "a", apply: () => count++ },
    { version: 2, name: "b", apply: () => count++ },
  ]);
  runner.applyAll(db);
  const r2 = runner.applyAll(db);
  assert.equal(r2.applied, 0);
  assert.equal(r2.current, 2);
  assert.equal(count, 2);
});

test("migrations: only missing versions are applied", () => {
  const db = new InMemorySqlite();
  const calls = [];
  const runner = new MigrationRunner([
    { version: 1, name: "a", apply: () => calls.push("v1") },
    { version: 2, name: "b", apply: () => calls.push("v2") },
  ]);
  runner.applyAll(db);
  const runner2 = new MigrationRunner([
    { version: 1, name: "a", apply: () => calls.push("v1") },
    { version: 2, name: "b", apply: () => calls.push("v2") },
    { version: 3, name: "c", apply: () => calls.push("v3") },
  ]);
  const r = runner2.applyAll(db);
  assert.equal(r.applied, 1);
  assert.equal(r.current, 3);
  assert.deepEqual(calls, ["v1", "v2", "v3"]);
});

test("migrations: rejects non-contiguous versions", () => {
  assert.throws(() => new MigrationRunner([
    { version: 1, name: "a", apply: () => {} },
    { version: 3, name: "c", apply: () => {} },
  ]), /contiguous/);
});

test("migrations: current version is 0 before anything applied", () => {
  const db = new InMemorySqlite();
  const runner = new MigrationRunner([]);
  assert.equal(runner.currentVersion(db), 0);
});
