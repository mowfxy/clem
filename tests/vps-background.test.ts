// Everything behind the main thread runs on the VPS worker while it holds the lease, on the same schedule and with the
// same results as on the laptop (owner, 2026-11-15): GUC portal, CMS and mail sync, the deadline reader, corrections
// applied at sync, files saved under the save rules (within the 82% limit), the organizer's news, reminders and
// notifications to Telegram, and the Telegram main thread on the worker answering from that fresh data. The worker's
// engine is the laptop's Engine, opened the way worker/index.ts opens it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { urls } from "../core/guc/parse.ts";
import { step } from "../core/vps/lease.ts";
import { cairoAt } from "../core/proactivity/settings.ts";
import { Engine } from "../desktop/engine/index.ts";
import { DeviceStore } from "../desktop/engine/storage.ts";
import { DiskLimit, LimitedStore, Waiting } from "../desktop/engine/vps/limit.ts";
import { runThreadTool } from "../desktop/engine/thread-tools.ts";
import { WorkerAgent } from "../desktop/engine/vps/agent.ts";
import type { WorkerWorkspace } from "../desktop/engine/vps/workspace.ts";
import { fakeGuc, fixture, host, noWait, site } from "./guc-fake.ts";
import { account, fakeTelegram, hook, msg, workerEnv } from "./telegram-fake.ts";

const KB = 1024;
const U = (f: string) => "https://cms.guc.edu.eg/Uploads/1201/64/" + f;
const pdf = (s: string) => new TextEncoder().encode("%PDF-1.4 " + s);
const cmsFiles = () => ({ [U("lecture-1.pdf")]: pdf("one"), [U("lecture-3.pdf")]: pdf("three"), [U("tutorial-3.pdf")]: pdf("tutorial") });

/** One side: the laptop's engine (its own Files folder) or the worker's (its store under the VPS limit, as
 *  worker/index.ts opens it: jobs off until the lease says so). Each with its own fake GUC and Telegram. */
async function side(kind: "laptop" | "worker", o: { clock: { t: number }; disk?: { total: number; free: number } }) {
  const dir = await mkdtemp(join(tmpdir(), "clem-bg-" + kind + "-"));
  const pages = site(), guc = fakeGuc(pages, { etags: true, files: cmsFiles() });
  const env = workerEnv(), tg = fakeTelegram();
  const h = Object.assign(host({ files: join(dir, "Files") }), { account: account(env, tg, "owner-1") });
  let store: LimitedStore | undefined, waiting: Waiting | undefined;
  if (kind === "worker") {
    const files = join(dir, "files");
    const limit = new DiskLimit({ measure: async () => o.disk || { total: 100_000 * KB, free: 90_000 * KB } });
    store = new LimitedStore({ inner: new DeviceStore(files, { location: "vps", sub: "" }), limit, root: files });
    h.fileStore = () => store;
    h.fileStores = () => ({ vps: store! });
  }
  const engine = await Engine.open("owner-1", h, { http: guc.http, sleep: noWait, memory: true, jobs: false, clock: () => o.clock.t, ...(store ? { store } : {}) });
  h.speaker = engine.organizer;
  if (store) waiting = store.waiting = new Waiting(engine.db, "owner-1");
  h.workspace = async () => ({ spaces: [{ id: "subj-1", name: "Circuits", kind: "subject" }], plans: [], files: [], studySets: [], automations: [], chats: [{ id: "main", kind: "main", messages: [] }] });
  const pair = async () => { const p = await engine.telegram.pair(); await hook(env, tg, msg(42, p.code)); await engine.telegram.status(true); };
  const said = () => tg.said().map((b: any) => b.text as string);
  const close = async () => { await engine.runner(false).catch(() => {}); await engine.close(); await rm(dir, { recursive: true, force: true }).catch(() => {}); };
  return { engine, guc, pages, dir, store, waiting, pair, said, close };
}

test("holding the lease, the worker runs the same jobs on the same schedule as the laptop", { timeout: 120_000 }, async () => {
  const clock = { t: cairoAt("2026-11-15", "10:00") };
  const L = await side("laptop", { clock }), W = await side("worker", { clock });
  try {
    // The lease: the worker alive holds it, the desktop then doesn't run jobs (and runs them only when it goes quiet).
    const w = step(null, "worker", clock.t), d = step(w.lease, "desktop", clock.t + 1000);
    assert.equal(w.run, true); assert.equal(d.run, false);
    for (const s of [L, W]) { await s.engine.connect("student.name", "secret"); await s.engine.link("subj-1", "1201:64"); await s.engine.setSettings("subj-1", { check: { text: "every day at 8pm" } } as any).catch(() => {}); }
    await L.engine.runner(true); await W.engine.runner(w.run);
    const schedules = async (e: Engine) => (await e.db.query<{ name: string; cron: string; key: string }>("select name, cron, key from pgboss.schedule order by name, key")).map((r) => [r.name, r.cron, r.key]);
    const queues = async (e: Engine) => (await e.db.query<{ name: string }>("select name from pgboss.queue order by name")).map((r) => r.name);
    assert.deepEqual(await schedules(W.engine), await schedules(L.engine), "the same crons");
    assert.deepEqual(await queues(W.engine), await queues(L.engine), "the same jobs");
    const names = (await queues(W.engine)).join(" ");
    for (const q of ["guc.sync", "guc.check", "organizer.sweep", "organizer.tick", "organizer.remind", "organizer.routine"]) assert.match(names, new RegExp(q.replace(".", "\\.")), q);
    assert.ok((await schedules(W.engine)).some(([n]) => n === "guc.sync"), "GUC sync is scheduled on the worker");
  } finally { await L.close(); await W.close(); }
});

test("the same sync, deadline reader, corrections and saved files on the worker as on the laptop, within the 82% limit", { timeout: 120_000 }, async () => {
  const clock = { t: cairoAt("2026-11-15", "10:00") };
  const L = await side("laptop", { clock }), W = await side("worker", { clock });
  try {
    for (const s of [L, W]) { await s.engine.connect("student.name", "secret"); await s.engine.link("subj-1", "1201:64"); await (s.engine as any).light; }
    const dl = async (e: Engine) => (await e.deadlines()).map((d: any) => [d.code, d.title, d.due]).sort();
    assert.deepEqual(await dl(W.engine), await dl(L.engine), "the same Coming up after the first sync");
    // The portal changes: a new deadline in a post (the deadline reader), a room change; both sync.
    for (const s of [L, W]) {
      s.pages[urls.course(1201, 64)] = fixture("cms-course").replace("</div>\n    </div>\n  </div>\n  <div class=\"weeksdata\">", `<p>Project milestone 2 deadline is 3 December 2026.</p></div>\n    </div>\n  </div>\n  <div class="weeksdata">`);
      s.pages[urls.schedule] = fixture("schedule").replace("C6.204", "C6.205");
      await s.engine.sync();
    }
    const events = async (e: Engine) => (await e.db.query<{ kind: string; title: string }>("select kind, title from guc_events order by kind, title")).map((r) => [r.kind, r.title]);
    assert.deepEqual(await events(W.engine), await events(L.engine), "the same changes found");
    assert.deepEqual(await dl(W.engine), await dl(L.engine), "the same deadlines read");
    assert.ok((await dl(W.engine)).some(([, t]) => /milestone 2/i.test(String(t))), "the deadline reader found the new one");
    // A correction from the Telegram main thread holds through the next sync, on both.
    for (const s of [L, W]) {
      const r = await runThreadTool({ engine: s.engine, owner: "owner-1", subjects: [{ id: "subj-1", name: "Circuits" }] }, { action: "guc.correct", item: "milestone 2", do: "remove", why: "cancelled" });
      assert.doesNotMatch(JSON.stringify(r), /error/i, JSON.stringify(r));
      s.pages[urls.course(1201, 64)] += "<!-- touched -->";
      await s.engine.sync();
    }
    assert.ok(!(await dl(W.engine)).some(([, t]) => /milestone 2/i.test(String(t))), "removed stays removed after a sync on the worker");
    assert.deepEqual(await dl(W.engine), await dl(L.engine));
    // Save rules: the slides are kept, in the worker's VPS store (under the limit) as in the laptop's Files.
    for (const s of [L, W]) await s.engine.setSettings("subj-1", { save: { kinds: { slides: true, assignments: false, sheets: false, other: false } } });
    const [l, w] = [await L.engine.check("subj-1", "now"), await W.engine.check("subj-1", "now")];
    assert.deepEqual([w?.saved, w?.deduped], [l?.saved, l?.deduped], "the same files kept");
    assert.ok((w?.saved || 0) >= 1);
    assert.ok((await readdir(join(W.dir, "files"))).some((n) => /\.pdf$/.test(n)), "the bytes are in the worker's store");
  } finally { await L.close(); await W.close(); }
});

test("past 82% the worker keeps no new CMS file, says so in plain words, and the CMS keeps it", { timeout: 120_000 }, async () => {
  const clock = { t: cairoAt("2026-11-15", "10:00") };
  const W = await side("worker", { clock, disk: { total: 1000 * KB, free: 150 * KB } });
  try {
    await W.engine.connect("student.name", "secret"); await W.engine.link("subj-1", "1201:64"); await (W.engine as any).light;
    await W.engine.setSettings("subj-1", { save: { kinds: { slides: true, assignments: false, sheets: false, other: false } } });
    const r = await W.engine.check("subj-1", "now");
    assert.equal(r?.saved || 0, 0, "nothing written past the limit");
    assert.deepEqual((await readdir(join(W.dir, "files")).catch(() => [] as string[])).filter((n) => /\.pdf$/.test(n)), []);
    assert.ok((await W.waiting!.items()).length >= 1, "what wasn't kept is noted");
  } finally { await W.close(); }
});

test("the organizer's news and the person's reminders reach Telegram from the worker as from the laptop", { timeout: 120_000 }, async () => {
  const clock = { t: cairoAt("2026-11-16", "09:00") };
  const L = await side("laptop", { clock }), W = await side("worker", { clock });
  try {
    for (const s of [L, W]) {
      await s.pair();
      await s.engine.organizer.sweep("event");
      await s.engine.db.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail) values ('owner-1', 'ann:t1', 'new_announcement', null, 'New announcement in ELCT 201', 'Today''s lab is cancelled.')");
      await s.engine.organizer.sweep("event");
      // A reminder set from the Telegram main thread rings on time.
      const r = await runThreadTool({ engine: s.engine, owner: "owner-1", subjects: [] }, { action: "clem.remind", text: "Submit Sheet 3", at: "2026-11-16 09:30" });
      assert.doesNotMatch(JSON.stringify(r), /"error"/, JSON.stringify(r));
    }
    clock.t = cairoAt("2026-11-16", "09:31");
    for (const s of [L, W]) await s.engine.organizer.ring();
    const news = (s: typeof L) => s.said().filter((t) => !/^Here's what I can do|^Paired/.test(t));
    assert.deepEqual(news(W), news(L), "the same messages, in the same order");
    assert.ok(news(W).some((t) => /lab is cancelled/i.test(t)), "the news");
    assert.ok(news(W).some((t) => /Sheet 3/.test(t)), "the reminder");
    const posts = async (e: Engine) => (await e.organizer.inbox()).posts.map((p) => p.content);
    assert.deepEqual(await posts(W.engine), await posts(L.engine), "and the same posts for the main thread");
  } finally { await L.close(); await W.close(); }
});

test("the main thread on the worker answers from the data the worker just synced", { timeout: 120_000 }, async () => {
  const clock = { t: cairoAt("2026-11-15", "10:00") };
  const W = await side("worker", { clock });
  const root = await mkdtemp(join(tmpdir(), "clem-bg-ws-"));
  try {
    await W.engine.connect("student.name", "secret"); await W.engine.link("subj-1", "1201:64");
    W.pages[urls.course(1201, 64)] = fixture("cms-course").replace("</div>\n    </div>\n  </div>\n  <div class=\"weeksdata\">", `<p>Project milestone 2 deadline is 18 November 2026.</p></div>\n    </div>\n  </div>\n  <div class="weeksdata">`);
    await W.engine.sync();
    let state: any = { name: "Sam", memory: "", automations: [], studySets: [], plans: [], files: [], spaces: [{ id: "subj-1", name: "Circuits", kind: "subject", description: "", memory: "", sources: [] }], chats: [{ id: "main", kind: "main", title: "Clem", spaceId: null, updated: 1, messages: [] }] };
    const ws = { state: async () => state, change: async (fn: (s: any) => any) => { state = fn(state); return { state, ops: [] }; }, ready: async () => true, drain: async () => {} } as unknown as WorkerWorkspace;
    const seen: string[] = [];
    const complete = async ({ user }: { system: string; user: string }) => {
      seen.push(user);
      if (!/Tool exchanges/.test(user)) return JSON.stringify({ kinetra: { action: "guc.deadlines", range: "14d" } });
      return /milestone 2/i.test(user) ? "Project milestone 2 is due on 18 November." : "Nothing due.";
    };
    const agent = new WorkerAgent({ owner: "owner-1", complete, engine: () => W.engine, ws, files: root, clock: () => clock.t });
    const r = await agent.converse({ id: "m1", text: "what's due in the next two weeks?" });
    assert.equal(r.text, "Project milestone 2 is due on 18 November.");
    assert.match(seen[0], /milestone 2/i, "the Now card already has it");
  } finally { await W.close(); await rm(root, { recursive: true, force: true }); }
});

test("the flashcards-due reminder: the worker sends it while it runs Clem's jobs, once a day, at the person's hour in Cairo", { timeout: 120_000 }, async () => {
  const { startPair, baseDesk } = await import("./vps-pair.ts");
  const { cairoWall } = await import("../worker/index.ts");
  const clock = { t: cairoAt("2026-11-16", "08:30") };
  const p = await startPair({ clock: () => clock.t, complete: async () => "Okay." });
  try {
    const due = clock.t - 3_600_000;
    await p.m.pushWorkspace(true, baseDesk({ studySets: [{ id: "s1", spaceId: "math", kind: "flashcards", title: "Limits", items: [{ question: "q", answer: "a" }, { question: "q2", answer: "a2" }], cards: [{ due, reps: 2 }, { due, reps: 1 }], created: 1, attempts: [] }] }));
    assert.equal(p.worker.engine.isRunner, true, "the worker holds the lease");
    await p.worker.work();
    const told = p.worker.notices.filter((n) => n.key.startsWith("study-due:"));
    assert.deepEqual(told.map((n) => [n.title, n.body]), [["Time to review", "2 cards due in Math"]], "to the PC as a notice");
    await p.worker.work();
    assert.equal(p.worker.notices.filter((n) => n.key.startsWith("study-due:")).length, 1, "once a day");
    const wall = cairoWall(cairoAt("2026-11-16", "08:30"));
    assert.deepEqual([wall.getHours(), wall.getMinutes()], [8, 30], "Cairo's hour, whatever the server's time zone");
    const main = await readFileText("desktop/main.ts");
    assert.match(main, /!vpsManagers\.get\(user\.id\)\?\.workerRuns\(\) \? reminders\.tick/, "the laptop leaves it to the worker meanwhile: never both");
  } finally { await p.stop(); }
});
const readFileText = (f: string) => import("node:fs/promises").then((m) => m.readFile(f, "utf8"));
