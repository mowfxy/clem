// Save rules, check schedules, saved files and the Drive copy against the real App and a real in-memory engine synced
// from the fixture GUC, in dark and light: rules and a schedule set from words show on the subject's cards, a check
// saves only the matching files (once each) and posts a file_saved card into the Setup chat with the files in the
// subject's Files, Summarize starts a chat, and the Drive card shows copies, then Reconnect Drive when Drive is gone.
// Usage: node scripts/verify/guc-rules.mjs [out-dir]   (screenshots are rules-*.png)
import { chromium } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openFixture } from "./local-power-fixture.mjs";
import { Engine } from "../../desktop/engine/index.ts";
import { convertSaveRules, rulesPatch } from "../../core/guc/rules.ts";
import { convertCheckSchedule } from "../../core/guc/schedule-rules.ts";
import { fakeGuc, host, noWait, site } from "../../tests/guc-fake.ts";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/guc-rules";
await mkdir(out, { recursive: true });
const OWNER = "fixture-owner";
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const until = async (fn, ms = 6000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true; return false; };
const U = (f) => "https://cms.guc.edu.eg/Uploads/1201/64/" + f;
const pdf = (s) => new TextEncoder().encode("%PDF-1.4 " + s);

try {
  for (const theme of ["dark", "light"]) {
    const dir = await mkdtemp(join(tmpdir(), "clem-rules-"));
    const guc = fakeGuc(site(), { etags: true, files: { [U("lecture-1.pdf")]: pdf("one"), [U("lecture-3.pdf")]: pdf("three"), [U("tutorial-3.pdf")]: pdf("tut") } });
    let n = 0;
    const drive = { on: true, connected: async () => drive.on, folder: async (p, name) => `${p}/${name}`, upload: async () => ({ id: "d" + ++n }) };
    const engine = await Engine.open(OWNER, host({ files: join(dir, "Files"), drive }), { http: guc.http, sleep: noWait, memory: true, jobs: false });
    await engine.connect("student.name", "secret");
    await engine.link("embedded", "1201:64");
    await engine.light;
    // Rules and a schedule from the person's words, as the setup chat reads them.
    await engine.setSettings("embedded", { save: rulesPatch(convertSaveRules("only PDFs from week 2").rules), check: convertCheckSchedule("every 2 hours on weekdays 8am-10pm"), drive: { enabled: true } });
    const first = await engine.check("embedded", "now");
    check(first.saved === 2 && guc.log.filter((r) => r.binary).length === 2, `${theme}: a check downloads only week 2's PDFs (${first.saved} saved, ${first.requests} requests)`);
    const again = await engine.check("embedded", "schedule");
    check(again.saved === 0 && again.requests === 1, `${theme}: an unchanged page is one request and no downloads`);

    const call = {
      gucStatus: () => engine.status(), gucSync: () => engine.status(), gucOverview: () => engine.overview(), gucCourses: () => engine.courses(),
      gucSchedule: (r) => engine.schedule(r.weekStart), gucAnnouncements: (r) => engine.announcements({ courseKey: r.courseId, cursor: r.cursor }), gucMarkRead: (r) => engine.markRead(r.ids),
      gucMaterials: (r) => engine.materials(r.courseId), gucSearch: (r) => engine.search(r.query), gucGrades: (r) => engine.grades(r.courseId), gucDeadlines: () => engine.deadlines(),
      gucFile: async () => { throw Error("Not in this check."); },
      gucLinks: () => engine.links(), gucLink: (r) => engine.link(r.subjectId, r.courseId), gucUnlink: (r) => engine.unlink(r.subjectId), gucSubject: (r) => engine.subject(r.subjectId),
      gucSetSettings: (r) => engine.setSettings(r.subjectId, r.patch), gucCheckNow: (r) => engine.checkNow(r.subjectId), gucForgetSubject: (r) => engine.forgetSubject(r.subjectId),
      gucNewCourses: () => engine.newCourses(), gucAckNewCourses: (r) => engine.ackNewCourses(r.keys), gucInbox: () => engine.inbox(), gucAckInbox: (r) => engine.ackInbox(r.keys),
    };
    const fx = await openFixture(browser, {
      port: 5236, viewport: { width: 1360, height: 900 },
      initScripts: [`try{localStorage.setItem("clem-theme",${JSON.stringify(theme)})}catch{}`],
      extraSpaces: [{ id: "embedded", name: "Embedded Systems", kind: "subject", description: "", memory: "", sources: [] }],
      guc: (r) => call[r.action](r),
    });
    const { page, errors } = fx;
    const shot = async (name, el) => { await page.waitForTimeout(500); await (el ? page.locator(el).last() : page).screenshot({ path: join(out, `rules-${name}-${theme}.png`) }); };
    const card = (title) => page.locator(".guc-card", { hasText: title }).last();
    try {
      check(await page.locator("html").getAttribute("data-theme") === theme, `${theme}: theme applied`);
      // What the check saved reaches the window: the files join the subject, a card goes to its Setup chat.
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      check(await until(async () => (await engine.inbox()).length === 0), `${theme}: the window takes the inbox once and acknowledges it`);
      await page.locator(".side-space .history-title", { hasText: "Embedded Systems" }).click();
      await page.getByRole("tab", { name: "Chats" }).click();
      await page.locator(".sp-chat", { hasText: "Setup" }).first().click();
      const saved = card("new files from CMS");
      await saved.waitFor({ timeout: 8000 });
      check(await saved.locator("li").count() === 2, `${theme}: the file_saved card lists the two saved files`);
      for (const b of ["Preview", "Summarize"]) check(await saved.getByRole("button", { name: b }).count() === 2, `${theme}: each saved file offers ${b}`);
      check(await saved.getByRole("button", { name: "Show in Files" }).count() === 1, `${theme}: the card opens the subject's Files`);
      await shot("file-saved", ".guc-card");
      await saved.getByRole("button", { name: "Show in Files" }).click();
      await page.locator(".sp-file-open", { hasText: "Lecture 3.pdf" }).waitFor({ timeout: 6000 }).then(() => check(true, `${theme}: saved files show in the subject's Files tab`), () => check(false, `${theme}: saved files in Files`));
      check(await page.locator(".sp-file-open", { hasText: "Lecture 1.pdf" }).count() === 0, `${theme}: week 1 was not saved`);
      await shot("files");

      // The rule, schedule and Drive cards on the subject page.
      await page.getByRole("tab", { name: "CMS" }).click();
      await page.locator(".guc-subject").getByRole("tab", { name: "Settings" }).click();
      const rules = card("What Clem saves");
      await rules.waitFor({ timeout: 6000 });
      check(/PDFs only · week 2 onwards/.test(await rules.textContent()), `${theme}: the rule card describes the filters`);
      check(await rules.getByRole("button", { name: "Clear filters" }).count() === 1, `${theme}: filters can be cleared`);
      await shot("save-rules", ".guc-card:has-text('What Clem saves')");
      const when = card("When Clem checks CMS");
      check(/Every 2 hours, 08:00–22:00, Sat–Thu \(GUC week\)/.test(await when.textContent()), `${theme}: the schedule card says weekdays are Sat–Thu`);
      check(await when.getByRole("radio", { name: "Custom" }).getAttribute("aria-checked") === "true", `${theme}: a schedule from words shows as Custom`);
      check(/Coming up:/.test(await when.textContent()) && /Last checked/.test(await when.textContent()), `${theme}: next runs and the last check show`);
      await shot("check-schedule", ".guc-card:has-text('When Clem checks CMS')");
      const copy = card("Copy to Google Drive");
      check(/Folder: Clem\/GUC\/CSEN 701 Embedded Systems Architecture/.test(await copy.textContent()) && /2 copied/.test(await copy.textContent()), `${theme}: the Drive card shows the folder and the copies`);
      check(await copy.getByRole("button", { name: "Open" }).count() === 1 && await copy.getByRole("button", { name: "Change folder" }).count() === 1, `${theme}: the Drive card opens and changes the folder`);
      await shot("drive", ".guc-card:has-text('Copy to Google Drive')");
      drive.on = false;
      await engine.copyToDrive("embedded");
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      await card("Copy to Google Drive").getByRole("button", { name: "Reconnect Drive" }).waitFor({ timeout: 6000 }).then(() => check(true, `${theme}: a disconnected Drive shows Reconnect Drive`), () => check(false, `${theme}: Reconnect Drive`));
      await shot("drive-reconnect", ".guc-card:has-text('Copy to Google Drive')");

      // Summarize: a new chat in the subject with the file attached and the request typed.
      await page.getByRole("tab", { name: "Chats" }).click();
      await page.locator(".sp-chat", { hasText: "Setup" }).first().click();
      await card("new files from CMS").getByRole("button", { name: "Summarize Lecture 3.pdf" }).click();
      check(await until(async () => /Summarize Lecture 3\.pdf/.test(await page.locator(".composer textarea").inputValue())), `${theme}: Summarize opens a subject chat with the request typed`);
      await shot("summarize");
      check(!errors.length, `${theme}: no page errors` + (errors.length ? ": " + errors.join("; ") : ""));
    } catch (e) { check(false, `${theme}: ${e.message.split("\n")[0]}`); await shot("failure").catch(() => {}); }
    finally { await fx.close(); await engine.close(); await rm(dir, { recursive: true, force: true }); }
  }
} finally { await browser.close(); }
console.log(failed ? "GUC rules check failed." : "GUC rules verified; screenshots in " + out);
process.exit(failed ? 1 : 0);
