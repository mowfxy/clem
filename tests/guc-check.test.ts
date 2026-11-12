import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { urls } from "../core/guc/parse.ts";
import { Engine } from "../desktop/engine/index.ts";
import type { DriveMirror } from "../desktop/engine/drive-mirror.ts";
import { fakeGuc, fixture, host, noWait, site } from "./guc-fake.ts";

const U = (f: string) => "https://cms.guc.edu.eg/Uploads/1201/64/" + f;
const bytes = (s: string) => new TextEncoder().encode("%PDF-1.4 " + s);
const SAME = bytes("the same slides posted twice");
const files = () => ({ [U("lecture-1.pdf")]: SAME, [U("lecture-3.pdf")]: SAME, [U("tutorial-3.pdf")]: bytes("tutorial three") });

function fakeDrive(o: { connected?: boolean } = {}) {
  const calls = { folders: [] as string[], uploads: [] as { folder: string; name: string; type: string }[] };
  let n = 0;
  const drive: DriveMirror & { on: boolean } = {
    on: o.connected ?? true,
    connected: async () => drive.on,
    // Ids say where a folder sits: "root/Clem/GUC/…".
    folder: async (parent, name) => { calls.folders.push(`${parent}/${name}`); return `${parent}/${name}`; },
    upload: async (folder, name, path, type) => { await stat(path); calls.uploads.push({ folder, name, type }); return { id: "d" + ++n }; },
  };
  return { drive, calls };
}

async function open(o: { etags?: boolean; drive?: DriveMirror; pages?: Record<string, string>; files?: Record<string, Uint8Array> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "clem-check-"));
  const pages = o.pages || site(), guc = fakeGuc(pages, { etags: o.etags ?? true, files: o.files || files() });
  const h = host({ files: join(dir, "Files"), drive: o.drive });
  const engine = await Engine.open("owner-a", h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
  await engine.connect("student.name", "secret");
  await engine.link("subj-1", "1201:64");
  await (engine as any).light;
  const close = async () => { await engine.close(); await rm(dir, { recursive: true, force: true }); };
  return { engine, guc, h, dir, pages, close, since: () => { const at = guc.log.length; return () => guc.log.slice(at); } };
}

test("a check downloads only what the rules keep, stores the same bytes once, and an unchanged page costs one request", async () => {
  const t = await open();
  try {
    await t.engine.setSettings("subj-1", { save: { kinds: { slides: true, assignments: false, sheets: false, other: false } } });
    let log = t.since();
    const first = await t.engine.check("subj-1", "now");
    const asked = log();
    assert.deepEqual(asked.filter((r) => r.binary).map((r) => r.url).sort(), [U("lecture-1.pdf"), U("lecture-3.pdf")], "only the slides");
    assert.equal(asked.filter((r) => !r.binary).length, 1, "the course page, asked conditionally");
    assert.ok(asked[0].conditional);
    assert.deepEqual([first?.saved, first?.deduped, first?.requests, first?.pageChanged], [2, 1, 3, false]);
    // One copy on disk under its hash, shown twice in Files as the same bytes.
    const stored = await readdir(join(t.dir, "Files", "GUC"));
    assert.equal(stored.length, 1);
    assert.deepEqual(new Uint8Array(await readFile(join(t.dir, "Files", "guc_900101.blob"))), SAME);
    assert.equal((await stat(join(t.dir, "Files", "guc_900301.blob"))).nlink, 3, "a hard link, not a copy");

    log = t.since();
    const again = await t.engine.check("subj-1", "schedule");
    assert.deepEqual([again?.saved, again?.requests, log().length], [0, 1, 1], "nothing changed: one 304, zero downloads");

    // New rules: only the newly kept file, without reading the page again.
    await t.engine.setSettings("subj-1", { save: { kinds: { assignments: true } } });
    log = t.since();
    const rules = await t.engine.check("subj-1", "rules");
    assert.deepEqual(log().map((r) => r.url), [U("tutorial-3.pdf")]);
    assert.equal(rules?.saved, 1);

    const view = await t.engine.subject("subj-1");
    assert.deepEqual([view.storage.files, view.lastCheck?.saved], [3, 1]);

    const rows = await t.engine.db.query<{ trigger: string; requests: number; saved: number; page_changed: boolean }>("select trigger, requests, saved, page_changed from guc_checks where owner_id = 'owner-a' order by id");
    assert.deepEqual(rows.map((r) => [r.trigger, r.requests, r.saved]), [["now", 3, 2], ["schedule", 1, 0], ["rules", 1, 1]], "every check is recorded for the perf pass");
    const inbox = await t.engine.inbox();
    assert.deepEqual(inbox.filter((i) => i.kind === "file_saved").map((i) => [i.subjectId, i.file?.name, i.file?.type]).sort(),
      [["subj-1", "Lecture 1.pdf", "application/pdf"], ["subj-1", "Lecture 3.pdf", "application/pdf"], ["subj-1", "Tutorial 3.pdf", "application/pdf"]]);
    await t.engine.ackInbox(inbox.map((i) => i.key));
    assert.deepEqual(await t.engine.inbox(), [], "shown once");
  } finally { await t.close(); }
});

test("a changed file is fetched again, and a size rule asks GUC first", async () => {
  const f = files(), t = await open({ files: f });
  try {
    await t.engine.setSettings("subj-1", { save: { kinds: { slides: true, assignments: false, sheets: false, other: false } } });
    await t.engine.check("subj-1", "now");
    t.pages[urls.course(1201, 64)] = fixture("cms-course").replace("lecture-3.pdf", "lecture-3-v2.pdf");
    f[U("lecture-3-v2.pdf")] = bytes("lecture three, corrected");
    let log = t.since();
    const changed = await t.engine.check("subj-1", "now");
    assert.deepEqual(log().filter((r) => r.binary).map((r) => r.url), [U("lecture-3-v2.pdf")], "only the replaced file");
    assert.equal(changed?.saved, 1);
    assert.equal((await readdir(join(t.dir, "Files", "GUC"))).length, 2, "old bytes kept: lecture 1 still uses them");

    // Under 1 MB: a HEAD first; a bigger file is never downloaded.
    f[U("tutorial-3.pdf")] = new Uint8Array(2 * 1024 * 1024);
    await t.engine.setSettings("subj-1", { save: { kinds: { assignments: true }, maxMB: 1 } });
    log = t.since();
    const sized = await t.engine.check("subj-1", "rules");
    assert.deepEqual(log().map((r) => [r.method, r.url]), [["HEAD", U("tutorial-3.pdf")]]);
    assert.equal(sized?.saved, 0);
  } finally { await t.close(); }
});

test("checks of one subject run one at a time, and nothing is saved for an unlinked subject", async () => {
  const t = await open();
  try {
    const [a, b] = await Promise.all([t.engine.check("subj-1", "now"), t.engine.check("subj-1", "now")]);
    assert.equal((a?.saved || 0) + (b?.saved || 0), 3, "the second found the first's work done");
    await assert.rejects(t.engine.check("subj-x", "now"), /Link a CMS course first/);
  } finally { await t.close(); }
});

test("Drive copy: week folders, no duplicates, unchanged files skipped, and a disconnected Drive asks to reconnect", async () => {
  const { drive, calls } = fakeDrive();
  const t = await open({ drive });
  try {
    await t.engine.setSettings("subj-1", { drive: { enabled: true } });
    const first = await t.engine.check("subj-1", "now");
    assert.equal(first?.uploaded, 3, "lecture 1 and 3 hold the same bytes but sit in different week folders");
    const course = "root/Clem/GUC/CSEN 701 Embedded Systems Architecture";
    assert.deepEqual([...calls.folders].sort(), ["root/Clem", "root/Clem/GUC", course, course + "/Week 2026-10-31", course + "/Week 2026-11-07"], "Clem/GUC/<course>/<week>, each made once");
    assert.equal(calls.uploads.length, 3, "three files, one per week folder and name");
    assert.ok(calls.uploads.every((u) => u.type === "application/pdf"));
    let v = await t.engine.subject("subj-1");
    assert.deepEqual([v.drive.copied, v.drive.waiting, v.drive.error, v.drive.path], [3, 0, undefined, "Clem/GUC/CSEN 701 Embedded Systems Architecture"]);

    const again = await t.engine.copyToDrive("subj-1");
    assert.deepEqual([again.uploaded, calls.uploads.length, calls.folders.length], [0, 3, 5], "unchanged: nothing sent, folders looked up once");

    drive.on = false;
    await t.engine.setSettings("subj-1", { drive: { enabled: true, folderId: "chosen", folderName: "My GUC" } });
    const off = await t.engine.copyToDrive("subj-1");
    assert.equal(off.error, "reconnect");
    v = await t.engine.subject("subj-1");
    assert.deepEqual([v.drive.error, v.drive.waiting, v.drive.path], ["reconnect", 3, "My GUC"], "a new folder waits for Drive");
    drive.on = true;
    const moved = await t.engine.copyToDrive("subj-1");
    assert.equal(moved.uploaded, 3);
    assert.ok(calls.folders.slice(5).every((f) => f.startsWith("chosen/")), "into the chosen folder's week folders");
    assert.equal((await t.engine.subject("subj-1")).drive.error, undefined);
  } finally { await t.close(); }
});

test("schedules reconcile: only the lines that changed are added or removed", async () => {
  const guc = fakeGuc(site(), { files: files() });
  const engine = await Engine.open("owner-c", host(), { http: guc.http, sleep: noWait, memory: true });
  const reschedule = (id: string) => (engine as any).reschedule(id);
  try {
    await engine.connect("student.name", "secret");
    await engine.link("subj-1", "1201:64");
    assert.deepEqual(await reschedule("subj-1"), { added: 0, removed: 0 }, "already in step");
    const times = (t: string[]) => ({ mode: "custom" as const, times: t.map((time) => ({ day: 0, time })), tz: "Africa/Cairo" });
    await engine.setSettings("subj-1", { check: times(["09:00", "18:30"]) });
    await engine.setSettings("subj-1", { check: { ...times(["09:00", "18:30"]), times: [...times(["09:00", "18:30"]).times, { day: 1, time: "18:30" }] } });
    const lines = (await (engine as any).jobs.schedules("guc.check")).map((s: any) => s.key).sort();
    assert.deepEqual(lines, ["subj-1/m0h9d0", "subj-1/m30h18d01"]);
    await engine.setSettings("subj-1", { check: { mode: "custom", times: [{ day: 0, time: "09:00" }], tz: "Africa/Cairo", every: { minutes: 120, from: "10:00", to: "14:00", days: [6] } } });
    assert.deepEqual((await (engine as any).jobs.schedules("guc.check")).map((s: any) => [s.key, s.cron]).sort(), [["subj-1/m0h10.12.14d6", "0 10,12,14 * * 6"], ["subj-1/m0h9d0", "0 9 * * 0"]]);
    assert.deepEqual(await reschedule("subj-1"), { added: 0, removed: 0 });
    await engine.unlink("subj-1");
    assert.deepEqual(await (engine as any).jobs.schedules("guc.check"), []);
  } finally { await engine.close(); }
});
