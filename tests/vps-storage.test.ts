// The VPS step's storage (docs/GUC-VPS-ENGINE.md "Storage on the VPS", "Moving files"): VpsStore, the router and its
// cache, and the mover's interruption, resume, checksum rollback and move back. All against a fake VPS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openPglite } from "../desktop/engine/db.ts";
import { DeviceStore, sha256 } from "../desktop/engine/storage.ts";
import { ChecksumError, VpsStore, vpsRoot } from "../desktop/engine/vps/store.ts";
import { StorageRouter } from "../desktop/engine/vps/router.ts";
import { Migrator } from "../desktop/engine/vps/migrate.ts";
import { likelyNext, chatFiles } from "../core/vps/prefetch.ts";
import { FakeLocal, FakeVps, bytesOf } from "./vps-fake.ts";

const OWNER = "owner-1";
async function setup(o: { cap?: number; mode?: "device" | "vps" } = {}) {
  const { backend, db } = await openPglite();
  await migrate(backend, "desktop/engine/migrations");
  const vps = new FakeVps(), local = new FakeLocal();
  let mode = o.mode || "device";
  const store = new VpsStore(() => vps, vpsRoot(OWNER));
  const router = await new StorageRouter({ db, owner: OWNER, local, remote: () => (vps.offline ? undefined : store), mode: () => mode, cap: o.cap || 10_000 }).init();
  return { db, backend, vps, local, store, router, setMode: (m: "device" | "vps") => { mode = m; } };
}
const until = async (check: () => Promise<boolean>, ms = 10_000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (await check()) return; throw Error("timed out"); };

test("VpsStore keeps files under their sha256, checks the server's copy, and refuses damaged bytes", async () => {
  const vps = new FakeVps(), store = new VpsStore(() => vps, vpsRoot(OWNER)), b = bytesOf(500), h = sha256(b);
  const path = await store.put(h, "pdf", b);
  assert.equal(path, `clem/${OWNER}/files/${h}.pdf`);
  assert.deepEqual(await store.read(path), b);
  assert.ok(vps.commands.some((c) => c.startsWith("sha256sum")), "the server hashes its copy");
  // The same bytes again: nothing is sent.
  const puts = vps.files.size; await store.put(h, "pdf", b); assert.equal(vps.files.size, puts);
  // A damaged upload never takes the file's name.
  const c = bytesOf(300, 2); vps.corrupt = (p) => p.includes(".part-");
  await assert.rejects(store.put(sha256(c), "bin", c), ChecksumError);
  assert.ok(![...vps.files.keys()].some((k) => k.includes(sha256(c))), "no partial or damaged file is left");
  // A copy damaged on the server is refused on the way out.
  vps.files.get(path)![0] ^= 1;
  await assert.rejects(store.read(path), ChecksumError);
  // Bytes that don't match the hash they claim are refused before sending.
  await assert.rejects(store.put("0".repeat(64), "pdf", b), ChecksumError);
});

test("the router: device mode stays local; VPS mode writes there, caches recent files under the cap, keeps pins", async () => {
  const t = await setup({ cap: 2500 });
  await t.router.writeFile("a", bytesOf(1000, 1));
  assert.equal((await t.router.row("a")), undefined, "device mode: no VPS row");
  assert.equal(t.vps.files.size, 0);
  t.setMode("vps");
  for (const id of ["b", "c", "d"]) await t.router.writeFile(id, bytesOf(1000, id.charCodeAt(0)));
  for (const id of ["b", "c", "d"]) assert.equal((await t.router.row(id))?.location, "vps");
  await until(async () => !(await t.local.has("b")));
  assert.ok(await t.local.has("a"), "a file only on this device is never evicted");
  assert.ok(await t.local.has("c") && await t.local.has("d"), "the newest stay cached");
  // Reading an evicted file brings it back from the VPS (and evicts the oldest).
  assert.deepEqual(await t.router.readFile("b"), bytesOf(1000, "b".charCodeAt(0)));
  assert.ok(await t.local.has("b"));
  await until(async () => !(await t.local.has("c")));
  // A pinned file is never evicted, whatever the cap.
  await t.router.pin("c", true);
  assert.ok(await t.local.has("c"));
  for (const id of ["e", "f", "g"]) await t.router.writeFile(id, bytesOf(1000, id.charCodeAt(0)));
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(await t.local.has("c"), "pinned stays");
  assert.deepEqual(await t.router.pinned(), ["c"]);
  const u = await t.router.usage();
  assert.equal(u.mode, "vps"); assert.equal(u.files.vps, 6); assert.ok(u.cache <= 2500 + 1000, "cache within its cap plus the pinned file");
  // The VPS gone: a cached file still reads; one that isn't cached says so plainly.
  t.vps.offline = true;
  assert.ok(await t.router.readFile("c"));
  const missing = ["b", "d", "e", "f", "g"].find((id) => !t.local.files.has(id))!;
  await assert.rejects(t.router.readFile(missing), /isn't reachable/);
  // A write while it is gone stays on this device (the mover takes it later).
  await t.router.writeFile("h", bytesOf(10, 9));
  assert.equal(await t.router.row("h"), undefined);
  assert.ok(await t.local.has("h"));
  // Deleting removes the VPS copy once nothing uses it.
  t.vps.offline = false;
  const path = (await t.router.row("e"))!.path;
  await t.router.deleteFile("e");
  assert.ok(!t.vps.files.has(path));
  await t.backend.close();
});

test("the mover: interrupted mid-way, resumed (also after a restart), each file checked before the device lets go", async () => {
  const t = await setup({ cap: 1_000_000 });
  for (let i = 0; i < 6; i++) await t.local.write("f" + i, bytesOf(400 + i, i));
  const dir = await mkdtemp(join(tmpdir(), "clem-vps-")), device = new DeviceStore(dir);
  // A saved CMS file kept on this device moves too.
  const g = bytesOf(700, 42), gPath = await device.put(sha256(g), "pdf", g);
  await t.db.query("insert into file_objects (owner_id, file_id, location, path, sha256, size) values ($1, 'guc:m1', 'device', $2, $3, $4)", [OWNER, gPath, sha256(g), g.length]);
  try {
    t.setMode("vps");
    t.vps.dropAfter = 2;
    let m = new Migrator({ db: t.db, owner: OWNER, router: t.router, local: t.local, remote: () => (t.vps.offline ? undefined : t.store), device });
    await m.start("up"); await m.wait();
    let v = (await m.view())!;
    assert.equal(v.status, "paused"); assert.equal(v.done, 2); assert.equal(v.total, 7);
    // While paused, every file still reads where its row points.
    for (let i = 0; i < 6; i++) assert.deepEqual(await t.router.readFile("f" + i), bytesOf(400 + i, i));
    // "Restart": a new mover over the same database carries on.
    t.vps.offline = false; t.vps.dropAfter = undefined;
    m = new Migrator({ db: t.db, owner: OWNER, router: t.router, local: t.local, remote: () => t.store, device });
    await m.resume(); await m.wait();
    v = (await m.view())!;
    assert.equal(v.status, "done"); assert.equal(v.done, 7); assert.equal(v.failed, 0);
    for (let i = 0; i < 6; i++) assert.equal((await t.router.row("f" + i))?.location, "vps");
    const [gr] = await t.db.query<{ location: string; path: string }>("select location, path from file_objects where owner_id = $1 and file_id = 'guc:m1'", [OWNER]);
    assert.equal(gr.location, "vps"); assert.deepEqual(await t.store.read(gr.path), g);
    assert.deepEqual(await readdir(join(dir, "GUC")), [], "the device copy went only after the VPS copy was checked");

    // Move back: every file here again, checked, and gone from the VPS.
    m = new Migrator({ db: t.db, owner: OWNER, router: t.router, local: t.local, remote: () => t.store, device });
    t.setMode("device");
    for (let i = 0; i < 6; i++) await t.local.remove("f" + i);
    await m.start("down"); await m.wait();
    v = (await m.view())!;
    assert.equal(v.status, "done"); assert.equal(v.direction, "down");
    for (let i = 0; i < 6; i++) { assert.deepEqual(await t.local.read("f" + i), bytesOf(400 + i, i)); assert.equal(await t.router.row("f" + i), undefined); }
    assert.equal(t.vps.files.size, 0, "nothing left on the VPS");
    const [back] = await t.db.query<{ location: string; path: string }>("select location, path from file_objects where owner_id = $1 and file_id = 'guc:m1'", [OWNER]);
    assert.equal(back.location, "device"); assert.deepEqual(await device.read(back.path), g);
  } finally { await t.backend.close(); await rm(dir, { recursive: true, force: true }); }
});

test("the mover: a file whose VPS copy fails its checksum stays on the device; aborting leaves every row pointing at a real copy", async () => {
  const t = await setup();
  for (let i = 0; i < 4; i++) await t.local.write("f" + i, bytesOf(200, i));
  const bad = sha256(bytesOf(200, 2));
  t.vps.corrupt = (p) => p.includes(bad);
  t.setMode("vps");
  const m = new Migrator({ db: t.db, owner: OWNER, router: t.router, local: t.local, remote: () => t.store, device: new DeviceStore(tmpdir()) });
  await m.start("up"); await m.wait();
  const v = (await m.view())!;
  assert.equal(v.status, "failed"); assert.equal(v.failed, 1); assert.equal(v.done, 3);
  assert.match(v.error!, /safe on this device/);
  assert.equal(await t.router.row("f2"), undefined, "its row never moved");
  assert.deepEqual(await t.local.read("f2"), bytesOf(200, 2), "and its bytes are untouched");
  assert.ok(![...t.vps.files.keys()].some((k) => k.includes(bad)), "the damaged copy was removed");
  const [row] = await t.db.query<{ attempts: number; status: string }>("select attempts, status from migration_state where owner_id = $1 and item = 'ws:f2'", [OWNER]);
  assert.equal(row.status, "failed"); assert.equal(row.attempts, 3);

  // Abort in the middle of a move back: moved files are here, the rest still read from the VPS.
  t.vps.corrupt = () => false;
  for (let i = 0; i < 4; i++) if (i !== 2) await t.local.remove("f" + i);
  const back = new Migrator({ db: t.db, owner: OWNER, router: t.router, local: t.local, remote: () => t.store, device: new DeviceStore(tmpdir()) });
  await back.start("down");
  const aborted = (await back.abort())!;
  assert.equal(aborted.status, "aborted");
  for (let i = 0; i < 4; i++) assert.deepEqual(await t.router.readFile("f" + i), bytesOf(200, i), `f${i} still reads after the abort`);
  await t.backend.close();
});

test("prefetch: the same space's files from the same week, and the files a chat refers to", () => {
  const day = 86_400_000, files = [
    { id: "a", spaceId: "s1", created: 10 * day }, { id: "b", spaceId: "s1", created: 11 * day }, { id: "c", spaceId: "s1", created: 30 * day },
    { id: "d", spaceId: "s2", created: 10 * day }, { id: "e", spaceId: "s1", created: 9 * day },
  ];
  assert.deepEqual(likelyNext(files, "a"), ["b", "e"]);
  assert.deepEqual(likelyNext(files, "zzz"), []);
  assert.deepEqual(chatFiles([{ attachments: ["x"] }, { context: ["y"], pointers: [{ fileId: "z" }] }]), ["y", "z", "x"]);
});
