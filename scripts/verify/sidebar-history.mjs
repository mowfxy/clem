// Checks the sidebar history against the real App: pinned chats first, then one group per day
// (Today, Yesterday, then dates), newest first; the sliders button filters by space and opens search.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/sidebar-history";
await mkdir(out, { recursive: true });
const now = Date.now(), day = 864e5;
const chat = (id, title, updated, extra = {}) => ({ id, title, spaceId: null, updated, messages: [{ id: id + "-m", role: "user", content: title }], ...extra });
const extraChats = [
  chat("c-today", "Recover linked Epic Games account", now - 60e3),
  chat("c-yday", "Payment methods and tax questions", now - day),
  chat("c-watch", "Huawei Watch Fit 4 Pro app development with a very long title that fades out", now - day - 3600e3),
  chat("c-old", "PSpice simulation and circuit analysis steps", now - 40 * day),
  chat("c-pin", "Pinned reading list", now - 90 * day, { pinned: true }),
];
const browser = await chromium.launch();
const fixture = await openFixture(browser, { extraChats, viewport: { width: 1280, height: 900 } });
const { page, errors } = fixture;
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
try {
  await page.waitForTimeout(800);
  const labels = await page.locator(".history-group .history-label > span").allTextContents();
  check(labels[0] === "Pinned" && labels[1] === "Today" && labels[2] === "Yesterday", `groups start Pinned, Today, Yesterday (${labels.join(" | ")})`);
  check(labels.length === new Set(labels).size, "each day appears once");
  const titles = await page.locator(".history-group .history-title").allTextContents();
  check(titles[0] === "Pinned reading list" && titles[1] === "Recover linked Epic Games account", "pinned first, then newest");
  check(titles.indexOf("PSpice simulation and circuit analysis steps") === titles.length - 1, "oldest chat is last");
  await page.screenshot({ path: `${out}/sidebar.png`, clip: { x: 0, y: 0, width: 300, height: 900 } });

  // Filter to the Biology space and back.
  await page.getByRole("button", { name: "Filter chats" }).click();
  await page.locator(".history-filter-menu:popover-open").getByRole("menuitemradio", { name: "Biology 101" }).click();
  const bio = await page.locator(".history-group .history-title").allTextContents();
  check(bio.length === 2 && bio.every((t) => /Osmosis|Krebs/.test(t)), `space filter lists only its chats (${bio.join(", ")})`);
  check(await page.locator(".history-scope").getByText("Biology 101").isVisible(), "filter name is shown");
  await page.screenshot({ path: `${out}/filtered.png`, clip: { x: 0, y: 0, width: 300, height: 900 } });
  await page.locator(".history-scope-clear").click();
  check((await page.locator(".history-group .history-title").count()) === titles.length, "Show all restores every chat");

  // Search from the same menu.
  await page.getByRole("button", { name: "Filter chats" }).click();
  await page.locator(".history-filter-menu:popover-open").getByRole("button", { name: /Search chats/ }).click();
  await page.waitForTimeout(400);
  check(await page.locator("input:focus").count() === 1, "search opens with the field focused");
  check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
} finally {
  await fixture.close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
