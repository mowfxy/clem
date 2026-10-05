// Checks the memory notice and chat deletion against the real App with a scripted desktop bridge:
// a "memory" event after an answer shows a notice whose Forget button forgets exactly those records,
// and deleting a chat asks the desktop to forget what was only learned from it.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/memory-notice";
await mkdir(out, { recursive: true });
// Keep a handle on the App's chat listeners so the test can send what the main process would.
const capture = () => {
  let bridge;
  Object.defineProperty(window, "mowrDesktop", {
    configurable: true,
    get: () => bridge,
    set(value) {
      const listen = value.onChat;
      window.__chatListeners = new Set();
      value.onChat = (fn) => { window.__chatListeners.add(fn); const stop = listen(fn); return () => { window.__chatListeners.delete(fn); stop(); }; };
      bridge = value;
    },
  });
};
const browser = await chromium.launch();
const fixture = await openFixture(browser, { initScripts: [capture] });
const { page, errors } = fixture;
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
try {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  await page.evaluate((ids) => {
    for (const fn of window.__chatListeners) fn({ id: "run-1", type: "memory", text: "", memories: [
      { id: ids[0], text: "The user is a second-year biology student.", confirmed: false },
      { id: ids[1], text: "The user has a midterm on 20 October.", confirmed: false },
    ] });
  }, ids);
  const notice = page.locator(".notice-card", { hasText: "Mowr noted this" });
  await notice.waitFor({ timeout: 5000 });
  check(await notice.getByText("second-year biology student").isVisible(), "notice shows what was noted");
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/notice.png` });
  await notice.getByRole("button", { name: /Forget/ }).click();
  await page.waitForFunction(() => window.requests.some((r) => r.action === "memoryForget"));
  const forget = await page.evaluate(() => window.requests.find((r) => r.action === "memoryForget"));
  check(JSON.stringify(forget.ids) === JSON.stringify(ids), "Forget sends both ids");

  // A kept memory ("remember that…") says so.
  await page.evaluate(() => { for (const fn of window.__chatListeners) fn({ id: "run-2", type: "memory", text: "", memories: [{ id: "33333333-3333-4333-8333-333333333333", text: "The user prefers SI units.", confirmed: true }] }); });
  await page.locator(".notice-card", { hasText: "Mowr will remember this" }).waitFor({ timeout: 5000 });
  check(true, "kept memory notice");

  // Deleting a chat forgets what was only learned from it.
  await page.getByRole("button", { name: "Chat options for Krebs cycle in plain words" }).click();
  await page.locator(".chat-options:popover-open").getByRole("button", { name: "Delete chat" }).click();
  const modal = page.getByRole("dialog").filter({ hasText: "Delete conversation?" });
  await modal.waitFor({ timeout: 5000 });
  check(await modal.getByText("memory you kept stay").isVisible(), "delete dialog explains what is forgotten");
  await page.screenshot({ path: `${out}/delete.png` });
  await modal.getByRole("button", { name: "Delete conversation" }).click();
  await page.waitForFunction(() => window.requests.some((r) => r.action === "memoryForgetChat"), null, { timeout: 5000 });
  const forgetChat = await page.evaluate(() => window.requests.find((r) => r.action === "memoryForgetChat"));
  check(JSON.stringify(forgetChat.chats) === '["c-krebs"]', "deleting the chat forgets its learned memory");
  check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
} catch (error) {
  console.log("FAIL " + error.message);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  failed = true;
} finally {
  await fixture.close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
