// Microsoft Store listing screenshots (1920×1080) of the real interface, from the demo fixture.
//   node scripts/store-screenshots.mjs   → .work/store-screenshots/*.png
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openFixture } from "./verify/local-power-fixture.mjs";

const out = resolve(".work/store-screenshots");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const { page, close } = await openFixture(browser, { port: 5199, viewport: { width: 1920, height: 1080 } });
const shot = async (name, step) => {
  try { await step(); await page.waitForTimeout(1200); await page.screenshot({ path: join(out, name + ".png") }); console.log("saved", name); }
  catch (error) { console.log("skipped", name, String(error).split("\n")[0]); }
};
try {
  await page.waitForTimeout(2500);
  await shot("1-home", async () => {});
  const nav = (label) => page.locator("nav, aside").getByText(label, { exact: true }).first().click();
  await shot("2-chat", async () => { await page.getByText("Osmosis lab write-up").first().click(); });
  await shot("3-subjects", async () => { await nav("Subjects"); });
  await shot("4-visuals", async () => { await nav("Visuals"); });
  await shot("5-files", async () => { await nav("Files"); });
} finally { await close(); await browser.close(); }
