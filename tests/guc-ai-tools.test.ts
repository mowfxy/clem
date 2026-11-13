import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deadlineWindow, fileTextPage, gucAction, gucNow, resolveSubject, scheduleDays } from "../core/guc/ai-tools.ts";
import { clemSkillsFor } from "../core/clem-skills.ts";
import { localNowCard, renderNow, withGuc } from "../core/main-thread/context.ts";
import { Engine } from "../desktop/engine/index.ts";
import { runGucTool, type GucToolContext } from "../desktop/engine/ai-tools.ts";
import { extractText, type TextCacheOptions } from "../desktop/engine/file-text.ts";
import { kinetraMcp } from "../desktop/kinetra-mcp.ts";
import { toolRequests } from "../desktop/kinetra-turn.ts";
import { fakeGuc, host, noWait, site } from "./guc-fake.ts";

const fixtureBytes = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/guc/${name}`, import.meta.url)));
const U = (f: string) => "https://cms.guc.edu.eg/Uploads/1201/64/" + f;
// Sunday 8 Nov 2026, 10:00 in Cairo.
const NOW = Date.parse("2026-11-08T08:00:00Z");
const SUBJECTS = [{ id: "subj-emb", name: "Embedded", examDate: "2026-12-20" }, { id: "subj-mp", name: "Micro" }];

async function open(o: { owner?: string; text?: TextCacheOptions } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "clem-ai-")), owner = o.owner || "owner-a";
  const files = { [U("lecture-3.pdf")]: await fixtureBytes("lecture.pdf"), [U("lecture-1.pdf")]: await fixtureBytes("lecture.pdf"), [U("deck.pptx")]: await fixtureBytes("deck.pptx") };
  const guc = fakeGuc(site(), { files });
  const engine = await Engine.open(owner, host({ files: join(dir, "Files"), temp: join(dir, "temp") }), { http: guc.http, sleep: noWait, memory: true, jobs: false, text: o.text });
  await engine.connect("student.name", "secret");
  await engine.link("subj-emb", "1201:64");
  await engine.link("subj-mp", "1202:64");
  await (engine as any).light;
  await engine.db.query("insert into guc_materials (owner_id, material_id, course_key, week, title, kind, url) values ($1, 'deck1', '1201:64', 'Week: 2026-11-07', 'Pipelines deck', 'Lecture slides', $2)", [owner, U("deck.pptx")]);
  await engine.db.query("delete from guc_deadlines where owner_id = $1", [owner]);
  await engine.db.query("insert into guc_deadlines (owner_id, deadline_id, course_key, title, due, source) values ($1, 'd1', '1201:64', 'Assignment 2 submission', '2026-11-10T21:59:00Z', 'announcement'), ($1, 'd2', '1202:64', 'Lab report', '2026-11-30T21:59:00Z', 'announcement'), ($1, 'd0', '1201:64', 'Quiz 0', '2026-11-01T10:00:00Z', 'announcement')", [owner]);
  const binaries = () => guc.log.filter((r) => r.binary).length;
  const ctx = (o: Partial<GucToolContext> = {}): GucToolContext => ({ engine, owner, subjects: SUBJECTS, now: NOW, ...o });
  const run = (request: Record<string, unknown>, o: Partial<GucToolContext> = {}) => runGucTool(ctx(o), request);
  return { engine, guc, dir, owner, run, binaries, close: async () => { await engine.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("actions are namespaced, aliases read as the action they mean, and the text protocol accepts them", () => {
  assert.equal(gucAction("guc.schedule"), "guc.schedule");
  assert.equal(gucAction("guc.read_file"), "guc.read");
  assert.equal(gucAction("guc.update_subject_settings"), "guc.settings");
  assert.equal(gucAction("schedule"), null);
  assert.deepEqual(toolRequests('{"kinetra":{"action":"guc.deadlines","range":"7d"}}'), [{ action: "guc.deadlines", range: "7d" }]);
});

test("ranges: schedule days in Cairo's Sat–Thu week, deadline windows", () => {
  assert.deepEqual(scheduleDays("today", NOW), { days: ["2026-11-08"] });
  assert.deepEqual(scheduleDays("week", NOW), { days: ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"] });
  assert.deepEqual(scheduleDays("monday", NOW), { days: ["2026-11-09"] });
  assert.equal((scheduleDays("2026-11-01..2026-12-31", NOW) as { days: string[] }).days.length, 14, "capped at 14 days");
  assert.ok("error" in scheduleDays("someday", NOW));
  assert.deepEqual(deadlineWindow("7d", NOW), { from: NOW, to: NOW + 7 * 864e5 });
  assert.ok("error" in deadlineWindow("soon", NOW));
});

test("subjects resolve by id, @mention, name, code, course name and fuzzy words; the chat's subject is the default", () => {
  const links = [{ subjectId: "s1", courseKey: "1201:64", code: "CSEN 701", name: "Embedded Systems Architecture", season: "", linkedAt: 0 }];
  const courses = [{ key: "1201:64", code: "CSEN 701", name: "Embedded Systems Architecture", active: true }, { key: "1202:64", code: "CSEN 702", name: "Microprocessors", active: true }, { key: "1203:64", code: "DMET 901", name: "Computer Vision", active: true }];
  const d = { links, courses, subjects: [{ id: "s1", name: "Embedded" }] };
  const key = (r: unknown) => (r && typeof r === "object" && "courseKey" in r ? (r as { courseKey: string }).courseKey : r);
  assert.equal(key(resolveSubject("s1", d)), "1201:64");
  assert.equal(key(resolveSubject("@s1", d)), "1201:64");
  assert.equal(key(resolveSubject("embedded", d)), "1201:64");
  assert.equal(key(resolveSubject("csen702", d)), "1202:64");
  assert.equal(key(resolveSubject("computer vision", d)), "1203:64");
  assert.equal(key(resolveSubject("microprocesors", d)), "1202:64", "a small typo");
  assert.equal((resolveSubject("csen701", d) as { subjectId?: string }).subjectId, "s1", "a linked course carries its subject");
  assert.equal(key(resolveSubject(undefined, { ...d, scope: "s1" })), "1201:64");
  assert.equal(resolveSubject(undefined, d), null);
  assert.ok("error" in (resolveSubject("underwater basket weaving", d) as object));
});

test("each tool answers from the fixture GUC in compact text with links to cite", async () => {
  const t = await open();
  try {
    const today = await t.run({ action: "guc.schedule", range: "today" }) as string;
    assert.match(today, /Sun 2026-11-08: .*CSEN 701 Tut.*CSEN 701 Lecture.*CSEN 702 Lab/);
    assert.match(today, /#\/app\/guc\/schedule/);
    const mine = await t.run({ action: "guc.schedule", range: "week", subject: "DMET 901" }) as string;
    assert.match(mine, /Mon 2026-11-09: .*DMET 901 Lecture/);
    assert.doesNotMatch(mine, /CSEN/);

    const due = await t.run({ action: "guc.deadlines" }) as string;
    assert.match(due, /CSEN 701: Assignment 2 submission · Tue 10 Nov, 23:59 \(Tue at 23:59\) #\/app\/guc\/deadlines\/d1/);
    assert.doesNotMatch(due, /Lab report/, "beyond 14 days");
    assert.doesNotMatch(due, /Quiz 0/, "past");
    assert.match(await t.run({ action: "guc.deadlines", range: "past" }) as string, /Quiz 0/);
    assert.match(await t.run({ action: "guc.deadlines", range: "month", subject: "Micro" }) as string, /^Deadlines for Micro · CSEN 702[^]*Lab report/);

    const news = await t.run({ action: "guc.announcements", subject: "Embedded" }) as string;
    assert.match(news, /CSEN 701 .*unread.*#\/app\/guc\/announcements\//);
    assert.match((await t.run({ action: "guc.announcements", since: "last tuesday" }) as { error: string }).error, /"since"/);
    assert.match(await t.run({ action: "guc.announcements", since: "2099-01-01" }) as string, /No announcements/);

    const files = await t.run({ action: "guc.materials" }, { scope: "subj-emb" }) as string;
    assert.match(files, /^Embedded · CSEN 701 Embedded Systems Architecture: 4 files, 0 saved/);
    assert.match(files, /900301 · Lecture 3\.pdf .*#\/app\/guc\/cms\/1201%3A64\/900301/);
    assert.ok("error" in (await t.run({ action: "guc.materials" }) as object), "no subject and no chat subject");

    const found = await t.run({ action: "guc.search", query: "lecture 3", subject: "csen 702" }) as string;
    assert.match(found, /CSEN 702/);
    assert.doesNotMatch(found, /CSEN 701/);

    assert.match(await t.run({ action: "guc.grades" }) as string, /Spring 2026/);
    assert.match(await t.run({ action: "guc.help" }) as string, /guc\.read/);
    assert.ok("error" in (await t.run({ action: "guc.schedule", range: 5 }) as object), "arguments are checked");
  } finally { await t.close(); }
});

test("read_file: an unsaved file is read from CMS into memory only, cached, and the cache expires", async () => {
  let clock = 1_000;
  const t = await open({ text: { ttl: 60_000, perf: { now: () => clock } } });
  try {
    const first = await t.run({ action: "guc.read", file: "900301" }) as string;
    assert.match(first, /Lecture 3\.pdf · Week: .* · read from CMS \(not saved\) · 3 pages/);
    assert.match(first, /\[Lecture 3\.pdf, page 2\]\nPage 2\. Timers and watchdogs/);
    assert.equal(t.binaries(), 1);
    assert.equal((await t.engine.db.query("select * from file_objects")).length, 0, "not recorded as saved");
    assert.deepEqual(await readdir(join(t.dir, "Files")).catch(() => []), [], "nothing stored");
    assert.deepEqual(await readdir(join(t.dir, "temp")).catch(() => []), [], "no temp bytes left");

    assert.match(await t.run({ action: "guc.read", file: "Lecture 3", subject: "Embedded" }) as string, /page 1/);
    assert.equal(t.binaries(), 1, "the second read is a cache hit");
    clock += 61_000;
    await t.run({ action: "guc.read", file: "900301" });
    assert.equal(t.binaries(), 2, "after the TTL it is fetched again");

    assert.ok("error" in (await t.run({ action: "guc.read", file: "Lecture 3" }) as object), "ambiguous across courses: asks for the id");
    const deck = await t.run({ action: "guc.read", file: "deck1" }) as string;
    assert.match(deck, /2 slides[^]*\[Pipelines deck\.pptx, slide 2\]\nHazards and forwarding/);
  } finally { await t.close(); }
});

test("read_file: a saved file is read from its store without asking CMS", async () => {
  const t = await open();
  try {
    await t.engine.setSettings("subj-emb", { save: { kinds: { slides: true, assignments: false, sheets: false, other: false } } });
    await t.engine.check("subj-emb", "rules");
    const before = t.binaries();
    assert.match(await t.run({ action: "guc.read", file: "900101" }) as string, /· saved ·[^]*Embedded systems: interrupts/);
    assert.equal(t.binaries(), before, "no download");
  } finally { await t.close(); }
});

test("long files page with a cursor; text extraction from PDF and PowerPoint", async () => {
  const pdf = await extractText(await fixtureBytes("lecture.pdf"), "L.pdf");
  assert.deepEqual(pdf.parts, ["Page 1. Embedded systems: interrupts", "Page 2. Timers and watchdogs", "Page 3. Memory-mapped IO"]);
  const pptx = await extractText(await fixtureBytes("deck.pptx"), "D.pptx");
  assert.deepEqual([pptx.unit, pptx.parts], ["slide", ["Pipelining basics", "Hazards and forwarding"]]);
  const big = { name: "B.pdf", unit: "page" as const, parts: ["a".repeat(30), "b".repeat(30), "c".repeat(30)] };
  const p1 = fileTextPage(big, 1, 70);
  assert.deepEqual([p1.next, p1.total], [3, 3]);
  assert.match(p1.text, /\[B\.pdf, page 2\]/);
  assert.equal(fileTextPage(big, 3, 70).next, undefined);
  await assert.rejects(extractText(new Uint8Array([1, 2, 3]), "v.mp4"), /no text/);
});

test("update_subject_settings: words and structured rules go through the same converters and checks as cards", async () => {
  const t = await open();
  try {
    const out = await t.run({ action: "guc.settings", subject: "Embedded", saveText: "only PDFs from week 2", drive: { enabled: false } }) as string;
    assert.match(out, /^Updated Embedded · CSEN 701.*PDFs only · week 2 onwards/);
    const v = await t.engine.subject("subj-emb");
    assert.deepEqual([v.settings.save.types?.only, v.settings.save.weeks?.from], [["pdf"], 2]);
    assert.match(await t.run({ action: "guc.settings", checkText: "every day at 9pm" }, { scope: "subj-mp" }) as string, /^Updated Micro/);
    assert.equal((await t.engine.subject("subj-mp")).settings.check.mode, "custom");
    assert.match(await t.run({ action: "guc.settings", subject: "Embedded", rules: { kinds: { videos: true } } }) as string, /Updated/);
    assert.equal((await t.engine.subject("subj-emb")).settings.save.kinds.videos, true);
    // Invalid structured rules, unreadable words, a course without a subject, and nothing to change.
    assert.ok("error" in (await t.run({ action: "guc.settings", subject: "Embedded", rules: { weeks: { from: 9, to: 2 } } }) as object));
    assert.match((await t.run({ action: "guc.settings", subject: "Embedded", saveText: "the blue ones" }) as { error: string }).error, /couldn't read/);
    assert.match((await t.run({ action: "guc.settings", subject: "DMET 901", drive: { enabled: true } }) as { error: string }).error, /isn't linked/);
    assert.ok("error" in (await t.run({ action: "guc.settings", subject: "Embedded" }) as object));
  } finally { await t.close(); }
});

test("only the owner's data: another owner's rows never show, and a mismatched owner is refused", async () => {
  const t = await open();
  try {
    const other = "owner-b";
    await t.engine.db.query("insert into guc_materials (owner_id, material_id, course_key, week, title, kind, url) values ($1, 'secret1', '1201:64', 'Week: 2026-11-07', 'Secret Lecture', 'Lecture slides', $2)", [other, U("lecture-3.pdf")]);
    await t.engine.db.query("insert into guc_announcements (owner_id, announcement_id, course_key, scope, body) values ($1, 'secret-ann', '1201:64', 'course', 'Secret announcement for B')", [other]);
    await t.engine.db.query("insert into guc_deadlines (owner_id, deadline_id, course_key, title, due, source) values ($1, 'secret-d', '1201:64', 'Secret deadline', '2026-11-09T10:00:00Z', 'x')", [other]);
    await t.engine.db.query("insert into subject_links (owner_id, subject_id, course_key) values ($1, 'b-subject', '1203:64')", [other]);
    const all = [
      await t.run({ action: "guc.materials", subject: "Embedded" }), await t.run({ action: "guc.announcements" }), await t.run({ action: "guc.deadlines" }),
      await t.run({ action: "guc.search", query: "secret" }), await t.run({ action: "guc.read", file: "secret1" }), await t.run({ action: "guc.materials", subject: "b-subject" }),
    ].map((r) => JSON.stringify(r)).join("\n");
    // (The queries themselves are echoed back; the other owner's titles, news, deadline and course never are.)
    assert.doesNotMatch(all, /Secret Lecture|Secret announcement|Secret deadline/);
    assert.ok("error" in (await t.run({ action: "guc.materials", subject: "b-subject" }) as object), "another owner's subject link is not one");
    await assert.rejects(runGucTool({ engine: t.engine, owner: other, subjects: [] }, { action: "guc.schedule" }), /not this owner's/);
  } finally { await t.close(); }
});

test("the Now card gets today's classes, deadlines in 7 days and unread, cached until the data changes", async () => {
  const t = await open();
  try {
    const now = await t.engine.now(NOW);
    assert.deepEqual(now.schedule.map((s) => s.title), ["CSEN 701 Tutorial","CSEN 701 Lecture", "CSEN 702 Lab"]);
    assert.deepEqual(now.deadlines.map((d) => d.title), ["Assignment 2 submission"]);
    assert.ok(now.unread > 0);
    assert.equal(await t.engine.now(NOW), now, "cached");
    const ids = (await t.engine.announcements()).items.map((a) => a.id);
    await t.engine.markRead(ids);
    const after = await t.engine.now(NOW);
    assert.notEqual(after, now);
    assert.equal(after.unread, 0);
    const card = withGuc(localNowCard({ spaces: [], plans: [], today: "2026-11-08" }), after);
    assert.match(renderNow(card), /Schedule: 08:15 CSEN 701 Tutorial \(C7\.301\)/);
    assert.match(renderNow(card), /Deadlines \(7 days\): Assignment 2 submission .* · CSEN 701/);
    assert.deepEqual(gucNow({ slots: [], deadlines: [], unread: 0 }, NOW), { schedule: [], deadlines: [], unread: 0 });
  } finally { await t.close(); }
});

test("the GUC skill is offered only with GUC connected, for study questions or in a subject", () => {
  const has = (q: string, c: object) => clemSkillsFor(q, c).some((s) => s.id === "guc");
  assert.ok(has("what's due this week?", { guc: true }));
  assert.ok(has("explain this", { guc: true, subject: true }));
  assert.ok(!has("what's due this week?", {}));
  assert.ok(!has("write me a poem about cats", { guc: true }));
});

test("end to end: a CLI's kinetra tool call over MCP reaches the GUC tools", async () => {
  const t = await open();
  const endpoint = await kinetraMcp.open(async (request) => ({ result: await runGucTool({ engine: t.engine, owner: t.owner, subjects: SUBJECTS, scope: "subj-emb", now: NOW }, request), pictures: [] }));
  try {
    const res = await fetch(endpoint.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "kinetra", arguments: { action: "guc.materials" } } }) });
    const body = await res.json() as { result: { content: { text: string }[]; isError: boolean } };
    assert.equal(body.result.isError, false);
    assert.match(body.result.content[0].text, /CSEN 701[^]*Lecture 3\.pdf/);
  } finally { endpoint.close(); kinetraMcp.close(); await t.close(); }
});

test("save: a CMS file is saved only when asked (guc.save), once; reading never saves", async () => {
  const t = await open();
  try {
    await t.run({ action: "guc.read", file: "900301" });
    assert.equal((await t.engine.db.query("select * from file_objects")).length, 0, "guc.read saves nothing");
    const saved = await t.run({ action: "guc.save", file: "900301" }) as string;
    assert.match(saved, /^Saved Lecture 3\.pdf to their files \(under its subject\)/);
    const rows = await t.engine.db.query<{ subject_id: string }>("select subject_id from file_objects");
    assert.deepEqual(rows.map((r) => r.subject_id), ["subj-emb"], "only the file asked for, under the course's subject");
    const before = t.binaries();
    assert.match(await t.run({ action: "guc.save", file: "900301" }) as string, /^Already saved/);
    assert.equal(t.binaries(), before, "saved and unchanged: not downloaded again");
    assert.match(String((await t.run({ action: "guc.save", file: "deck1", drive: "Uni/CSEN 701" }) as { error: string }).error), /Google Drive isn't connected/, "Drive needs connecting; the file is still saved");
  } finally { await t.close(); }
});

test("mail: the Inbox lists with previews (the baseline too) and one message opens in full", async () => {
  const t = await open();
  try {
    const list = await t.run({ action: "guc.mail" }) as string;
    assert.match(list, /Student Affairs: Welcome back[^\n]*— Classes start Saturday\./);
    const id = /^- ([\w-]+) ·/m.exec(list)![1];
    const one = await t.run({ action: "guc.mail", id }) as string;
    assert.match(one, /^From: Student Affairs[^]*Subject: Welcome back[^]*\n\nClasses start Saturday\.$/);
    assert.ok("error" in (await t.run({ action: "guc.mail", id: "nope" }) as object));
  } finally { await t.close(); }
});
