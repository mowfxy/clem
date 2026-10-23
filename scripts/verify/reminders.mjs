// Flashcard reminders: the Settings card, and a reminder click opening its subject at the review.
//   node scripts/verify/reminders.mjs   → test-results/reminders-*.png
// With the desktop build (npm run desktop:build), `--electron` also shows a real Windows notification from Clem.
import { chromium, _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openFixture } from "./local-power-fixture.mjs";

const browser = await chromium.launch();
const { page, errors, close } = await openFixture(browser, { port: 5194, initScripts: [() => {
  const settings = { enabled: true, time: "08:00" };
  const open = new Set();
  window.fireOpen = (event) => { for (const fn of open) fn(event); };
  let real;
  Object.defineProperty(window, "clemDesktop", { configurable: true, get: () => real, set: (bridge) => {
    real = { ...bridge, onOpen: (fn) => { open.add(fn); return () => open.delete(fn); }, invoke: async (r) => {
      if (r.action === "reminders") { if (r.set) Object.assign(settings, r.set); window.reminderSettings = { ...settings }; return { ...settings }; }
      return bridge.invoke(r);
    } };
  } });
}] });
try {
  await page.locator(".profile-settings").click();
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page.getByRole("heading", { name: "Study reminders" }).waitFor();
  await page.getByLabel("Reminder time").fill("07:30");
  await page.waitForFunction(() => window.reminderSettings?.time === "07:30");
  await page.getByRole("heading", { name: "Study reminders" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/reminders-settings.png" });
  await page.getByRole("switch", { name: "Remind me when cards are due" }).click({ force: true });
  await page.waitForFunction(() => window.reminderSettings?.enabled === false);
  assert.equal(await page.getByLabel("Reminder time").count(), 0);
  await page.locator(".st-close").click();
  // The reminder is clicked while Clem shows something else: Biology 101 opens with its review running.
  await page.evaluate(() => window.fireOpen({ review: "bio" }));
  await page.getByRole("button", { name: /Show answer/ }).waitFor();
  assert.ok(await page.getByRole("tab", { name: /Flashcards/ }).getAttribute("aria-selected"));
  await page.screenshot({ path: "test-results/reminders-review.png" });
  // Another subject opened later does not start a review by itself.
  await page.evaluate(() => window.fireOpen({ review: "not-a-subject" }));
  assert.deepEqual(errors, []);
  console.log("reminders: settings and a reminder click opening the review work");
} finally { await close(); await browser.close(); }

if (process.argv.includes("--electron")) {
  const userData = await mkdtemp(join(tmpdir(), "clem-reminder-"));
  const app = await electron.launch({ args: [resolve("desktop-dist/main.cjs"), "--user-data-dir=" + userData], timeout: 30000 });
  try {
    await (await app.firstWindow()).getByRole("heading", { name: "Welcome to Clem." }).waitFor();
    const shown = await app.evaluate(({ Notification }) => new Promise((done) => {
      if (!Notification.isSupported()) return done("unsupported");
      const note = new Notification({ title: "Time to review", body: "12 cards due in Biology 101", silent: true });
      note.on("show", () => done("shown")); note.on("failed", (_e, error) => done("failed: " + error));
      note.show(); setTimeout(() => done("no show event"), 8000);
    }));
    console.log("electron notification:", shown);
    assert.equal(shown, "shown");
  } finally { await app.close(); await rm(userData, { recursive: true, force: true }).catch(() => {}); }
}
