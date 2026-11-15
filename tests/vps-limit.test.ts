// Clem's storage limit on the VPS (docs/GUC-VPS-ENGINE.md "Storage limit"): the disk never passes 82% full because of
// Clem. Under, at and over the limit; a move that stops at it; the disk measured again; the worker past the limit with
// the laptop off. All on the fake VPS (its df counts the files put on it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openPglite } from "../desktop/engine/db.ts";
import { DeviceStore, sha256 } from "../desktop/engine/storage.ts";
import { VpsStore, vpsRoot } from "../desktop/engine/vps/store.ts";
import { StorageRouter } from "../desktop/engine/vps/router.ts";
import { Migrator } from "../desktop/engine/vps/migrate.ts";
import { DiskLimit, LimitedStore, Waiting, sshDisk } from "../desktop/engine/vps/limit.ts";
import { seal, secretFile } from "../desktop/engine/vps/secrets.ts";
import { WorkerClient } from "../desktop/engine/vps/rpc.ts";
import { VpsManager, type VpsVault } from "../desktop/engine/vps/manager.ts";
import type { Engine } from "../desktop/engine/index.ts";
import { DISK_SHARE, fits, parseDf, roomOn } from "../core/vps/limit.ts";
import { applyPull } from "../core/workspace/ops.ts";
import { startWorker } from "../worker/index.ts";
import { FakeLocal, FakeVps, bytesOf } from "./vps-fake.ts";

const OWNER = "owner-1", KB = 1024;
const full = (vps: FakeVps) => vps.diskUsed / vps.diskTotal;

test("the limit: Clem writes only while the disk stays at or under 82% full, whatever else is on it", () => {
  const d = { total: 1000 * KB, free: 230 * KB };
  assert.equal(DISK_SHARE, 0.82);
  assert.equal(roomOn(d), 50 * KB);
  assert.ok(fits(d, 49 * KB), "under"); assert.ok(fits(d, 50 * KB), "at"); assert.ok(!fits(d, 50 * KB + 1), "over");
  assert.equal(roomOn({ total: 1000 * KB, free: 100 * KB }), 0, "already past 82% because of other things: no room, never negative");
  assert.deepEqual(parseDf("Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 1000 700 300 70% /\n"), { total: 1000 * KB, free: 300 * KB });
  assert.equal(parseDf("df: no such file"), null);
});

async function setup(o: { other: number; total?: number; ttl?: number }) {
  const { backend, db } = await openPglite();
  await migrate(backend, "desktop/engine/migrations");
  const vps = new FakeVps(), local = new FakeLocal();
  vps.diskTotal = o.total ?? 1000 * KB; vps.diskOther = o.other;
  let now = 1_000_000;
  const store = new VpsStore(() => vps, vpsRoot(OWNER));
  const limit = new DiskLimit({ measure: sshDisk(async () => vps, vpsRoot(OWNER)), clock: () => now, ttl: o.ttl });
  const router = await new StorageRouter({ db, owner: OWNER, local, remote: () => store, mode: () => "vps", cap: 10 * 1024 * KB, limit }).init();
  return { db, backend, vps, local, store, router, limit, tick: (ms: number) => { now += ms; } };
}

test("under, at and over the limit: the file that would pass it stays on this PC, with no error, and Settings has the numbers", async () => {
  const s = await setup({ other: 770 * KB });
  try {
    await s.router.writeFile("a", bytesOf(30 * KB, 1));
    assert.equal((await s.router.row("a"))?.location, "vps", "under the limit: on the VPS");
    await s.router.writeFile("b", bytesOf(20 * KB, 2));
    assert.equal((await s.router.row("b"))?.location, "vps", "exactly at the limit: still on the VPS");
    assert.ok(full(s.vps) <= 0.82, `the disk is ${full(s.vps)} full`);
    await s.router.writeFile("c", bytesOf(1, 3));
    assert.equal(await s.router.row("c"), undefined, "over the limit: this PC keeps it (no row on the VPS)");
    assert.deepEqual(await s.router.readFile("c"), bytesOf(1, 3), "and it reads as any file");
    assert.ok(full(s.vps) <= 0.82, "never past 82%");
    const u = await s.router.usage();
    assert.equal(u.vpsLimit?.used, 50 * KB);
    assert.equal(u.vpsLimit?.max, 50 * KB, "Using 50 KB of 50 KB on your VPS");
    assert.equal(u.vpsLimit?.heldHere, 1, "the rest stays on this PC");
    assert.equal(u.vpsLimit?.diskTotal, 1000 * KB);
  } finally { await s.backend.close(); }
});

test("the disk is measured again: space freed on the server is used again after a few minutes", async () => {
  const s = await setup({ other: 820 * KB, ttl: 5 * 60_000 });
  try {
    await s.router.writeFile("x", bytesOf(10 * KB, 4));
    assert.equal(await s.router.row("x"), undefined, "no room");
    s.vps.diskOther = 670 * KB; // the person cleaned up their server
    await s.router.writeFile("y", bytesOf(10 * KB, 5));
    assert.equal(await s.router.row("y"), undefined, "the old measurement still holds for a few minutes");
    s.tick(5 * 60_000 + 1);
    await s.router.writeFile("z", bytesOf(10 * KB, 6));
    assert.equal((await s.router.row("z"))?.location, "vps", "measured again: room again");
    assert.ok(full(s.vps) <= 0.82);
  } finally { await s.backend.close(); }
});

test("a move to the VPS stops at the limit: what fits moves, the rest stays on this PC, and the run says how many", async () => {
  const s = await setup({ other: 770 * KB });
  try {
    for (let i = 0; i < 5; i++) await s.local.write("f" + i, bytesOf(20 * KB, 10 + i));
    const m = new Migrator({ db: s.db, owner: OWNER, router: s.router, local: s.local, remote: () => s.store, device: new DeviceStore(tmpdir()), limit: s.limit });
    await m.start("up"); await m.wait();
    const v = (await m.view())!;
    assert.equal(v.status, "done");
    assert.equal(v.done, 2, "two files of 20 KB fit in the 50 KB Clem may use");
    assert.equal(v.atLimit, 3, "three stay on this PC");
    assert.ok(!v.error, "no error: nothing went wrong");
    assert.ok(full(s.vps) <= 0.82, `the disk is ${full(s.vps)} full`);
    for (let i = 0; i < 5; i++) assert.deepEqual(await s.router.readFile("f" + i), bytesOf(20 * KB, 10 + i), "every file reads where its row points");
    // Reading a cached file notes its last use in the background: let that finish before the database closes.
    await new Promise((r) => setTimeout(r, 200));
  } finally { await s.backend.close(); }
});

test("the worker's store past the limit keeps the CMS file on the CMS and notes it in plain words", async () => {
  const { backend, db } = await openPglite();
  await migrate(backend, "desktop/engine/migrations");
  const root = await mkdtemp(join(tmpdir(), "clem-limit-"));
  try {
    const limit = new DiskLimit({ measure: async () => ({ total: 1000 * KB, free: 190 * KB }) });
    const waiting = new Waiting(db, OWNER);
    const store = new LimitedStore({ inner: new DeviceStore(root, { location: "vps", sub: "" }), limit, root, waiting });
    const small = bytesOf(5 * KB, 1), big = bytesOf(8 * KB, 2);
    assert.match(await store.put(sha256(small), "pdf", small), /\.pdf$/, "10 KB of room: 5 KB fits");
    await assert.rejects(store.put(sha256(big), "pdf", big), /stays on the CMS/);
    assert.deepEqual(await waiting.sentences(), ["A CMS file (1 MB) wasn't kept on your VPS because it's at Clem's storage limit; it stays on the CMS and Clem reads it from there."]);
  } finally { await backend.close(); await rm(root, { recursive: true, force: true }); }
});
