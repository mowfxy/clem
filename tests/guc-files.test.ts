// Seating plans and schedules uploaded as files: the one kind of CMS file Clem reads on its own (docs/GUC-VPS-ENGINE.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fileText, isSeatingFile } from "../core/guc/deadline-ai.ts";
import { fileUpdate } from "../core/guc/deadlines.ts";
import { urls } from "../core/guc/parse.ts";
import type { GucSlot } from "../core/guc/types.ts";
import { Engine } from "../desktop/engine/index.ts";
import { fakeGuc, fixture, host, noWait, site } from "./guc-fake.ts";

// Saturday 14 November 2026, 10:00 in Cairo.
const NOW = Date.parse("2026-11-14T08:00:00Z");
const PLAN = "https://cms.guc.edu.eg/Uploads/1201/64/quiz2-seating.pdf";
const card = (title: string, href: string, id: string) => `<strong>Content:</strong><div class="card mb-4"><div class="card-body"><div><strong>0 - ${title} (Others)</strong></div><div><div><a id="download" download="x" href="${href}">Download</a><input type="button" id="${id}" data-contentid="${id}" /></div></div></div></div>`;
/** CSEN 701's page (the fixture student's tutorial group is T07) with a Quiz 2 post and, optionally, a file. */
const course = (file?: string) => {
  const html = fixture("cms-course").replace("<p>Assignment 1 is due on 20 November 2026 at 11:59 pm. Submit on the CMS.</p>", "<p>Quiz 2 will be held on Tuesday 24/11/2026.</p>");
  return file ? html.replace("<strong>Content:</strong>", file) : html;
};
async function seatingPdf(lines: string[]) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([500, 400]);
  lines.forEach((l, i) => page.drawText(l, { x: 20, y: 370 - i * 18, size: 11, font }));
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}
const PLAN_LINES = ["CSEN 701 Quiz 2 - Seating Plan", "Tuesday 24/11/2026", "Tutorial groups   Hall   Seats", "T01 - T06   H12   1-90", "T07 - T09   Exam Hall 4   1-60", "T10 - T12   H13   1-80"];
async function open(name: string, files: Record<string, Uint8Array> = {}, first = course()) {
  const pages = site(), guc = fakeGuc(pages, { files });
  pages[urls.course(1201, 64)] = first;
  const engine = await Engine.open(name, host(), { http: guc.http, sleep: noWait, memory: true, jobs: false, clock: () => NOW });
  await engine.connect("student.name", "secret");
  return { engine, pages, guc, close: () => engine.close() };
}
const quiz2 = async (e: Engine) => (await e.deadlines()).find((d) => d.code === "CSEN 701" && d.title === "Quiz 2");

test("which files are seating plans or schedules", () => {
  for (const hit of ["Quiz 2 seating plan", "Seating", "Seat plan", "Midterm Schedule", "Final exam seats", "Room distribution", "Hall allocation", "Quiz 2 rooms", "Quiz 2 locations", "In-class assignment schedule", "Exams_Halls"]) assert.ok(isSeatingFile(hit), hit);
  for (const miss of ["Lecture 7 slides", "Sheet 5", "Quiz 2 solution", "Quiz 2 sample", "Quiz 2", "Course schedule", "Midterm revision", "Tutorial 3 schedule", "Seating solution", "Quiz 2 rooms sample"]) assert.ok(!isSeatingFile(miss), miss);
  assert.ok(isSeatingFile("Announcement", "Quiz_2_Seating.pdf"), "the file's name counts too");
});

test("a seating plan's text keeps its start and the student's rows; the rules fill the room of the item its title names", () => {
  const rows = Array.from({ length: 400 }, (_, i) => `T${100 + i} - T${100 + i} Hall ${i % 9} 1-30`);
  const text = fileText(["Quiz 2 Seating", "Group Hall Seats", ...rows, "T13 - T17 Exam Hall 4 1-120", "Ahmed student.name 58-1234 seat 17"].join("\n"), { slots: [{ group: "3MIET T014" } as GucSlot], username: "student.name" });
  assert.ok(text.length <= 4000);
  assert.match(text, /^Quiz 2 Seating\nGroup Hall Seats\n/);
  assert.match(text, /T13 - T17 Exam Hall 4 1-120\nAhmed student\.name 58-1234 seat 17/, "their group's row and their own line survive");
  const slots = [{ group: "3MIET T014", code: "MATH 301" } as GucSlot];
  const tracked = [{ id: "q2", courseKey: "m", title: "Quiz 2", due: "2026-11-17T21:59:00.000Z", source: "announcement", kind: "quiz", timeKnown: false }];
  const u = fileUpdate({ title: "Quiz 2 seating plan", text }, tracked, slots)!;
  assert.deepEqual([u.id, u.place, u.source], ["q2", "Exam Hall 4", "file"]);
  assert.match(u.note!, /^From the file “Quiz 2 seating plan”/);
  assert.equal(fileUpdate({ title: "Seating plan", text }, tracked, slots), undefined, "which item: unclear, nothing changes");
  assert.equal(fileUpdate({ title: "Quiz 3 seating plan", text }, tracked, slots), undefined);
  assert.equal(fileUpdate({ title: "Quiz 2 seating plan", text: "T01 - T05 H12" }, tracked, slots), undefined, "no row for their group: nothing changes");
});

test("a new seating plan sets Exam Hall 4 on the tracked Quiz 2 for the student's group, by the rules, read once, never saved", async () => {
  const bytes = await seatingPdf(PLAN_LINES);
  const t = await open("files-new", { [PLAN]: bytes });
  try {
    assert.equal((await quiz2(t.engine))?.place, undefined);
    t.pages[urls.course(1201, 64)] = course(card("Quiz 2 seating plan", "/Uploads/1201/64/quiz2-seating.pdf", "900777"));
    t.guc.log.length = 0;
    await t.engine.sync();
    const q = (await quiz2(t.engine))!;
    assert.deepEqual([q.place, q.source], ["Exam Hall 4", "file"]);
    const told = await t.engine.db.query<{ title: string }>("select title from guc_events where kind = 'deadline_changed'");
    assert.deepEqual(told.map((e) => e.title), ["CSEN 701 Quiz 2: now in Exam Hall 4"]);
    assert.equal(t.guc.log.filter((x) => x.url === PLAN && x.binary).length, 1, "fetched once");
    assert.equal((await t.engine.db.query("select 1 from file_objects")).length, 0, "not saved");
    t.guc.log.length = 0;
    t.pages[urls.course(1201, 64)] += "<!-- changed -->";
    await t.engine.sync();
    assert.equal(t.guc.log.filter((x) => x.url === PLAN).length, 0, "a file is read once");
    assert.equal((await t.engine.db.query("select 1 from guc_events where kind = 'deadline_changed'")).length, 1, "told once");
  } finally { await t.close(); }
});

test("a course's first read fetches no file, and a failing fetch is skipped quietly and tried at most three times", async () => {
  const withFile = course(card("Quiz 2 seating plan", "/Uploads/1201/64/quiz2-seating.pdf", "900777"));
  const first = await open("files-baseline", { [PLAN]: await seatingPdf(PLAN_LINES) }, withFile);
  try { assert.equal(first.guc.log.filter((x) => x.url === PLAN).length, 0, "the baseline reads nothing"); } finally { await first.close(); }

  const t = await open("files-fail");
  try {
    t.pages[urls.course(1201, 64)] = withFile;
    for (let i = 0; i < 5; i++) { t.pages[urls.course(1201, 64)] += " "; const r = await t.engine.sync(); assert.equal(r.error, undefined); }
    assert.equal(t.guc.log.filter((x) => x.url === PLAN && x.method === "GET").length, 3, "GUC has no such file (404): tried three times, then left");
    assert.equal((await quiz2(t.engine))?.place, undefined);
  } finally { await t.close(); }
});
