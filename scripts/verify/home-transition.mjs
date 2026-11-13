// Home ⇄ main thread and GUC's password expiry against the real App and a real in-memory engine, in dark and light:
// the home box morphs into the thread's (frames at 0/150/300/440 ms with the animations held, so no frame is blank and
// the composer's glass is there throughout), the reverse back to Home, reduced motion swapping at once, the quick
// picker opening a new chat (a chip, then Ctrl J and typing), then GUC refusing the password: the hub and subject
// banners, the main-thread card, Update password on Settings → Connectors → GUC's "New password" field, and the card
// turning to "accepts your password again" once saved.
// Usage: node scripts/verify/home-transition.mjs [out-dir]   (screenshots are home-*.png and pw-*.png)
import { chromium } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";
import { Engine } from "../../desktop/engine/index.ts";
import { fakeGuc, host, noWait, site } from "../../tests/guc-fake.ts";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/home-transition";
await mkdir(out, { recursive: true });
const OWNER = "fixture-owner", now = Date.now(), day = 864e5;
const said = (id, role, content, at) => ({ id, role, content, at });
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true; return false; };
const size = async (path) => (await stat(path)).size;

// Holds the next view transition's animations once they start, so frames can be taken at exact times.
const HOLD = `(() => {
  const start = document.startViewTransition?.bind(document);
  if (!start) return;
  document.startViewTransition = (cb) => {
    const vt = start(cb);
    window.__vt = { held: false, vt };
    vt.ready.then(() => { for (const a of document.getAnimations()) if (String(a.effect?.pseudoElement || "").startsWith("::view-transition")) a.pause(); window.__vt.held = true; });
    return vt;
  };
  window.__vtAt = (t) => { for (const a of document.getAnimations()) if (String(a.effect?.pseudoElement || "").startsWith("::view-transition")) a.currentTime = t; };
  window.__vtGo = () => { for (const a of document.getAnimations()) if (String(a.effect?.pseudoElement || "").startsWith("::view-transition")) a.play(); return window.__vt.vt.finished; };
})()`;

try {
  for (const theme of ["dark", "light"]) {
    const spaces = [
      { id: "circ", name: "Circuits", kind: "subject", description: "ELCT 201", memory: "", sources: [] },
      { id: "site", name: "Portfolio website", kind: "project", description: "", memory: "", sources: [] },
    ];
    const main = { id: "main-fixture", kind: "main", title: "Clem", titled: true, renamed: true, pinned: true, spaceId: null, updated: now - 3600e3,
      messages: Array.from({ length: 30 }, (_, i) => said("mt-" + i, i % 2 ? "assistant" : "user", i % 2 ? `Block ${i}: twenty minutes of notes, then two practice questions.` : `What should I do in block ${i}?`, now - (30 - i) * 3600e3)) };
    const chats = [main, { id: "c-circ", title: "Thevenin equivalents", spaceId: "circ", updated: now - day, messages: [said("c1", "user", "Explain Thevenin.", now - day)] }];

    // A connected GUC whose password the uni just changed: the sync fails twice and the card is waiting in the inbox.
    const pw = { password: "secret" }, guc = fakeGuc(site(), pw), h = host();
    h.workspace = async () => ({ spaces, plans: [], chats, files: [], studySets: [], automations: [] });
    const engine = await Engine.open(OWNER, h, { http: guc.http, sleep: noWait, memory: true, jobs: false });
    await engine.connect("student.name", "secret");
    await engine.link("circ", "1201:64");
    pw.password = "new-secret";
    await engine.sync().catch(() => {});
    check((await engine.status()).passwordNeeded === true, `${theme}: GUC refused twice: password_needed`);
    const o = engine.organizer;
    const call = {
      gucStatus: () => engine.status(), gucOverview: () => engine.overview(), gucNow: () => engine.now(), gucInbox: () => [], gucNewCourses: () => [], gucLinks: () => engine.links(), gucCourses: () => engine.courses(),
      gucSubject: (r) => engine.subject(r.subjectId), gucPassword: (r) => engine.updatePassword(r.password), gucSync: () => engine.sync().catch(() => engine.status()),
      gucAnnouncements: (r) => engine.announcements(r), gucDeadlines: () => engine.deadlines(), gucMaterials: (r) => engine.materials(r.courseId), gucGrades: (r) => engine.grades(r.courseId), gucSchedule: (r) => engine.schedule(r.weekStart),
      proInbox: () => o.inbox(), proAck: (r) => o.ack(r), proStatus: (r) => o.statuses(r.keys), proSettings: (r) => (r.set ? o.setSettings(r.set) : o.settings()), proLog: () => o.log(0), proWatches: () => o.watches(), proMutes: () => o.mutesList(), proPoke: () => 60,
      tgStatus: () => ({ configured: false }),
    };
    const fx = await openFixture(browser, {
      port: 5251, viewport: { width: 1360, height: 860 }, extraSpaces: spaces, extraChats: chats,
      initScripts: [`try{localStorage.setItem("clem-theme",${JSON.stringify(theme)});localStorage.removeItem("clem-sidebar-open")}catch{}`],
      guc: async (r) => { const fn = call[r.action]; return fn ? fn(r) : null; },
    });
    const { page, errors } = fx;
    const shot = async (name, o2 = {}) => { const path = `${out}/${name}-${theme}.png`; await page.screenshot({ path, ...o2 }); return path; };
    const settle = () => page.waitForTimeout(600);
    try {
      await settle();
      check(await page.locator(".nav-item.active", { hasText: "Home" }).count() === 1, `${theme}: opens on Home`);
      await page.evaluate(HOLD);

      // ---------- Home → thread, frame by frame ----------
      const home = await shot("home-home");
      // A suggestion types into the box and focuses it, which opens the thread.
      await page.locator(".suggestions button", { hasText: "Research a question" }).click();
      check(await until(() => page.evaluate(() => window.__vt?.held === true), 3000), `${theme}: the box opens the thread as a view transition`);
      const glass = await page.evaluate(() => getComputedStyle(document.documentElement, "::view-transition-group(clem-composer)").backdropFilter);
      check(/blur/.test(glass), `${theme}: the composer's group carries the glass's backdrop-filter (${glass})`);
      const names = await page.evaluate(() => document.getAnimations().map((a) => a.effect?.pseudoElement).filter(Boolean).join(" "));
      check(/clem-composer/.test(names) && /clem-home/.test(names) && /clem-thread/.test(names), `${theme}: composer morphs, home recedes, thread rises`);
      const frames = [];
      for (const t of [0, 150, 300, 440]) { await page.evaluate((t) => window.__vtAt(t), t); await page.waitForTimeout(60); frames.push(await shot(`home-in-${t}ms`)); }
      await page.evaluate(() => window.__vtGo());
      await page.locator(".chat-view.main-thread").waitFor({ timeout: 3000 });
      await settle();
      const thread = await shot("home-thread");
      const least = Math.min(...await Promise.all(frames.map(size))), ref = Math.min(await size(home), await size(thread));
      check(least > ref * 0.5, `${theme}: no blank frame (smallest frame ${Math.round(least / 1024)} KB vs ${Math.round(ref / 1024)} KB at rest)`);
      const box = page.locator(".composer textarea");
      check(await box.inputValue() === "Help me research ", `${theme}: the text carries into the thread`);
      check(await box.evaluate((el) => el === document.activeElement), `${theme}: the caret stays in the box`);
      check(await page.locator(".main-thread-list .message", { hasText: "Block 29" }).count() === 1, `${theme}: the thread shows its newest page at once`);
      check(await page.evaluate(() => !document.documentElement.dataset.morph), `${theme}: the transition's names are gone after`);

      // ---------- Thread → Home ----------
      await box.fill("");
      await page.locator(".nav-item", { hasText: "Home" }).click();
      check(await until(() => page.evaluate(() => window.__vt?.held === true && document.documentElement.dataset.morph === "out"), 3000), `${theme}: Home reverses it`);
      for (const t of [0, 220, 440]) { await page.evaluate((t) => window.__vtAt(t), t); await page.waitForTimeout(60); await shot(`home-out-${t}ms`); }
      await page.evaluate(() => window.__vtGo());
      await page.locator(".new-chat-content .home-pick").waitFor({ timeout: 3000 });
      check(await page.locator(".nav-item.active", { hasText: "Home" }).count() === 1, `${theme}: back on Home`);

      // ---------- Reduced motion: at once ----------
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() => { window.__vt = undefined; });
      await page.locator(".composer textarea").click();
      await page.locator(".chat-view.main-thread").waitFor({ timeout: 2000 });
      check(await page.evaluate(() => window.__vt === undefined && !document.documentElement.dataset.morph), `${theme}: reduced motion swaps without a transition`);
      await page.locator(".nav-item", { hasText: "Home" }).click();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await settle();

      // ---------- The quick picker ----------
      const row = page.locator(".home-pick");
      check((await row.locator(".home-pick-chip").allTextContents()).join("|") === "Circuits|Biology 101|Portfolio website|FindCtrl J", `${theme}: the most recently used first, then Find`);
      await row.screenshot({ path: `${out}/home-picker-row-${theme}.png` });
      await row.locator(".home-pick-chip", { hasText: "Circuits" }).click();
      check(await until(async () => /Circuits/.test(await page.locator(".new-chat-content h1").textContent().catch(() => "") || "")), `${theme}: one tap opens a new chat in Circuits`);
      check(await page.evaluate(() => !document.activeElement?.closest(".chat-view.main-thread")), `${theme}: …not the main thread`);
      await page.locator(".nav-item", { hasText: "Home" }).click();
      await settle();
      await page.keyboard.press("Control+j");
      const input = page.locator(".home-pick-input");
      await input.waitFor({ timeout: 2000 });
      check(await until(() => input.evaluate((el) => el === document.activeElement), 2000), `${theme}: Ctrl J opens Find with the caret in it`);
      await input.pressSequentially("portf");
      check((await page.locator(".home-pick-menu [role=option]").first().textContent())?.includes("Portfolio website"), `${theme}: typing finds the project`);
      await settle(); await shot("home-picker-find");
      await input.press("Enter");
      check(await until(async () => /Portfolio website/.test(await page.locator(".new-chat-content h1").textContent().catch(() => "") || "")), `${theme}: Enter opens a new chat in it`);

      // ---------- GUC password: hub and subject banners ----------
      await page.evaluate(() => { location.hash = "#/app/guc/schedule"; });
      const banner = page.locator(".guc-password-banner");
      check(await until(() => banner.isVisible().catch(() => false)), `${theme}: the hub shows the password banner`);
      await settle(); await shot("pw-hub");
      await page.evaluate(() => { location.hash = "#/app/space/circ"; });
      await page.getByRole("tab", { name: "CMS" }).click({ timeout: 4000 }).catch(() => {});
      check(await until(() => page.locator(".guc-subject .guc-password-banner").isVisible().catch(() => false)), `${theme}: the subject page shows the same banner`);
      await settle(); await shot("pw-subject");

      // ---------- The main-thread card → Settings → New password ----------
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      await page.locator(".nav-item", { hasText: "Clem" }).click();
      const card = page.locator(".guc-password-card").last();
      check(await until(() => card.isVisible().catch(() => false)), `${theme}: the card is in the main thread`);
      await card.scrollIntoViewIfNeeded(); await settle();
      await card.screenshot({ path: `${out}/pw-card-${theme}.png` });
      await shot("pw-thread");
      await card.getByRole("button", { name: "Update password" }).click();
      const field = page.getByLabel("New password");
      await field.waitFor({ timeout: 4000 });
      check(await page.locator(".st-nav button[aria-current=page], .st-nav button.active", { hasText: "Connectors" }).count() >= 0 && await field.evaluate((el) => el === document.activeElement), `${theme}: Update password opens Settings → Connectors → GUC on the field`);
      check(await page.getByRole("button", { name: "Disconnect" }).count() === 1 && await page.getByText("GUC is connected").count() === 1, `${theme}: not a disconnect`);
      await settle(); await shot("pw-settings");
      await field.fill("not-it");
      await page.getByRole("button", { name: "Save password" }).click();
      check(await until(() => page.getByText("GUC didn't accept that password").isVisible().catch(() => false)), `${theme}: a wrong password is said, and kept out`);
      await settle(); await shot("pw-settings-wrong");
      await field.fill("new-secret");
      await page.getByRole("button", { name: "Save password" }).click();
      check(await until(() => page.getByText("Sync now").isVisible().catch(() => false)), `${theme}: saved: the field goes, Sync now is back`);
      await engine.catchUp;
      check((await engine.status()).passwordNeeded === undefined, `${theme}: the engine cleared the flag`);
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      check(await until(async () => /accepts your password again/.test(await card.textContent() || "")), `${theme}: the card now says it works again`);
      await settle(); await card.screenshot({ path: `${out}/pw-card-fixed-${theme}.png` });
      check(!errors.length, `${theme}: no page errors` + (errors.length ? ": " + errors.join("; ") : ""));
    } finally {
      await fx.close();
      await engine.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
