// A failed account check (a bad connection) after the workspace opened must not close it: closing it stopped every
// running answer and showed "Can't reach Mowr" mid-answer. Opening Mowr while offline still shows that screen.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
const server = await createServer({ server: { host: "127.0.0.1", port: 5199, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const open = async (startOffline) => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await page.addInitScript((startOffline) => {
    const online = { active: true, reason: "free" }, offline = { active: false, reason: "offline" };
    window.fixture = { entitlement: startOffline ? offline : online, offline, online };
    window.mowrDesktop = {
      onAuth: () => () => {}, onChat: () => () => {}, onAttachment: () => () => {}, onCapture: () => () => {}, onFolder: () => () => {}, onPack: () => () => {},
      invoke: async (r) => {
        if (r.action === "status") return { configured: true, user: { id: "fixture-owner", email: "sam@example.com", name: "Sam" }, setup: { step: 4, username: "sam", displayName: "Sam", memory: true }, entitlement: window.fixture.entitlement };
        if (r.action === "providerAccounts") return { accounts: [], active: null, autoSwitch: false };
        if (r.action === "essentialSync") return { skills: r.skills, notes: r.notes };
        return {};
      },
    };
  }, startOffline);
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.includes("/api/local/")) return r.fallback();
    return r.fulfill({ json: path.endsWith("auth/session") ? { user: { id: "fixture-owner", email: "sam@example.com" }, auth: true } : path.endsWith("models") ? [] : {} });
  });
  await page.goto("http://127.0.0.1:5199/");
  return page;
};
try {
  const page = await open(false);
  // The workspace (App) is mounted: its own opening line, not the setup screen's.
  await page.locator("main.workspace-loading p, .workspace").first().waitFor({ timeout: 30000 });
  // The connection drops; the window regains focus and checks again.
  await page.evaluate(() => { window.fixture.entitlement = window.fixture.offline; window.dispatchEvent(new Event("focus")); });
  await page.waitForTimeout(1200);
  assert.equal(await page.getByText("Can’t reach Mowr.").count(), 0, "a failed check keeps the open workspace");
  assert.equal(await page.locator(".desktop-setup").count(), 0);
  await page.evaluate(() => { window.fixture.entitlement = window.fixture.online; window.dispatchEvent(new Event("focus")); });
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".desktop-setup").count(), 0);
  await page.close();

  const cold = await open(true);
  await cold.getByText("Can’t reach Mowr.").waitFor({ timeout: 30000 });
  await cold.close();
  console.log("Offline check passed: the open workspace stays, a cold offline start still asks.");
} finally {
  await browser.close();
  await server.close();
}
