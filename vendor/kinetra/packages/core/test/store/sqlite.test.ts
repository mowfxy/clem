/**
 * Tests for store/sqlite.ts — the InMemorySqlite shim and
 * isNativeSqliteAvailable() detection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemorySqlite,
  isNativeSqliteAvailable,
  openSqlite,
} from "../../src/store/sqlite.js";

test("InMemorySqlite: CREATE + INSERT + SELECT round-trip", () => {
  const db = new InMemorySqlite();
  db.exec("CREATE TABLE t (id INTEGER, name TEXT);");
  db.prepare("INSERT INTO t (id, name) VALUES (?, ?)").run(1, "alice");
  db.prepare("INSERT INTO t (id, name) VALUES (?, ?)").run(2, "bob");
  const rows = db.prepare("SELECT * FROM t").all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 2);
  const alice = rows.find((r) => r.id === 1);
  assert.equal(alice?.name, "alice");
});

test("InMemorySqlite: UPDATE mutates and reports changes", () => {
  const db = new InMemorySqlite();
  db.exec("CREATE TABLE t (id INTEGER, name TEXT);");
  db.prepare("INSERT INTO t (id, name) VALUES (?, ?)").run(1, "alice");
  db.prepare("UPDATE t SET name = ? WHERE id = ?").run("ALICE", 1);
  const row = db.prepare("SELECT * FROM t WHERE id = ?").get(1) as Record<string, unknown>;
  assert.equal(row.name, "ALICE");
});

test("InMemorySqlite: DELETE removes rows", () => {
  const db = new InMemorySqlite();
  db.exec("CREATE TABLE t (id INTEGER, name TEXT);");
  db.prepare("INSERT INTO t (id, name) VALUES (?, ?)").run(1, "alice");
  db.prepare("INSERT INTO t (id, name) VALUES (?, ?)").run(2, "bob");
  db.prepare("DELETE FROM t WHERE id = ?").run(1);
  const rows = db.prepare("SELECT * FROM t").all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 2);
});

test("InMemorySqlite: WHERE with AND chain", () => {
  const db = new InMemorySqlite();
  db.exec("CREATE TABLE t (id INTEGER, name TEXT, age INTEGER);");
  db.prepare("INSERT INTO t (id, name, age) VALUES (?, ?, ?)").run(1, "alice", 30);
  db.prepare("INSERT INTO t (id, name, age) VALUES (?, ?, ?)").run(2, "bob", 40);
  const rows = db.prepare("SELECT * FROM t WHERE name = ? AND age = ?").all("bob", 40) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 2);
});

test("InMemorySqlite: INSERT OR REPLACE on primary key", () => {
  const db = new InMemorySqlite();
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);");
  db.prepare("INSERT INTO t (id, name) VALUES (?, ?)").run(1, "alice");
  db.prepare("INSERT OR REPLACE INTO t (id, name) VALUES (?, ?)").run(1, "ALICE");
  const row = db.prepare("SELECT * FROM t WHERE id = ?").get(1) as Record<string, unknown>;
  assert.equal(row.name, "ALICE");
});

test("openSqlite returns a usable database object", () => {
  const db = openSqlite(":memory:");
  assert.equal(typeof db.prepare, "function");
  assert.equal(typeof db.exec, "function");
  assert.equal(typeof db.close, "function");
  assert.equal(typeof db.changes, "function");
  db.close();
});

test("isNativeSqliteAvailable returns boolean", () => {
  const v = isNativeSqliteAvailable();
  assert.equal(typeof v, "boolean");
});