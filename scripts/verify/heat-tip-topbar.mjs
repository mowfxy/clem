// Heatmap hover tip and the top bar's files button in a temporary chat, against the real App with a scripted bridge.
// node --experimental-strip-types scripts/verify/heat-tip-topbar.mjs [out]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/tip-topbar";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const { page, close, errors } = await openFixture(browser, { port: 5196, replies: ["Hey! What are we studying today?"], deviceScaleFactor: 2 });
try {
  const heat = page.locator(".sw-heat");
  await heat.waitFor({ timeout: 20000 });
  await page.waitForTimeout(900);
  const cells = heat.locator("i:not([data-future])");
  const n = await cells.count();
  const levels = await cells.evaluateAll((els) => els.map((e) => e.dataset.level));
  let pick = levels.findLastIndex((l) => l !== "0"); if (pick < 0) pick = n - 10;
  await cells.nth(pick).hover();
  await page.waitForTimeout(250);
  console.log("tip:", await page.locator(".sw-tip").innerText());
  await page.locator(".sw-activity").screenshot({ path: `${out}/heat-tip.png` });
  await cells.nth(2).hover(); await page.waitForTimeout(250);
  await page.locator(".sw-activity").screenshot({ path: `${out}/heat-tip-edge.png` });

  await page.locator(".temp-toggle").click();
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: "Notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
  await page.getByLabel("Your message").fill("hey");
  await page.getByLabel("Your message").press("Enter");
  await page.locator(".temp-pill").waitFor();
  await page.waitForTimeout(1500);
  const box = (sel) => page.locator(sel).first().boundingBox();
  console.log("files", await box(".workspace-top .chat-files"), "controls", await box(".workspace-top .temp-controls"));
  await page.screenshot({ path: `${out}/topbar.png`, clip: { x: 0, y: 0, width: 1440, height: 120 } });
  if (errors.length) console.log("page errors:", errors);
} finally { await close(); await browser.close(); }
