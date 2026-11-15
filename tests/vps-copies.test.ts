// Files live on both (owner, 2026-11-15): this PC keeps every file; "Keep a copy of my files on the VPS" (on by default
// with the one switch) copies them there too, quietly, under the 82% limit. Off removes the VPS copies only once the PC
// holds each, and the worker then keeps no file at all. Older installs' files only on the VPS come back to the PC.
// The person can say it in words, in the app and on Telegram (with the PC off it is done when the PC is next on).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openPglite } from "../desktop/engine/db.ts";
import { DeviceStore, sha256 } from "../desktop/engine/storage.ts";
import { DiskLimit, LimitedStore, Waiting } from "../desktop/engine/vps/limit.ts";
import { runThreadTool } from "../desktop/engine/thread-tools.ts";
import { baseDesk, startPair } from "./vps-pair.ts";
import { bytesOf } from "./vps-fake.ts";

const req = (o: object) => JSON.stringify({ kinetra: o });
const until = async (check: () => Promise<boolean>, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 30))) if (await check()) return; throw Error("timed out"); };

test("copies on and off: the PC keeps everything; off removes the VPS copies only once the PC holds each; the switch turns them on unless the person said off", { timeout: 120_000 }, async () => {
  const p = await startPair({ complete: async () => "Okay." });
  try {
    const r = await p.m.router();
    await p.m.setCopies(true);
    for (const id of ["a", "b", "c"]) await r.writeFile(id, bytesOf(500, id.charCodeAt(0)));
    await r.idle();
    for (const id of ["a", "b", "c"]) { assert.equal((await r.row(id))?.location, "vps"); assert.ok(await p.local.has(id)); }
    assert.equal((await p.stored()).length, 3, "a copy of each on the VPS");
    // Copies off, by the person: every VPS copy goes, each only once this PC holds the file.
    await p.local.remove("b"); // lost here somehow: brought back before its VPS copy goes
    await p.m.setCopies(false);
    await until(async () => (await p.stored()).length === 0);
    for (const id of ["a", "b", "c"]) { assert.deepEqual(await p.local.read(id), bytesOf(500, id.charCodeAt(0))); assert.equal(await r.row(id), undefined); }
    assert.equal((await p.m.vault()).storage?.off, true, "remembered");
    // New files stay here only.
    await r.writeFile("d", bytesOf(300, 4)); await r.idle();
    assert.equal(await r.row("d"), undefined);
    // The switch's own on leaves copies off when the person said off; their word turns them on again.
    await p.m.setCopies(false, { person: false });
    assert.equal((await p.m.vault()).storage?.off, true, "the switch going off doesn't change the person's choice");
    await p.m.setCopies(true);
    assert.equal((await p.m.vault()).storage?.off, undefined);
    await until(async () => (await p.stored()).length === 4);
    assert.ok(await p.m.copies());
  } finally { await p.stop(); }
});

test("an older install: files only on the VPS come back to the PC quietly, and Forget waits for them; nothing is deleted from its only place", { timeout: 120_000 }, async () => {
  const p = await startPair({ complete: async () => "Okay." });
  try {
    const r = await p.m.router(), store = p.m.vpsStore()!;
    const only = bytesOf(800, 9), path = await store.put(sha256(only), "blob", only);
    await r.markVps("old", path, sha256(only), only.length, false);
    assert.equal(await p.m.vpsOnly(), 1);
    await assert.rejects(p.m.forget(), /still only on your VPS/);
    await until(async () => (await p.local.read("old")) !== null);
    assert.deepEqual(await p.local.read("old"), only, "copied back to the PC");
    assert.ok((await p.stored()).some((n) => n.startsWith(sha256(only))), "and still on the VPS (it is a copy now)");
    assert.equal(await p.m.vpsOnly(), 0);
  } finally { await p.stop(); }
});

test("with copies off the worker keeps no file: a CMS file stays on the CMS and the PC saves it itself; the VPS isn't 'full'", async () => {
  const { backend, db } = await openPglite();
  await migrate(backend, "desktop/engine/migrations");
  const root = await mkdtemp(join(tmpdir(), "clem-copies-"));
  try {
    let on = false;
    const waiting = new Waiting(db, "owner-1");
    const store = new LimitedStore({ inner: new DeviceStore(root, { location: "vps", sub: "" }), limit: new DiskLimit({ measure: async () => ({ total: 1e9, free: 9e8 }) }), root, waiting, off: () => !on });
    const b = bytesOf(1000, 3);
    await assert.rejects(store.put(sha256(b), "pdf", b, { item: "cms:m9", name: "Lecture 9.pdf" }), /copies on your VPS are off/i);
    assert.deepEqual((await waiting.items()).map((i) => i.item), ["pc:m9"], "the PC saves it when it is on");
    assert.deepEqual(await waiting.sentences(), [], "not told as the VPS being full");
    on = true;
    assert.match(await store.put(sha256(b), "pdf", b, { item: "cms:m9", name: "Lecture 9.pdf" }), /\.pdf$/, "copies on: kept");
  } finally { await backend.close(); await rm(root, { recursive: true, force: true }); }
});

test("said in words: in the app it is done at once; on Telegram with the PC off it is done when the PC is next on", { timeout: 120_000 }, async () => {
  const p = await startPair({ complete: async ({ user }) => (/Tool exchanges/.test(user) ? "Okay, your VPS won't keep copies; your PC keeps everything." : req({ action: "vps.copies", on: false })) });
  try {
    await p.m.pushWorkspace(true, baseDesk());
    // Telegram with the PC off: a wish the worker keeps.
    const reply = await p.worker.host.converse!({ id: "1", text: "stop keeping my files on the VPS" });
    assert.match(reply.text, /won't keep copies/);
    assert.equal(await p.worker.state.get("copies-wish"), false);
    assert.ok(await p.m.copies(), "not yet: the PC holds the files");
    // The PC comes online: carried out, once.
    await p.m.heartbeat();
    await until(async () => !(await p.m.copies()));
    await until(async () => (await p.worker.state.get("copies-wish")) === undefined);
    // From the app's main thread (or Telegram with the PC on): the same tool, done at once.
    const done: boolean[] = [];
    const ctx = { engine: p.worker.engine, owner: "owner-1", subjects: [], vps: { run: async () => ({}), hold: async () => {}, waiting: async () => ({ items: [] }), keep: async () => ({}), copies: async (on: boolean) => { done.push(on); return { ok: true }; } } };
    assert.deepEqual(await runThreadTool(ctx, { action: "vps.copies", on: true }), { ok: true });
    assert.deepEqual(done, [true]);
    assert.match(((await runThreadTool(ctx, { action: "vps.copies" })) as { error: string }).error, /needs "on"/);
    const main = await readFile("desktop/main.ts", "utf8");
    assert.match(main, /tool\.action === "vps\.waiting" \|\| tool\.action === "vps\.copies"\) return runThreadTool/, "the app's main thread reaches the same tool");
    assert.match(main, /copies: async \(on: boolean\) => \{ await m\.setCopies\(on\)/);
  } finally { await p.stop(); }
});

test("the pop-up is one switch and one small option: no moves, no cache limit, no pins", async () => {
  const ui = await readFile("src/vps/VpsSettings.tsx", "utf8"), contracts = await readFile("desktop/contracts.ts", "utf8");
  assert.ok(!/Move everything|Move back|Keep on this PC|Pinned to this PC|vpsMove|vpsCap|vpsPin/.test(ui + contracts));
  assert.match(ui, /title="Keep a copy of my files on the VPS"/);
  assert.match(ui, /used on your VPS/);
  assert.equal((ui.match(/<Switch /g) || []).length, 3, "the switch, the option, and the setup's password toggle");
  const manager = await readFile("desktop/engine/vps/manager.ts", "utf8");
  assert.match(manager, /if \(!\(await this\.vault\(\)\)\.storage\?\.off\) await this\.setCopies\(true, \{ person: false \}\)/, "the switch turns copies on");
});
