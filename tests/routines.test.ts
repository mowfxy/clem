// Routines (core/proactivity/routines.ts, desktop/engine/organizer.ts) and the paced GUC pulse: what the AI builds from
// the person's words runs in their own engine, fires the moment a sync finds matching news, posts to their webhook,
// answers its own webhook only with its key, and watches pages from a baseline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cronTooOften, matchChange, readRoutineReply, triggerSchema } from "../core/proactivity/routines.ts";
import { cardsIn } from "../core/guc/cards.ts";
import { dueParts, PACE } from "../desktop/engine/guc-sync.ts";
import { Engine } from "../desktop/engine/index.ts";
import { serveHooks } from "../desktop/engine/hooks.ts";
import { checkGrade, fakeGuc, host as fakeHost, noWait, site } from "./guc-fake.ts";
import { portalUrls } from "../core/guc/parse.ts";

const space = (id: string, name: string, extra = {}) => ({ id, name, kind: "subject" as const, description: "", memory: "", sources: [], ...extra });
async function engine(o: { complete?: (r: { system: string; user: string }) => Promise<string>; http?: ReturnType<typeof fakeGuc>["http"] } = {}) {
  const h = Object.assign(fakeHost(), { pushed: [] as { title: string; body: string }[] });
  h.workspace = async () => ({ spaces: [space("emb", "Embedded", { description: "CSEN 701" })], plans: [], chats: [{ id: "main", kind: "main", messages: [] }], files: [], studySets: [], automations: [] });
  h.notify = (n) => { h.pushed.push({ title: n.title, body: n.body }); };
  if (o.complete) h.complete = o.complete;
  const e = await Engine.open("rt-owner", h, { memory: true, jobs: false, http: o.http, sleep: noWait });
  return { e, o: e.organizer, h };
}
/** A local server standing in for the person's own webhook (or a page they watch). */
async function local(respond: (body: string) => string = () => "ok") {
  const got: { path: string; body: string }[] = [];
  const server = createServer(async (req, res) => { let body = ""; for await (const c of req) body += c; got.push({ path: req.url || "", body }); res.end(respond(body)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, got, close: () => server.close() };
}

test("routine checks: any trigger the person describes, never a schedule that is only noise", () => {
  assert.ok(triggerSchema.safeParse({ type: "schedule", cron: "30 21 * * 6" }).success);
  assert.equal(triggerSchema.safeParse({ type: "schedule", cron: "every day" }).success, false);
  assert.equal(cronTooOften("* * * * *"), true);
  assert.equal(cronTooOften("*/5 * * * *"), true);
  assert.equal(cronTooOften("0 8 * * 0"), false);
  assert.equal(triggerSchema.safeParse({ type: "page", url: "ftp://x.y/z" }).success, false);
  const t = triggerSchema.parse({ type: "change", kinds: ["new_grade"], subject: "Embedded" }) as Extract<ReturnType<typeof triggerSchema.parse>, { type: "change" }>;
  assert.equal(matchChange(t, { key: "a", kind: "new_grade", title: "Midterm grade out: CSEN 701", detail: "", subject: "Embedded" }), true);
  assert.equal(matchChange(t, { key: "b", kind: "new_announcement", title: "x", detail: "", subject: "Embedded" }), false);
  assert.deepEqual(readRoutineReply('{"say": null}'), { say: null, important: false });
  assert.deepEqual(readRoutineReply('ok {"say":"Quiz moved.","important":true}'), { say: "Quiz moved.", important: true });
});

test("the GUC pulse reads only what is due: mail and pages often, heavy pages rarely, slower at night", () => {
  const now = Date.UTC(2026, 10, 13, 10, 0);
  assert.deepEqual(dueParts(undefined, now, 12), ["mail", "pages", "grades", "exams", "courses", "schedule", "transcript"], "everything the first time");
  const just = Object.fromEntries(Object.keys(PACE).map((p) => [p, now - 4 * 60_000]));
  assert.deepEqual(dueParts(just, now, 12), ["mail"], "four minutes on, only mail");
  assert.deepEqual(dueParts(just, now, 3), [], "at night the same gap is not enough");
});

test("a change routine fires right after the sync that found a grade, tells the person and posts to their webhook", async () => {
  const hook = await local();
  const pages = site(), guc = fakeGuc(pages), asked: string[] = [];
  const { e, o } = await engine({ http: guc.http, complete: async (r) => { asked.push(r.user); return JSON.stringify({ say: "Your CSEN 701 midterm is out: 17/20.", important: true }); } });
  try {
    await e.connect("student.name", "secret");
    await e.db.query("insert into subject_links (owner_id, subject_id, course_key) values ('rt-owner', 'emb', '1201:64')");
    const made = await o.tool({ action: "clem.routine", title: "Grades the moment they land", instructions: "Tell me the grade and how it compares.", trigger: { type: "change", kinds: ["new_grade"] }, post: hook.url + "/clem" }) as { ok: boolean; card: string };
    assert.equal(made.ok, true);
    assert.equal((cardsIn(made.card)[0] as { type: string }).type, "routine");
    pages[portalUrls.grades] = checkGrade({ mid701: "17/20" });
    await e.sync();
    for (let i = 0; i < 50 && !hook.got.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(hook.got.length, 1, "posted once");
    const body = JSON.parse(hook.got[0].body);
    assert.equal(body.event.kind, "change");
    assert.match(body.event.changes[0].title, /Midterm grade out: CSEN 701/);
    assert.equal(body.message, "Your CSEN 701 midterm is out: 17/20.");
    assert.match(asked[0], /Event:[\s\S]*Midterm grade out/, "the model saw the change as data");
    const posts = (await o.inbox()).posts.map((p) => p.content);
    assert.ok(posts.some((p) => /Grades the moment they land[\s\S]*17\/20/.test(p)), "said in the main thread");
    const [row] = await o.routines();
    assert.equal(row.runs, 1);
    assert.match(String(row.lastResult), /told, posted/);
  } finally { hook.close(); await e.close(); }
});

test("a webhook routine answers only its own key; without a model it says what came in", async () => {
  const { e, o } = await engine();
  try {
    const made = await o.tool({ action: "clem.routine", title: "Gym booking", trigger: { type: "webhook" }, think: false }) as { webhook: string };
    const url = new URL(made.webhook), id = url.pathname.split("/").pop()!, key = url.searchParams.get("key")!;
    const server = await serveHooks({ port: 0, host: "127.0.0.1", target: async () => (i, k, p) => o.hook(i, k, p) });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      assert.equal((await fetch(`${base}/hook/${id}?key=wrong`, { method: "POST", body: "{}" })).status, 404);
      assert.equal((await fetch(`${base}/hook/${id}`, { method: "POST", headers: { "x-clem-key": key, "content-type": "application/json" }, body: JSON.stringify({ slot: "Sat 18:00" }) })).status, 202);
      assert.equal((await fetch(`${base}/elsewhere`, { method: "POST" })).status, 404, "nothing else is served");
      for (let i = 0; i < 50 && !(await o.inbox()).posts.length; i++) await new Promise((r) => setTimeout(r, 20));
      assert.match((await o.inbox()).posts[0].content, /Gym booking[\s\S]*Sat 18:00/);
      assert.equal((await fetch(`${base}/hook/${id}?key=${key}`, { method: "POST", body: "again" })).status, 429, "not twice within seconds");
    } finally { server.close(); }
    await o.stopRoutine(id);
    assert.equal((await o.hook(id, key, {})).status, 404, "a stopped routine is gone");
  } finally { await e.close(); }
});

test("a page routine sets a baseline first and runs when the page's words change", async () => {
  let text = "<html><script>x=1</script><body>Registration opens soon</body></html>";
  const page = await local(() => text);
  const { e, o } = await engine();
  try {
    const made = await o.tool({ action: "clem.routine", title: "Registration", trigger: { type: "page", url: page.url + "/reg", every: 15 }, think: false }) as { ok: boolean };
    assert.equal(made.ok, true);
    await o.routinePages();
    assert.equal((await o.inbox()).posts.length, 0, "baseline only");
    text = "<html><script>x=2</script><body>Registration opens soon</body></html>";
    await e.db.query("update organizer_routines set state = state || '{\"at\":0}'::jsonb");
    await o.routinePages();
    assert.equal((await o.inbox()).posts.length, 0, "a script change is not a change");
    text = "<html><body>Registration is OPEN</body></html>";
    await e.db.query("update organizer_routines set state = state || '{\"at\":0}'::jsonb");
    await o.routinePages();
    assert.match((await o.inbox()).posts[0]?.content || "", /Registration[\s\S]*changed/);
  } finally { page.close(); await e.close(); }
});

test("bad routines are refused with a reason the AI can fix", async () => {
  const { e, o } = await engine();
  try {
    assert.match(String((await o.tool({ action: "clem.routine", title: "Spam", trigger: { type: "schedule", cron: "* * * * *" } }) as { error: string }).error), /15 minutes/);
    assert.match(String((await o.tool({ action: "clem.routine", title: "Nothing", trigger: { type: "webhook" }, tell: false }) as { error: string }).error), /tell|post/);
    assert.match(String((await o.tool({ action: "clem.routine", title: "Past", trigger: { type: "at", at: "2001-01-01T09:00" } }) as { error: string }).error), /future time/);
    assert.match(String((await o.tool({ action: "clem.routines" }) as { text: string }).text), /No routines yet/);
  } finally { await e.close(); }
});
