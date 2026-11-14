// Reminders and study time against the real App and a real in-memory engine, in dark and light: reminders ringing in
// the main thread as plain messages ("Reminder: …", no Cancel button: cancelling is said in words, clem.unremind),
// study sessions planned around another plan item and applied to the plan (facts for the AI, no card), the morning
// brief as one plain message, upcoming reminders in Settings → Proactivity, and no calendar connector in Settings →
// Connectors. Nothing calls a model.
// Usage: node scripts/verify/study-reminders.mjs [out-dir]   (screenshots are cal-*.png)
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";
import { Engine } from "../../desktop/engine/index.ts";
import { cairo } from "../../core/guc/hub.ts";
import { cairoAt } from "../../core/proactivity/settings.ts";
import { host } from "../../tests/guc-fake.ts";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/study-reminders";
await mkdir(out, { recursive: true });
const OWNER = "fixture-owner";
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true; return false; };
const today = cairo(Date.now()).ymd, tomorrow = new Date(Date.parse(today + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
const until3 = new Date(Date.parse(today + "T00:00:00Z") + 3 * 864e5).toISOString().slice(0, 10);

try {
  for (const theme of ["dark", "light"]) {
    const spaces = [{ id: "circ", name: "Circuits", kind: "subject", description: "ELCT 201", memory: "", sources: [] }];
    const main = { id: "main-fixture", kind: "main", title: "Clem", titled: true, renamed: true, pinned: true, spaceId: null, updated: Date.now() - 3600e3, messages: [{ id: "u0", role: "user", content: "Morning!", at: Date.now() - 3600e3 }] };
    const plan = { id: "plan-circ", spaceId: "circ", title: "Circuits plan", start: today, created: Date.now() - 864e5, updated: Date.now() - 864e5, rev: 1, history: [], tasks: [{ id: "t1", title: "Lab prep", due: today, time: "10:00" }, { id: "t2", title: "Robotics club", due: today, time: "16:00" }, { id: "t3", title: "Problem set 4", due: today }] };
    const workspace = { spaces, plans: [plan], chats: [main], files: [], studySets: [], automations: [] };
    const clock = { t: cairoAt(today, "07:30") };
    const h = host();
    h.workspace = async () => workspace;
    const engine = await Engine.open(OWNER, h, { memory: true, jobs: false, clock: () => clock.t });
    const o = engine.organizer;
    await o.setSettings({ study: { days: [0, 1, 2, 3, 4, 5, 6] } });
    const brief = await o.sweep("morning");
    check(brief.posted, `${theme}: the morning brief posts`);
    const briefFirst = (await o.inbox()).posts.at(-1).content.split("\n")[0];
    // A daily reminder rings (Cancel stays: it comes again tomorrow), and a one-off one.
    await o.remind({ text: "Review Circuits flashcards", at: cairoAt(today, "07:40"), repeat: "daily", spaceId: "circ" });
    await o.remind({ text: "Email the TA about the lab", at: cairoAt(today, "07:45") });
    clock.t = cairoAt(today, "07:50");
    check(await o.ring() === 2, `${theme}: both reminders ring`);
    // Study sessions for the quiz, planned around the club; the tool answers with facts, no card.
    const study = await o.tool({ action: "clem.study", subject: "ELCT 201", sessions: 2, until: until3 });
    check(study.ok && study.planned.length === 2 && study.planned[0].endsWith("at 17:15"), `${theme}: two study sessions, today's after the club (${study.planned?.join("; ")})`);
    check(study.card === undefined, `${theme}: no card to embed in the AI's reply`);
    check(!(await o.reminders()).some((x) => x.source === "study"), `${theme}: study sessions set no reminders of their own`);
    // One the person asks for, so Settings lists something upcoming.
    const lab = await o.tool({ action: "clem.remind", text: "Submit the lab report", at: tomorrow + "T09:00" });
    check(lab.ok, `${theme}: a reminder the person asks for is set`);

    const call = {
      gucStatus: () => engine.status(), gucOverview: () => engine.overview(), gucNow: () => engine.now(), gucInbox: () => [], gucNewCourses: () => [], gucLinks: () => engine.links(), gucCourses: () => engine.courses(),
      proInbox: () => o.inbox(), proAck: (r) => o.ack(r), proStatus: (r) => o.statuses(r.keys), proUndo: (r) => o.undo(r.key),
      proUnmute: (r) => o.unmute(r.key), proMutes: () => o.mutesList(), proSettings: (r) => (r.set ? o.setSettings(r.set) : o.settings()), proLog: () => o.log(0),
      proWatches: () => o.watches(), proStopWatch: (r) => o.stopWatch(r.id), proPoke: () => 60,
      proReminders: () => o.reminders(), proCancelReminder: (r) => o.cancelReminder(r.id),
    };
    const fx = await openFixture(browser, {
      port: 5242, viewport: { width: 1360, height: 900 },
      initScripts: [`try{localStorage.setItem("clem-theme",${JSON.stringify(theme)})}catch{}`],
      extraSpaces: spaces, extraChats: [main], extraState: { plans: [plan] },
      guc: async (r) => { const fn = call[r.action]; return fn ? fn(r) : null; },
    });
    const { page, errors } = fx;
    const shot = async (name, el) => { await page.waitForTimeout(500); await (el ? page.locator(el).last() : page).screenshot({ path: `${out}/cal-${name}-${theme}.png` }); };
    try {
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      check(await until(async () => (await o.inbox()).posts.length === 0 && (await o.inbox()).apply.length === 0), `${theme}: the window takes the posts and applies the study sessions`);
      await page.locator(".nav-item", { hasText: "Clem" }).click();
      await page.locator(".chat-view.main-thread").waitFor({ timeout: 4000 });
      const thread = page.locator(".chat-view.main-thread");
      const morning = thread.getByText(briefFirst, { exact: false }).last();
      await morning.waitFor({ timeout: 6000 });
      check(!/calendar/i.test(await morning.textContent()), `${theme}: the brief mentions no calendar app`);
      await morning.scrollIntoViewIfNeeded();
      await shot("brief", ".chat-view.main-thread");
      check(await thread.getByText("Reminder: Review Circuits flashcards.").count() === 1 && await thread.getByText("Reminder: Email the TA about the lab.").count() === 1, `${theme}: each reminder rings as a plain message`);
      check(await thread.locator(".pro-card").count() === 0 && await thread.getByRole("button", { name: /Cancel|Undo/ }).count() === 0, `${theme}: no card, no Cancel or Undo button`);
      check((await o.log(0)).filter((r) => r.key.startsWith("study:") && r.status === "applied").length === 2, `${theme}: both study sessions are in the plan`);
      await shot("thread", ".chat-view.main-thread");
      // "Stop reminding me about flashcards": said in words.
      const daily = (await o.reminders()).find((x) => x.text === "Review Circuits flashcards");
      check(!!daily && (await o.tool({ action: "clem.unremind", id: daily.id })).ok, `${theme}: a daily reminder is cancelled by text`);

      await page.keyboard.press("Control+,");
      await page.locator(".st-dialog").waitFor();
      const nav = page.locator(".st-nav button", { hasText: "Proactivity" });
      check(await nav.locator(".icon-bell").count() === 1, `${theme}: Proactivity has its own icon in the Settings sidebar`);
      await nav.click();
      const upcoming = page.locator(".st-card-wrap", { hasText: "Upcoming reminders" });
      await upcoming.waitFor({ timeout: 4000 });
      check(await upcoming.getByRole("button", { name: "Cancel" }).count() === 1, `${theme}: the person's own reminder is listed with Cancel`);
      for (const gone of ["When you study", "Google Calendar"]) check(await page.locator(".st-card-title").filter({ hasText: new RegExp("^" + gone + "$") }).count() === 0, `${theme}: no "${gone}" card in Proactivity`);
      check(await page.locator(".st-dialog select").count() === 0, `${theme}: no native dropdowns in Proactivity`);
      await upcoming.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.locator(".st-dialog").screenshot({ path: `${out}/cal-settings-${theme}.png` });
      // Connectors has Google Drive and no calendar.
      await page.locator(".st-nav button", { hasText: "Connectors" }).click();
      await page.locator(".st-row", { hasText: "Google Drive" }).waitFor({ timeout: 4000 });
      check(await page.locator(".st-row", { hasText: "Calendar" }).count() === 0, `${theme}: no calendar connector`);
      await page.waitForTimeout(400);
      await page.locator(".st-dialog").screenshot({ path: `${out}/cal-connectors-${theme}.png` });
      check(!errors.length, `${theme}: no page errors` + (errors.length ? ": " + errors.join("; ") : ""));
    } catch (e) { check(false, `${theme}: ${e.message.split("\n")[0]}`); await shot("failure").catch(() => {}); }
    finally { await fx.close(); await engine.close(); }
  }
} finally { await browser.close(); }
console.log(failed ? "Reminders check failed." : "Reminders verified; screenshots in " + out);
process.exit(failed ? 1 : 0);
