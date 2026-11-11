import { test } from "node:test";
import assert from "node:assert/strict";
import { urls } from "../core/guc/parse.ts";
import { diffSnapshots } from "../core/guc/diff.ts";
import { emptySnapshot } from "../core/guc/types.ts";
import { Engine } from "../desktop/engine/index.ts";
import { GucError } from "../desktop/engine/errors.ts";
import { GucClient, login, type Http } from "../desktop/engine/guc-client.ts";
import { fakeGuc, fixture, host, noWait, site } from "./guc-fake.ts";

test("connecting checks the password, keeps it encrypted, and the first sync is a quiet baseline", async () => {
  const pages = site(), guc = fakeGuc(pages), h = host();
  const engine = await Engine.open("owner-1", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    const progress: string[] = [];
    const status = await engine.connect("student.name", "secret", (p) => progress.push(p.label));
    assert.equal(status.connected, true);
    assert.equal(status.username, "student.name");
    assert.equal(status.courses, 4);
    assert.deepEqual(h.store.get("guc-owner-1"), { username: "student.name", password: "secret", domain: "" });
    assert.ok(progress.includes("Checking your courses… 3 of 3"), progress.join(" | "));
    // First sync: the active courses of the newest season are read for announcements, nothing is news yet.
    const courseRequests = guc.log.filter((r) => r.url.includes("CourseViewStn")).map((r) => r.url);
    assert.equal(courseRequests.length, 3);
    assert.equal((await engine.db.query("select * from guc_events")).length, 0);
    assert.equal((await engine.db.query("select * from guc_grades where owner_id = 'owner-1'")).length, 4);
    assert.equal((await engine.db.query("select * from guc_schedule_slots")).length, 5);
    assert.ok((await engine.db.query("select * from guc_deadlines")).length >= 2);
    assert.match(JSON.stringify(await engine.db.query("select * from guc_snapshots")), /^(?!.*secret)/, "the password is never in the database");
  } finally { await engine.close(); }
});

test("an incremental sync reads only linked courses, skips unchanged pages and turns changes into events", async () => {
  const pages = site(), guc = fakeGuc(pages, { etags: true }), h = host();
  const engine = await Engine.open("owner-2", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    await engine.db.query("insert into subject_links (owner_id, subject_id, course_key) values ('owner-2', 'subject-a', '1201:64')");
    guc.log.length = 0;
    let status = await engine.sync();
    assert.deepEqual(guc.log.map((r) => r.url), [urls.home, urls.schedule, urls.transcript, urls.course(1201, 64)], "only the linked course");
    assert.ok(guc.log.every((r) => r.conditional), "every page is asked for conditionally");
    assert.equal(status.stats!.requests, 4);
    assert.equal(status.stats!.skipped, 4);
    assert.equal(status.stats!.changed, 0);

    pages[urls.course(1201, 64)] = fixture("cms-course")
      .replace("</div>\n    </div>\n  </div>\n  <div class=\"weeksdata\">", `<p>Project milestone 2 deadline is 3 December 2026.</p></div>\n    </div>\n  </div>\n  <div class="weeksdata">`)
      .replace("<strong>Content:</strong>", '<strong>Content:</strong><div class="card mb-4"><div class="card-body"><div><strong>0 - Lecture 4 (Lecture slides)</strong></div><div><div><a id="download" download="L4" href="/Uploads/1201/64/lecture-4.pdf">Download</a><input type="button" id="900401" data-contentid="900401" /></div></div></div></div>')
      .replace("20 November 2026", "22 November 2026");
    pages[urls.transcript] = fixture("transcript").replace("<td>CSEN603</td><td>Software Engineering</td><td></td><td></td>", "<td>CSEN603</td><td>Software Engineering</td><td>1.70</td><td>B+</td>");
    pages[urls.schedule] = fixture("schedule").replace("C6.204", "C6.205");
    pages[urls.course(1202, 64)] += "<!-- changed, but not linked -->";
    guc.log.length = 0;
    status = await engine.sync();
    assert.equal(guc.log.filter((r) => r.url.includes("CourseViewStn")).length, 1);
    const kinds = (await engine.db.query<{ kind: string }>("select kind from guc_events order by kind")).map((e) => e.kind);
    // The edited announcement (its date moved) reads as new, beside the new milestone paragraph.
    assert.deepEqual(kinds, ["deadline_added", "deadline_changed", "new_announcement", "new_announcement", "new_grade", "new_material", "schedule_changed"], kinds.join());
    assert.equal(status.stats!.events, 7);

    // The same changes seen again are not news twice.
    guc.log.length = 0;
    status = await engine.sync();
    assert.equal(status.stats!.events, 0);
    assert.equal((await engine.db.query("select * from guc_events")).length, 7);
    assert.equal((await engine.db.query("select * from guc_snapshots")).length, 4, "the latest snapshots are kept, older ones pruned at 5");
  } finally { await engine.close(); }
});

test("a content hash skips pages that come back identical without an ETag", async () => {
  const pages = site(), guc = fakeGuc(pages), h = host();
  const engine = await Engine.open("owner-3", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    // Only the view state changes between loads.
    pages[urls.home] = pages[urls.home].replace("FAKEVIEWSTATE", "OTHERVIEWSTATE");
    const status = await engine.sync();
    assert.equal(status.stats!.changed, 0);
    assert.equal(status.stats!.skipped, 3);
  } finally { await engine.close(); }
});

test("logins are retried as GUC\\username, and failures are typed and told once", async () => {
  const guc = fakeGuc(site(), { domain: "GUC" });
  const client = await login("student.name", "secret", urls.home, guc.http, noWait);
  assert.equal(client.domain, "GUC");
  assert.deepEqual(guc.log.map((r) => r.domain), ["", "GUC"]);
  await assert.rejects(login("student.name", "wrong", urls.home, guc.http, noWait), (e: GucError) => e.kind === "auth" && !/wrong/.test(e.message));

  const offline: Http = async () => { throw Object.assign(Error("getaddrinfo ENOTFOUND cms.guc.edu.eg"), { code: "ENOTFOUND" }); };
  const c = new GucClient({ username: "a", password: "b" }, offline, noWait);
  await assert.rejects(c.page(urls.home), (e: GucError) => e.kind === "offline");
  assert.equal(c.requests, 3, "network errors are retried with backoff");
  const down: Http = async () => ({ status: 503, headers: {}, body: "Service Unavailable" });
  await assert.rejects(new GucClient({ username: "a", password: "b" }, down, noWait).page(urls.home), (e: GucError) => e.kind === "unavailable");
  const loginPage: Http = async () => ({ status: 200, headers: {}, body: '<form><input type="password"></form>' });
  await assert.rejects(new GucClient({ username: "a", password: "b" }, loginPage, noWait).page(urls.home), (e: GucError) => e.kind === "auth");
  const portalClosed: Http = async (r) => r.url.includes("Transcript") ? { status: 302, headers: { location: "/student_ext/Main/MessagePage.aspx?message=Page+will+be+available+from+1+Dec" }, body: "" } : { status: 200, headers: {}, body: "Page will be available from 1 Dec" };
  assert.equal((await new GucClient({ username: "a", password: "b" }, portalClosed, noWait).page(urls.transcript)).unavailable, true);

  const pages = site(), h = host(), flaky = fakeGuc(pages);
  const engine = await Engine.open("owner-4", h, { http: flaky.http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    pages[urls.home] = "<html><body>Something new</body></html>";
    await assert.rejects(engine.sync(), (e: GucError) => e.kind === "site_changed");
    await assert.rejects(engine.sync(), (e: GucError) => e.kind === "site_changed");
    assert.equal(h.notices.length, 1, "one notice, not one per failed sync");
    assert.equal((await engine.status()).error?.kind, "site_changed");
    pages[urls.home] = fixture("cms-home");
    assert.equal((await engine.sync()).error, undefined);
    const status = await engine.disconnect();
    assert.equal(status.connected, false);
    assert.equal(h.store.has("guc-owner-4"), false);
    assert.equal((await engine.db.query("select * from guc_courses")).length, 0);
  } finally { await engine.close(); }
});

test("the diff only reports courses, grades and schedules it has seen before", () => {
  const prev = emptySnapshot(), next = emptySnapshot();
  next.materials.push({ id: "1", courseKey: "1:1", week: "w", title: "t", kind: "File", url: "" });
  next.grades.push({ id: "g", semester: "s", code: "C", name: "n", hours: 6, numeric: 1, letter: "A" });
  assert.equal(diffSnapshots(prev, next, { courses: [], grades: false, schedule: false }).length, 0);
  assert.deepEqual(diffSnapshots(prev, next, { courses: ["1:1"], grades: true, schedule: false }).map((e) => e.key), ["mat:1", "grade:g:A"]);
});
