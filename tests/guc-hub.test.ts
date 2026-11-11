import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cairo, hubPath, materialFile, parseHubRoute, relativeDue, semesterOrder, sortDeadlines, weekGrid, weekStart } from "../core/guc/hub.ts";
import { Swr } from "../src/guc/swr.ts";
import { Engine } from "../desktop/engine/index.ts";
import { GucError } from "../desktop/engine/errors.ts";
import { fakeGuc, host, noWait, site } from "./guc-fake.ts";

const at = (iso: string) => Date.parse(iso);

test("the GUC week runs Saturday to Thursday in Cairo time, Friday belonging to the week before", () => {
  assert.equal(weekStart(at("2026-11-11T10:00:00Z")), "2026-11-07"); // a Wednesday
  assert.equal(weekStart(at("2026-11-07T08:00:00Z")), "2026-11-07"); // the Saturday itself
  assert.equal(weekStart(at("2026-11-13T12:00:00Z")), "2026-11-07"); // Friday
  // 23:30 UTC on Friday is already Saturday in Cairo.
  assert.equal(weekStart(at("2026-11-13T23:30:00Z")), "2026-11-14");
  assert.equal(cairo(at("2026-11-13T23:30:00Z")).ymd, "2026-11-14");
});

test("the week grid lays slots by day and period and marks today", () => {
  const slot = (day: string, period: number, code: string) => ({ id: day + period + code, day, period, start: "", end: "", code, name: code, type: "Lecture", group: "", location: "H1" });
  const g = weekGrid([slot("Sunday", 1, "CSEN 701"), slot("Sunday", 1, "CSEN 702"), slot("Monday", 7, "DMET 901"), slot("Friday", 2, "X")], "2026-11-07", at("2026-11-09T09:00:00Z"));
  assert.deepEqual(g.days.map((d) => d.name), ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"]);
  assert.deepEqual(g.days.map((d) => d.date), ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
  assert.deepEqual(g.days.map((d) => d.today), [false, false, true, false, false, false]);
  assert.equal(g.periods.length, 7, "grows to the latest period used");
  assert.deepEqual(g.days[1].cells[0].map((s) => s.code), ["CSEN 701", "CSEN 702"], "a split slot keeps both classes");
  assert.equal(g.days[2].cells[6][0].code, "DMET 901");
  assert.equal(weekGrid([], "2026-11-07", 0).periods.length, 5, "five periods at least");
});

test("deadlines sort soonest first, past ones last, with relative times in Cairo", () => {
  const now = at("2026-11-11T10:00:00Z"); // 12:00 in Cairo
  const list = sortDeadlines([{ id: "a", due: "2026-11-20T21:59:00Z" }, { id: "past1", due: "2026-11-01T10:00:00Z" }, { id: "b", due: "2026-11-11T12:00:00Z" }, { id: "past2", due: "2026-11-10T10:00:00Z" }], now);
  assert.deepEqual(list.map((d) => d.id + (d.past ? "!" : "")), ["b", "a", "past2!", "past1!"]);
  assert.deepEqual(relativeDue("2026-11-11T10:30:00Z", now), { label: "in 30 min", date: "Wed 11 Nov, 12:30", tone: "soon" });
  assert.equal(relativeDue("2026-11-11T16:00:00Z", now).label, "today at 18:00");
  assert.equal(relativeDue("2026-11-12T21:59:00Z", now).label, "tomorrow at 23:59");
  assert.equal(relativeDue("2026-11-15T07:00:00Z", now).label, "Sun at 09:00");
  assert.equal(relativeDue("2026-11-15T07:00:00Z", now).tone, "later");
  assert.equal(relativeDue("2026-11-20T21:59:00Z", now).label, "in 9 days");
  assert.equal(relativeDue("2026-11-10T10:00:00Z", now).label, "yesterday");
  assert.equal(relativeDue("2026-11-08T10:00:00Z", now).label, "3 days ago");
  assert.equal(relativeDue("2026-11-11T09:20:00Z", now).label, "40 min ago");
});

test("hub routes round-trip, unknown tabs fall back to the schedule", () => {
  assert.deepEqual(parseHubRoute("/app/guc"), { tab: "schedule", id: undefined, sub: undefined });
  assert.deepEqual(parseHubRoute(hubPath("cms", "1201:64", "900301")), { tab: "cms", id: "1201:64", sub: "900301" });
  assert.deepEqual(parseHubRoute("/app/guc/announcements/abc123"), { tab: "announcements", id: "abc123", sub: undefined });
  assert.equal(parseHubRoute("/app/guc/nope")!.tab, "schedule");
  assert.equal(parseHubRoute("/app/gucx"), null);
  assert.equal(parseHubRoute("/app/space/x"), null);
});

test("semesters order by year then term; file names come from the download URL", () => {
  assert.deepEqual(["Spring 2026", "Winter 2025", "Summer 2026", "Winter 2026"].sort((a, b) => semesterOrder(a) - semesterOrder(b)), ["Winter 2025", "Spring 2026", "Summer 2026", "Winter 2026"]);
  assert.deepEqual(materialFile("https://cms.guc.edu.eg/Uploads/1201/64/lecture-3.pdf", "Lecture 3"), { name: "Lecture 3.pdf", type: "application/pdf" });
  assert.equal(materialFile("https://cms.guc.edu.eg/Uploads/x/Deck%201.pptx", "").name, "Deck 1.pptx");
  assert.equal(materialFile("https://cms.guc.edu.eg/Uploads/x/notes", "Notes").type, "application/octet-stream");
});

test("the cache shows what it has at once, shares one fetch, keeps old data on failure and refreshes on demand", async () => {
  const saved = new Map<string, unknown>();
  let t = 1000, calls = 0, fail = false;
  const cache = new Swr({ get: async (k) => saved.get(k), set: async (k, v) => { saved.set(k, v); } }, () => t);
  const fetcher = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); if (fail) throw Error("offline"); return { n: calls }; };
  const [a, b] = await Promise.all([cache.revalidate("k", fetcher), cache.revalidate("k", fetcher)]);
  assert.deepEqual([a, b, calls], [{ n: 1 }, { n: 1 }, 1], "two asks, one fetch");
  assert.deepEqual(saved.get("k"), { data: { n: 1 }, at: 1000 });
  t = 2000;
  assert.deepEqual(await cache.revalidate("k", fetcher, 5000), { n: 1 }, "fresh within maxAge: no fetch");
  assert.equal(calls, 1);
  fail = true;
  assert.deepEqual(await cache.revalidate("k", fetcher), { n: 1 }, "a failure keeps the old data");
  assert.equal(cache.get("k")!.error, "offline");

  // A new session: the saved copy shows before any fetch, and a fetch that finished first is not overwritten by it.
  const next = new Swr({ get: async (k) => saved.get(k), set: async (k, v) => { saved.set(k, v); } }, () => t);
  let seen = 0;
  next.subscribe("k", () => seen++);
  await next.hydrate("k");
  assert.deepEqual(next.get("k")!.data, { n: 1 });
  assert.ok(seen >= 1, "subscribers hear about it");
  fail = false; t = 3000;
  await next.revalidate("k", fetcher);
  assert.deepEqual(next.get("k")!.data, { n: 3 });
  t = 4000;
  await next.revalidateAll();
  assert.deepEqual(next.get("k")!.data, { n: 4 }, "revalidateAll refreshes watched keys with their last fetcher");
  const late = new Swr({ get: async () => ({ data: "old", at: 1 }), set: async () => {} }, () => 5);
  await late.revalidate("x", async () => "new");
  await late.hydrate("x");
  assert.equal(late.get("x")!.data, "new");
  next.mutate<{ n: number }>("k", (d) => ({ n: d!.n + 10 }));
  assert.deepEqual(next.get("k")!.data, { n: 14 }, "optimistic change");
  assert.deepEqual((saved.get("k") as { data: unknown }).data, { n: 14 }, "and kept");
});

/** An engine synced from the fixture GUC, with course 1201 linked to a subject. */
async function synced(owner: string, files: Record<string, Uint8Array> = {}, temp?: string) {
  const guc = fakeGuc(site(), { files });
  const engine = await Engine.open(owner, host({ temp }), { http: guc.http, sleep: noWait, memory: true, jobs: false });
  await engine.connect("student.name", "secret");
  await engine.db.query("insert into subject_links (owner_id, subject_id, course_key) values ($1, 'circuits', '1201:64')", [owner]);
  return { engine, guc };
}

test("the hub's reads: overview, courses, schedule, materials by week, grades and deadlines, all for one owner", async () => {
  const { engine } = await synced("hub-1");
  const other = await synced("hub-2");
  try {
    const o = await engine.overview();
    assert.equal(o.connected, true);
    assert.deepEqual(o.counts, { courses: 4, unread: 9, materials: 9, deadlines: o.counts.deadlines, grades: 4 });
    assert.ok(o.counts.deadlines >= 2);

    const courses = await engine.courses();
    assert.deepEqual(courses.slice(0, 3).map((c) => [c.code, c.subjectId, c.materials]), [["CSEN 701", "circuits", 3], ["CSEN 702", undefined, 3], ["DMET 901", undefined, 3]]);
    assert.equal(courses.at(-1)!.active, false, "inactive courses come last");

    const schedule = await engine.schedule("2026-11-07");
    assert.equal(schedule.slots.length, 5);
    assert.ok(schedule.slots.every((s) => s.start && s.day));

    const m = await engine.materials("1201:64");
    assert.deepEqual(m.weeks.map((w) => [w.date, w.items.map((i) => i.name)]), [["2026-11-07", ["Lecture 3.pdf", "Tutorial 3.pdf"]], ["2026-10-31", ["Lecture 1.pdf"]]]);
    assert.equal(m.weeks[0].items[0].type, "application/pdf");
    assert.equal((await engine.materials("9999:1")).weeks.length, 0);

    const grades = await engine.grades();
    assert.deepEqual(grades.map((g) => g.semester), ["Spring 2026", "Winter 2025", "Winter 2025", "Winter 2025"], "newest semester first");
    assert.deepEqual(grades.map((g) => g.latest), [true, false, false, false]);

    const deadlines = await engine.deadlines();
    assert.ok(deadlines.every((d, i) => i === 0 || deadlines[i - 1].due <= d.due), "sorted by due date");
    assert.ok(deadlines.some((d) => d.code === "CSEN 701" && /Assignment 1/.test(d.title)));

    // Another owner's rows never show.
    await other.engine.db.query("update guc_announcements set read_at = now() where owner_id = 'hub-2'");
    assert.equal((await engine.overview()).counts.unread, 9);
  } finally { await engine.close(); await other.engine.close(); }
});

test("announcements page newest first by cursor, filter by course, and marking read is owner-scoped and idempotent", async () => {
  const { engine } = await synced("hub-3");
  try {
    // 45 more in one course, so there are two pages.
    for (let i = 0; i < 45; i++) await engine.db.query("insert into guc_announcements (owner_id, announcement_id, course_key, scope, body, first_seen) values ('hub-3', $1, '1202:64', 'course', $2, now() + make_interval(secs => $3))", ["extra" + String(i).padStart(2, "0"), "Extra note " + i, i + 1]);
    const first = await engine.announcements();
    assert.equal(first.items.length, 40);
    assert.equal(first.items[0].id, "extra44", "newest first");
    assert.ok(first.next);
    const second = await engine.announcements({ cursor: first.next });
    assert.equal(second.items.length, 14);
    assert.equal(second.next, undefined);
    assert.equal(new Set([...first.items, ...second.items].map((a) => a.id)).size, 54, "no row twice across pages");

    const one = await engine.announcements({ courseKey: "1201:64" });
    assert.ok(one.items.length === 3 && one.items.every((a) => a.courseKey === "1201:64" && a.code === "CSEN 701"));

    const ids = one.items.map((a) => a.id);
    assert.deepEqual(await engine.markRead(ids), { marked: 3 });
    assert.deepEqual(await engine.markRead(ids), { marked: 0 });
    assert.ok((await engine.announcements({ courseKey: "1201:64" })).items.every((a) => a.read));
    assert.equal((await engine.courses()).find((c) => c.key === "1201:64")!.unread, 0);
  } finally { await engine.close(); }
});

test("search finds file names and announcements across courses; every word must match", async () => {
  const { engine } = await synced("hub-4");
  try {
    const hits = await engine.search("lecture 3");
    assert.deepEqual([...new Set(hits.filter((h) => h.type === "material").map((h) => h.title))], ["Lecture 3"]);
    assert.ok(hits.some((h) => h.code === "CSEN 702"), "across courses");
    const quiz = await engine.search("quiz tutorial");
    assert.ok(quiz.length && quiz.every((h) => h.type === "announcement" && /Quiz 1/.test(h.snippet)));
    assert.deepEqual(await engine.search("100%_"), [], "LIKE wildcards are literal");
    assert.deepEqual(await engine.search("x"), []);
  } finally { await engine.close(); }
});

test("a CMS file is fetched once on demand into a temp folder, never into the workspace, and removed on close", async () => {
  const temp = await mkdtemp(join(tmpdir(), "clem-guc-test-"));
  const pdf = new TextEncoder().encode("%PDF-1.4 fake");
  const { engine, guc } = await synced("hub-5", { "https://cms.guc.edu.eg/Uploads/1201/64/lecture-3.pdf": pdf }, temp);
  try {
    const [a, b] = await Promise.all([engine.file("900301"), engine.file("900301")]);
    assert.deepEqual({ ...a, path: undefined }, { id: "900301", name: "Lecture 3.pdf", type: "application/pdf", size: pdf.length, stored: false, path: undefined });
    assert.equal(a.path, b.path);
    assert.equal(guc.log.filter((r) => r.binary).length, 1, "one download for two asks");
    assert.ok(a.path.startsWith(temp));
    assert.equal((await engine.db.query("select * from file_objects")).length, 0, "nothing is recorded as saved");
    await assert.rejects(engine.file("nope"), (e: GucError) => /no longer on the CMS/.test(e.message));
    await assert.rejects(engine.file("900302"), (e: GucError) => e.kind === "unavailable", "a missing file is a friendly failure");
  } finally { await engine.close(); }
  assert.deepEqual(await readdir(temp).catch(() => []), [], "the temp copies go when the engine closes");
  await rm(temp, { recursive: true, force: true });
});
