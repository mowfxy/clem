// A subject's GUC setup against the real App and a real in-memory engine synced from the fixture GUC, in dark and light:
// the setup thread from the subject's CMS tab (Link on the card, a toggled chip and Looks good, a typed check time,
// Skip), editing a setting from the closing card, the AI changing a setting on request, the subject page's linked view
// and settings, the pinned Setup chat, and the main thread's new-semester card.
// Usage: node scripts/verify/guc-setup.mjs [out-dir]   (screenshots are setup-*.png)
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openFixture } from "./local-power-fixture.mjs";
import { Engine } from "../../desktop/engine/index.ts";
import { urls } from "../../core/guc/parse.ts";
import { fakeGuc, fixture, host, noWait, site } from "../../tests/guc-fake.ts";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/guc-setup";
await mkdir(out, { recursive: true });
const OWNER = "fixture-owner";
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const until = async (fn, ms = 6000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true; return false; };
const aiUpdate = 'Done, I stopped saving videos for Embedded Systems.\n\n```clem-card\n{"type":"settings_update","save":{"videos":false}}\n```';

try {
  for (const theme of ["dark", "light"]) {
    const pages = site(), guc = fakeGuc(pages);
    const engine = await Engine.open(OWNER, host(), { http: guc.http, sleep: noWait, memory: true, jobs: false });
    await engine.connect("student.name", "secret");
    const call = {
      gucStatus: () => engine.status(), gucSync: () => engine.status(), gucOverview: () => engine.overview(), gucCourses: () => engine.courses(),
      gucSchedule: (r) => engine.schedule(r.weekStart), gucAnnouncements: (r) => engine.announcements({ courseKey: r.courseId, cursor: r.cursor }), gucMarkRead: (r) => engine.markRead(r.ids),
      gucMaterials: (r) => engine.materials(r.courseId), gucSearch: (r) => engine.search(r.query), gucGrades: (r) => engine.grades(r.courseId), gucDeadlines: () => engine.deadlines(),
      gucFile: async () => { throw Error("Not in this check."); },
      gucLinks: () => engine.links(), gucLink: (r) => engine.link(r.subjectId, r.courseId), gucUnlink: (r) => engine.unlink(r.subjectId), gucSubject: (r) => engine.subject(r.subjectId),
      gucSetSettings: (r) => engine.setSettings(r.subjectId, r.patch), gucCheckNow: (r) => engine.checkNow(r.subjectId), gucForgetSubject: (r) => engine.forgetSubject(r.subjectId),
      gucNewCourses: () => engine.newCourses(), gucAckNewCourses: (r) => engine.ackNewCourses(r.keys),
    };
    const fx = await openFixture(browser, {
      port: 5234, viewport: { width: 1360, height: 900 },
      initScripts: [`try{localStorage.setItem("clem-theme",${JSON.stringify(theme)})}catch{}`],
      extraSpaces: [{ id: "embedded", name: "Embedded Systems", kind: "subject", description: "", memory: "", sources: [] }],
      replies: [aiUpdate], guc: (r) => call[r.action](r),
    });
    const { page, errors } = fx;
    const shot = async (name, el) => { await page.waitForTimeout(500); await (el ? page.locator(el).last() : page).screenshot({ path: join(out, `setup-${name}-${theme}.png`) }); };
    const settings = async () => (await engine.subject("embedded")).settings;
    const card = (title) => page.locator(".guc-card", { hasText: title }).last();
    try {
      check(await page.locator("html").getAttribute("data-theme") === theme, `${theme}: theme applied`);
      // The subject's CMS tab before linking: the likeliest course first.
      await page.locator(".side-space .history-title", { hasText: "Embedded Systems" }).click();
      await page.getByRole("tab", { name: "CMS" }).click();
      await page.locator(".guc-link-pick li.is-best", { hasText: "CSEN 701" }).waitFor({ timeout: 6000 });
      check(true, `${theme}: an unlinked subject offers CSEN 701 as its best match`);
      await shot("subject-unlinked");

      // The setup thread: one question at a time, each with its card.
      await page.getByRole("button", { name: "Set up in a chat" }).click();
      const link = card("Embedded Systems Architecture");
      await link.waitFor({ timeout: 6000 });
      check(await page.getByText("This looks like CSEN 701 (Embedded Systems Architecture) on CMS. Link it?").count() === 1, `${theme}: Clem asks "This looks like CSEN 701 … link it?"`);
      for (const b of ["Link", "Change", "Skip", "New subject from this course"]) check(await link.getByRole("button", { name: b, exact: true }).count() === 1, `${theme}: the link card offers ${b}`);
      await shot("link");
      const t0 = Date.now();
      await link.getByRole("button", { name: "Link", exact: true }).click();
      await card("What Clem saves").waitFor({ timeout: 6000 });
      console.log(`time ${theme}: Link → next question ${Date.now() - t0} ms`);
      check((await engine.links()).some((l) => l.subjectId === "embedded" && l.courseKey === "1201:64"), `${theme}: linking writes the engine's link`);
      check(await card("Embedded Systems Architecture").getByRole("button", { name: "Open in CMS" }).count() === 1, `${theme}: the link card now shows the live link (Open in CMS, Unlink)`);
      await card("What Clem saves").getByRole("button", { name: "Videos" }).click();
      check(await card("What Clem saves").getByRole("button", { name: "Videos" }).getAttribute("aria-pressed") === "true", `${theme}: a chip turns on at once`);
      check(await until(async () => (await settings()).save.kinds.videos === true), `${theme}: the chip writes the save rule to the engine`);
      await shot("save");
      await card("What Clem saves").getByRole("button", { name: "Looks good" }).click();
      await card("When Clem checks CMS").waitFor({ timeout: 6000 });
      check(await page.getByText(/Half an hour after each lecture works well: Sun 12:00/).count() === 1, `${theme}: the check suggestion comes from the lecture slots`);
      await shot("check");
      const box = page.locator(".composer textarea");
      await box.fill("every day at 8pm");
      await box.press("Enter");
      await card("Copy to Google Drive").waitFor({ timeout: 6000 });
      const s = await settings();
      check(s.check.mode === "custom" && s.check.times.length === 7 && s.check.times.every((t) => t.time === "20:00"), `${theme}: a typed answer is read locally ("every day at 8pm")`);
      check(!(await page.evaluate(() => window.requests.some((r) => r.action === "chat"))), `${theme}: no AI call for answers the local parser reads`);
      await shot("drive");
      await card("Copy to Google Drive").getByRole("button", { name: "Skip" }).click();
      await card("is set up").waitFor({ timeout: 6000 });
      check((await settings()).setup?.finished === true, `${theme}: setup finishes and is saved in the engine`);
      await shot("done");

      // Editing a setting from the closing card.
      await card("is set up").getByRole("button", { name: /^Saving/ }).click();
      await card("is set up").locator(".guc-summary-edit").getByRole("button", { name: "Links" }).click();
      check(await until(async () => (await settings()).save.kinds.links === true), `${theme}: editing a card writes the engine at once`);
      check(await card("is set up").locator(".guc-summary li", { hasText: "Saving" }).textContent().then((t) => /Everything/.test(t)), `${theme}: the summary shows the live rule (every kind on now)`);
      await shot("edit");

      // Telling the AI: its settings_update block is applied once the answer ends.
      await box.fill("stop saving videos");
      await box.press("Enter");
      check(await until(async () => (await settings()).save.kinds.videos === false, 12000), `${theme}: "stop saving videos" in the chat changes the rule`);
      const sent = await page.evaluate(() => window.requests.filter((r) => r.action === "chat").at(-1));
      check(!!sent && sent.messages.some((m) => m.role === "system" && m.content.includes("settings_update") && m.content.includes("CSEN 701")), `${theme}: the subject chat's AI is told the settings and how to change them`);
      await page.locator(".guc-updated", { hasText: "Stopped saving videos" }).waitFor({ timeout: 6000 }).then(() => check(true, `${theme}: the change shows as a card`), () => check(false, `${theme}: the change shows as a card`));
      await shot("ai-update");

      // The subject page once linked: the course's views and the same setting cards; the Setup chat pinned first.
      await page.locator(".side-space .history-title", { hasText: "Embedded Systems" }).click();
      await page.getByRole("tab", { name: "Chats" }).click();
      check(await page.locator(".sp-chat strong").first().textContent() === "Setup", `${theme}: the Setup chat is pinned at the top of the subject's chats`);
      await page.getByRole("tab", { name: "CMS" }).click();
      await page.locator(".guc-subject .guc-file").first().waitFor({ timeout: 6000 });
      check(await page.locator(".guc-subject .guc-week").count() === 2, `${theme}: the linked subject shows its course's files by week`);
      await shot("subject-linked");
      await page.locator(".guc-subject").getByRole("tab", { name: "Announcements" }).click();
      await page.locator(".guc-subject .guc-ann").first().waitFor();
      check(await page.locator(".guc-subject .guc-ann header b").evaluateAll((bs) => bs.every((b) => b.textContent === "CSEN 701")), `${theme}: only this course's announcements`);
      await page.locator(".guc-subject").getByRole("tab", { name: "Classes" }).click();
      check(await page.locator(".guc-classes li").count() === 2, `${theme}: the course's classes from the schedule`);
      await page.locator(".guc-subject").getByRole("tab", { name: "Settings" }).click();
      await card("When Clem checks CMS").waitFor();
      check(await card("When Clem checks CMS").getByRole("radio", { name: "Daily" }).getAttribute("aria-checked") === "true", `${theme}: the subject page shows the same live settings`);
      await card("When Clem checks CMS").getByRole("radio", { name: "After lectures" }).click();
      check(await until(async () => (await settings()).check.mode === "after_lectures"), `${theme}: settings are editable on the subject page`);
      await shot("subject-settings");

      // Settings → Connectors → GUC lists linked subjects with their settings.
      await page.evaluate(() => { location.hash = "/app/guc"; });
      await page.keyboard.press("Control+,");
      await page.getByRole("button", { name: /Connectors/ }).first().click();
      await page.locator(".st-row", { hasText: "GUC" }).getByRole("button", { name: "Manage" }).click();
      await page.locator(".guc-linked-item").first().click();
      await card("What Clem saves").waitFor({ timeout: 6000 }).then(() => check(true, `${theme}: Settings → GUC lists linked subjects with their settings`), () => check(false, `${theme}: Settings → GUC subjects`));
      await shot("settings-dialog", "dialog[open]");
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");

      // A new semester: courses no subject has get one card in the main thread.
      pages[urls.home] = fixture("cms-home").replace("Season : 64, Title: Winter 2026", "Season : 65, Title: Spring 2027")
        .replace("(|CSEN702|) Microprocessors (1202)", "(|CSEN802|) Software Engineering (1302)")
        .replace("(|DMET901|) Computer Vision (1203)", "(|DMET902|) Computer Graphics (1303)");
      await engine.sync();
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      await page.locator(".sidebar .nav-item:has(.nav-mark)").click();
      const fresh = card("new courses this semester");
      await fresh.waitFor({ timeout: 8000 }).then(() => check(true, `${theme}: the main thread offers the new courses`), () => check(false, `${theme}: new-semester card`));
      check(await fresh.getByRole("button", { name: "Set up" }).count() === 3, `${theme}: one Set up per new course`);
      await shot("new-semester");
      await fresh.locator("li", { hasText: "CSEN 802" }).getByRole("button", { name: "Set up" }).click();
      await page.getByText("is linked to **Software Engineering**").or(page.getByText(/CSEN 802 is linked to Software Engineering/)).first().waitFor({ timeout: 8000 }).then(() => check(true, `${theme}: Set up makes the subject and opens its setup thread`), () => check(false, `${theme}: Set up opens a setup thread`));
      check((await engine.links()).some((l) => l.courseKey === "1302:65"), `${theme}: the new subject is linked to its course`);
      await shot("new-subject-setup");
      check(!errors.length, `${theme}: no page errors` + (errors.length ? ": " + errors.join("; ") : ""));
    } catch (e) { check(false, `${theme}: ${e.message.split("\n")[0]}`); await shot("failure").catch(() => {}); }
    finally { await fx.close(); await engine.close(); }
  }
} finally { await browser.close(); }
console.log(failed ? "GUC setup check failed." : "GUC setup verified; screenshots in " + out);
process.exit(failed ? 1 : 0);
