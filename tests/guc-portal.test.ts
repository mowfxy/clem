// The layouts the working Grok bot read (docs/GUC-VPS-ENGINE.md): the CMS student grid, guc-cms-scrapper's course
// cards, CheckGrade's midterms and coursework postback, exam seats, the sTo bounce, and read-only EWS mail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cmsHref, courseworkOptions, nextTranscriptYear, pageState, parseCourseList, parseCoursePage, parseCoursework, parseExamSeats, parseMidterms, portalBounce, portalUrls, postbackForm, weekDay } from "../core/guc/parse.ts";
import { EWS_URL, ewsRequest, findInbox, parseBodies, parseFind } from "../core/guc/ews.ts";
import { GucClient } from "../desktop/engine/guc-client.ts";
import { readMail } from "../desktop/engine/guc-mail.ts";
import { checkGrade, examSeats, fakeEws, fakeGuc, fixture, noWait } from "./guc-fake.ts";

test("the CMS student grid as GUC serves it: Name, Active, Season (the term's title), ID, SeasonId (the link's number)", () => {
  const courses = parseCourseList(fixture("cms-home-grid"));
  assert.deepEqual(courses.map((c) => [c.key, c.code, c.name, c.active, c.season]), [
    ["351:70", "CSEN 301", "Data Structures and Algorithms", true, "Winter 2026"],
    ["45:70", "MATH 301", "Mathematics III", true, "Winter 2026"],
    ["399:70", "PHYST 301", "Physics III", true, "Winter 2026"],
  ], "the season id is SeasonId's 70, never the 2026 in the Season title");
  // The older season layout still reads.
  assert.ok(parseCourseList(fixture("cms-home")).length >= 3);
});

test("a course page as guc-cms-scrapper reads it: content blocks, kinds after the title, absolute links kept", () => {
  const page = parseCoursePage(fixture("cms-course-real"), "351:70");
  assert.equal(page.weeks[0].date, "2026-09-07", "an unpadded week date still reads");
  assert.equal(page.weeks[0].description, "Sorting and searching.");
  assert.deepEqual(page.announcements.map((a) => a.text), ["Quiz 2 is on Sunday in the lecture slot.", "Bring a calculator."]);
  assert.deepEqual(page.materials.map((m) => [m.id, m.title, m.kind]), [["61001", "Lecture 1", "Lecture slides"], ["61002", "Course Outline G3", "Others"]]);
  assert.equal(page.materials[0].url, "https://cms.guc.edu.eg/Uploads/70/351/61001/GUC_351_70_61001_2026-09-07T10_00_00.pdf", "no double slash");
  assert.equal(page.materials[1].url, "https://drive.google.com/file/d/abc/view", "a Drive link is not glued onto the CMS host");
  assert.equal(cmsHref("//Uploads/x.pdf").startsWith("https://"), true);
  assert.equal(weekDay("Week: 2024-9-14"), "2024-09-14");
});

test("CheckGrade: midterms, the course list, and coursework grouped under each assessment", () => {
  const page = checkGrade({ mid701: "17/20" })({ method: "GET", url: portalUrls.grades });
  assert.deepEqual(parseMidterms(page).map((m) => [m.code, m.grade]), [["CSEN 701", "17/20"], ["CSEN 702", "81.5"]]);
  const list = courseworkOptions(page)!;
  assert.match(list.field, /smCrsLst$/);
  assert.deepEqual(list.options.map((o) => o.value), ["17011", "17021"], "not the 'Choose a Course' placeholder");
  const form = postbackForm(page, list.field, "17011");
  assert.equal(form.__VIEWSTATE, "FAKEVIEWSTATE", "the view state travels");
  assert.ok(Object.keys(form).some((k) => k.endsWith("Button1")), "every named input, as the page has it");
  const after = checkGrade()({ method: "POST", url: portalUrls.grades, form });
  const work = parseCoursework(after, list.options[0]);
  assert.equal(work.code, "CSEN 701");
  assert.deepEqual(work.entries.map((e) => [e.name, e.elements.map((x) => `${x.name}=${x.grade}`)]), [["Quiz 1", ["Quiz 1=8 / 10"]], ["Assignment 1", ["Part A=4 / 5", "Part B=5 / 5"]]]);
});

test("exam seats and the portal's sTo bounce", () => {
  const exams = parseExamSeats(examSeats());
  assert.deepEqual(exams.map((e) => [e.code, e.date, e.start, e.hall, e.seat, e.type]), [["CSEN 701", "2026-12-13", "08:30", "C7.301", "27", "Final"], ["CSEN 702", "2026-12-15", "12:00", "H13", "4", "Final"]]);
  assert.equal(portalBounce("<script>sTo('a1b2c3d4')</script>", portalUrls.grades), portalUrls.grades + "?v=a1b2c3d4");
  assert.equal(portalBounce(examSeats(), portalUrls.exams), undefined, "a real page is not bounced");
});

test("mail is read-only: only Get/Find requests can be built, the first read is a baseline, ids are hashed", async () => {
  assert.throws(() => ewsRequest("SendItem", ""), /write_operation_forbidden/);
  assert.throws(() => ewsRequest("UpdateItem", ""), /write_operation_forbidden/);
  assert.match(findInbox(0).headers.SOAPAction, /FindItem$/);

  const inbox = [{ id: "AAMk1", subject: "Hello", from: "Dr A", at: "2026-11-01T08:00:00Z", body: "first" }];
  const guc = fakeGuc({ [EWS_URL]: fakeEws(inbox) });
  const client = new GucClient({ username: "s", password: "secret" }, guc.http, noWait);
  const first = await readMail(client, undefined);
  assert.equal(first.fresh.length, 0, "the first read is a baseline");
  assert.equal(guc.log.filter((r) => r.url === EWS_URL).length, 2, "the baseline's messages are previewed once (not news)");
  assert.equal(first.mail[0].preview, "first");
  inbox.push({ id: "AAMk2", subject: "Lab moved", from: "TA B", at: "2026-11-12T08:00:00Z", body: "Lab 3   moved\n to Thursday." });
  const second = await readMail(client, first.seen, first.mail);
  assert.deepEqual(second.fresh.map((m) => [m.subject, m.preview]), [["Lab moved", "Lab 3 moved to Thursday."]]);
  assert.equal(second.mail[0].subject, "Lab moved", "newest first");
  assert.doesNotMatch(JSON.stringify(second), /AAMk/, "no raw EWS id is kept");
  assert.ok(guc.log.every((r) => r.method === "POST"));

  // A FindItem page without its root folder is an error, not an empty inbox.
  assert.throws(() => parseFind("<Envelope><Body/></Envelope>"), /invalid_pagination/);
  assert.equal(parseBodies("<Envelope/>").size, 0);
});

test("every request looks like a browser and keeps the portal's session cookie (the portal throws a 500 otherwise)", async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const http = async (r: { url: string; headers?: Record<string, string> }) => {
    seen.push({ url: r.url, headers: { ...r.headers } });
    if (!/Mozilla/.test(r.headers?.["User-Agent"] || "")) return { status: 500, headers: {}, body: "Object reference not set to an instance of an object." };
    return { status: 200, headers: { "set-cookie": ["ASP.NET_SessionId=abc; path=/; HttpOnly"] }, body: "<html><body>ok</body></html>" };
  };
  const client = new GucClient({ username: "u", password: "p" }, http as never, noWait);
  assert.equal((await client.page(portalUrls.grades)).status, 200);
  await client.page(portalUrls.exams);
  assert.equal(seen[1].headers.Cookie, "ASP.NET_SessionId=abc", "the second page carries the session");
  assert.equal(seen[0].headers.Cookie, undefined);
});

test("the transcript is read a study year at a time: unread past years first, never a future year, then the newest two", () => {
  const options = ["2028-2029", "2027-2028", "2026-2027", "2025-2026", "2024-2025", "2023-2024", "2022-2023"].map((text, i) => ({ value: String(26 - i), text }));
  const now = new Date(Date.UTC(2026, 10, 13));
  assert.deepEqual(nextTranscriptYear(options, undefined, now), { year: options[3], more: true }, "2025-2026 first, more to come");
  assert.equal(nextTranscriptYear(options, { at: { "2025-2026": 1 } }, now)?.year.text, "2024-2025");
  const all = { at: { "2025-2026": 1, "2024-2025": 1, "2023-2024": 1 }, end: "2023-2024" };
  assert.deepEqual(nextTranscriptYear(options, all, now), { year: options[2], more: false }, "past years done: this year");
  assert.equal(nextTranscriptYear(options, { ...all, at: { ...all.at, "2026-2027": 5 } }, now)?.year.text, "2025-2026", "then whichever of the newest two is older");
  assert.equal(nextTranscriptYear(options, undefined, new Date(Date.UTC(2027, 2, 1)))?.year.text, "2025-2026", "March is still the 2026-2027 study year");
  assert.equal(pageState("<div class='dialog'>Your request to refresh the transcript page has been temporarily paused due to server overload.</div>"), "unavailable", "the once-a-minute limit is not a broken page");
});
