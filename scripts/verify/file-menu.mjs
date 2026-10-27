// Browser check for a file's ⋯ menu: near the bottom of the window it opens upward and stays fully on screen, it stays
// visible while open with the pointer elsewhere, and switching to another app closes it (it used to reappear on the
// next hover of its row, as if hovering had opened it).
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const { page, errors, close } = await openFixture(browser, { port: 5199, viewport: { width: 1280, height: 620 } });
try {
  await page.evaluate(() => { location.hash = "/app/subjects"; });
  await page.locator(".lib-card-open", { hasText: "Biology 101" }).click();
  await page.getByRole("tab", { name: /^Files/ }).click();
  await page.locator(".sp-folder", { hasText: "Worksheets" }).click();
  const row = page.locator(".sp-file").last();
  await row.waitFor();
  // Put the row at the very bottom of the window, where the menu used to run off the page.
  await row.evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) { p.scrollTop = 0; break; }
    const gap = window.innerHeight - el.getBoundingClientRect().bottom - 6;
    if (gap > 0) { const pad = document.createElement("div"); pad.style.height = gap + "px"; el.parentElement.insertBefore(pad, el); }
  });
  await row.hover();
  await row.getByRole("button", { name: /options/ }).click();
  const list = row.locator(".sp-menu-list");
  await list.waitFor();
  const box = await list.boundingBox(), height = await page.evaluate(() => innerHeight);
  assert.ok(box.y >= 0 && box.y + box.height <= height, `menu on screen: ${box.y}..${box.y + box.height} of ${height}`);
  assert.ok(await list.evaluate((el) => el.classList.contains("up")), "opens upward near the bottom");
  await page.screenshot({ path: "artifacts/file-menu-up.png" });

  // Open, pointer away, focus gone: still visible.
  await page.mouse.move(5, 5);
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(400);
  assert.equal(await row.locator(".sp-menu").evaluate((el) => getComputedStyle(el).opacity), "1", "an open menu stays visible");

  // Switching apps closes it; hovering the row afterwards does not bring it back.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await list.waitFor({ state: "detached" });
  await row.hover();
  await page.waitForTimeout(400);
  assert.equal(await row.locator(".sp-menu-list").count(), 0, "hover does not open the menu");
  assert.deepEqual(errors, []);
  console.log("file menu: ok");
} finally {
  await close();
  await browser.close();
}
