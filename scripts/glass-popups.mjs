// Screenshots the notices and the Memory pop-up on the browser fixture, in both themes. Scripted data only.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./verify/local-power-fixture.mjs";

const out = process.argv[2] || "test-results/glass";
await mkdir(out, { recursive: true });
const capture = () => {
  let bridge;
  Object.defineProperty(window, "clemDesktop", { configurable: true, get: () => bridge, set(value) {
    const listen = value.onChat, invoke = value.invoke;
    window.__chat = new Set();
    value.onChat = (fn) => { window.__chat.add(fn); const stop = listen(fn); return () => { window.__chat.delete(fn); stop(); }; };
    const at = new Date(Date.now() - 2 * 864e5).toISOString();
    const record = (id, scope, text, confirmed, extra = {}) => ({ id, scope, key: "note:" + id, text, kind: confirmed ? "fact" : "inference", confirmed, updatedAt: at, sharedWith: [], source: { locator: "chat" }, ...extra });
    const records = [
      record("11111111-1111-4111-8111-111111111111", "user:me", "The user prefers short answers with one worked example.", true, { kind: "preference", key: "pref:short" }),
      record("22222222-2222-4222-8222-222222222222", "user:me", "The user is a second-year biology student.", false),
      record("33333333-3333-4333-8333-333333333333", "subject:bio", "The user finds membrane transport hard.", false),
      record("44444444-4444-4444-8444-444444444444", "subject:bio", "The user has a DSA lab test and EC quiz on October 15, 2026; a DSA midterm covering L1-6 on October 22; a Physics midterm on October 29.", true),
    ];
    value.invoke = async (r) => (r.action === "memoryAll" ? { enabled: true, records } : invoke(r));
    bridge = value;
  } });
};
const browser = await chromium.launch();
const fixture = await openFixture(browser, { initScripts: [capture], viewport: { width: 1440, height: 900 } });
const { page, errors } = fixture;
const theme = (name) => page.evaluate((name) => { document.documentElement.dataset.theme = name; window.dispatchEvent(new CustomEvent("clem-theme", { detail: name })); }, name);
try {
  await theme("dark");
  await page.waitForTimeout(800);
  await page.evaluate(() => { for (const fn of window.__chat) fn({ id: "r", type: "memory", text: "", memories: [
    { id: "22222222-2222-4222-8222-222222222222", text: "The user is a second-year biology student who studies mostly late at night and wants exam-style practice.", confirmed: false },
    { id: "33333333-3333-4333-8333-333333333333", text: "The user finds membrane transport hard.", confirmed: false }] }); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/notice-dark.png` });
  await page.locator(".notice-stack").hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/notice-open-zoom.png`, clip: { x: 0, y: 400, width: 300, height: 500 } });
  await page.mouse.move(900, 300);
  await page.locator(".profile-settings").click();
  await page.locator(".st-nav button", { hasText: "Memory" }).click();
  await page.getByRole("button", { name: "Open memory" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/memory-dark.png` });
  await theme("light");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/memory-light.png` });
  console.log(errors.length ? "page errors: " + errors.join("; ") : "no page errors");
} finally {
  await fixture.close();
  await browser.close();
}
