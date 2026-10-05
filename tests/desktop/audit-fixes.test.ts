import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer, WORN_BYTES } from "../../desktop/app-server.ts";
import { Codex, LOGOUT_MS } from "../../desktop/codex.ts";
import { streamTurn, THREAD_START_MS } from "../../desktop/codex-stream.ts";
import { CropAssets, memoryIo, temporaryStores } from "../../desktop/pdf-assets.ts";
import { stoppedRuns } from "../../desktop/inflight.ts";
import { viewCopyName, markFromInternet } from "../../desktop/documents.ts";
import { indexFolder, sameIndex, type IndexedFile } from "../../desktop/folders.ts";
import { FolderWatcher } from "../../desktop/folder-watch.ts";
import { WorkspaceDisk } from "../../desktop/workspace-disk.ts";
import { GrokProvider } from "../../desktop/grok.ts";

function child() {
  const p: any = new EventEmitter();
  p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new PassThrough();
  p.killed = 0;
  p.kill = () => { p.killed++; return true; };
  return p;
}
/** An app-server stand-in that answers initialize, then whatever `answer` returns for each request. */
function appServer(answer: (method: string) => unknown = () => ({})) {
  const p = child();
  p.stdin.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      const m = JSON.parse(line);
      if (m.id === undefined) continue;
      const result = m.method === "initialize" ? {} : answer(m.method);
      if (result !== undefined) p.stdout.write(JSON.stringify({ id: m.id, result }) + "\n");
    }
  });
  return p;
}

test("a Codex connection past its byte limit keeps serving the answers on it and is only marked worn", async () => {
  const p = appServer();
  const server = new AppServer(p);
  await server.ready;
  const failed: Error[] = [];
  server.subscribe("t1", { onMessage: () => {}, onFail: (e) => failed.push(e) });
  const chunk = JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "t1", itemId: "i", delta: "x".repeat(1_000_000) } }) + "\n";
  for (let sent = 0; sent <= WORN_BYTES; sent += chunk.length) p.stdout.write(chunk);
  await new Promise((r) => setImmediate(r));
  assert.equal(server.worn, true);
  assert.equal(server.dead, false);
  assert.equal(p.killed, 0);
  assert.deepEqual(failed, []);
});

test("a worn Codex connection is replaced before a new answer only when nothing is using it", () => {
  const codex: any = new Codex("fixture", "fixture", "fixture");
  let closed = 0;
  const worn = { worn: true, idle: true, dead: false, close() { closed++; } };
  codex.server = worn;
  codex.turns.set("other", { cancelled: false });
  codex.retireWorn();
  assert.equal(closed, 0, "another answer is still on it");
  codex.turns.clear();
  codex.quicks = 1;
  codex.retireWorn();
  assert.equal(closed, 0, "a memory note is still on it");
  codex.quicks = 0;
  codex.retireWorn();
  assert.equal(closed, 1);
  assert.equal(codex.server, null);
});

test("opening a Codex thread that never answers fails after its time limit instead of waiting forever", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const server = new AppServer(appServer((method) => (method === "thread/start" ? undefined : {})));
  await server.ready;
  const turn = streamTurn(server, {}, "hi", undefined, [], () => {}, () => false);
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(THREAD_START_MS);
  await assert.rejects(turn, /in time/);
});

test("a Codex sign-out that hangs is ended after its limit, so the account queue is not held", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const codex: any = new Codex("fixture", "fixture", "fixture");
  const p = child();
  p.kill = () => { p.killed++; p.emit("close", null); return true; };
  codex.start = async () => p;
  const out = codex.logout();
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(LOGOUT_MS);
  await assert.rejects(out, /timed out/);
  assert.equal(p.killed, 1);
});

test("crop ids carry 64 random bits; ids made before (32 bits) still resolve", async () => {
  const store = new Map<string, Uint8Array>();
  const crops = new CropAssets(memoryIo(store), "chat1");
  const meta = { file: "a.pdf", page: 1, box: [0, 0, 10, 10] as [number, number, number, number], units: "pt" as const, width: 10, height: 10, dpi: 72 };
  const a = await crops.add(meta, new Uint8Array([1]));
  assert.match(a.id, /^crop-[a-f0-9]{16}$/);
  store.set("assets-chat2", new TextEncoder().encode(JSON.stringify([{ ...meta, id: "crop-0000aaaa", vector: false, created: 0 }])));
  store.set("crop-0000aaaa-png", new Uint8Array([2]));
  assert.equal((await new CropAssets(memoryIo(store), "chat2").get("crop-0000aaaa"))?.meta.id, "crop-0000aaaa");
});

test("temporary chats keep crops only for the few most recent chats, and a dropped one is freed", () => {
  const stores = temporaryStores(2);
  stores.store("a").set("k", new Uint8Array(1));
  stores.store("b");
  assert.equal(stores.store("a").size, 1, "using a chat keeps it recent");
  stores.store("c");
  assert.equal(stores.size, 2);
  assert.equal(stores.store("b").size, 0, "the least recent chat was let go");
  stores.drop("b");
  assert.equal(stores.size, 1);
});

test("a Stop counts only for a running answer, and nothing is kept once answers end", () => {
  const runs = stoppedRuns();
  assert.equal(runs.add("late"), false, "a Stop after the answer ended is ignored");
  assert.equal(runs.has("late"), false);
  runs.start("a");
  assert.equal(runs.add("a"), true);
  assert.equal(runs.has("a"), true);
  runs.end("a");
  runs.start("b");
  runs.end("b"); // failed before its answer started
  assert.equal(runs.has("a"), false);
  assert.equal(runs.size, 0);
});

test("legacy Office and RTF files, which can carry macros or OLE objects, are never handed to Windows to open", () => {
  for (const name of ["old.doc", "book.xls", "deck.ppt", "letter.rtf", "LETTER.RTF"]) assert.equal(viewCopyName(name), null, name);
  for (const name of ["notes.docx", "book.xlsx", "deck.pptx", "text.odt"]) assert.equal(viewCopyName(name), name);
});

test("a copy opened from the workspace is marked as from the internet where the drive allows it", { skip: process.platform !== "win32" }, async () => {
  const path = join(mkdtempSync(join(tmpdir(), "mowr-motw-")), "notes.docx");
  writeFileSync(path, "x");
  await markFromInternet(path);
  assert.match(readFileSync(path + ":Zone.Identifier", "utf8"), /\[ZoneTransfer\]\r\nZoneId=3/);
  await markFromInternet(join(tmpdir(), "missing-folder-" + Date.now(), "x.pdf")); // never throws
});

test("an ignore file that cannot be read leaves the folder indexed without it", async () => {
  const root = mkdtempSync(join(tmpdir(), "mowr-ignore-"));
  mkdirSync(join(root, ".gitignore")); // reading it fails (EISDIR), as a locked or protected file would
  writeFileSync(join(root, "a.md"), "alpha");
  const files = await indexFolder({ id: "f", scope: "chat:x", path: root }, []);
  assert.deepEqual(files.map((f) => f.path), ["a.md"]);
  assert.equal(sameIndex(files, files.map((f) => ({ ...f }))), true);
  assert.equal(sameIndex(files, [{ ...files[0], hash: "other" }]), false);
  assert.equal(sameIndex(files, []), false);
});

test("a watched folder's index is reused while no change is waiting to be read", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const file = (hash: string): IndexedFile => ({ path: "a.md", hash, mtime: 0, size: 1, text: "" });
  let disk = [file("1")], walks = 0;
  const fake = new EventEmitter() as EventEmitter & { close(): void };
  fake.close = () => {};
  let listener: (event: string, name: string | null) => void = () => {};
  const watcher = new FolderWatcher(async () => { walks++; return disk; }, () => {}, (_p, l) => { listener = l; return fake as never; });
  watcher.sync([{ id: "f", scope: "chat:x", path: "C:/Notes" }]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(watcher.settled("f", "C:/Notes"), disk);
  assert.equal(watcher.settled("f", "C:/Elsewhere"), undefined);
  disk = [file("2")];
  listener("change", "a.md");
  assert.equal(watcher.settled("f", "C:/Notes"), undefined, "a change is waiting");
  t.mock.timers.tick(1500);
  await watcher.check("f");
  assert.deepEqual(watcher.settled("f", "C:/Notes"), [file("2")]);
  assert.ok(walks >= 2);
  watcher.stop();
});

test("the workspace says whether a file is there without reading it", async () => {
  const disk = new WorkspaceDisk(mkdtempSync(join(tmpdir(), "mowr-disk-")));
  assert.equal(await disk.hasFile("owner", "spec-x"), false);
  await disk.writeFile("owner", "spec-x", new Uint8Array([1]));
  assert.equal(await disk.hasFile("owner", "spec-x"), true);
});

test("signing in to Grok again replaces the sign-in already waiting", async () => {
  const grok: any = new GrokProvider(mkdtempSync(join(tmpdir(), "mowr-grok-")), "fixture");
  const started: any[] = [];
  grok.start = async () => { const p = child(); started.push(p); return p; };
  await grok.login(() => {});
  await grok.login(() => {});
  started[0].emit("close", null);
  assert.equal(started.length, 2);
  assert.equal(started[0].killed, 1);
  assert.equal(started[1].killed, 0);
  grok.stop();
  assert.equal(started[1].killed, 1, "quitting ends a waiting sign-in");
  started[1].emit("close", null);
});
