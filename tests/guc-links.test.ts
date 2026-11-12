import { test } from "node:test";
import assert from "node:assert/strict";
import { newCourses } from "../core/guc/diff.ts";
import { emptySnapshot, type GucCourse } from "../core/guc/types.ts";
import { urls } from "../core/guc/parse.ts";
import { Engine } from "../desktop/engine/index.ts";
import { fakeGuc, fixture, host, noWait, site } from "./guc-fake.ts";

const course = (key: string, seasonId = Number(key.split(":")[1]), active = true): GucCourse => ({ key, id: Number(key.split(":")[0]), seasonId, season: "S" + seasonId, code: "CSEN " + key.slice(0, 3), name: "Course " + key, active });

test("a new term's courses are news once; the first sync and linked or old courses are not", () => {
  const prev = { ...emptySnapshot(), courses: [course("1201:64")] };
  const next = { ...emptySnapshot(), courses: [course("1201:64"), course("1301:65"), course("1302:65"), course("1303:65", 65, false), course("1100:63")] };
  assert.deepEqual(newCourses(prev, next, new Set(["1302:65"])).map((e) => [e.kind, e.key, e.courseKey]), [["new_course", "course:1301:65", "1301:65"]]);
  assert.deepEqual(newCourses(emptySnapshot(), next, new Set()), [], "the first sync is a baseline");
});

const open = async (pages = site()) => {
  const guc = fakeGuc(pages);
  const engine = await Engine.open("owner-a", host(), { http: guc.http, sleep: noWait, memory: true, jobs: false });
  await engine.connect("student.name", "secret");
  return { engine, guc };
};

test("linking: link, light sync of that course, move, unlink, settings and the live view", async () => {
  const { engine, guc } = await open();
  try {
    assert.deepEqual(await engine.links(), []);
    const before = guc.log.length;
    let v = await engine.link("subj-1", "1201:64");
    assert.equal(v.course?.code, "CSEN 701");
    assert.equal(v.course?.subjectId, "subj-1");
    assert.equal(v.settings.check.mode, "after_lectures", "checks follow the course's lectures by default");
    assert.equal(v.settings.check.times[0].time, "12:00");
    assert.ok(v.nextCheck && v.nextCheck > Date.now());
    assert.deepEqual(v.slots.map((s) => s.type).sort(), ["Lecture", "Tutorial"]);
    await (engine as any).light;
    const light = guc.log.slice(before).map((r) => r.url);
    assert.deepEqual(light, [urls.course(1201, 64)], "a light sync reads only that course's page");
    assert.deepEqual((await engine.links()).map((l) => [l.subjectId, l.courseKey, l.code]), [["subj-1", "1201:64", "CSEN 701"]]);

    // The same course on another subject moves there; a subject's link can change.
    await engine.link("subj-2", "1201:64");
    assert.deepEqual((await engine.links()).map((l) => l.subjectId), ["subj-2"]);
    assert.equal((await engine.subject("subj-1")).course, undefined);
    await engine.link("subj-2", "1203:64");
    assert.deepEqual((await engine.links()).map((l) => l.courseKey), ["1203:64"]);
    await assert.rejects(engine.link("subj-2", "9999:1"), /isn't in your CMS list/);

    v = await engine.setSettings("subj-2", { save: { kinds: { videos: true } } });
    assert.equal(v.settings.save.kinds.videos, true);
    assert.equal(v.settings.save.kinds.slides, true);
    v = await engine.setSettings("subj-2", { check: { mode: "off", times: [], tz: "Africa/Cairo" } });
    assert.equal(v.nextCheck, undefined);
    v = await engine.setSettings("subj-2", { setup: { done: { link: "answered" }, started: 1 } });
    assert.deepEqual(v.settings.setup?.done, { link: "answered" }, "setup state survives with the settings");
    assert.equal(v.settings.save.kinds.videos, true, "other settings stay");

    const checked = await engine.checkNow("subj-2");
    assert.equal(checked.course?.key, "1203:64");
    await assert.rejects(engine.checkNow("subj-1"), /Link a CMS course first/);

    await engine.unlink("subj-2");
    assert.deepEqual(await engine.links(), []);
    assert.equal((await engine.courses()).find((c) => c.key === "1203:64")?.subjectId, undefined);
    await engine.forgetSubject("subj-2");
    assert.equal((await engine.subject("subj-2")).settings.save.kinds.videos, false, "a forgotten subject's settings are gone");

    // Another owner sees none of it.
    const other = await Engine.open("owner-b", host(), { memory: true, jobs: false });
    try { assert.deepEqual(await other.links(), []); } finally { await other.close(); }
  } finally { await engine.close(); }
});

test("a sync that finds unlinked courses of a new term offers them once", async () => {
  const pages = site();
  const { engine } = await open(pages);
  try {
    assert.deepEqual(await engine.newCourses(), [], "nothing after the first sync");
    await engine.link("subj-1", "1201:64");
    pages[urls.home] = fixture("cms-home").replace("Season : 64, Title: Winter 2026", "Season : 65, Title: Spring 2027")
      .replace("(|CSEN702|) Microprocessors (1202)", "(|CSEN802|) Software Engineering (1302)")
      .replace("(|DMET901|) Computer Vision (1203)", "(|DMET902|) Computer Graphics (1303)");
    await engine.sync();
    const found = await engine.newCourses();
    assert.deepEqual(found.map((c) => [c.code, c.name, c.season]), [["CSEN 701", "Embedded Systems Architecture", "Spring 2027"], ["CSEN 802", "Software Engineering", "Spring 2027"], ["DMET 902", "Computer Graphics", "Spring 2027"]]);
    await engine.link("subj-2", found[1].key);
    assert.equal((await engine.newCourses()).length, 2, "a course set up since is not offered");
    await engine.ackNewCourses(found.map((c) => c.key));
    assert.deepEqual(await engine.newCourses(), [], "posted once");
  } finally { await engine.close(); }
});

test("a linked subject's checks are pg-boss schedules that follow its settings", async () => {
  const guc = fakeGuc(site());
  const engine = await Engine.open("owner-c", host(), { http: guc.http, sleep: noWait, memory: true });
  const checks = async () => (await (engine as any).jobs.schedules("guc.check")).map((s: any) => [s.key, s.cron, s.timezone]).sort();
  try {
    await engine.connect("student.name", "secret");
    await engine.link("subj-1", "1201:64");
    assert.deepEqual(await checks(), [["subj-1/m0h12.21d0", "0 12,21 * * 0", "Africa/Cairo"]], "after the Sunday lecture and that evening");
    await engine.setSettings("subj-1", { check: { mode: "custom", times: [{ day: 0, time: "18:00" }, { day: 2, time: "18:00" }, { day: 3, time: "09:30" }], tz: "Africa/Cairo" } });
    assert.deepEqual(await checks(), [["subj-1/m0h18d02", "0 18 * * 0,2", "Africa/Cairo"], ["subj-1/m30h9d3", "30 9 * * 3", "Africa/Cairo"]]);
    await engine.unlink("subj-1");
    assert.deepEqual(await checks(), []);
  } finally { await engine.close(); }
});
