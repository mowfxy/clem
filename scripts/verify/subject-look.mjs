// Screenshots of a subject's Chats, Flashcards, Quizzes and Files tabs, wide and narrow.
// node scripts/verify/subject-look.mjs [out-dir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/subject-look";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const { page, close, errors } = await openFixture(browser, { port: 5193, viewport: { width: 1440, height: 1100 } });
await page.evaluate(() => { location.hash = "/app/subjects"; }); await page.waitForTimeout(500);
await page.locator(".lib-card").first().click(); await page.waitForTimeout(1500);
for (const name of ["Chats", "Flashcards", "Quizzes", "Files"]) {
  await page.getByRole("tab", { name: new RegExp("^" + name) }).first().click(); await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name.toLowerCase()}.png` });
}
// The Add menu holds every way to bring something in.
await page.getByRole("button", { name: "Add" }).click(); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/files-add.png` });
await page.keyboard.press("Escape"); await page.mouse.click(1300, 1000);
await page.locator(".sp-folder", { hasText: "Past papers" }).click(); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/files-folder.png` });
await page.locator(".sp-path button", { hasText: "Files" }).click();
await page.setViewportSize({ width: 760, height: 1100 }); await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/files-narrow.png` });
if (errors.length) console.log("page errors:", errors);
process.exitCode = errors.length ? 1 : 0;
await close(); await browser.close();
