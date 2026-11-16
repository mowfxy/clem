import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPglite, openPgliteRepairing, snapshotPath, snapshotPglite } from "../desktop/engine/db.ts";

// What happened on 2026-11-16: the engine folder was left without a valid checkpoint (Clem quit for an update while
// PGlite still wrote), Postgres PANICked at every start ("RuntimeError: Aborted()") and every chat turn failed with it.
// Zeroed WAL gives the same PANIC.
async function damage(dir: string) {
  for (const f of await readdir(join(dir, "pg_wal"))) if (/^[0-9A-F]{24}$/.test(f)) await writeFile(join(dir, "pg_wal", f), new Uint8Array(16 * 1024 * 1024));
}

test("a damaged engine folder is kept aside and starts again from the last snapshot, or empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "clem-repair-")), dir = join(root, "engine");
  try {
    let opened = await openPgliteRepairing(dir);
    assert.equal(opened.repaired, undefined);
    await opened.db.query("create table t (v text)");
    await opened.db.query("insert into t values ('kept')");
    assert.ok((await snapshotPglite(opened.pg, dir)) > 0);
    await opened.db.query("insert into t values ('after the snapshot')");
    await opened.pg.close();

    await damage(dir);
    await assert.rejects(openPglite(dir), /Aborted/);
    const log: string[] = [];
    opened = await openPgliteRepairing(dir, (m) => log.push(m));
    assert.equal(opened.repaired, "snapshot");
    assert.deepEqual((await opened.db.query("select v from t")).map((r) => r.v), ["kept"]);
    assert.match(log.join("\n"), /would not start/);
    await opened.pg.close();

    // No snapshot (or a bad one): an empty database, and the damaged folders kept (the newest two).
    await rm(snapshotPath(dir));
    await damage(dir);
    opened = await openPgliteRepairing(dir);
    assert.equal(opened.repaired, "fresh");
    assert.deepEqual(await opened.db.query("select to_regclass('t') as t"), [{ t: null }]);
    await opened.pg.close();
    await damage(dir);
    await new Promise((r) => setTimeout(r, 5));
    await (await openPgliteRepairing(dir)).pg.close();
    assert.equal((await readdir(root)).filter((f) => f.startsWith("engine-damaged-")).length, 2);

    // A healthy folder opens as it is.
    opened = await openPgliteRepairing(dir);
    assert.equal(opened.repaired, undefined);
    await opened.pg.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
