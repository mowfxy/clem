// When the VPS is full (docs/GUC-VPS-ENGINE.md "Storage limit"): Clem says so once in the main thread, with what
// waits, and asks once; "yes" is the standing answer (CMS files the worker skipped are fetched by the PC itself), "no"
// leaves them and is never asked again; either changes by saying so. Deleting in the app deletes on the VPS and the
// reverse, after a reconnect too, exactly once; freed room counts at once. Where a file is kept is the person's word.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyPull } from "../core/workspace/ops.ts";
import { sha256 } from "../desktop/engine/storage.ts";
import { WorkerClient } from "../desktop/engine/vps/rpc.ts";
import { baseDesk, startPair } from "./vps-pair.ts";
import { FULL_TEXT } from "../desktop/engine/vps/full.ts";

const KB = 1024;
const req = (o: object) => JSON.stringify({ kinetra: o });
const mainOf = (s: any) => s.chats.find((c: any) => c.kind === "main");

test("the VPS full: told once, plainly, nothing asked; the PC fetches the CMS files the worker skipped by itself; copies off isn't full", { timeout: 120_000 }, async () => {
  const p = await startPair({
    disk: async () => ({ total: 1000 * KB, free: 150 * KB }), // 85% full: past the 82% limit
    complete: async ({ user }) => (/Tool exchanges/.test(user) ? "Three CMS files weren't copied to your VPS; your PC keeps everything." : req({ action: "vps.waiting" })),
  });
  try {
    await p.m.pushWorkspace(true, baseDesk());
    // Files left off the VPS because copies are off are not the VPS being full.
    await p.worker.waiting.add("pc:m0", "Sheet 0.pdf", 10, "Kept on your PC: copies on your VPS are off.");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(mainOf(await p.worker.ws.state()).messages.filter((m: any) => /Your VPS is full/.test(m.content)).length, 0);
    await p.worker.waiting.clear(["pc:m0"]);
    // A CMS file the worker couldn't keep at the limit: told once, however many follow.
    const pdf = new TextEncoder().encode("%PDF-1.4 lecture 5");
    (p.worker.engine as any).fileBytes = async (id: string) => ({ id, name: "Lecture 5.pdf", type: "application/pdf", size: pdf.length, stored: false, data: Buffer.from(pdf).toString("base64") });
    await p.worker.waiting.add("cms:m5", "Lecture 5.pdf", pdf.length, "A CMS file wasn't kept on your VPS because it's at Clem's storage limit.");
    await p.worker.waiting.add("cms:m6", "Lecture 6.pdf", pdf.length, "A CMS file wasn't kept on your VPS because it's at Clem's storage limit.");
    await new Promise((r) => setTimeout(r, 300));
    const told = mainOf(await p.worker.ws.state()).messages.filter((m: any) => /Your VPS is full/.test(m.content));
    assert.equal(told.length, 1, "said once");
    assert.equal(told[0].content, FULL_TEXT);
    assert.match(told[0].content, /New files stay on your PC only/);
    assert.ok(!/\?/.test(told[0].content) && !/```clem-card|button/i.test(told[0].content), "a plain message, nothing asked");
    // "yes" or "no" is just a message now: nothing is waiting for an answer.
    const yes = await p.worker.host.converse!({ id: "1", text: "what isn't on my VPS?" });
    assert.match(yes.text, /PC keeps everything/);
    // The PC fetches the skipped CMS files itself, with no question (it keeps everything).
    await p.m.heartbeat();
    for (let i = 0; i < 40 && !(await p.db.query("select 1 from file_objects where file_id = 'guc:m5'")).length; i++) await new Promise((r) => setTimeout(r, 50));
    const [row] = await p.db.query<{ path: string; sha256: string }>("select path, sha256 from file_objects where file_id = 'guc:m5' and location = 'device'");
    assert.ok(row, "the PC keeps the CMS file");
    assert.equal(sha256(new Uint8Array(await readFile(row.path))), sha256(pdf));
    assert.ok(!(await p.worker.waiting.items()).some((i) => i.item === "cms:m5"), "it waits no more");
  } finally { await p.stop(); }
});
test("deleting in the app deletes on the VPS, after a reconnect too, once, never bytes re-added since; freed room counts at once", { timeout: 120_000 }, async () => {
  const p = await startPair({ complete: async () => "Okay." });
  try {
    const kept = p.kept.get("vps-owner-1") as any; kept.storage = { mode: "vps" };
    await p.m.ready();
    const r = await p.m.router();
    const a = new TextEncoder().encode("lecture A"), b = new TextEncoder().encode("lecture B");
    await r.writeFile("fa", a); await r.idle(); await r.writeFile("fb", b); await r.idle();
    const pa = (await r.row("fa"))!.path, pb = (await r.row("fb"))!.path;
    const onWorker = (path: string) => stat(join(p.files, path.split("/").pop()!)).then(() => true, () => false);
    assert.ok(await onWorker(pa) && await onWorker(pb), "both are on the VPS");
    // Online: deleted here, gone there at once.
    await r.deleteFile("fa");
    assert.ok(!(await onWorker(pa)), "its bytes on the VPS are gone");
    assert.equal(await r.row("fa"), undefined, "its row too");
    // Offline: remembered, applied when the VPS is back, once.
    p.link.offline = true;
    await r.deleteFile("fb");
    assert.ok(await onWorker(pb), "out of reach: still there");
    p.link.offline = false;
    assert.equal(await r.sweepDeletes(), 1);
    assert.ok(!(await onWorker(pb)), "applied on reconnect");
    assert.equal(await r.sweepDeletes(), 0, "exactly once");
    // Deleted offline, then the same bytes re-added (the worker made the same file): never removed.
    const c = new TextEncoder().encode("lecture C");
    await r.writeFile("fc", c); await r.idle();
    const pc = (await r.row("fc"))!.path;
    p.link.offline = true; await r.deleteFile("fc"); p.link.offline = false;
    await r.writeFile("fc2", c); await r.idle();
    await r.sweepDeletes();
    assert.ok(await onWorker(pc), "re-added since: kept");
  } finally { await p.stop(); }
});

test("on Telegram a file is kept on the PC by the person's word; deleting stays in the app", { timeout: 120_000 }, async () => {
  const p = await startPair({
    complete: async ({ user }) => {
      if (/Tool exchanges/.test(user)) return "Done.";
      if (/\[From Telegram\] delete/.test(user)) return req({ action: "ws.delete", file: "Old notes.md" });
      if (/\[From Telegram\] keep/.test(user)) return req({ action: "vps.keep", file: "Keep me.md", where: "pc" });
      return "Okay.";
    },
  });
  try {
    const kept = p.kept.get("vps-owner-1") as any; kept.storage = { mode: "vps" };
    await p.m.ready();
    const r = await p.m.router();
    const old = new TextEncoder().encode("old notes"), keep = new TextEncoder().encode("keep me");
    await r.writeFile("old", old); await r.idle(); await r.writeFile("keep", keep); await r.idle();
    const pathOld = (await r.row("old"))!.path;
    let desk = baseDesk({ files: [{ id: "old", name: "Old notes.md", size: old.length, type: "text/markdown", created: 1, spaceId: "math" }, { id: "keep", name: "Keep me.md", size: keep.length, type: "text/markdown", created: 1, spaceId: "math" }] });
    await p.m.pushWorkspace(true, desk);
    await p.worker.host.converse!({ id: "1", text: "delete my old notes" });
    assert.ok(await stat(join(p.files, pathOld.split("/").pop()!)).then(() => true, () => false), "Telegram has no file deleting: the file stays");
    await p.worker.host.converse!({ id: "2", text: "keep Keep me on my PC" });
    // The PC syncs: the person's word on where the file lives is carried out here, once.
    desk = applyPull(desk, (await p.m.pullOps(desk.vpsSync))!);
    assert.ok(desk.files.some((f: any) => f.id === "old"));
    for (let i = 0; i < 40 && (await r.row("keep")); i++) await new Promise((res) => setTimeout(res, 50));
    assert.equal(await r.row("keep"), undefined, "kept on the PC only");
    assert.deepEqual(await p.local.read("keep"), keep);
    assert.equal(await r.keepOf("keep"), "pc");
    await r.writeFile("keep", keep); await r.idle();
    assert.equal(await r.row("keep"), undefined, "a later write stays on the PC: the person's word holds");
    assert.equal((await p.m.pullOps(desk.vpsSync))!.ops.length, 0, "applied once");
  } finally { await p.stop(); }
});

test("the worker's guide and the window's both carry the rule that the AI comes first", async () => {
  const worker = await readFile("desktop/engine/vps/agent.ts", "utf8");
  const { telegramGuide } = await import("../core/telegram/thread.ts"), { AI_FIRST } = await import("../core/main-thread/context.ts");
  assert.match(worker, /telegramTurn\(/);
  assert.ok(telegramGuide().includes(AI_FIRST));
  void writeFile;
});
