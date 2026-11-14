// The quiet main thread (docs/MAIN-THREAD.md "Proactivity" → "Only what is true and yours"), against the real App and a
// real in-memory engine, in dark and light. A first run posts nothing (no hello, no Telegram card, no new-courses
// card, no Setup chat); mail GUC sent to every student and a routine upload make no message, no push and no model
// call; then a cancelled tutorial mailed for a course the student takes, a mail written to them, and a deadline that
// moved twice are told once, in one card, each as one line.
// This is the test build in a browser, not the installed app.
// Usage: node scripts/verify/quiet-thread.mjs [out-dir]   (screenshots are quiet-*.png)
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";
import { Engine } from "../../desktop/engine/index.ts";
import { cairo } from "../../core/guc/hub.ts";
import { cairoAt } from "../../core/proactivity/settings.ts";
import { host } from "../../tests/guc-fake.ts";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/quiet-thread";
await mkdir(out, { recursive: true });
const OWNER = "fixture-owner";
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true; return false; };
const today = cairo(Date.now()).ymd;

try {
  for (const theme of ["dark", "light"]) {
    const spaces = [{ id: "math", name: "Math 301", kind: "subject", description: "MATH 301", memory: "", sources: [] }];
    const main = { id: "main-fixture", kind: "main", title: "Clem", titled: true, renamed: true, pinned: true, spaceId: null, updated: Date.now() - 3600e3, messages: [{ id: "u0", role: "user", content: "Morning!", at: Date.now() - 3600e3 }] };
    const workspace = { spaces, plans: [], chats: [main], files: [], studySets: [], automations: [] };
    const clock = { t: cairoAt(today, "10:00") };
    const h = host(), pushes = [], calls = [];
    h.workspace = async () => workspace;
    h.notify = (n) => pushes.push(n);
    h.complete = async (r) => { calls.push(r); return JSON.stringify({ message: "Your midterm is on the 27th, so plan around it.", levels: [] }); };
    const engine = await Engine.open(OWNER, h, { memory: true, jobs: false, clock: () => clock.t });
    const o = engine.organizer;
    await engine.db.query("insert into guc_courses (owner_id, course_key, course_id, season_id, season, code, name, active) values ($1, '45:70', 45, 70, 'Winter 2026', 'MATH 301', 'Mathematics III', true)", [OWNER]);
    await engine.db.query("insert into subject_links (owner_id, subject_id, course_key) values ($1, 'math', '45:70')", [OWNER]);
    const ev = (key, kind, title, detail, course = null) => engine.db.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail, created_at) values ($1, $2, $3, $4, $5, $6, now() + interval '1 second' * (select count(*) from guc_events))", [OWNER, key, kind, course, title, detail]);

    // First run, then mail for everybody and a routine upload.
    check(await o.quietStart() === true && (await o.inbox()).posts.length === 0, `${theme}: the first run posts nothing`);
    await o.sweep("event");
    await ev("mail:all:1", "new_mail", "Email from English Centre: AE & AS Midterm exams from Saturday", "Dear Students, the midterm exams are tomorrow. Attendance is mandatory, submit the form today.");
    await ev("mail:all:2", "new_mail", "Email from Examination Office: Online remarking", "Dear Students, a kind reminder of the deadline for remarking requests.");
    await ev("mat:1", "new_material", "New in MATH 301 Mathematics III: Sheet 6", "sheets · Week 6", "45:70");
    const quiet = await o.sweep("event");
    check(!quiet.posted && !quiet.called && pushes.length === 0 && calls.length === 0, `${theme}: mail for every student and a routine upload: no message, no push, no model call`);

    // What the window is offered that used to become messages: new-term courses, and a linked course's news.
    const call = {
      gucStatus: () => engine.status(), gucOverview: () => engine.overview(), gucNow: () => engine.now(), gucLinks: () => engine.links(), gucCourses: () => engine.courses(),
      gucNewCourses: () => [{ key: "20:70", code: "ELCT 301", name: "Electrical Circuits I", season: "Winter 2026" }], gucAckNewCourses: () => ({}),
      gucInbox: () => [{ key: "ann:w1", subjectId: "math", kind: "new_announcement", courseKey: "45:70", title: "New announcement in MATH 301", detail: "Sheet 6 is posted.", at: Date.now() }], gucAckInbox: () => ({}),
      gucSubject: (r) => engine.subject(r.subjectId),
      proInbox: () => o.inbox(), proAck: (r) => o.ack(r), proStatus: (r) => o.statuses(r.keys), proMute: (r) => o.mute(r.key), proMutes: () => o.mutesList(), proSettings: (r) => (r.set ? o.setSettings(r.set) : o.settings()), proLog: () => o.log(0),
      proWatches: () => o.watches(), proPoke: () => 60,
    };
    const fx = await openFixture(browser, {
      port: 5243, viewport: { width: 1360, height: 900 },
      initScripts: [`try{localStorage.setItem("clem-theme",${JSON.stringify(theme)})}catch{}`],
      extraSpaces: spaces, extraChats: [main],
      guc: async (r) => { const fn = call[r.action]; return fn ? fn(r) : null; },
    });
    const { page, errors } = fx;
    const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${out}/quiet-${name}-${theme}.png` }); };
    try {
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      await page.locator(".nav-item", { hasText: "Clem" }).click();
      const thread = page.locator(".chat-view.main-thread");
      await thread.waitFor({ timeout: 6000 });
      await page.waitForTimeout(1200);
      check(await thread.locator(".pro-card").count() === 0, `${theme}: no card in the main thread`);
      check(await thread.getByText(/how you'd like me around|new course|Set up|Telegram/i).count() === 0, `${theme}: no hello, no new-courses card, no Telegram card`);
      check(await page.locator("[role=dialog], .st-dialog, dialog[open]").count() === 0, `${theme}: nothing opened by itself`);
      const chats = await page.evaluate(() => JSON.parse(JSON.stringify(window.__clemState?.().chats || null)));
      if (chats) check(!chats.some((c) => c.setup), `${theme}: no Setup chat was made`);
      check(await page.getByText("Setup", { exact: true }).count() === 0, `${theme}: no Setup chat in the sidebar`);
      await shot("nothing");

      // Now real news about their own course, and a deadline that moved twice before Clem looked.
      await ev("mail:3", "new_mail", "Email from GUC Notification System: Cancellation of Today's Tutorial", "Dear Students, please be informed that today's tutorial is cancelled.", "45:70");
      await ev("mail:4", "new_mail", "Email from Reem Hassan: Re: Best of in Presentations", "Hello, there is no best of in presentations, each one counts for ten percent.");
      await ev("dl:q1:" + today + "T10:00:00.000Z", "deadline_changed", "MATH 301 Quiz 2 moved to Thursday", "Was Wednesday.", "45:70");
      await ev("dl:q1:" + today + "T12:00:00.000Z", "deadline_changed", "MATH 301 Quiz 2 moved to Friday", "Was Thursday.", "45:70");
      const news = await o.sweep("event");
      check(news.posted, `${theme}: their own course's news is told`);
      check(pushes.length === 2 && /cancelled/.test(pushes[0].body), `${theme}: the cancelled tutorial is pushed now, the rest in one push (${pushes.length})`);
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      const card = thread.locator(".pro-card").last();
      await card.waitFor({ timeout: 8000 });
      check(await thread.locator(".pro-card").count() === 1, `${theme}: one card`);
      const text = await card.textContent();
      check(/Cancellation of Today.s Tutorial/.test(text) && /Best of in Presentations/.test(text), `${theme}: the course mail and the personal mail are in it`);
      check(/moved to Friday/.test(text) && !/moved to Thursday/.test(text), `${theme}: the deadline is one line, at the date it has now`);
      check(!/Midterm exams|remarking/i.test(text), `${theme}: nothing from the mail sent to everyone`);
      check(await page.getByText(/midterm is on the 27th/).count() === 0, `${theme}: no invented words above the card`);
      const again = await o.sweep("event");
      check(!again.posted && pushes.length === 2, `${theme}: said once`);
      await card.scrollIntoViewIfNeeded();
      await shot("news");
      check(errors.length === 0, `${theme}: no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
    } finally { await fx.close(); await engine.close(); }
  }
} finally { await browser.close(); }
if (failed) process.exit(1);
