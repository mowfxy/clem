// The workspace in two places (docs/GUC-VPS-ENGINE.md "Workspace on the VPS"): per-item operations, the newer write
// winning, messages never dropped, deletions as tombstones; the worker's durable copy and its organizer drain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, applyPull, diffOps, leanState, mergePushed, type WsBatch, type WsOp } from "../core/workspace/ops.ts";
import { commitPlanBlock, addStudySet, putMessage } from "../core/workspace/apply.ts";
import { readPlanBlock } from "../core/plans.ts";
import { migrate, openPglite } from "../desktop/engine/db.ts";
import { WorkerWorkspace } from "../desktop/engine/vps/workspace.ts";

const base = () => ({
  name: "Sam", memory: "", automations: [], files: [], studySets: [], plans: [] as any[],
  spaces: [{ id: "math", name: "Math", kind: "subject" as const, description: "MATH 301", memory: "", sources: [] }],
  chats: [{ id: "main", kind: "main" as const, title: "Clem", spaceId: null, updated: 1, messages: [{ id: "m1", role: "user" as const, content: "hi", at: 1 }] }],
});
const batch = (ops: WsOp[], id = "copy-1"): WsBatch => ({ id, ops: ops.map((o, i) => ({ ...o, seq: i + 1 })), last: ops.length });

test("a change becomes per-item operations, and applying them gives the same workspace", () => {
  const before = base();
  let after: any = addStudySet(before, { spaceId: "math", kind: "flashcards", title: "Limits", items: [{ question: "q", answer: "a" }] }, { now: 50, uid: () => "deck" }).state;
  after = putMessage(after, "main", { id: "m2", role: "assistant", content: "Done.", at: 60 });
  after = commitPlanBlock(after, readPlanBlock(JSON.stringify({ action: "create", space: "Math", title: "Math plan", tasks: [{ title: "Study", due: "2026-11-19" }] }))!, null, { now: 70, uid: () => "p1" }).state;
  const ops = diffOps(before, after, 100, "worker");
  assert.deepEqual(ops.map((o) => o.t + ":" + ("kind" in o ? o.kind : "")).sort(), ["chat:", "msg:", "put:plan", "put:studySet"].sort());
  const rebuilt = applyOps(base(), ops);
  assert.deepEqual(rebuilt.studySets, after.studySets);
  assert.deepEqual(rebuilt.plans, after.plans);
  assert.deepEqual(rebuilt.chats[0].messages.map((m: any) => m.id), ["m1", "m2"]);
  // Pulling the same operations twice changes nothing.
  assert.deepEqual(applyOps(rebuilt, ops), rebuilt);
});

test("conflicts: the newer write of an item wins, messages are never dropped, deletions are tombstones", () => {
  const desk: any = base();
  // The desktop edited the plan at 500; the worker's older change (at 300) doesn't overwrite it.
  desk.plans = [{ id: "p", spaceId: "math", title: "Desk plan", start: "2026-11-15", tasks: [], created: 1, updated: 500, rev: 3 }];
  const older: WsOp = { at: 300, by: "worker", t: "put", kind: "plan", item: { id: "p", spaceId: "math", title: "Worker plan", start: "2026-11-15", tasks: [], created: 1, updated: 300, rev: 2 } };
  assert.equal(applyOps(desk, [older]).plans[0].title, "Desk plan");
  // A newer one does.
  const newer: WsOp = { ...older, at: 900, item: { ...(older as any).item, title: "Worker plan", updated: 900 } };
  assert.equal(applyOps(desk, [newer]).plans[0].title, "Worker plan");
  // Both sides wrote in the same chat: every message is kept.
  const a = putMessage(desk, "main", { id: "d1", role: "user", content: "from the PC", at: 400 });
  const merged = applyOps(a, [{ at: 410, by: "worker", t: "msg", chat: { id: "main", kind: "main", title: "Clem", spaceId: null }, message: { id: "w1", role: "user", content: "from Telegram", at: 410 } }]);
  assert.deepEqual(merged.chats[0].messages.map((m: any) => m.id), ["m1", "d1", "w1"]);
  // The PC deleted a chat; the worker then wrote in it: the chat comes back with that message.
  const gone = { ...desk, chats: [] };
  const back = applyOps(gone, [{ at: 600, by: "worker", t: "msg", chat: { id: "main", kind: "main", title: "Clem", spaceId: null }, message: { id: "w2", role: "assistant", content: "Reminder", at: 600 } }]);
  assert.equal(back.chats[0].messages[0].id, "w2");
  // A deletion older than the item's last change is ignored; a newer one removes it.
  const deck = { id: "deck", spaceId: "math", kind: "flashcards", title: "x", items: [], created: 100, attempts: [{ at: 800, correct: 1, total: 1 }] };
  const withDeck = { ...desk, studySets: [deck] };
  assert.equal(applyOps(withDeck, [{ at: 700, by: "worker", t: "del", kind: "studySet", id: "deck" }]).studySets.length, 1, "studied at 800, after the deletion at 700");
  assert.equal(applyOps(withDeck, [{ at: 900, by: "worker", t: "del", kind: "studySet", id: "deck" }]).studySets.length, 0);
  // A missing message in a diff is not a deletion.
  const less = { ...a, chats: [{ ...a.chats[0], messages: a.chats[0].messages.slice(1) }] };
  assert.ok(!diffOps(a, less, 1, "desktop").some((o) => o.t === "del"));
});

test("the desktop's push is the base and the worker's unsaved operations go on top; the cursor makes each land once", () => {
  const ops: WsOp[] = [
    { at: 10, by: "worker", t: "put", kind: "studySet", item: { id: "s1", spaceId: "math", kind: "flashcards", title: "A", items: [], created: 10, attempts: [] } },
    { at: 20, by: "worker", t: "put", kind: "studySet", item: { id: "s2", spaceId: "math", kind: "flashcards", title: "B", items: [], created: 20, attempts: [] } },
  ];
  const b = batch(ops);
  // A desktop that saved the first operation pushes; the worker keeps only the second on top.
  const pushed: any = { ...base(), studySets: [ops[0].t === "put" ? ops[0].item : null], vpsSync: { id: "copy-1", seq: 1 } };
  assert.deepEqual(mergePushed(pushed, b).studySets.map((s: any) => s.id), ["s1", "s2"]);
  // The desktop pulls: both once, the cursor saved with them; again: nothing changes.
  const desk = applyPull(base() as any, b);
  assert.deepEqual(desk.studySets.map((s: any) => s.id), ["s1", "s2"]);
  assert.deepEqual(desk.vpsSync, { id: "copy-1", seq: 2 });
  assert.equal(applyPull(desk, b), desk);
  // A reinstalled worker (a new copy id) sends everything again; applying it twice is still safe.
  assert.deepEqual(applyPull(desk, batch(ops, "copy-2")).studySets.length, 2);
  // What is sent to the worker: temporary chats left out, chats cut to their latest messages.
  const many = { ...base(), chats: [{ id: "c", title: "t", spaceId: "math", updated: 1, messages: Array.from({ length: 30 }, (_, i) => ({ id: "x" + i, role: "user", content: "", at: i })) }, { id: "tmp", temporary: true, title: "t", spaceId: null, updated: 1, messages: [] }] };
  const lean = leanState(many);
  assert.equal(lean.chats.length, 1); assert.equal(lean.chats[0].messages.length, 8);
});

test("the worker's copy is durable, keeps its changes as numbered operations, and applies the organizer's decisions itself", async () => {
  const { backend, db } = await openPglite();
  await migrate(backend, "desktop/engine/migrations");
  let now = 1_000;
  const ws = new WorkerWorkspace({ db, owner: "o1", clock: () => now });
  await assert.rejects(ws.change((s) => s), /hasn't reached your VPS/);
  await ws.receive(leanState(base()) as any);
  now = 2_000;
  const { ops } = await ws.change((s) => addStudySet(s, { spaceId: "math", kind: "flashcards", title: "Deck", items: [{ question: "q", answer: "a" }] }, { now }).state);
  assert.equal(ops.length, 1);
  // The organizer's inbox: a plan task to apply and a message for the main thread; the window gets them as operations.
  const acks: any[] = [];
  const organizer = {
    inbox: async () => ({ posts: [{ id: "pro-1", content: "MATH 301 Quiz 2 is tomorrow.", at: 2_500 }], apply: [{ key: "k1", action: { type: "plan_task", spaceId: "math", title: "Revise limits", due: "2026-11-18" } }], revert: [] }),
    ack: async (o: unknown) => { acks.push(o); },
  };
  now = 3_000;
  assert.equal(await ws.drain(organizer), 2);
  assert.equal(acks[0].results[0].ok, true); assert.ok(acks[0].results[0].undo, "an Undo record goes back to the organizer");
  assert.deepEqual(acks[0].posts, ["pro-1"]);
  // A new handle on the same database (the worker restarted) sees the same copy and operations.
  const again = new WorkerWorkspace({ db, owner: "o1" });
  const s = (await again.state())!;
  assert.equal(s.studySets.length, 1);
  assert.equal(s.plans![0].tasks[0].title, "Revise limits");
  assert.equal(s.chats[0].messages.at(-1)!.content, "MATH 301 Quiz 2 is tomorrow.");
  const pulled = (await again.opsAfter(null))!;
  const desk = applyPull(base() as any, pulled);
  assert.equal(desk.plans[0].tasks[0].title, "Revise limits");
  assert.equal(desk.studySets[0].title, "Deck");
  assert.equal((await again.opsAfter(desk.vpsSync))!.ops.length, 0, "nothing is sent twice");
  await backend.close();
});

test("the person's routines run on the worker as the window runs them, once, and the window then leaves them", async () => {
  const { WorkerAgent } = await import("../desktop/engine/vps/agent.ts");
  const { backend, db } = await openPglite();
  await migrate(backend, "desktop/engine/migrations");
  let now = Date.parse("2026-11-16T07:00:00Z");
  const ws = new WorkerWorkspace({ db, owner: "o1", clock: () => now });
  await ws.receive(leanState({ ...base(), automations: [{ id: "a1", name: "Morning words", prompt: "Give me three words to learn.", schedule: "daily", enabled: true, spaceId: null, nextRun: now - 1000 }] }) as any);
  const prompts: string[] = [];
  const agent = new WorkerAgent({ owner: "o1", ws, files: "/nowhere", clock: () => now, engine: () => ({}) as any, complete: async ({ user }) => { prompts.push(user); return "Lucid, terse, apt."; } });
  assert.equal(await agent.routines(), true);
  assert.equal(await agent.routines(), false, "not again until its next time");
  const s = (await ws.state())!;
  assert.deepEqual(prompts, ["Give me three words to learn."]);
  assert.equal(s.chats[0].messages.at(-1)!.content, "**Morning words**\n\nLucid, terse, apt.");
  assert.ok(s.automations[0].nextRun! > now, "moved to its next run, which the desktop receives with the rest");
  assert.equal((await ws.opsAfter(null))!.ops.filter((o) => o.t === "put" && o.kind === "automation").length, 1);
  await backend.close();
});
