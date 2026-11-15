// Sending existing files to Telegram (owner, 2026-11-15): the main thread, in the app and on Telegram, sends the
// person's files in Clem and CMS files with one tool, telegram.sendFile (desktop/engine/thread-tools.ts sendFileTool):
// from the app's main thread on the laptop, from Telegram with the laptop on, and from Telegram with the laptop off (the
// worker fetches a CMS file from CMS and a Clem file from the VPS store). A file only on the PC while it is off is said
// in one plain sentence and sent by the PC itself when it is next online. Sending only; Telegram's 50 MB holds.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TG_FILE_LIMIT } from "../core/telegram/pairing.ts";
import { Engine } from "../desktop/engine/index.ts";
import { DeviceStore, sha256 } from "../desktop/engine/storage.ts";
import { DiskLimit, LimitedStore } from "../desktop/engine/vps/limit.ts";
import { runThreadTool, sendFileTool } from "../desktop/engine/thread-tools.ts";
import { PENDING_SENDS, WorkerAgent } from "../desktop/engine/vps/agent.ts";
import type { WorkerWorkspace } from "../desktop/engine/vps/workspace.ts";
import { fakeGuc, host, noWait, site } from "./guc-fake.ts";
import { account, fakeTelegram, hook, msg, workerEnv } from "./telegram-fake.ts";
import { baseDesk, startPair } from "./vps-pair.ts";

const U = (f: string) => "https://cms.guc.edu.eg/Uploads/1201/64/" + f;
const pdf = (s: string) => new TextEncoder().encode("%PDF-1.4 " + s);

/** An engine (the laptop's, or the worker's with its VPS store) with GUC and a paired Telegram, all fake. */
async function engineWith(kind: "laptop" | "worker") {
  const dir = await mkdtemp(join(tmpdir(), "clem-send-"));
  const guc = fakeGuc(site(), { etags: true, files: { [U("lecture-1.pdf")]: pdf("lecture one"), [U("lecture-3.pdf")]: pdf("lecture three") } });
  const env = workerEnv(), tg = fakeTelegram();
  const h = Object.assign(host({ files: join(dir, "Files") }), { account: account(env, tg, "owner-1") });
  const store = kind === "worker" ? new LimitedStore({ inner: new DeviceStore(join(dir, "files"), { location: "vps", sub: "" }), limit: new DiskLimit({ measure: async () => ({ total: 1e9, free: 9e8 }) }), root: join(dir, "files") }) : undefined;
  if (store) { h.fileStore = () => store; h.fileStores = () => ({ vps: store }); }
  const engine = await Engine.open("owner-1", h, { http: guc.http, sleep: noWait, memory: true, jobs: false, ...(store ? { store } : {}) });
  await engine.connect("student.name", "secret"); await engine.link("subj-1", "1201:64");
  const p = await engine.telegram.pair(); await hook(env, tg, msg(42, p.code)); await engine.telegram.status(true);
  const documents = () => tg.calls.filter((c) => c.method === "sendDocument").map((c) => /filename="([^"]+)"/.exec(c.body.multipart)?.[1]);
  return { engine, guc, tg, dir, documents, close: async () => { await engine.close(); await rm(dir, { recursive: true, force: true }).catch(() => {}); } };
}

test("from the laptop (the app's main thread, or Telegram with the laptop on): a file in Clem, a CMS file, the 50 MB limit", { timeout: 60_000 }, async () => {
  const L = await engineWith("laptop");
  try {
    const own: Record<string, Uint8Array> = { "Math notes.pdf": pdf("my notes") };
    // As desktop/main.ts threadCtx reads them: this PC's files by name, their bytes from its store.
    const ctx = { engine: L.engine, owner: "owner-1", subjects: [{ id: "subj-1", name: "Circuits" }], workspaceFile: async (name: string) => {
      const hit = Object.keys(own).find((n) => n.toLowerCase().includes(name.toLowerCase()));
      return hit ? { name: hit, type: "application/pdf", bytes: own[hit] } : null;
    } };
    assert.match(String(await sendFileTool(ctx, { action: "telegram.sendFile", file: "Math notes" })), /^Sent Math notes\.pdf/);
    assert.match(String(await runThreadTool(ctx, { action: "telegram.sendFile", file: "lecture 3", subject: "Circuits" })), /^Sent /, "a CMS file, fetched from CMS");
    assert.ok(L.guc.log.some((r) => r.url === U("lecture-3.pdf")), "fetched from the CMS");
    assert.deepEqual(L.documents().length, 2);
    // Over 50 MB: never uploaded.
    own["Recording.mp4"] = new Uint8Array(TG_FILE_LIMIT + 1);
    assert.match(String(await sendFileTool(ctx, { action: "telegram.sendFile", file: "Recording" })), /over Telegram's 50 MB/);
    assert.equal(L.documents().length, 2);
    assert.match(JSON.stringify(await sendFileTool(ctx, { action: "telegram.sendFile", file: "nothing like this" })), /No file called/);
  } finally { await L.close(); }
  // The app's main thread and Telegram's both reach the same tool.
  const main = await readFile("desktop/main.ts", "utf8");
  assert.match(main, /if \(tool\?\.action === "telegram\.sendFile"\) return sendFileTool\(await threadCtx\(user\.id, await engineFor\(user\.id\)\), tool\);/);
  assert.match(main, /if \(request\.action === "tgTool"\) return runThreadTool\(await threadCtx\(user\.id, engine\), request\.tool\);/);
});

test("from Telegram with the laptop off: the worker fetches a CMS file from CMS and sends a Clem file from the VPS store; one only on the PC waits for it", { timeout: 60_000 }, async () => {
  const W = await engineWith("worker");
  const files = join(W.dir, "files");
  try {
    const notes = pdf("notes on the VPS"), hash = sha256(notes);
    await mkdir(files, { recursive: true }); await writeFile(join(files, hash + ".pdf"), notes);
    let state: any = baseDesk({ spaces: [{ id: "subj-1", name: "Circuits", kind: "subject", description: "", memory: "", sources: [] }], files: [
      { id: "f1", name: "Math notes.pdf", size: notes.length, type: "application/pdf", created: 1, spaceId: "math", blob: { sha256: hash, ext: "pdf", size: notes.length } },
      { id: "f2", name: "Essay draft.docx", size: 10, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", created: 1, spaceId: "math" },
    ] });
    const ws = { state: async () => state, change: async (fn: (s: any) => any) => { state = fn(state); return { state, ops: [] }; }, ready: async () => true, drain: async () => {} } as unknown as WorkerWorkspace;
    const kept = new Map<string, unknown>();
    const workerState = { get: async (k: string) => kept.get(k), set: async (k: string, v: unknown) => { kept.set(k, v); }, take: async () => undefined, delete: async () => {} } as any;
    const asks: Record<string, string> = { "my Math notes": "Math notes", "lecture 3": "lecture 3", "my essay draft": "Essay draft" };
    const complete = async ({ user }: { system: string; user: string }) => {
      const q = [...user.matchAll(/\[From Telegram\] send me (.+)/g)].at(-1)![1];
      if (!/Tool exchanges/.test(user)) return JSON.stringify({ kinetra: { action: "telegram.sendFile", file: asks[q], subject: "Circuits" } });
      return /only on their PC/.test(user) ? "Your essay draft is only on your PC; it'll come here as soon as the PC is on." : /Sent /.test(user) ? "Sent." : "Couldn't.";
    };
    const agent = new WorkerAgent({ owner: "owner-1", complete, engine: () => W.engine, ws, files, state: workerState });
    assert.equal((await agent.converse({ id: "m1", text: "send me my Math notes" })).text, "Sent.");
    assert.equal((await agent.converse({ id: "m2", text: "send me lecture 3" })).text, "Sent.");
    assert.ok(W.guc.log.some((r) => r.url === U("lecture-3.pdf")), "the CMS file came from CMS");
    assert.ok(W.tg.calls.filter((c) => c.method === "sendDocument").some((c) => c.body.multipart.includes("Math notes.pdf")), "the Clem file, from the VPS store");
    assert.equal(W.documents().length, 2);
    const later = await agent.converse({ id: "m3", text: "send me my essay draft" });
    assert.match(later.text, /only on your PC/);
    assert.equal(W.documents().length, 2, "nothing sent yet");
    assert.deepEqual((kept.get(PENDING_SENDS) as any[]).map((x) => [x.id, x.name]), [["f2", "Essay draft.docx"]], "kept for the PC");
  } finally { await W.close(); }
});

test("a file kept for the PC goes to Telegram by itself when the PC is next online, once", { timeout: 120_000 }, async () => {
  const sent: string[] = [];
  const p = await startPair({ complete: async () => "Okay.", manager: { sendToTelegram: async (id) => { sent.push(id); return "sent"; } } });
  try {
    await p.m.pushWorkspace(true, baseDesk());
    await p.worker.state.set(PENDING_SENDS, [{ id: "f2", name: "Essay draft.docx", at: 1 }, { id: "gone", name: "Old.pdf", at: 1 }]);
    await p.m.heartbeat();
    for (let i = 0; i < 40 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(sent, ["f2", "gone"], "the PC sends what waited for it");
    assert.deepEqual(await p.worker.state.get(PENDING_SENDS), [], "cleared on the worker");
    await p.m.heartbeat();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(sent.length, 2, "once");
  } finally { await p.stop(); }
});
