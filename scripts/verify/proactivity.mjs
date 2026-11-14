// Clem's organizer against the real App and a real in-memory engine, in dark and light: the morning brief as one plain
// message in the main thread with blocks the window applied, the event sweep as plain messages (a cancelled class
// pushed in Clem's words, the routine post and new lecture named in one closing sentence), no card and no button
// anywhere, "undo that" by text (clem.undo) put back by the window, Settings → Proactivity (nothing set by hand) and
// "What Clem did today" with its Undo. The engine runs on a fixed Cairo morning; the organizer model is a fixed reply.
// Usage: node scripts/verify/proactivity.mjs [out-dir]   (screenshots are pro-*.png)
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";
import { Engine } from "../../desktop/engine/index.ts";
import { cairo } from "../../core/guc/hub.ts";
import { cairoAt } from "../../core/proactivity/settings.ts";
import { host } from "../../tests/guc-fake.ts";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/proactivity";
await mkdir(out, { recursive: true });
const OWNER = "fixture-owner";
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true; return false; };
const today = cairo(Date.now()).ymd, yesterday = new Date(Date.parse(today + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);

try {
  for (const theme of ["dark", "light"]) {
    const plan = { id: "plan-circ", spaceId: "circ", title: "Circuits plan", start: yesterday, created: Date.now() - 864e5, updated: Date.now() - 864e5, rev: 1, history: [], tasks: [{ id: "t1", title: "Thevenin problem set", due: yesterday }, { id: "t2", title: "Lab report draft", due: yesterday }] };
    const spaces = [{ id: "circ", name: "Circuits", kind: "subject", description: "ELCT 201", memory: "", sources: [] }];
    const main = { id: "main-fixture", kind: "main", title: "Clem", titled: true, renamed: true, pinned: true, spaceId: null, updated: Date.now() - 3600e3, messages: [{ id: "u0", role: "user", content: "Morning!", at: Date.now() - 3600e3 }] };
    const workspace = { spaces, plans: [plan], chats: [main], files: [], studySets: [], automations: [] };
    const clock = { t: cairoAt(today, "07:30") };
    const h = host(), pushes = [];
    h.workspace = async () => workspace;
    h.notify = (n) => pushes.push(n);
    const SAID = { morning: "Two things slipped from yesterday, so they get your first free hours today. Nothing else is due.", event: "Today's Circuits lab is cancelled, so you have that slot back." };
    h.complete = async (r) => (r.user.includes("the morning plan") ? JSON.stringify({ message: SAID.morning }) : JSON.stringify({ message: "Ignored after a change.", levels: [{ i: 0, level: "urgent", why: "Today", say: SAID.event }, { i: 1, level: "digest", why: "Routine" }, { i: 2, level: "digest", why: "Routine" }] }));
    const engine = await Engine.open(OWNER, h, { memory: true, jobs: false, clock: () => clock.t });
    const o = engine.organizer;
    await engine.db.query("insert into guc_courses (owner_id, course_key, course_id, season_id, season, code, name, active) values ($1, '1201:64', 1201, 64, 'Winter 2026', 'ELCT 201', 'Circuits', true)", [OWNER]);
    await engine.db.query("insert into subject_links (owner_id, subject_id, course_key) values ($1, 'circ', '1201:64')", [OWNER]);
    const brief = await o.sweep("morning");
    check(brief.posted && brief.called, `${theme}: the morning brief posts, in Clem's words (one short call)`);
    check(pushes.length === 1 && pushes[0].body === SAID.morning, `${theme}: the morning plan reaches out with what Clem said`);
    pushes.length = 0;
    // Later that morning: a cancelled lab (urgent), a routine announcement and a new lecture.
    clock.t = cairoAt(today, "10:00");
    const ev = (key, kind, title, detail) => engine.db.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail) values ($1, $2, $3, '1201:64', $4, $5)", [OWNER, key, kind, title, detail]);
    await ev("ann:v1", "new_announcement", "New announcement in ELCT 201 Circuits", "Today's lab is cancelled. A compensation lab will be announced.");
    await ev("ann:v2", "new_announcement", "New announcement in ELCT 201 Circuits", "Lecture 6 slides are uploaded on the CMS for your reference.");
    await ev("mat:v3", "new_material", "New in ELCT 201 Circuits: Lecture 6 - Thevenin and Norton", "slides · Week 6");
    const later = await o.sweep("event");
    check(later.posted && later.called, `${theme}: the event sweep posts after one short call`);
    check(pushes.length === 1 && pushes[0].title === "Clem" && pushes[0].body.startsWith(SAID.event), `${theme}: one message, one notification, titled Clem (${pushes.length})`);
    check(pushes[0]?.open?.chat === "main-fixture" && /^pro-/.test(pushes[0]?.open?.message || ""), `${theme}: the push opens its message in the main thread`);
    const told = (await o.inbox()).posts.map((p) => p.content);
    check(told.every((c) => !c.includes("```")), `${theme}: no card in anything Clem posted`);
    check(told.some((c) => c.startsWith(SAID.event) && /Also up: .*Circuits\./.test(c)), `${theme}: the routine post and new lecture are one closing sentence`);

    const call = {
      gucStatus: () => engine.status(), gucOverview: () => engine.overview(), gucNow: () => engine.now(), gucInbox: () => [], gucNewCourses: () => [], gucLinks: () => engine.links(), gucCourses: () => engine.courses(),
      proInbox: () => o.inbox(), proAck: (r) => o.ack(r), proStatus: (r) => o.statuses(r.keys), proUndo: (r) => o.undo(r.key),
      proUnmute: (r) => o.unmute(r.key), proMutes: () => o.mutesList(), proSettings: (r) => (r.set ? o.setSettings(r.set) : o.settings()), proLog: () => o.log(0),
      proWatches: () => o.watches(), proStopWatch: (r) => o.stopWatch(r.id), proPoke: () => 60,
    };
    const fx = await openFixture(browser, {
      port: 5241, viewport: { width: 1360, height: 900 },
      initScripts: [`try{localStorage.setItem("clem-theme",${JSON.stringify(theme)})}catch{}`],
      extraSpaces: spaces, extraChats: [main], extraState: { plans: [plan] },
      guc: async (r) => { const fn = call[r.action]; return fn ? fn(r) : null; },
    });
    const { page, errors } = fx;
    const shot = async (name, el) => { await page.waitForTimeout(500); await (el ? page.locator(el).last() : page).screenshot({ path: `${out}/pro-${name}-${theme}.png` }); };
    try {
      check(await page.locator("html").getAttribute("data-theme") === theme, `${theme}: theme applied`);
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      check(await until(async () => (await o.inbox()).posts.length === 0), `${theme}: the window takes the organizer's inbox and acknowledges it`);
      const box = await o.log(0);
      check(box.filter((r) => r.status === "applied" && r.undo).length === 2, `${theme}: the window applied the brief's block and move (${box.map((r) => r.status).join(",")})`);
      await page.locator(".nav-item", { hasText: "Clem" }).click();
      await page.locator(".chat-view.main-thread").waitFor({ timeout: 4000 });
      const thread = page.locator(".chat-view.main-thread");
      await thread.getByText(SAID.morning).waitFor({ timeout: 6000 });
      check(await thread.getByText(SAID.morning).count() === 1 && await thread.getByText(SAID.event, { exact: false }).count() === 1, `${theme}: each thing Clem said is its own plain message`);
      check(await thread.locator(".pro-card").count() === 0, `${theme}: no card in the main thread`);
      check(await thread.getByRole("button", { name: /Undo|Mute|Don’t tell me|Do it|Not now|Stop|Cancel/ }).count() === 0, `${theme}: no Undo, Mute, Do it, Stop or Cancel button`);
      await thread.getByText(SAID.morning).scrollIntoViewIfNeeded();
      await shot("morning", ".chat-view.main-thread");
      // "Undo that": by text, put back by the window through the inbox.
      const undo = await o.tool({ action: "clem.undo" });
      check(undo.ok, `${theme}: clem.undo takes back Clem's latest change (${undo.undone || undo.error})`);
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      check(await until(async () => (await o.log(0)).some((r) => r.status === "undone")), `${theme}: the window put it back and acknowledged it`);
      await shot("digest", ".chat-view.main-thread");

      // Settings → Proactivity.
      await page.keyboard.press("Control+,");
      await page.locator(".st-dialog").waitFor();
      await page.locator(".st-nav button", { hasText: "Proactivity" }).click();
      await page.locator(".st-card-wrap", { hasText: "What Clem did today" }).waitFor({ timeout: 4000 });
      for (const gone of ["What Clem tells you about", "How Clem keeps you posted", "Clem’s routines", "When you study"]) check(await page.locator(".st-card-title").filter({ hasText: new RegExp("^" + gone + "$") }).count() === 0, `${theme}: no "${gone}" settings (Clem asks in chat)`);
      check(await page.getByRole("radiogroup").count() === 0 && await page.locator(".st-dialog input[type=time]").count() === 0, `${theme}: nothing left to set by hand`);
      const prefs = await o.tool({ action: "clem.prefs", level: "balanced" });
      check(prefs.ok && (await o.settings()).level === "balanced", `${theme}: how much Clem speaks is changed by telling it`);
      await page.waitForTimeout(600);
      await page.locator(".st-dialog").screenshot({ path: `${out}/pro-settings-${theme}.png` });
      const did = page.locator(".st-card-wrap", { hasText: "What Clem did today" });
      await did.scrollIntoViewIfNeeded();
      check(await did.getByRole("button", { name: "Undo" }).count() === 1, `${theme}: today's log offers Undo on what is still applied`);
      check(/Undone/.test(await did.textContent()) && /Told you/.test(await did.textContent()), `${theme}: the log shows what was undone and what was said`);
      await page.waitForTimeout(500);
      await page.locator(".st-dialog").screenshot({ path: `${out}/pro-today-${theme}.png` });
      check(!errors.length, `${theme}: no page errors` + (errors.length ? ": " + errors.join("; ") : ""));
    } catch (e) { check(false, `${theme}: ${e.message.split("\n")[0]}`); await shot("failure").catch(() => {}); }
    finally { await fx.close(); await engine.close(); }
  }
} finally { await browser.close(); }
console.log(failed ? "Proactivity check failed." : "Proactivity verified; screenshots in " + out);
process.exit(failed ? 1 : 0);
