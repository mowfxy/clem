// Screenshots every file kind's card mid-entrance, settled, and hovered.  node scripts/verify/file-art.mjs [out-dir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";
const out = process.argv[2] || "test-results/file-art";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const { page, close, errors } = await openFixture(browser, { replies: [], deviceScaleFactor: 2 });
await page.evaluate(async () => { (await import("/scripts/verify/file-art-gallery.tsx")).mount(); });
await page.waitForTimeout(350); await page.screenshot({ path: `${out}/entering.png` });
await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/settled.png` });
for (const [i, n] of [[2, "slides"], [3, "sheet"], [4, "image"]]) { await page.locator(".document-card").nth(i).hover(); await page.waitForTimeout(700); await page.locator(".document-card").nth(i).screenshot({ path: `${out}/hover-${n}.png` }); }
if (errors.length) console.log("page errors:", errors);
await close(); await browser.close();
