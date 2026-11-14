// The main thread speaks only for what is true and the student's own (docs/MAIN-THREAD.md "Proactivity"): mail is
// judged by who it is for, a thing is said once, and nothing is posted on first run.
import test from "node:test";
import assert from "node:assert/strict";
import { cardsIn } from "../core/guc/cards.ts";
import { codesIn } from "../core/guc/codes.ts";
import { diffSnapshots } from "../core/guc/diff.ts";
import { mailAbout } from "../core/guc/mail-about.ts";
import { emptySnapshot, type GucCourse, type GucMail } from "../core/guc/types.ts";
import { importance, type Change } from "../core/proactivity/attention.ts";
import { cairoAt } from "../core/proactivity/settings.ts";
import { planSweep } from "../core/proactivity/sweep.ts";
import { snapshotOf } from "../core/proactivity/snapshot.ts";
import { Engine } from "../desktop/engine/index.ts";
import { host as fakeHost } from "./guc-fake.ts";

const course = (key: string, code: string, name: string, seasonId = 70): GucCourse => ({ key, id: Number(key.split(":")[0]), seasonId, season: "Winter 2026", code, name, active: true });
// One student's term, and a course of an older term they are no longer in.
const COURSES = [course("351:70", "CSEN 301", "Data structures and Algorithms"), course("45:70", "MATH 301", "Mathematics III"), course("20:70", "ELCT 301", "Electrical Circuits I"), course("9:69", "CSEN 202", "Introduction to Computer Programming", 69)];
const mail = (m: Partial<GucMail>): GucMail => ({ id: "m" + Math.random().toString(36).slice(2), from: "Someone <someone@guc.edu.eg>", subject: "", received: "2026-11-12T09:00:00Z", preview: "", attachments: false, read: false, ...m });
const about = (m: Partial<GucMail>) => mailAbout(mail(m), { courses: COURSES, username: "sara.adel" });

const ENROLLED = { from: "GUC Notification System (DO NOT REPLY) <notify@guc.edu.eg>", subject: "Notification System: MATH301 Extra Lecture [Group: Winter 2026 - MATH 301 - 3MIET2 (Lecture)]", preview: "To the students of Lecture Group 2: We have an extra lecture this Thur 12/11 at 3:45 in H10.", to: "" };
const MASS = { from: "English Centre <english.centre@guc.edu.eg>", subject: "RE: Winter 2026: AE & AS Midterm Writing and Computerized exams from Saturday to Thursday", preview: "Dear winter 2026 AE & AS Students, A kind reminder.", to: "Winter 2026 Students" };
const OTHER = { from: "Dr. Hany <hany@guc.edu.eg>", subject: "CSEN 501 quiz 2 moved to Sunday", preview: "Dear students, the quiz is moved. Submit your sheets by the deadline.", to: "CSEN 501 Students" };
const PERSONAL = { from: "Reem Hassan <reem.hassan@guc.edu.eg>", subject: "Re: Best of in Presentations", preview: "Hello Sara, there is no best of in presentations, each is 10%.", to: "Sara Mohamed Adel" };

test("a mail is the student's when it names a course they take this term or was written to them alone", () => {
  assert.deepEqual(about(ENROLLED), { about: "course", courseKey: "45:70", code: "MATH 301" });
  assert.deepEqual(about(MASS), { about: "everyone" }, "the same mail to every student, about a course they are not in");
  assert.deepEqual(about(OTHER), { about: "everyone", other: true }, "it names a course, and not one of theirs");
  assert.deepEqual(about({ ...OTHER, subject: "CSEN 202 revision session" }), { about: "everyone", other: true }, "a course of an older term is not theirs now");
  assert.deepEqual(about(PERSONAL), { about: "personal" });
  assert.deepEqual(about({ ...PERSONAL, to: "Sara Mohamed Adel; Omar Tarek" }), { about: "everyone" }, "written to several people");
  assert.deepEqual(about({ ...PERSONAL, to: "Omar Tarek" }), { about: "everyone" }, "written to someone else");
  assert.deepEqual(about({ ...PERSONAL, from: "Notion Team <notify@updates.notion.com>" }), { about: "everyone" }, "a sender that writes to lists");
  // Kept before recipients were read: only a greeting by name, or an answer to their own message, makes it theirs.
  assert.deepEqual(about({ ...PERSONAL, to: undefined }), { about: "personal" });
  assert.deepEqual(about({ ...MASS, to: undefined }), { about: "everyone" });
  assert.deepEqual(about({ from: "Onspot <onspot@guc.edu.eg>", subject: "myCIB x GUC", preview: "[cid:image001.jpg@01DD7068.613BC680] Book now for 500 EGP", to: "Sara Mohamed Adel" }), { about: "personal" }, "image001 and prices are not course codes");
  assert.deepEqual(about({ from: "Dr. Amr <amr@guc.edu.eg>", subject: "Mathematics III: sheet 4 solutions", preview: "Dear all", to: "" }), { about: "course", courseKey: "45:70", code: "MATH 301" }, "the course's name in the subject line");
  assert.deepEqual(codesIn("CSEN301 and math-301, also csen 301"), ["CSEN 301", "MATH 301"]);
});

test("new mail becomes an event that says who it is for; mail for everyone is never rated or sent to the model", () => {
  const prev = { ...emptySnapshot(), courses: COURSES }, a = mail(ENROLLED), b = mail(MASS), c = mail(PERSONAL), d = mail(OTHER);
  const events = diffSnapshots(prev, { ...prev, mail: [a, b, c, d] }, { courses: [], grades: false, schedule: false, mailIds: [] }, Date.now(), { username: "sara.adel" });
  assert.deepEqual(events.map((e) => [e.key, e.courseKey]), [["mail:" + a.id, "45:70"], ["mail:all:" + b.id, undefined], ["mail:" + c.id, undefined], ["mail:all:" + d.id, undefined]]);
  const change = (o: Partial<Change>): Change => ({ key: "mail:x", kind: "new_mail", title: "Email from English Centre: Midterm exams from Saturday", detail: "The midterm exams are tomorrow. Attendance is mandatory.", ...o });
  assert.deepEqual(importance(change({ everyone: true })), { level: "silent", why: "Sent to everyone." }, "even with every word that would matter");
  assert.equal(importance(change({ subjectId: "math", title: "Email from GUC Notification System: MATH301 Extra Lecture", detail: "We have an extra lecture this Thursday at 3:45 in H10." })).level, "notify");
  assert.equal(importance(change({ mine: true, title: "Email from Reem Hassan: Re: Best of in Presentations", detail: "There is no best of in presentations, each one counts for ten percent." })).level, "notify");
  const snap = snapshotOf({ spaces: [], plans: [], chats: [], files: [], studySets: [], automations: [] }, Date.now());
  const plan = planSweep("event", { now: Date.now(), snap, prev: snap, slots: [], deadlines: [], events: [change({ everyone: true }), change({ key: "mail:all:y", everyone: true, detail: "Something long enough that the rules could not place it on their own." })] }, { done: new Set() });
  assert.equal(plan.ask, undefined, "no model call for mail that is not theirs");
  assert.deepEqual(plan.rate, []);
});

test("after a change the model is not asked to reword what is certain", () => {
  const snap = snapshotOf({ spaces: [], plans: [], chats: [], files: [], studySets: [], automations: [] }, Date.now());
  const moved: Change = { key: "dl:a:2026-11-20T10:00:00.000Z", kind: "deadline_changed", title: "CSEN 301 Quiz 1 moved to Fri 20 Nov", detail: "Was Thu 19 Nov." };
  assert.equal(planSweep("event", { now: Date.now(), snap, prev: snap, slots: [], deadlines: [], events: [moved] }, { done: new Set() }).ask, undefined);
});

// ---------- In the engine ----------
const SUN = "2026-11-15";
async function engineAt(clock: { t: number }) {
  const h = Object.assign(fakeHost(), { calls: [] as { system: string; user: string }[] });
  h.workspace = async () => ({ spaces: [{ id: "math", name: "Math 301", kind: "subject", description: "", memory: "", sources: [] }], plans: [], chats: [{ id: "main", kind: "main", messages: [] }], files: [], studySets: [], automations: [] });
  h.complete = async (r) => { h.calls.push(r); return '{"message":"Something about next week\'s quiz.","levels":[],"actions":[]}'; };
  h.notify = (n) => { h.notices.push(n.title + " | " + n.body); };
  const engine = await Engine.open("quiet-owner", h, { memory: true, jobs: false, clock: () => clock.t });
  return { engine, h, o: engine.organizer };
}
const event = (engine: Engine, key: string, kind: string, title: string, detail: string, course: string | null = null) =>
  engine.db.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail, created_at) values ($1, $2, $3, $4, $5, $6, now() + interval '1 second' * (select count(*) from guc_events))", ["quiet-owner", key, kind, course, title, detail]);

test("engine: a first run posts nothing; mail for everyone makes no post, push or model call; the student's own mail is told once", async () => {
  const clock = { t: cairoAt(SUN, "13:00") };
  const { engine, h, o } = await engineAt(clock);
  try {
    assert.equal(await o.quietStart(), true);
    assert.equal((await o.settings()).level, "balanced");
    assert.deepEqual((await o.inbox()).posts, [], "no hello, no questions, no Telegram card");
    await o.sweep("event");
    // The same mail GUC sends every student, with every word that would make an announcement urgent.
    await event(engine, "mail:all:1", "new_mail", "Email from English Centre: AE & AS Midterm exams from Saturday", "Dear Students, the midterm exams are tomorrow. Attendance is mandatory, submit the form today.");
    await event(engine, "mail:all:2", "new_mail", "Email from Examination Office: Online remarking", "Dear Students, this is a kind reminder of the deadline for remarking requests.");
    let r = await o.sweep("event");
    assert.deepEqual([r.posted, r.called], [false, false]);
    assert.deepEqual((await o.inbox()).posts, []);
    assert.deepEqual(h.notices, []);
    assert.equal((await engine.db.query("select 1 from organizer_actions where owner_id = 'quiet-owner'")).length, 0, "not even kept for later");

    // Mail about a course they take, and a mail written to them.
    await engine.db.query("insert into subject_links (owner_id, subject_id, course_key) values ('quiet-owner', 'math', '45:70')");
    await event(engine, "mail:3", "new_mail", "Email from GUC Notification System: MATH301 Extra Lecture", "To the students of Lecture Group 2: We have an extra lecture this Thursday at 3:45 in H10.", "45:70");
    await event(engine, "mail:4", "new_mail", "Email from Reem Hassan: Re: Best of in Presentations", "Hello Sara, there is no best of in presentations, each one counts for ten percent.");
    r = await o.sweep("event");
    assert.equal(r.posted, true);
    const { posts } = await o.inbox();
    assert.equal(posts.length, 1, "one message for both");
    const card = cardsIn(posts[0].content).find((c) => c.type === "organizer") as { lines: { text: string; key?: string; space?: string }[] };
    assert.deepEqual(card.lines.map((l) => l.key), ["change:mail:3", "change:mail:4"]);
    assert.equal(card.lines[0].space, "Math 301", "under the right course");
    assert.equal(h.notices.length, 1, "one push for the batch");
    assert.equal((await o.sweep("event")).posted, false, "said once");
    assert.equal((await o.inbox()).posts.length, 1);
  } finally { await engine.close(); }
});

test("engine: a deadline that moved twice between sweeps is one line at the date it has now, in the card's words only; a mailed copy of a CMS announcement is not told twice", async () => {
  const clock = { t: cairoAt(SUN, "13:00") };
  const { engine, h, o } = await engineAt(clock);
  try {
    await o.quietStart();
    await o.sweep("event");
    await event(engine, "dl:a:2026-11-19T10:00:00.000Z", "deadline_changed", "CSEN 301 Quiz 1 moved to Thu 19 Nov", "Was Wed 18 Nov.");
    await event(engine, "dl:a:2026-11-20T10:00:00.000Z", "deadline_changed", "CSEN 301 Quiz 1 moved to Fri 20 Nov", "Was Thu 19 Nov.");
    assert.equal((await o.sweep("event")).posted, true);
    let posts = (await o.inbox()).posts;
    const card = cardsIn(posts[0].content).find((c) => c.type === "organizer") as { lines: { text: string }[] };
    assert.deepEqual(card.lines.map((l) => l.text), ["CSEN 301 Quiz 1 moved to Fri 20 Nov"]);
    assert.equal(h.calls.length, 0, "no model call to reword it");
    assert.ok(posts[0].content.startsWith("```clem-card"), "nothing is said above the card that the card does not say");

    // GUC mails out what a lecturer posted on CMS: the announcement is already there, so the mail is not news.
    const body = "Dear students, quiz 2 will be held next Tuesday in the tutorial. It covers chapters 3 and 4.";
    await engine.db.query("insert into guc_announcements (owner_id, announcement_id, course_key, scope, body) values ('quiet-owner', 'a1', '45:70', 'course', $1)", [body]);
    await event(engine, "mail:9", "new_mail", "Email from GUC Notification System: Quiz 2", body.slice(0, 80), "45:70");
    assert.equal((await o.sweep("event")).posted, false);
    posts = (await o.inbox()).posts;
    assert.equal(posts.length, 1);
  } finally { await engine.close(); }
});
