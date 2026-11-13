// Setup asks nothing per subject (docs/GUC-VPS-ENGINE.md → "Ask once, never per subject"), against the real App and a
// real in-memory engine synced from the fixture GUC, in dark and light: linking from the subject's CMS tab stays on the
// page and asks nothing, no Setup chat is made and nothing is posted, the Settings tab has no check
// schedule (Check now is on the course bar) and no storage choice without a VPS, and one "for all my courses" answer
// reaches every linked subject.
// Usage: node scripts/verify/guc-ask-once.mjs [out-dir]   (screenshots are ask-once-*.png)
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openFixture } from "./local-power-fixture.mjs";
import { Engine } from "../../desktop/engine/index.ts";
import { ALL_SUBJECTS } from "../../core/guc/settings.ts";
import { fakeGuc, host, noWait, site } from "../../tests/guc-fake.ts";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/guc-ask-once";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const until = async (fn, ms = 6000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true; return false; };

try {
  for (const theme of ["dark", "light"]) {
    const guc = fakeGuc(site());
    const engine = await Engine.open("fixture-owner", host(), { http: guc.http, sleep: noWait, memory: true, jobs: false });
    await engine.connect("student.name", "secret");
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
      replies: [], guc: (r) => call[r.action](r),
    });
    const { page, errors } = fx;
    const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: join(out, `ask-once-${name}-${theme}.png`) }); };
    try {
      await page.locator(".side-space .history-title", { hasText: "Embedded Systems" }).click();
      await page.getByRole("tab", { name: "CMS" }).click();
      await page.locator(".guc-link-pick li.is-best", { hasText: "CSEN 701" }).getByRole("button", { name: "Link" }).click();
      check(await until(async () => (await engine.links()).some((l) => l.subjectId === "embedded")), `${theme}: Link on the subject's CMS tab links the course`);
      await page.locator(".guc-course-bar").waitFor({ timeout: 6000 });
      check(await page.locator(".guc-course-bar").count() === 1 && await page.locator(".composer textarea").count() === 0, `${theme}: the page stays on the subject (no chat opens)`);
      check(await until(async () => (await engine.subject("embedded")).settings.setup?.finished === true), `${theme}: setup is finished with nothing asked`);
      check(await page.locator(".guc-course-bar").getByRole("button", { name: "Check now" }).count() === 1, `${theme}: Check now is on the course bar`);
      await shot("linked");

      await page.locator(".guc-subject").getByRole("tab", { name: "Settings" }).click();
      await page.locator(".guc-card", { hasText: "What Clem saves" }).waitFor({ timeout: 6000 });
      check(await page.locator(".guc-card", { hasText: "When Clem checks CMS" }).count() === 0, `${theme}: no check schedule to set`);
      check(await page.locator(".guc-card", { hasText: "Where files live" }).count() === 0, `${theme}: no storage choice without a VPS`);
      check(await page.locator(".guc-card", { hasText: "Copy to Google Drive" }).count() === 1, `${theme}: the Drive copy is still there`);
      await shot("settings");

      // No Setup chat is made and nothing is written anywhere: linking is all that happened.
      await page.locator(".guc-subject").getByRole("tab", { name: "Files" }).click();
      await page.getByRole("tab", { name: "Chats" }).click();
      await page.waitForTimeout(600);
      check(await page.locator(".sp-chat", { hasText: "Setup" }).count() === 0, `${theme}: no Setup chat was made`);
      check(await page.getByText(/What should I keep from it?|I watch it on CMS/).count() === 0, `${theme}: and nothing was posted about it`);
      await shot("no-setup-chat");

      // One answer for all courses reaches the linked subject and the ones linked later.
      await engine.setSettings(ALL_SUBJECTS, { save: { kinds: { videos: true, links: true } } });
      check((await engine.subject("embedded")).settings.save.kinds.videos === true, `${theme}: "for all my courses" changes the linked subject`);
      check((await engine.subject("another")).settings.save.kinds.links === true, `${theme}: and is what a new subject starts from`);
      check(errors.length === 0, `${theme}: no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
    } finally { await fx.close(); await engine.close(); }
  }
} finally { await browser.close(); }
if (failed) process.exit(1);
